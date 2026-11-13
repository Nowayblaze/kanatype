const kanaEl = document.getElementById("kana");
const tipEl = document.getElementById("tip");
const practiceEl = document.getElementById("practice");
const answerEl = document.getElementById("answer");
const feedbackEl = document.getElementById("feedback");
const scoreEl = document.getElementById("score");
const toggleBtn = document.getElementById("toggle");
const tabsEl = document.getElementById("tabs");
const panelsEl = document.getElementById("panels");
const groupEls = [...document.querySelectorAll(".toggles input")];

const ROWS_KEY = "kanatype.rows";
const TAB_KEY = "kanatype.tab";
const LOCK_MS = 450;          // after a wrong answer, ignore keystrokes so fast typers don't overshoot
const HOVER_REVEAL_MS = 350;  // hover delay before the answer is revealed (avoids accidental reveals)

let selected = loadRows();
let activeScript = loadScript();
let running = false;
let paused = false, pauseStart = 0;
let current = null;
let shownAt = 0;
let missedThis = false;       // a miss (wrong answer or revealed answer) was already recorded for this kana
let lockUntil = 0, lockedValue = "";
let hoverTimer = null;
let sessionCorrect = 0, sessionTotal = 0;

const cells = new Map();      // kana -> table cell element
const heads = new Map();      // row id -> column checkbox

/* ---------- persistence of row selection ---------- */
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

function setRows(ids) {
  selected = new Set(ids);
  if (selected.size === 0) selected.add(ROWS[0].id); // always keep at least one row
  saveRows();
  updateTable();
  if (running && !selected.has(current.row)) showNext();
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

/* ---------- picking the next kana (weighted towards weak ones) ---------- */
function pool() { return ALL_KANA.filter(k => selected.has(k.row)); }

function pickNext() {
  const p = pool();
  const options = p.length > 1 ? p.filter(k => !current || k.ch !== current.ch) : p;
  const weights = options.map(k => weight(k.ch));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < options.length; i++) {
    r -= weights[i];
    if (r <= 0) return options[i];
  }
  return options[options.length - 1];
}

/* ---------- practice loop ---------- */
function renderScore() { scoreEl.textContent = sessionCorrect + " / " + sessionTotal; }

function setFeedback(text, info) {
  feedbackEl.textContent = text;
  feedbackEl.classList.toggle("info", !!info);
}

function showNext() {
  current = pickNext();
  kanaEl.textContent = current.ch;
  answerEl.value = "";
  answerEl.classList.remove("wrong", "right");
  hideTip(true);
  setFeedback("");
  missedThis = false;
  lockUntil = 0;
  shownAt = performance.now();
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

function accept() {
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

function reject(val) {
  markMiss();
  showAnswer();
  // Tell the learner what they actually typed, if it is a real kana (helps with look-alikes).
  const other = ALL_KANA.find(k => k.answers.includes(val));
  setFeedback("✕ " + (other ? "“" + val + "” is " + other.ch + ". " : "") + "Type " + current.romaji + " to continue");
  // restart the red/shake animation
  answerEl.classList.remove("wrong");
  void answerEl.offsetWidth;
  answerEl.classList.add("wrong");
  lockedValue = answerEl.value;
  lockUntil = performance.now() + LOCK_MS;
  setTimeout(() => { if (running && answerEl.classList.contains("wrong")) answerEl.select(); }, LOCK_MS);
}

function classify(val) {
  if (current.answers.includes(val)) return "right";
  if (current.answers.some(a => a.startsWith(val))) return "partial";
  return "wrong";
}

answerEl.addEventListener("input", () => {
  if (!running || paused) return;
  if (performance.now() < lockUntil) { answerEl.value = lockedValue; return; }
  const val = answerEl.value.trim().toLowerCase();
  if (!val) { answerEl.classList.remove("wrong"); return; }
  const result = classify(val);
  if (result === "right") accept();
  else if (result === "wrong") reject(val);
  else answerEl.classList.remove("wrong"); // still typing something that could be right
});

/* hover (or tap) the kana to reveal the answer; counts as a miss */
function reveal(pin) {
  if (!running || !current || paused) return;
  if (!missedThis) {
    markMiss();
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
  running = true;
  paused = false;
  practiceEl.classList.remove("paused");
  sessionCorrect = sessionTotal = 0;
  renderScore();
  toggleBtn.textContent = "Stop";
  toggleBtn.classList.add("stop");
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
  practiceEl.classList.remove("paused");
  clearTimeout(hoverTimer);
  toggleBtn.textContent = "Start";
  toggleBtn.classList.remove("stop");
  kanaEl.textContent = "かな";
  kanaEl.classList.add("idle");
  hideTip(true);
  answerEl.value = "";
  answerEl.classList.remove("wrong", "right");
  answerEl.disabled = true;
  answerEl.placeholder = "Press Start";
  if (sessionTotal > 0) {
    const pct = Math.round(100 * sessionCorrect / sessionTotal);
    setFeedback("Session: " + sessionCorrect + " / " + sessionTotal + " correct first try (" + pct + "%)", true);
  } else {
    setFeedback("");
  }
  current = null;
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
  practiceEl.classList.add("paused");
  answerEl.blur();
}
function resume() {
  if (!paused) return;
  paused = false;
  shownAt += performance.now() - pauseStart;
  practiceEl.classList.remove("paused");
  answerEl.focus();
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
    sessionCorrect = sessionTotal = 0;
    renderScore();
    updateTable();
    if (running) showNext();
  }
});

buildTable();
updateTable();
renderScore();
