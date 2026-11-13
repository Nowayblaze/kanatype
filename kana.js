// Hiragana data, laid out like the kana table: one entry per column ("row" of the
// gojuuon chart). `slots` is the vertical position (0-4 = a/i/u/e/o) of each kana.
// Each kana: [kana, romaji, ...accepted alternates]
const ROWS = [
  { id: "a",  label: "a",  slots: [0,1,2,3,4], kana: [["あ","a"],["い","i"],["う","u"],["え","e"],["お","o"]] },
  { id: "ka", label: "ka", slots: [0,1,2,3,4], kana: [["か","ka"],["き","ki"],["く","ku"],["け","ke"],["こ","ko"]] },
  { id: "sa", label: "sa", slots: [0,1,2,3,4], kana: [["さ","sa"],["し","shi","si"],["す","su"],["せ","se"],["そ","so"]] },
  { id: "ta", label: "ta", slots: [0,1,2,3,4], kana: [["た","ta"],["ち","chi","ti"],["つ","tsu","tu"],["て","te"],["と","to"]] },
  { id: "na", label: "na", slots: [0,1,2,3,4], kana: [["な","na"],["に","ni"],["ぬ","nu"],["ね","ne"],["の","no"]] },
  { id: "ha", label: "ha", slots: [0,1,2,3,4], kana: [["は","ha"],["ひ","hi"],["ふ","fu","hu"],["へ","he"],["ほ","ho"]] },
  { id: "ma", label: "ma", slots: [0,1,2,3,4], kana: [["ま","ma"],["み","mi"],["む","mu"],["め","me"],["も","mo"]] },
  { id: "ya", label: "ya", slots: [0,2,4],     kana: [["や","ya"],["ゆ","yu"],["よ","yo"]] },
  { id: "ra", label: "ra", slots: [0,1,2,3,4], kana: [["ら","ra"],["り","ri"],["る","ru"],["れ","re"],["ろ","ro"]] },
  { id: "wa", label: "wa", slots: [0,4],       kana: [["わ","wa"],["を","wo","o"]] },
  { id: "n",  label: "n",  slots: [4],         kana: [["ん","n"]] },
];

const ALL_KANA = ROWS.flatMap(r => r.kana.map(([ch, ...answers]) => ({ ch, answers, row: r.id, romaji: answers[0] })));
