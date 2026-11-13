const kanaEl = document.getElementById("kana");
const tipEl = document.getElementById("tip");
const practiceEl = document.getElementById("practice");
const answerEl = document.getElementById("answer");
const feedbackEl = document.getElementById("feedback");
const scoreEl = document.getElementById("score");
const toggleBtn = document.getElementById("toggle");
const modeEl = document.getElementById("mode");
const availEl = document.getElementById("avail");
const hintEl = document.getElementById("practice-hint");
const choicesEl = document.getElementById("choices");
const starEl = document.getElementById("star");
const nudgeEl = document.getElementById("nudge");
const togglesEl = document.querySelector(".toggles");
const tabsEl = document.getElementById("tabs");
const panelsEl = document.getElementById("panels");
const groupEls = [...document.querySelectorAll(".toggles input")];

const ROWS_KEY = "kanatype.rows";
const TAB_KEY = "kanatype.tab";
const MODE_KEY = "kanatype.mode";
const LOCK_MS = 450;          // after a wrong answer, ignore keystrokes so fast typers don't overshoot
const HOVER_REVEAL_MS = 350;  // hover delay before the answer is revealed (avoids accidental reveals)
const MIN_WORDS = 5;          // words needed in the pool before Words mode can start
const COOLDOWN = 20;          // a word is not repeated within this many words
const LOCK_MSG = "Tick a few more columns to unlock words";
const NUDGE_KEY = "kanatype.nudged";
const MINE = "mine";          // id of the "Your words" tab (Words mode only)

let selected = loadRows();
let activeScript = loadScript();
let mode = loadMode();        // "kana" | "words"
let running = false;
let paused = false, pauseStart = 0;
let current = null;           // kana item {ch, answers, romaji, row} or word item (see WORDS in words.js)
let shownAt = 0;
let missedThis = false;       // a miss (wrong answer or revealed answer) was already recorded for this item
let lockUntil = 0, lockedValue = "";
let holdValue = "";           // what the box shows while a finished word waits for Enter
let hoverTimer = null;
let sessionCorrect = 0, sessionTotal = 0;
// Words mode state
let wstate = null;            // per-word progress: { n kana done, last timestamp, ms[], failed index, revealed }
let holding = false, holdTimer = null;
let sessionWords = 0, sessionMs = 0;
let recent = [];
// Meaning check: every 8-10 words, a quick 3-option "what does it mean?" after a correct word
let checking = false, checkAnswered = false, checkOptions = [];
let sinceCheck = 0, nextCheck = rollNextCheck();
function rollNextCheck() { return 8 + Math.floor(Math.random() * 3); }

const WORD_BY_W = Object.fromEntries(WORDS.map(x => [x.w, x]));
const cells = new Map();      // kana -> table cell element
const heads = new Map();      // row id -> column checkbox

/* ---------- persistence ---------- */
function loadRows() {
  try {
    const raw = JSON.parse(localStorage.getItem(ROWS_KEY));
    if (Array.isArray(raw)) {
      // older saves used plain ids like "ka"; those were hiragana columns
      const ids = raw.map(id => ROWS.some(r => r.id === id) ? id : "h-" + id);
      const valid = ids.filter(id => ROWS.some(r => r.id === id));
      if (valid.length) return new Set(valid);
    }
  } catch (e) {}
  return new Set(["h-a"]);
}
function loadScript() {
  try {
    const s = localStorage.getItem(TAB_KEY);
    if (SCRIPTS.some(x => x.id === s)) return s;
    if (s === MINE && loadMode() === "words") return s;
  } catch (e) {}
  return SCRIPTS[0].id;
}
function loadMode() {
  try { if (localStorage.getItem(MODE_KEY) === "words") return "words"; } catch (e) {}
  return "kana";
}
function saveRows() {
  try { localStorage.setItem(ROWS_KEY, JSON.stringify([...selected])); } catch (e) {}
}

