const kanaEl = document.getElementById("kana");
const tipEl = document.getElementById("tip");
const answerEl = document.getElementById("answer");
const feedbackEl = document.getElementById("feedback");
const scoreEl = document.getElementById("score");
const toggleBtn = document.getElementById("toggle");
const allEl = document.getElementById("all");
const tableEl = document.getElementById("table");

const ROWS_KEY = "kanatype.rows";
const LOCK_MS = 450;          // after a wrong answer, ignore keystrokes so fast typers don't overshoot
const HOVER_REVEAL_MS = 350;  // hover delay before the answer is revealed (avoids accidental reveals)

let selected = loadRows();
let running = false;
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
      const valid = raw.filter(id => ROWS.some(r => r.id === id));
      if (valid.length) return new Set(valid);
    }
  } catch (e) {}
  return new Set(["a"]);
}
function saveRows() {
  try { localStorage.setItem(ROWS_KEY, JSON.stringify([...selected])); } catch (e) {}
}

/* ---------- kana table (row picker + confidence in one) ---------- */
function buildTable() {
  tableEl.innerHTML = "";
  ROWS.forEach(r => {
    const head = document.createElement("label");
    head.className = "colhead";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.addEventListener("change", () => toggleRow(r.id, cb.checked));
    head.append(cb, document.createTextNode(r.label));
    tableEl.appendChild(head);
    heads.set(r.id, cb);
  });
  for (let slot = 0; slot < 5; slot++) {
    ROWS.forEach(r => {
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
      tableEl.appendChild(cell);
    });
  }
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
  allEl.checked = selected.size === ROWS.length;
  allEl.indeterminate = selected.size > 0 && selected.size < ROWS.length;
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
allEl.addEventListener("change", () => setRows(allEl.checked ? ROWS.map(r => r.id) : [ROWS[0].id]));

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
  if (!running) return;
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
  if (!running || !current) return;
  if (!missedThis) {
    markMiss();
    setFeedback("Answer revealed – counts as a miss. Type it to continue", true);
  }
  showTip(pin);
}
kanaEl.addEventListener("mouseenter", () => {
  if (running) hoverTimer = setTimeout(() => reveal(false), HOVER_REVEAL_MS);
});
kanaEl.addEventListener("mouseleave", () => { clearTimeout(hoverTimer); hideTip(false); });
kanaEl.addEventListener("click", () => reveal(true)); // touch devices have no hover: tap keeps it shown

/* ---------- start / stop ---------- */
function start() {
  running = true;
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
  else if (e.key === "Enter" && !running && e.target === document.body) start();
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
