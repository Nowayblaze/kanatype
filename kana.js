// Hiragana data. Each entry: [kana, romaji, ...accepted alternates]
const ROWS = [
  { id: "a",  label: "a",  kana: [["あ","a"],["い","i"],["う","u"],["え","e"],["お","o"]] },
  { id: "ka", label: "ka", kana: [["か","ka"],["き","ki"],["く","ku"],["け","ke"],["こ","ko"]] },
  { id: "sa", label: "sa", kana: [["さ","sa"],["し","shi","si"],["す","su"],["せ","se"],["そ","so"]] },
  { id: "ta", label: "ta", kana: [["た","ta"],["ち","chi","ti"],["つ","tsu","tu"],["て","te"],["と","to"]] },
  { id: "na", label: "na", kana: [["な","na"],["に","ni"],["ぬ","nu"],["ね","ne"],["の","no"]] },
  { id: "ha", label: "ha", kana: [["は","ha"],["ひ","hi"],["ふ","fu","hu"],["へ","he"],["ほ","ho"]] },
  { id: "ma", label: "ma", kana: [["ま","ma"],["み","mi"],["む","mu"],["め","me"],["も","mo"]] },
  { id: "ya", label: "ya", kana: [["や","ya"],["ゆ","yu"],["よ","yo"]] },
  { id: "ra", label: "ra", kana: [["ら","ra"],["り","ri"],["る","ru"],["れ","re"],["ろ","ro"]] },
  { id: "wa", label: "wa", kana: [["わ","wa"],["を","wo","o"],["ん","n","nn"]] },
];

const ALL_KANA = ROWS.flatMap(r => r.kana.map(([ch, ...answers]) => ({ ch, answers, row: r.id, romaji: answers[0] })));