/* ---------- kana table (column picker + confidence in one), one tab per script ---------- */
function buildTable() {
  tabsEl.innerHTML = "";
  panelsEl.innerHTML = "";
  SCRIPTS.forEach(s => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.setAttribute("role", "tab");
    tab.dataset.script = s.id;
    tab.addEventListener("click", () => setTab(s.id));
    tabsEl.appendChild(tab);

    const panel = document.createElement("div");
    panel.className = "table-scroll";
    panel.dataset.script = s.id;
    const table = document.createElement("div");
    table.className = "table";
    panel.appendChild(table);
    panelsEl.appendChild(panel);

    const firstDakuten = s.rows.findIndex(r => r.group === "dakuten");
    const spacer = () => { const d = document.createElement("div"); d.className = "spacer"; table.appendChild(d); };

    s.rows.forEach((r, i) => {
      if (i === firstDakuten) spacer();
      const head = document.createElement("label");
      head.className = "colhead";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.addEventListener("change", () => toggleRow(r.id, cb.checked));
      head.append(cb, document.createTextNode(r.label));
      table.appendChild(head);
      heads.set(r.id, cb);
    });
    for (let slot = 0; slot < 5; slot++) {
      s.rows.forEach((r, i) => {
        if (i === firstDakuten) spacer();
        const cell = document.createElement("div");
        const idx = r.slots.indexOf(slot);
        if (idx === -1) {
          cell.className = "cell empty";
        } else {
          const [ch, ro] = r.kana[idx];
          cell.className = "cell";
          cell.innerHTML = '<div class="ch">' + ch + '</div><div class="ro">' + ro + "</div>";
          cells.set(ch, cell);
        }
        table.appendChild(cell);
      });
    }
  });

  // "Your words": third tab, only shown in Words mode
  const mineTab = document.createElement("button");
  mineTab.type = "button";
  mineTab.setAttribute("role", "tab");
  mineTab.dataset.script = MINE;
  mineTab.addEventListener("click", () => setTab(MINE));
  tabsEl.appendChild(mineTab);
  const minePanel = document.createElement("div");
  minePanel.className = "table-scroll mine";
  minePanel.dataset.script = MINE;
  panelsEl.appendChild(minePanel);
}

/* ---------- "Your words": words seen, known and saved ---------- */
function renderMine() {
  const panel = panelsEl.querySelector('[data-script="' + MINE + '"]');
  const top = panel.scrollTop;
  const items = Object.entries(wordStats)
    .map(([w, s]) => ({ w, s, def: WORD_BY_W[w] }))
    .filter(x => x.def && (x.s.seen > 0 || x.s.starred));
  items.sort((a, b) => (b.s.starred ? 1 : 0) - (a.s.starred ? 1 : 0) || (b.s.last || 0) - (a.s.last || 0));
  const seen = items.filter(x => x.s.seen > 0).length;
  const known = items.filter(x => isKnown(x.w)).length;
  const saved = items.filter(x => x.s.starred).length;
  panel.innerHTML = "";
  const summary = document.createElement("div");
  summary.className = "mine-summary";
  summary.innerHTML = "<span><b>" + seen + "</b> seen</span><span><b>" + known + "</b> known</span><span><b>" + saved + "</b> saved</span>";
  panel.appendChild(summary);
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "mine-empty";
    empty.textContent = "Words you complete will appear here with their meaning. Star the ones you want to keep reviewing.";
    panel.appendChild(empty);
  }
  items.forEach(({ w, s, def }) => {
    const row = document.createElement("div");
    row.className = "mine-row";
    const word = document.createElement("span");
    word.className = "mw";
    word.textContent = w;
    if (def.k) { const k = document.createElement("small"); k.textContent = def.k; word.appendChild(k); }
    const mean = document.createElement("span");
    mean.className = "mm";
    mean.textContent = def.m;
    const meta = document.createElement("span");
    meta.className = "ms";
    meta.textContent = "seen " + s.seen;
    const badge = document.createElement("span");
    if (isKnown(w)) { badge.className = "known"; badge.textContent = "known"; }
    const star = document.createElement("button");
    star.type = "button";
    star.className = "st" + (s.starred ? " on" : "");
    star.textContent = s.starred ? "★" : "☆";
    star.setAttribute("aria-label", (s.starred ? "Unsave " : "Save ") + w);
    star.addEventListener("click", () => { toggleStar(w); updateStarUI(); renderMine(); });
    row.append(word, mean, meta, badge, star);
    panel.appendChild(row);
  });
  panel.scrollTop = top;
}

