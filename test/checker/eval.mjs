#!/usr/bin/env node
// Accuracy / speed evaluation for src/checker.js.
//
//   node test/checker/eval.mjs --vocab <dir of vocab set JSON> [--real <dir>] [--words 300] [--seed 1] [--only cat,cat] [--verbose]
//
// --vocab  folder of vocab set files ({words:[{en,kana,kanji}]}); only used for word lists.
// --real   folder with hand-drawn reference data (optional):
//            ref-patterns.js     from KanjiCanvas (MIT), raw.githubusercontent.com/asdfjkl/kanjicanvas/master/docs/resources/javascript/ref-patterns.js
//            handwriting-ja.xml  Tomoe data, raw.githubusercontent.com/tegaki/tegaki/master/tegaki-models/data/train/japanese/handwriting-ja.xml
//          Words are then also written from these patterns ("real" rows). Dakuten/small kana are built on a real base.
import fs from "node:fs";
import path from "node:path";
import { ROOT, rng, writeWord, templates, realPatterns, hasDakuten, baseOf, SMALL_TO_LARGE } from "./synth.mjs";

await import(path.join(ROOT, "src/checker.js"));
const C = globalThis.QCardChecker;

const A = process.argv.slice(2), opt = { words: 300, seed: 1 };
for (let i = 0; i < A.length; i++) if (A[i].startsWith("--")) { const k = A[i].slice(2); opt[k] = A[i + 1] && !A[i + 1].startsWith("--") ? A[++i] : true; }
if (!opt.vocab) { console.error("--vocab <dir> is required"); process.exit(2); }
const ONLY = opt.only ? new Set(String(opt.only).split(",")) : null;

const tj = templates().json;
const t0 = performance.now();
const ii = C.init(tj);
const initMs = performance.now() - t0;
const dataKB = fs.statSync(path.join(ROOT, "data/templates.json")).size / 1024;

// ---------------------------------------------------------------- word list
function expand(s) {
  // "（お）てんき" -> おてんき, てんき ; "なに／なん" -> なに, なん ; strip 〜 and spaces
  if (!s) return [];
  let outs = [""];
  const alts = s.split("／");
  if (alts.length > 1) return [...new Set(alts.flatMap(expand))];
  const re = /（([^）]*)）|([^（]+)/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[1] !== undefined) outs = outs.flatMap((o) => [o + m[1], o]);
    else outs = outs.map((o) => o + m[2]);
  }
  return [...new Set(outs.map((o) => o.replace(/[〜～\s]/g, "").normalize("NFKC").replace(/~/g, "")).filter(Boolean))];
}
const words = [];
for (const f of fs.readdirSync(opt.vocab).filter((f) => f.endsWith(".json")).sort()) {
  const d = JSON.parse(fs.readFileSync(path.join(opt.vocab, f), "utf8"));
  for (const w of d.words || []) {
    const kanji = expand(w.kanji), kana = expand(w.kana);
    const cands = [...new Set([...kanji, ...kana])];
    if (!cands.length) continue;
    words.push({ en: w.en, kanji, kana, cands });
  }
}
const supported = (s) => [...s].every((c) => C.has(c) || /[、。・]/.test(c));
const R = rng(+opt.seed);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pool = shuffle(words.filter((w) => w.cands.some(supported)));
const N = Math.min(+opt.words, pool.length);
const W = pool.slice(0, N);

// ---------------------------------------------------------------- error generators
const HIRA = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん";
const KATA = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン";
const CONF = [["シ", "ツ"], ["ソ", "ン"], ["ね", "れ"], ["れ", "わ"], ["ね", "わ"], ["ぬ", "め"], ["る", "ろ"], ["は", "ほ"], ["き", "さ"], ["あ", "お"], ["う", "ら"],
  ["ク", "ケ"], ["チ", "テ"], ["ウ", "ワ"], ["未", "末"], ["土", "士"], ["人", "入"], ["大", "犬"], ["大", "太"], ["犬", "太"], ["午", "牛"], ["日", "目"], ["持", "待"]];
const LOOKALIKE = [["カ", "力"], ["エ", "工"], ["ロ", "口"], ["タ", "夕"], ["ニ", "二"], ["ハ", "八"], ["ト", "卜"], ["ー", "一"], ["へ", "ヘ"], ["べ", "ベ"], ["ぺ", "ペ"], ["り", "リ"]];
const LARGE_TO_SMALL = Object.fromEntries(Object.entries(SMALL_TO_LARGE).map(([s, l]) => [l, s]));
const strokeCount = (c) => (tj.chars[c] || "").split(" ").length;
const KANJI = Object.keys(tj.chars).filter((c) => /[一-鿿]/.test(c));
const isKana = (c) => /[ぁ-ゖァ-ヺ]/.test(c);

