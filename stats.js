// Per-kana stats, confidence scoring and localStorage persistence.
const STORAGE_KEY = "kanatype.v1";
const TARGET_MS = 2000;      // answer time considered "fast"
const CALIBRATE_AFTER = 5;   // attempts before a kana gets a colour
const RECENT_N = 10;

let stats = loadStats();

function loadStats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {};
}

function saveStats() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stats)); } catch (e) {}
}

function resetStats() {
  stats = {};
  saveStats();
  wordStats = {};
  saveWords();
}

/* ---------- per-word records (separate from per-kana confidence) ---------- */
const WORDS_KEY = "kanatype.words";
let wordStats = loadWords();

function loadWords() {
  try {
    const raw = localStorage.getItem(WORDS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {};
}
function saveWords() {
  try { localStorage.setItem(WORDS_KEY, JSON.stringify(wordStats)); } catch (e) {}
}
function getWordStat(w) {
  return wordStats[w] || { seen: 0, correct: 0, avgMs: 0, last: 0 };
}
// A word counts as "known" once the meaning check was passed on this many separate days.
const KNOWN_DAYS = 3;

function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function recordMeaningCheck(w, ok) {
  const s = getWordStat(w);
  s.checks = (s.checks || 0) + 1;
  if (ok) {
    s.passes = (s.passes || 0) + 1;
    s.passDays = s.passDays || [];
    const t = todayStr();
    if (!s.passDays.includes(t)) s.passDays.push(t);
  }
  wordStats[w] = s;
  saveWords();
}
function isKnown(w) {
  const s = wordStats[w];
  return !!s && (s.passDays || []).length >= KNOWN_DAYS;
}
function isStarred(w) {
  return !!(wordStats[w] && wordStats[w].starred);
}
function toggleStar(w) {
  const s = getWordStat(w);
  s.starred = !s.starred;
  wordStats[w] = s;
  saveWords();
  return s.starred;
}

function recordWord(w, ok, ms) {
  const s = getWordStat(w);
  s.seen++;
  if (ok) s.correct++;
  s.avgMs = s.avgMs ? s.avgMs * 0.7 + ms * 0.3 : ms;
  s.last = Date.now();
  wordStats[w] = s;
  saveWords();
}

function getStat(ch) {
  return stats[ch] || { attempts: 0, correct: 0, recent: [], avgMs: 0, last: 0 };
}

function recordResult(ch, correct, ms) {
  const s = getStat(ch);
  s.attempts++;
  if (correct) {
    s.correct++;
    s.avgMs = s.avgMs ? s.avgMs * 0.7 + ms * 0.3 : ms;
  }
  s.recent.push(correct ? 1 : 0);
  if (s.recent.length > RECENT_N) s.recent.shift();
  s.last = Date.now();
  stats[ch] = s;
  saveStats();
}

// null = not calibrated yet, else 0..1
function confidence(ch) {
  const s = getStat(ch);
  if (s.attempts < CALIBRATE_AFTER) return null;
  const acc = s.recent.reduce((a, b) => a + b, 0) / s.recent.length;
  const speed = s.avgMs ? Math.min(1, TARGET_MS / s.avgMs) : 0.5;
  return acc * (0.6 + 0.4 * speed);
}

// Higher weight = more likely to be picked next.
function weight(ch) {
  const c = confidence(ch);
  const s = getStat(ch);
  if (c === null) return 1.5;  // new/uncalibrated: introduce quickly
  const sinceMin = (Date.now() - s.last) / 60000;
  return (1 - c) + 0.05 + Math.min(0.2, sinceMin * 0.02);
}