function groupRows(script, group) {
  return ROWS.filter(r => r.script === script && (group === "all" || r.group === group));
}

function updateTable() {
  ROWS.forEach(r => {
    heads.get(r.id).checked = selected.has(r.id);
    r.kana.forEach(([ch]) => {
      const c = confidence(ch);
      const cls = c === null ? "" : c < 0.5 ? " s-low" : c < 0.8 ? " s-mid" : " s-high";
      cells.get(ch).className = "cell" + cls + (selected.has(r.id) ? "" : " off");
    });
  });
  // "Your words" only exists in Words mode; fall back to a script tab otherwise
  if (activeScript === MINE && mode !== "words") activeScript = lastScript;
  // tabs: label, selected state, and how many columns are ticked in that script
  tabsEl.querySelectorAll("button").forEach(tab => {
    tab.setAttribute("aria-selected", tab.dataset.script === activeScript);
    if (tab.dataset.script === MINE) {
      const seen = Object.values(wordStats).filter(s => s.seen > 0).length;
      tab.hidden = mode !== "words";
      tab.innerHTML = "Your words" + (seen ? '<span class="badge">' + seen + "</span>" : "");
      return;
    }
    const s = SCRIPTS.find(x => x.id === tab.dataset.script);
    const n = s.rows.filter(r => selected.has(r.id)).length;
    tab.innerHTML = s.label + (n ? '<span class="badge">' + n + "</span>" : "");
  });
  panelsEl.querySelectorAll(".table-scroll").forEach(p => { p.hidden = p.dataset.script !== activeScript; });
  if (activeScript === MINE) renderMine();
  // All / Regular / Dakuten toggles act on the visible script (not on "Your words")
  togglesEl.hidden = activeScript === MINE;
  if (activeScript !== MINE) {
    groupEls.forEach(cb => {
      const rows = groupRows(activeScript, cb.dataset.group);
      const n = rows.filter(r => selected.has(r.id)).length;
      cb.checked = n === rows.length;
      cb.indeterminate = n > 0 && n < rows.length;
    });
  }
  updateNudge();
}

let lastScript = activeScript === MINE ? SCRIPTS[0].id : activeScript;
function setTab(id) {
  activeScript = id;
  if (id !== MINE) lastScript = id;
  try { localStorage.setItem(TAB_KEY, id); } catch (e) {}
  updateTable();
}

/* ---------- one-time "Word mode unlocked" hint ---------- */
// Shown in Kana mode once about three columns are known at amber or better.
function columnsAmberOrBetter() {
  return ROWS.filter(r => r.kana.every(([ch]) => { const c = confidence(ch); return c !== null && c >= 0.5; })).length;
}
function nudgeSeen() {
  try { return localStorage.getItem(NUDGE_KEY) === "1"; } catch (e) { return false; }
}
function markNudgeSeen() {
  try { localStorage.setItem(NUDGE_KEY, "1"); } catch (e) {}
}
function updateNudge() {
  nudgeEl.hidden = nudgeSeen() || mode !== "kana" || columnsAmberOrBetter() < 3;
}
nudgeEl.addEventListener("click", () => setMode("words"));

function inPool(item) {
  return item.isWord ? item.rows.every(r => selected.has(r)) : selected.has(item.row);
}

function setRows(ids) {
  selected = new Set(ids);
  if (selected.size === 0) selected.add(ROWS[0].id); // always keep at least one row
  saveRows();
  updateTable();
  updateModeUI();
  if (running) {
    if (mode === "words" && eligibleWords().length < MIN_WORDS) stop(); // not enough words left to practice
    else if (!inPool(current)) showNext();
  }
}
function toggleRow(id, on) {
  const next = new Set(selected);
  if (on) next.add(id); else next.delete(id);
  setRows([...next]);
}
groupEls.forEach(cb => cb.addEventListener("change", () => {
  const next = new Set(selected);
  groupRows(activeScript, cb.dataset.group).forEach(r => cb.checked ? next.add(r.id) : next.delete(r.id));
  setRows([...next]);
}));