function mutate(s, type, r) {
  const a = [...s];
  const idx = (pred) => { const xs = a.map((c, i) => (pred(c, i) ? i : -1)).filter((i) => i >= 0); return xs.length ? r.pick(xs) : -1; };
  const voicedOf = (c) => {
    const b = baseOf(c), out = [];
    for (const m of ["", "\u3099", "\u309a"]) { const v = (b + m).normalize("NFC"); if (v.length === 1 && v !== c && tj.chars[v]) out.push(v); }
    return out;
  };
  let i;
  switch (type) {
    case "dakuten":
      i = idx((c) => isKana(c) && voicedOf(c).length); if (i < 0) return null;
      a[i] = r.pick(voicedOf(a[i])); break;
    case "small-large":
      i = idx((c) => SMALL_TO_LARGE[c] || (LARGE_TO_SMALL[c] && "つやゆよツヤユヨ".includes(c))); if (i < 0) return null;
      a[i] = SMALL_TO_LARGE[a[i]] || LARGE_TO_SMALL[a[i]]; break;
    case "confusable": {
      i = idx((c) => CONF.some((p) => p.includes(c))); if (i < 0) return null;
      const ps = CONF.filter((p) => p.includes(a[i])).map((p) => (p[0] === a[i] ? p[1] : p[0]));
      a[i] = r.pick(ps); break;
    }
    case "missing-long/small-tsu":
      i = idx((c) => "ーっッ".includes(c)); if (i < 0) return null;
      a.splice(i, 1); break;
    case "extra-char": {
      const kata = a.some((c) => /[ァ-ヺ]/.test(c));
      const ins = r.pick([...(kata ? KATA : HIRA)]);
      a.splice(r() < 0.5 ? a.length : r.int(0, a.length), 0, ins); break;
    }
    case "other-kanji": {
      i = idx((c) => /[一-鿿]/.test(c)); if (i < 0) return null;
      const n = strokeCount(a[i]);
      const opts = KANJI.filter((k) => k !== a[i] && Math.abs(strokeCount(k) - n) <= 1);
      a[i] = r.pick(opts); break;
    }
    default: return null;
  }
  const out = a.join("");
  return out === s ? null : out;
}

// ---------------------------------------------------------------- run
const rows = [];
const times = [];
function run(cat, mode, writes, cands, expectOk, extra = {}) {
  if (ONLY && !ONLY.has(cat)) return;
  const key = cat + "|" + mode;
  let row = rows.find((x) => x.key === key);
  if (!row) { row = { key, cat, mode, n: 0, acc: 0, rej: 0, nul: 0, expectOk, fails: [] }; rows.push(row); }
  const seed = (R() * 1e9) | 0;
  const w = writeWord(writes, seed, { mode, realDir: opt.real, ...extra.write });
  if (mode === "real" && w.realChars < w.totalChars) return; // only words fully written from real patterns
  const res = C.verify({ strokes: w.strokes, candidates: cands, box: w.box, ...extra.verify });
  times.push({ ms: res.ms, len: [...writes].length, writes, cands, seed, n: w.strokes.length });
  row.n++;
  if (res.ok === true) row.acc++; else if (res.ok === false) row.rej++; else row.nul++;
  if ((res.ok === true) !== expectOk && row.fails.length < 400) row.fails.push({ writes, cands, seed, res: res.text + " " + res.chars.filter((c) => !c.ok).map((c) => c.ch + ":" + c.why + (c.other ? `(${c.cost}/${c.other}${c.otherCost})` : "")).join(" ") });
}

