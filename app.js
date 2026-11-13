const kanaEl = document.getElementById("kana");
const tipEl = document.getElementById("tip");
const practiceEl = document.getElementById("practice");
const answerEl = document.getElementById("answer");
const feedbackEl = document.getElementById("feedback");
const scoreEl = document.getElementById("score");
const toggleBtn = document.getElementById("toggle");
const modeEl = document.getElementById("mode");
const availEl = document.getElementById("avail");
const tabsEl = document.getElementById("tabs");
const panelsEl = document.getElementById("panels");
const groupEls = [...document.querySelectorAll(".toggles input")];

const ROWS_KEY = "kanatype.rows";
const TAB_KEY = "kanatype.tab";
const MODE_KEY = "kanatype.mode";
const LOCK_MS = 450;          // after a wrong answer, ignore keystrokes so fast typers don't overshoot
const HOVER_REVEAL_MS = 350;  // hover delay before the answer is revealed (avoids accidental reveals)
const WORD_HOLD_MS = 1500;    // how long a finished word (and its meaning) stays before the next one
const SLOW_MS = 1500;         // a kana in a word slower than this gets an amber underline
const MIN_WORDS = 5;          // words needed in the pool before Words mode can start
const COOLDOWN = 20;          // a word is not repeated within this many words
const LOCK_MSG = "Tick a few more columns to unlock words";

let selected = loadRows();
let activeScript = loadScript();
let mode = loadMode();        // "kana" | "words"
let running = false;
let paused = false, pauseStart = 0;
let current = null;           // kana item {ch, answers, romaji, row} or word item (see WORDS in words.js)
let shownAt = 0;
let missedThis = false;       // a miss (wrong answer or revealed answer) was already recorded for this item
let lockUntil = 0, lockedValue = "";
let hoverTimer = null;
let sessionCorrect = 0, sessionTotal = 0;
// Words mode state
let wstate = null;            // per-word progress: { n kana done, last timestamp, ms[], failed index, revealed }
let holding = false, holdTimer = null;
let sessionWords = 0, sessionMs = 0;
let recent = [];

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
  // tabs: label, selected state, and how many columns are ticked in that script
  tabsEl.querySelectorAll("button").forEach(tab => {
    const s = SCRIPTS.find(x => x.id === tab.dataset.script);
    const n = s.rows.filter(r => selected.has(r.id)).length;
    tab.setAttribute("aria-selected", s.id === activeScript);
    tab.innerHTML = s.label + (n ? '<span class="badge">' + n + "</span>" : "");
  });
  panelsEl.querySelectorAll(".table-scroll").forEach(p => { p.hidden = p.dataset.script !== activeScript; });
  // All / Regular / Dakuten toggles act on the visible script
  groupEls.forEach(cb => {
    const rows = groupRows(activeScript, cb.dataset.group);
    const n = rows.filter(r => selected.has(r.id)).length;
    cb.checked = n === rows.length;
    cb.indeterminate = n > 0 && n < rows.length;
  });
}

function setTab(id) {
  activeScript = id;
  try { localStorage.setItem(TAB_KEY, id); } catch (e) {}
  updateTable();
}

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
  sessionCorrect = sessionTotal = sessionWords = sessionMs = 0;
  setFeedback("");
  renderScore();
  updateModeUI();
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