/* ---------- Kana | Words mode ---------- */
function eligibleWords() {
  return WORDS.filter(x => x.supported && x.rows.every(r => selected.has(r)));
}

function idleGlyph() { return mode === "words" ? "ことば" : "かな"; }

// Keeps the mode switch, the idle card, the Start button and the "N words available" line in sync.
function updateModeUI() {
  const isWords = mode === "words";
  modeEl.querySelectorAll("button").forEach(b => b.setAttribute("aria-selected", b.dataset.mode === mode));
  availEl.hidden = !isWords;
  const n = isWords ? eligibleWords().length : 0;
  if (isWords) {
    availEl.textContent = n + (n === 1 ? " word" : " words") + " available with your selection" +
      (n < SUPPORTED_WORD_COUNT ? " · tick more columns to unlock more" : "");
  }
  hintEl.textContent = isWords
    ? "Type the word in romaji. Press Enter if you don't know it to see the answer, and Enter again for the next word. Hover the word to peek (counts as a miss). Esc stops."
    : "Hover over the kana to reveal the answer (it counts as a miss). Press Esc to stop.";
  const locked = isWords && n < MIN_WORDS;
  toggleBtn.disabled = locked && !running;
  if (!running) {
    kanaEl.textContent = idleGlyph();
    kanaEl.classList.toggle("word", isWords);
    kanaEl.classList.add("idle");
    if (locked) setFeedback(LOCK_MSG, true);
    else if (feedbackEl.textContent === LOCK_MSG) setFeedback("");
  }
}

function setMode(m) {
  if (m === mode) return;
  if (running) stop();
  mode = m;
  try { localStorage.setItem(MODE_KEY, mode); } catch (e) {}
  if (mode === "words") markNudgeSeen();               // they found Words mode, so no hint needed
  if (mode === "kana" && activeScript === MINE) setTab(lastScript); // "Your words" is Words-mode only
  sessionCorrect = sessionTotal = sessionWords = sessionMs = 0;
  setFeedback("");
  renderScore();
  updateModeUI();
  updateTable();
}
modeEl.querySelectorAll("button").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));

/* ---------- picking the next item (weighted towards weak kana) ---------- */
function weightedPick(options, weights) {
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < options.length; i++) {
    r -= weights[i];
    if (r <= 0) return options[i];
  }
  return options[options.length - 1];
}

function pool() { return ALL_KANA.filter(k => selected.has(k.row)); }

function pickNext() {
  const p = pool();
  const options = p.length > 1 ? p.filter(k => !current || k.ch !== current.ch) : p;
  return weightedPick(options, options.map(k => weight(k.ch)));
}

// Common words that contain your weak kana come up most: frequency weight x weakness.
function pickNextWord() {
  const p = eligibleWords();
  const cd = Math.min(COOLDOWN, p.length - 1);
  const banned = new Set(cd > 0 ? recent.slice(-cd) : []);
  let options = p.filter(x => !banned.has(x.w));
  if (!options.length) options = p;
  const weights = options.map(x => {
    const ws = x.kana.map(e => weight(e.ch));
    const mean = ws.reduce((a, b) => a + b, 0) / ws.length;
    return (0.5 + 1 / (1 + x.rank / 60)) * (mean + Math.max(...ws));
  });
  const picked = weightedPick(options, weights);
  recent.push(picked.w);
  if (recent.length > COOLDOWN) recent.shift();
  return picked;
}

/* ---------- practice loop ---------- */
function wpm() { return sessionMs > 0 ? Math.round(sessionWords / (sessionMs / 60000)) : 0; }
function accuracy() { return sessionTotal ? Math.round(100 * sessionCorrect / sessionTotal) : 0; }

function renderScore() {
  if (mode === "words") {
    scoreEl.textContent = sessionWords
      ? sessionWords + (sessionWords === 1 ? " word" : " words") + " · " + wpm() + " wpm · " + accuracy() + "%"
      : "0 words";
  } else {
    scoreEl.textContent = sessionCorrect + " / " + sessionTotal;
  }
}

