// Kana data, laid out like the kana table: one entry per column ("row" of the gojuuon chart).
// Each column: [id, group, slots, romaji, hiragana, katakana]
//   group  - "regular" or "dakuten" (includes handakuten: pa, pi, ...)
//   slots  - vertical positions (0-4 = a/i/u/e/o) the column's kana occupy
//   romaji - one entry per kana: a string, or an array of accepted spellings (first is shown)
const COLUMNS = [
  ["a",  "regular", [0,1,2,3,4], ["a","i","u","e","o"],                       "あいうえお", "アイウエオ"],
  ["ka", "regular", [0,1,2,3,4], ["ka","ki","ku","ke","ko"],                   "かきくけこ", "カキクケコ"],
  ["sa", "regular", [0,1,2,3,4], ["sa",["shi","si"],"su","se","so"],           "さしすせそ", "サシスセソ"],
  ["ta", "regular", [0,1,2,3,4], ["ta",["chi","ti"],["tsu","tu"],"te","to"],   "たちつてと", "タチツテト"],
  ["na", "regular", [0,1,2,3,4], ["na","ni","nu","ne","no"],                   "なにぬねの", "ナニヌネノ"],
  ["ha", "regular", [0,1,2,3,4], ["ha","hi",["fu","hu"],"he","ho"],            "はひふへほ", "ハヒフヘホ"],
  ["ma", "regular", [0,1,2,3,4], ["ma","mi","mu","me","mo"],                   "まみむめも", "マミムメモ"],
  ["ya", "regular", [0,2,4],     ["ya","yu","yo"],                             "やゆよ",     "ヤユヨ"],
  ["ra", "regular", [0,1,2,3,4], ["ra","ri","ru","re","ro"],                   "らりるれろ", "ラリルレロ"],
  ["wa", "regular", [0,4],       ["wa",["wo","o"]],                            "わを",       "ワヲ"],
  ["n",  "regular", [4],         ["n"],                                        "ん",         "ン"],
  ["ga", "dakuten", [0,1,2,3,4], ["ga","gi","gu","ge","go"],                   "がぎぐげご", "ガギグゲゴ"],
  ["za", "dakuten", [0,1,2,3,4], ["za",["ji","zi"],"zu","ze","zo"],            "ざじずぜぞ", "ザジズゼゾ"],
  ["da", "dakuten", [0,1,2,3,4], ["da",["ji","di"],["zu","du"],"de","do"],     "だぢづでど", "ダヂヅデド"],
  ["ba", "dakuten", [0,1,2,3,4], ["ba","bi","bu","be","bo"],                   "ばびぶべぼ", "バビブベボ"],
  ["pa", "dakuten", [0,1,2,3,4], ["pa","pi","pu","pe","po"],                   "ぱぴぷぺぽ", "パピプペポ"],
];

function buildRows(script, prefix, charsIndex) {
  return COLUMNS.map(col => {
    const chars = [...col[charsIndex]];
    return {
      id: prefix + "-" + col[0],
      label: col[0],
      script,
      group: col[1],
      slots: col[2],
      kana: chars.map((ch, i) => [ch, ...[].concat(col[3][i])]),
    };
  });
}

const SCRIPTS = [
  { id: "hira", label: "Hiragana", rows: buildRows("hira", "h", 4) },
  { id: "kata", label: "Katakana", rows: buildRows("kata", "k", 5) },
];

const ROWS = SCRIPTS.flatMap(s => s.rows);
const ALL_KANA = ROWS.flatMap(r => r.kana.map(([ch, ...answers]) => ({ ch, answers, row: r.id, romaji: answers[0] })));
const KANA_BY_CH = Object.fromEntries(ALL_KANA.map(k => [k.ch, k]));