const modes = opt.real ? ["synth", "real"] : ["synth"];
if (opt.real) realPatterns(opt.real);
const tStart = performance.now();
for (const mode of modes) {
  for (const w of W) {
    const ok = w.cands.filter(supported);
    // 1. correct writing (one of the candidates)
    const pick = R.pick(ok);
    run("correct", mode, pick, w.cands, true);
    // anyKana: the kana answer written in the other script
    const kanaOnly = w.kana.filter(supported).filter((k) => [...k].every((c) => isKana(c) || c === "ー"));
    if (kanaOnly.length) {
      const k = R.pick(kanaOnly);
      const other = [...k].map((c) => { const o = /[ぁ-ゖ]/.test(c) ? String.fromCharCode(c.charCodeAt(0) + 0x60) : /[ァ-ヶ]/.test(c) ? String.fromCharCode(c.charCodeAt(0) - 0x60) : c; return tj.chars[o] ? o : c; }).join("");
      run("anyKana other script", mode, other, w.cands, true, { verify: { anyKana: true } });
      // without anyKana the other script must be rejected (only when it really differs in look)
      if (other !== k) run("script mismatch (no anyKana)", mode, other, w.kana, false);
    }
    // 3. look-alike characters across scripts
    for (const c of ok) {
      const ps = LOOKALIKE.filter((p) => c.includes(p[0]) || c.includes(p[1]));
      if (!ps.length) continue;
      let s = c;
      for (const [x, y] of ps) s = s.split(x).join("\u0000").split(y).join(x).split("\u0000").join(y);
      if (s !== c) { run("look-alike swap", mode, s, w.cands, true); break; }
    }
    // 2. near misses
    for (const type of ["dakuten", "small-large", "confusable", "missing-long/small-tsu", "extra-char", "other-kanji"]) {
      const src = R.pick(ok);
      const bad = mutate(src, type, R);
      if (!bad || w.cands.includes(bad) || !supported(bad)) continue;
      run("wrong: " + type, mode, bad, w.cands, false);
    }
    if (w.kanji.length) {
      const kj = w.kanji.filter(supported), kn = w.kana.filter(supported);
      if (kj.length && kn.length && kj.some((k) => /[一-鿿]/.test(k))) run("wrong: kana for kanji-only", mode, R.pick(kn), kj.filter((k) => /[一-鿿]/.test(k)), false);
    }
    // furigana strip: short kana answers, 78 px tall strip, small writing
    if (kanaOnly.length && mode === "synth") {
      const k = R.pick(kanaOnly);
      if ([...k].length <= 4) {
        run("furigana strip", mode, k, [k], true, { write: { boxH: 78, em: R.range(22, 40) } });
        const bad = mutate(k, R.pick(["dakuten", "confusable", "extra-char", "small-large"]), R);
        if (bad && bad !== k && supported(bad)) run("furigana strip wrong", mode, bad, [k], false, { write: { boxH: 78, em: R.range(22, 40) } });
      }
    }
  }
}
const total = performance.now() - tStart;

// ---------------------------------------------------------------- report
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + "%" : "-");
console.log(`\nQ-Card checker eval: ${N} words, seed ${opt.seed}, templates ${ii.chars} chars, ${dataKB.toFixed(0)} KB, init ${initMs.toFixed(0)} ms\n`);
console.log("category                         mode    n     accepted  rejected  null   target");
let worstNeg = 0, nn = 0, nr = 0;
for (const r of rows.sort((a, b) => (a.cat < b.cat ? -1 : a.cat > b.cat ? 1 : a.mode < b.mode ? -1 : 1))) {
  console.log(`${r.cat.padEnd(32)} ${r.mode.padEnd(6)} ${String(r.n).padStart(5)}  ${pct(r.acc, r.n).padStart(8)}  ${pct(r.rej, r.n).padStart(8)}  ${String(r.nul).padStart(4)}   ${r.expectOk ? "accept" : "reject"}`);
  if (!r.expectOk && r.mode === "synth") { nn += r.n; nr += r.rej; }
}
console.log(`\nall near-miss (synth): rejected ${pct(nr, nn)} of ${nn}`);
const ms = times.map((t) => t.ms).sort((a, b) => a - b);
const q = (p) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))].toFixed(1);
console.log(`verify time: median ${q(0.5)} ms, p95 ${q(0.95)} ms, max ${q(1)} ms over ${ms.length} calls (total ${(total / 1000).toFixed(1)} s)`);
const six = times.filter((t) => t.len === 6).map((t) => t.ms).sort((a, b) => a - b);
if (six.length) console.log(`6-character words: median ${six[six.length >> 1].toFixed(1)} ms, max ${six[six.length - 1].toFixed(1)} ms`);
const long = times.filter((t) => t.len >= 12).map((t) => t.ms).sort((a, b) => a - b);
if (long.length) console.log(`12+ characters: median ${long[long.length >> 1].toFixed(1)} ms, max ${long[long.length - 1].toFixed(1)} ms`);
if (opt.slow) for (const t of times.slice().sort((a, b) => b.ms - a.ms).slice(0, +opt.slow)) console.log(`  slow: ${t.ms.toFixed(0)} ms  ${t.writes} (${t.n} strokes) cands ${t.cands.join(",")} seed ${t.seed}`);
if (opt.verbose) for (const r of rows) if (r.fails.length) { console.log(`\n--- ${r.cat} / ${r.mode}: ${r.fails.length} failures`); for (const f of r.fails.slice(0, +opt.verbose || 25)) console.log(`  wrote ${f.writes}  cands ${f.cands.join(",")}  seed ${f.seed}  -> ${f.res}`); }
if (opt.json) fs.writeFileSync(opt.json, JSON.stringify(rows, null, 1));