function setFeedback(text, info) {
  feedbackEl.textContent = text;
  feedbackEl.classList.toggle("info", !!info);
}

// Clears the meaning-check and star UI (used when moving to the next word and on stop).
function resetWordExtras() {
  checking = false;
  checkAnswered = false;
  choicesEl.hidden = true;
  choicesEl.innerHTML = "";
  starEl.hidden = true;
  if (running) {
    answerEl.disabled = false;
    answerEl.placeholder = "romaji";
  }
}

function updateStarUI() {
  if (!current || !current.isWord) return;
  const on = isStarred(current.w);
  starEl.classList.toggle("on", on);
  starEl.textContent = on ? "★" : "☆";
  starEl.title = on ? "Saved – click to unsave" : "Save this word";
  starEl.setAttribute("aria-label", starEl.title);
}
starEl.addEventListener("click", () => {
  if (!current || !current.isWord) return;
  toggleStar(current.w);
  updateStarUI();
  if (activeScript === MINE) renderMine();
  clearTimeout(holdTimer);   // they are interacting, so don't whisk the word away
  updateTable();
});

/* ----- meaning check: retrieval practice every 8-10 words ----- */
function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startMeaningCheck() {
  checking = true;
  checkAnswered = false;
  // wrong options: meanings of other words you can read (fall back to any word)
  const other = x => x.supported && x.m !== current.m;
  let wrongs = [...new Set(shuffled(eligibleWords().filter(other)).map(x => x.m))];
  if (wrongs.length < 2) wrongs = [...new Set(shuffled(WORDS.filter(other)).map(x => x.m))];
  checkOptions = shuffled([current.m, ...wrongs.slice(0, 2)]);
  choicesEl.innerHTML = "";
  checkOptions.forEach((text, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = (i + 1) + ". " + text;
    b.addEventListener("click", () => chooseOption(i));
    choicesEl.appendChild(b);
  });
  choicesEl.hidden = false;
  setFeedback("What does it mean?", true);
  answerEl.disabled = true;
  answerEl.placeholder = "Pick 1, 2 or 3";
  answerEl.blur();
}

function chooseOption(i) {
  if (!checking || checkAnswered || paused) return;
  checkAnswered = true;
  const ok = checkOptions[i] === current.m;
  recordMeaningCheck(current.w, ok);
  choicesEl.querySelectorAll("button").forEach((b, j) => {
    b.disabled = true;
    if (checkOptions[j] === current.m) b.classList.add("correct");
    else if (j === i) b.classList.add("wrong");
  });
  setFeedback((ok ? "Correct – " : "It means ") + meaningLine() + "  ·  press Enter for the next word", ok);
  answerEl.placeholder = "Press Enter";
  if (activeScript === MINE) renderMine();
  updateTable();
}

function showNext() {
  clearTimeout(holdTimer);
  holding = false;
  resetWordExtras();
  if (mode === "words") {
    current = pickNextWord();
    current.isWord = true;
    current.ch = current.w;
    wstate = { n: 0, last: performance.now(), ms: [], revealed: false };
    renderWord();
  } else {
    current = pickNext();
    kanaEl.classList.remove("word");
    kanaEl.textContent = current.ch;
  }
  answerEl.value = "";
  answerEl.classList.remove("wrong", "right", "ok");
  hideTip(true);
  setFeedback("");
  missedThis = false;
  lockUntil = 0;
  shownAt = performance.now();
  if (wstate) wstate.last = shownAt;
}

function advance() {
  showNext();
  answerEl.focus();
}

/* ----- word display: plain text, one fixed size for every word ----- */
function renderWord() {
  kanaEl.classList.add("word");
  kanaEl.textContent = current.w;
}

// "猫 · cat": the usual kanji spelling (if any) and the meaning, shown after the word is answered
function meaningLine() {
  return (current.k ? current.k + "  ·  " : "") + current.m;
}