function showNext() {
  clearTimeout(holdTimer);
  holding = false;
  if (mode === "words") {
    current = pickNextWord();
    current.isWord = true;
    current.ch = current.w;
    wstate = { n: 0, last: performance.now(), ms: [], failed: -1, revealed: false };
    renderWord();
  } else {
    current = pickNext();
    kanaEl.classList.remove("word");
    kanaEl.textContent = current.ch;
  }
  answerEl.value = "";
  answerEl.classList.remove("wrong", "right");
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

/* ----- word display: one span per kana so each can carry its own underline ----- */
function renderWord() {
  kanaEl.classList.add("word");
  kanaEl.innerHTML = "";
  [...current.w].forEach(ch => {
    const s = document.createElement("span");
    s.className = "seg";
    s.textContent = ch;
    kanaEl.appendChild(s);
  });
  renderSegs();
}

// green = quick, amber = slow, red = the kana where the mistake was made, blue = the kana you're on
function renderSegs() {
  if (!wstate || !current || !current.isWord) return;
  kanaEl.querySelectorAll(".seg").forEach((el, i) => {
    let c = "seg";
    if (i < wstate.n) c += i === wstate.failed ? " bad" : (wstate.ms[i] <= SLOW_MS ? " fast" : " slow");
    else {
      if (i === wstate.n) c += " cur";
      if (i === wstate.failed) c += " bad";
    }
    el.className = c;
  });
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
  renderSegs();
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

function acceptWord() {
  const now = performance.now();
  const total = current.kana.length;
  while (wstate.n < total) {            // make sure every kana is marked complete
    wstate.ms[wstate.n] = now - wstate.last;
    wstate.last = now;
    wstate.n++;
  }
  const ok = !missedThis;
  if (ok) { sessionTotal++; sessionCorrect++; }
  // One result per kana: the one that went wrong already got its miss; the others get a correct.
  // Kana after the mistake weren't really attempted, so they get a neutral time. If the answer was
  // revealed, no kana credit is given.
  if (!wstate.revealed) {
    current.kana.forEach((e, i) => {
      if (i === wstate.failed) return;
      recordResult(e.ch, true, wstate.failed >= 0 && i > wstate.failed ? TARGET_MS : wstate.ms[i]);
    });
  }
  const took = now - shownAt;
  recordWord(current.w, ok, took);
  sessionWords++;
  sessionMs += took;
  renderScore();
  updateTable();
  renderSegs();
  // Hold the finished word on screen with its meaning; Enter, a keystroke or a timer moves on.
  answerEl.value = "";
  answerEl.classList.remove("wrong");
  answerEl.classList.add("right");
  hideTip(true);
  setFeedback(current.m, true);
  if (current.k) {
    const kj = document.createElement("span");
    kj.className = "kanji";
    kj.textContent = current.k;
    kanaEl.appendChild(kj);
  }
  holding = true;
  holdTimer = setTimeout(advance, WORD_HOLD_MS);
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

function rejectKana(val) {
  markMiss();
  showAnswer();
  // Tell the learner what they actually typed, if it is a real kana (helps with look-alikes).
  const other = ALL_KANA.find(k => k.answers.includes(val));
  setFeedback("✕ " + (other ? "“" + val + "” is " + other.ch + ". " : "") + "Type " + current.romaji + " to continue");
  flashWrong();
}

function rejectWord(val) {
  const p = parseWord(current, val);
  if (wstate.failed < 0) {
    wstate.failed = Math.min(p.done, current.kana.length - 1);
    if (!missedThis) { missedThis = true; sessionTotal++; renderScore(); }
    recordResult(current.kana[wstate.failed].ch, false, performance.now() - wstate.last);
    updateTable();
  }
  renderSegs();
  showTip(true);
  const bad = current.kana[wstate.failed];
  setFeedback("✕ " + bad.ch + " is " + bad.romaji + ". Type the whole word: " + current.romaji);
  flashWrong();
}

function reject(val) { current.isWord ? rejectWord(val) : rejectKana(val); }

function classify(val) {
  if (current.answers.includes(val)) return "right";
  if (current.answers.some(a => a.startsWith(val))) return "partial";
  return "wrong";
}

answerEl.addEventListener("input", () => {
  if (!running || paused) return;
  if (holding) {            // typing during the hold starts the next word; this keystroke is its first letter
    const typed = answerEl.value;
    advance();
    answerEl.value = typed;
  }
  if (performance.now() < lockUntil) { answerEl.value = lockedValue; return; }
  const val = answerEl.value.trim().toLowerCase();
  if (!val) { answerEl.classList.remove("wrong"); return; }
  const result = classify(val);
  if (current.isWord) wordProgress(val);
  if (result === "right") accept();
  else if (result === "wrong") reject(val);
  else answerEl.classList.remove("wrong"); // still typing something that could be right
});
answerEl.addEventListener("keydown", e => { if (e.key === "Enter" && holding) advance(); });

/* hover (or tap) the kana to reveal the answer; counts as a miss */
function reveal(pin) {
  if (!running || !current || paused || holding) return;
  if (!missedThis) {
    if (current.isWord) {
      missedThis = true;
      wstate.revealed = true;
      sessionTotal++;
      renderScore();
    } else {
      markMiss();
    }
    setFeedback("Answer revealed – counts as a miss. Type it to continue", true);
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
  practiceEl.classList.remove("paused");
  clearTimeout(hoverTimer);
  toggleBtn.textContent = "Start";
  toggleBtn.classList.remove("stop");
  hideTip(true);
  answerEl.value = "";
  answerEl.classList.remove("wrong", "right");
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
  if (holding) advance(); else answerEl.focus();
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
