const kanaEl = document.getElementById("kana");
const answerEl = document.getElementById("answer");
const feedbackEl = document.getElementById("feedback");
const scoreEl = document.getElementById("score");
const rowsEl = document.getElementById("rows");
const gridEl = document.getElementById("grid");

const ROWS_KEY = "kanatype.rows";
let selected = loadRows();
let current = null;
let shownAt = 0;
let missedThis = false;
let sessionCorrect = 0, sessionTotal = 0;

function loadRows() {
  try {
    const raw = JSON.parse(localStorage.getItem(ROWS_KEY));
    if (Array.isArray(raw) && raw.length) return new Set(raw);
  } catch (e) {}
  return new Set(["a"]);
}
function saveRows() {
  try { localStorage.setItem(ROWS_KEY, JSON.stringify([...selected])); } catch (e) {}
}

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

function showNext() {
  current = pickNext();
  kanaEl.textContent = current.ch;
  answerEl.value = "";
  answerEl.classList.remove("wrong");
  feedbackEl.textContent = "";
  missedThis = false;
  shownAt = performance.now();
}

function renderScore() { scoreEl.textContent = sessionCorrect + " / " + sessionTotal; }

function renderRows() {
  rowsEl.innerHTML = "";
  ROWS.forEach(r => {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selected.has(r.id);
    cb.addEventListener("change", () => {
      if (cb.checked) selected.add(r.id); else selected.delete(r.id);
      if (selected.size === 0) { selected.add(r.id); cb.checked = true; } // keep at least one row
      saveRows();
      if (!selected.has(current.row)) showNext();
      answerEl.focus();
    });
    label.append(cb, " " + r.label);
    rowsEl.appendChild(label);
  });
}

function renderGrid() {
  gridEl.innerHTML = "";
  // lay out by column of the kana table: 5 vowels across, rows down
  ROWS.forEach(r => {
    const vowels = ["a","i","u","e","o"];
    const cells = r.id === "ya" ? [r.kana[0], null, r.kana[1], null, r.kana[2]]
                : r.id === "wa" ? [r.kana[0], null, r.kana[2], null, r.kana[1]]
                : r.kana;
    cells.forEach(entry => {
      const cell = document.createElement("div");
      if (!entry) { gridEl.appendChild(cell); return; }
      const [ch, ro] = entry;
      const c = confidence(ch);
      const cls = c === null ? "" : c < 0.5 ? "s-low" : c < 0.8 ? "s-mid" : "s-high";
      cell.className = "cell " + cls;
      cell.innerHTML = '<div class="ch">' + ch + '</div><div class="ro">' + ro + "</div>";
      gridEl.appendChild(cell);
    });
  });
}

function submit() {
  const val = answerEl.value.trim().toLowerCase();
  if (!val) return;
  const ms = performance.now() - shownAt;
  if (current.answers.includes(val)) {
    if (!missedThis) {  // a miss was already recorded when the wrong answer was entered
      recordResult(current.ch, true, ms);
      sessionTotal++;
      sessionCorrect++;
      renderScore();
      renderGrid();
    }
    showNext();
  } else if (!missedThis && current.answers.some(a => a.startsWith(val)) === false) {
    // wrong answer: record one miss, reveal the answer, let them retype it
    missedThis = true;
    recordResult(current.ch, false, ms);
    sessionTotal++;
    renderScore();
    renderGrid();
    answerEl.classList.add("wrong");
    feedbackEl.textContent = current.romaji;
    answerEl.select();
  } else if (missedThis) {
    answerEl.select();
  }
}

// Auto-submit once the typed text matches an accepted answer exactly and can't be a longer one
// (e.g. "n" is also a prefix of "nn", so Enter is needed for that case).
answerEl.addEventListener("input", () => {
  const val = answerEl.value.trim().toLowerCase();
  if (current.answers.includes(val) && !current.answers.some(a => a !== val && a.startsWith(val))) submit();
});
answerEl.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });

document.getElementById("reset").addEventListener("click", () => {
  if (confirm("Reset all progress?")) {
    resetStats();
    sessionCorrect = sessionTotal = 0;
    renderScore(); renderGrid(); showNext();
  }
});

renderRows();
renderGrid();
renderScore();
showNext();