// How far through the word is `val`? done = kana fully typed. If `val` can't be the start of any
// accepted spelling, the kana at index `done` is the one that went wrong. Tries every accepted
// spelling of each kana (si/shi, n/nn, ...), backtracking where they differ.
function parseWord(item, val) {
  let reach = 0, valid = false;
  (function walk(i, pos) {
    if (i > reach) reach = i;
    if (pos === val.length) { valid = true; return; }
    if (i >= item.alts.length) return;
    for (const a of item.alts[i]) {
      if (val.startsWith(a, pos)) walk(i + 1, pos + a.length);
      else if (a.startsWith(val.slice(pos))) valid = true;   // still typing kana i
    }
  })(0, 0);
  return { done: reach, valid };
}

function wordProgress(val) {
  const p = parseWord(current, val);
  const total = current.kana.length;
  while (wstate.n < Math.min(p.done, total)) {
    const now = performance.now();
    wstate.ms[wstate.n] = now - wstate.last;
    wstate.last = now;
    wstate.n++;
  }
}

// Record at most one result per kana shown: the first wrong answer or reveal counts as the miss.
function markMiss() {
  if (missedThis) return;
  missedThis = true;
  recordResult(current.ch, false, performance.now() - shownAt);
  sessionTotal++;
  renderScore();
  updateTable();
}

// The answer appears as a speech bubble above the kana. After a wrong answer it stays
// (pinned) until the next kana; when revealed by hovering it hides again on mouse-leave.
let tipPinned = false;
function showTip(pin) {
  tipEl.textContent = current.romaji;
  tipEl.classList.add("show");
  if (pin) tipPinned = true;
}
function hideTip(force) {
  if (force) tipPinned = false;
  if (!tipPinned) tipEl.classList.remove("show");
}
function showAnswer() { showTip(true); }

function acceptKana() {
  if (!missedThis) {
    recordResult(current.ch, true, performance.now() - shownAt);
    sessionTotal++;
    sessionCorrect++;
    renderScore();
    updateTable();
  }
  showNext();
  answerEl.classList.add("right");
}

// Words are not judged while you type. A correct answer turns the box green and ends the turn;
// Enter with an empty or wrong answer gives up and shows the answer. Either way the word stays on
// screen with its meaning until Enter is pressed again.
function acceptWord() {
  const now = performance.now();
  const total = current.kana.length;
  while (wstate.n < total) {            // make sure every kana is marked complete
    wstate.ms[wstate.n] = now - wstate.last;
    wstate.last = now;
    wstate.n++;
  }
  const ok = !missedThis;               // false if the answer was peeked at by hovering
  if (ok) { sessionTotal++; sessionCorrect++; }
  // Every kana in the word gets a correct, unless the answer was revealed first (no credit then).
  if (!wstate.revealed) current.kana.forEach((e, i) => recordResult(e.ch, true, wstate.ms[i]));
  const took = now - shownAt;
  recordWord(current.w, ok, took);
  sessionWords++;
  sessionMs += took;
  renderScore();
  updateTable();
  answerEl.classList.remove("wrong");
  answerEl.classList.add("ok");         // green outline
  holdValue = answerEl.value;
  hideTip(true);
  starEl.hidden = false;
  updateStarUI();
  if (activeScript === MINE) renderMine();
  // Every 8-10 words, ask for the meaning instead of showing it (needs enough words for options).
  // The kanji spelling is held back too, since it could give the meaning away.
  sinceCheck++;
  answerEl.placeholder = "Press Enter";
  if (sinceCheck >= nextCheck && WORDS.filter(x => x.supported).length >= 3) {
    sinceCheck = 0;
    nextCheck = rollNextCheck();
    startMeaningCheck();
    return;
  }
  setFeedback(meaningLine() + "  ·  press Enter for the next word", true);
  holding = true;
}

// Enter with nothing typed, or a wrong/unfinished answer: the learner doesn't know it, so show the
// answer and meaning. Kana typed correctly before the point of failure get credit, the kana where it
// went wrong gets a miss, and the rest are left alone. An empty answer changes no kana stats.
function giveUpWord() {
  if (!running || paused || checking || holding || !current || !current.isWord) return;
  const val = answerEl.value.trim().toLowerCase();
  const now = performance.now();
  const total = current.kana.length;
  if (val) wordProgress(val);
  if (!missedThis) { missedThis = true; sessionTotal++; }
  if (val && !wstate.revealed) {
    const failed = Math.min(parseWord(current, val).done, total - 1);
    current.kana.forEach((e, i) => {
      if (i < failed) recordResult(e.ch, true, wstate.ms[i]);
      else if (i === failed) recordResult(e.ch, false, now - wstate.last);
    });
  }
  const took = now - shownAt;
  recordWord(current.w, false, took);
  sessionMs += took;
  renderScore();
  updateTable();
  holdValue = answerEl.value;
  answerEl.classList.remove("ok", "wrong");
  void answerEl.offsetWidth;
  answerEl.classList.add("wrong");      // red outline
  showTip(true);                        // the answer, in the bubble above the word
  answerEl.placeholder = "Press Enter";
  starEl.hidden = false;
  updateStarUI();
  if (activeScript === MINE) renderMine();
  setFeedback(meaningLine() + "  ·  press Enter for the next word", true);
  holding = true;
}

function accept() { current.isWord ? acceptWord() : acceptKana(); }

function flashWrong() {
  // restart the red/shake animation, then briefly ignore keystrokes so fast typists don't overshoot
  answerEl.classList.remove("wrong");
  void answerEl.offsetWidth;
  answerEl.classList.add("wrong");
  lockedValue = answerEl.value;
  lockUntil = performance.now() + LOCK_MS;
  setTimeout(() => { if (running && answerEl.classList.contains("wrong")) answerEl.select(); }, LOCK_MS);
}

// Single kana are judged as you type: the first wrong letter marks it wrong and shows the answer.
function rejectKana(val) {
  markMiss();
  showAnswer();
  // Tell the learner what they actually typed, if it is a real kana (helps with look-alikes).
  const other = ALL_KANA.find(k => k.answers.includes(val));
  setFeedback("✕ " + (other ? "“" + val + "” is " + other.ch + ". " : "") + "Type " + current.romaji + " to continue");
  flashWrong();
}

function classify(val) {
  if (current.answers.includes(val)) return "right";
  if (current.answers.some(a => a.startsWith(val))) return "partial";
  return "wrong";
}

answerEl.addEventListener("input", e => {
  if (!running || paused || checking || e.isComposing) return;
  if (holding) {            // the finished word stays until Enter; the box can't be edited meanwhile
    answerEl.value = holdValue;
    return;
  }
  // A Japanese keyboard/IME turns letters into kana; answers are typed as romaji letters.
  if (/[^\x00-\x7f]/.test(answerEl.value)) {
    answerEl.value = answerEl.value.replace(/[^\x00-\x7f]/g, "");
    setFeedback("Switch your keyboard to English input and type romaji letters", true);
  }
  if (performance.now() < lockUntil) { answerEl.value = lockedValue; return; }
  const val = answerEl.value.trim().toLowerCase();
  if (!val) { answerEl.classList.remove("wrong"); return; }
  const result = classify(val);
  if (current.isWord) {
    // Words: never judged while typing. Only an exactly correct answer does anything (green, turn over).
    wordProgress(val);
    if (result === "right") accept();
    return;
  }
  if (result === "right") accept();
  else if (result === "wrong") rejectKana(val);
  else answerEl.classList.remove("wrong"); // still typing something that could be right
});
answerEl.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  if (holding) advance();                                              // read the answer, then next word
  else if (running && mode === "words") giveUpWord();                  // empty or wrong answer: show it
});
// Meaning check keys: 1-3 pick an option, Enter moves on after answering
document.addEventListener("keydown", e => {
  if (!running || paused || !checking) return;
  if (!checkAnswered && ["1", "2", "3"].includes(e.key) && checkOptions[+e.key - 1] !== undefined) {
    e.preventDefault();
    chooseOption(+e.key - 1);
  } else if (checkAnswered && e.key === "Enter") {
    e.preventDefault();
    advance();
  }
});

/* hover (or tap) the kana to reveal the answer; counts as a miss */
function reveal(pin) {
  if (!running || !current || paused || holding || checking) return;
  if (!missedThis) {
    if (current.isWord) {
      missedThis = true;
      wstate.revealed = true;
      sessionTotal++;
      renderScore();
    } else {
      markMiss();
    }
    setFeedback(current.isWord ? "Answer revealed – counts as a miss. Type it, or press Enter to skip"
                               : "Answer revealed – counts as a miss. Type it to continue", true);
  }
  showTip(pin);
}
kanaEl.addEventListener("mouseenter", () => {
  if (running && !paused) hoverTimer = setTimeout(() => reveal(false), HOVER_REVEAL_MS);
});
kanaEl.addEventListener("mouseleave", () => { clearTimeout(hoverTimer); hideTip(false); });
kanaEl.addEventListener("click", () => reveal(true)); // touch devices have no hover: tap keeps it shown

/* ---------- start / stop ---------- */
function start() {
  if (mode === "words" && eligibleWords().length < MIN_WORDS) return;
  running = true;
  paused = false;
  practiceEl.classList.remove("paused");
  sessionCorrect = sessionTotal = sessionWords = sessionMs = 0;
  recent = [];
  sinceCheck = 0;
  nextCheck = rollNextCheck();
  renderScore();
  toggleBtn.textContent = "Stop";
  toggleBtn.classList.add("stop");
  toggleBtn.disabled = false;
  kanaEl.classList.remove("idle");
  answerEl.disabled = false;
  answerEl.placeholder = "romaji";
  current = null;
  showNext();
  answerEl.focus();
}

function stop() {
  running = false;
  paused = false;
  holding = false;
  clearTimeout(holdTimer);
  resetWordExtras();
  practiceEl.classList.remove("paused");
  clearTimeout(hoverTimer);
  toggleBtn.textContent = "Start";
  toggleBtn.classList.remove("stop");
  hideTip(true);
  answerEl.value = "";
  answerEl.classList.remove("wrong", "right", "ok");
  answerEl.disabled = true;
  answerEl.placeholder = "Press Start";
  if (mode === "words" && sessionWords > 0) {
    setFeedback("Session: " + sessionWords + (sessionWords === 1 ? " word" : " words") + " · " + wpm() + " wpm · " + accuracy() + "% first try", true);
  } else if (mode === "kana" && sessionTotal > 0) {
    setFeedback("Session: " + sessionCorrect + " / " + sessionTotal + " correct first try (" + accuracy() + "%)", true);
  } else {
    setFeedback("");
  }
  current = null;
  wstate = null;
  updateModeUI();   // idle glyph, Start button state, and the "unlock words" message if needed
}

toggleBtn.addEventListener("click", () => running ? stop() : start());
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && running) stop();
  else if (e.key === "Enter" && e.target === document.body) { if (paused) resume(); else if (!running) start(); }
});

/* ---------- pause when the learner leaves the practice panel ---------- */
// The kana and input blur out and a resume prompt appears. Paused time is not counted
// towards the answer time, and hover-reveal is disabled so the answer can't be peeked at.
function pause() {
  if (!running || paused) return;
  paused = true;
  pauseStart = performance.now();
  clearTimeout(hoverTimer);
  clearTimeout(holdTimer);
  practiceEl.classList.add("paused");
  answerEl.blur();
}
function resume() {
  if (!paused) return;
  paused = false;
  const away = performance.now() - pauseStart;
  shownAt += away;
  if (wstate) wstate.last += away;
  practiceEl.classList.remove("paused");
  if (!checking) answerEl.focus();
}
document.addEventListener("mousedown", e => { if (running && !paused && !practiceEl.contains(e.target)) pause(); });
window.addEventListener("blur", pause);
document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
practiceEl.addEventListener("click", e => {
  if (paused) resume();
  else if (running && e.target !== toggleBtn) answerEl.focus(); // keep typing after clicking the kana
});

document.getElementById("reset").addEventListener("click", () => {
  if (confirm("Reset all progress?")) {
    resetStats();
    sessionCorrect = sessionTotal = sessionWords = sessionMs = 0;
    renderScore();
    updateTable();
    if (running) showNext();
  }
});

buildTable();
updateTable();
updateModeUI();
renderScore();
updateNudge();
