// Accuracy and speed of the checker's English mode (verify({ latin: true })) on synthetic handwriting.
//   node test/checker/eval-en.mjs --vocab <dir of vocab set JSON> --hershey <hersheytext package dir> [--n 200] [--seed 1]
//        [--fonts readability,readabilityI,tech,nixish] [--join 0] [--late 0.4] [--level 1] [--set '{"LMARGIN":0.05}'] [--verbose 10]
// --vocab    folder of vocab set files ({words:[{en}]}), for the meanings (data/samples.json is always added).
// --hershey  the unpacked npm package "hersheytext" (its Hershey JSON fonts and EMS SVG fonts), so the writing comes
//            from other fonts than the templates. Without it, the template letters themselves are used (an easy test).
// For each trial: one way of writing a meaning (as englishAnswers lists them, sometimes capitalised) should pass; a
// random other meaning should fail; and so should the closest other meaning by spelling ("hard", edit distance <= 40%),
// the same writing with one letter changed to another, and with one letter left out.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { rng, ROOT } from "./synth.mjs";
import { writeEnglish, loadFont, defaultFont, FONTS } from "./synth-en.mjs";
const require = createRequire(import.meta.url);
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const N = +arg("n", 200), SEED = +arg("seed", 1), VERB = +arg("verbose", 0);
const opts = { join: +arg("join", 0), late: +arg("late", 0.4), level: +arg("level", 1) };
const C = require(path.join(ROOT, "src/checker.js"));
C.init(JSON.parse(fs.readFileSync(path.join(ROOT, "data/templates.json"), "utf8")));
if (arg("set")) C._.set(JSON.parse(arg("set")));
const pkg = arg("hershey");
const fonts = pkg ? arg("fonts", "readability,readabilityI,tech,nixish").split(",").map((n) => [n, loadFont(pkg, FONTS[n] || n)]) : [["template letters", defaultFont()]];

const ens = new Set();
const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") { if (typeof x.en === "string") ens.add(x.en); Object.values(x).forEach(walk); } };
if (arg("vocab")) for (const f of fs.readdirSync(arg("vocab")).filter((f) => f.endsWith(".json"))) walk(JSON.parse(fs.readFileSync(path.join(arg("vocab"), f), "utf8")));
walk(JSON.parse(fs.readFileSync(path.join(ROOT, "data/samples.json"), "utf8")));
const letters = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const writable = (s) => [...s].every((c) => c === " " || fonts.every(([, g]) => g.has(c)));
const G = [...ens].map((en) => ({ en, A: C.englishAnswers(en) })).filter((g) => g.A.length && g.A.every(writable));
console.log(`meanings ${ens.size}, writable in every font ${G.length}; fonts ${fonts.map(([n]) => n).join(", ")}`);

function ed(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
const r = rng(SEED);
const pick = (a) => a[Math.floor(r() * a.length)];
const styleCase = (t) => { const u = r(); return u < 0.25 ? t.replace(/^[a-z]/, (c) => c.toUpperCase()) : t; };
const stats = { pos: [0, 0], neg: [0, 0], hard: [0, 0], sub: [0, 0], drop: [0, 0] }, ms = [], misses = [], fas = [];
let unchecked = 0; // answers too long to check (left to the student): not counted below
const LOWER = "abcdefghijklmnopqrstuvwxyz";
// txt with one lowercase letter changed (sub) or left out (drop); null when the result is still an accepted answer
function misspell(txt, A, kind) {
  const idx = [...txt].map((c, i) => (LOWER.includes(c) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return null;
  const i = pick(idx);
  let c = txt[i];
  if (kind === "sub") while (c === txt[i]) c = pick([...LOWER]);
  const t = txt.slice(0, i) + (kind === "sub" ? c : "") + txt.slice(i + 1);
  return !letters(t) || A.some((a) => letters(a) === letters(t)) ? null : t;
}
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const g = pick(G), [fname, font] = pick(fonts);
  const run = (txt, seed) => { const w = writeEnglish(txt, font, seed, opts); return C.verify({ strokes: w.strokes, candidates: g.A, box: w.box, latin: true }); };
  const txt = styleCase(pick(g.A)), res = run(txt, SEED * 100000 + i);
  if (res.ok === null) { unchecked++; continue; }
  ms.push(res.ms); stats.pos[0] += res.ok === true; stats.pos[1]++;
  if (res.ok !== true) misses.push({ en: g.en, wrote: txt, font: fname, read: res.chars.map((c) => (c.ok ? c.ch : `[${c.ch || "+"}:${c.why}${c.got ? ">" + c.got : ""}]`)).join("") });
  let h; do h = pick(G); while (h.A.some((a) => g.A.some((b) => letters(a) === letters(b))));
  const ntxt = styleCase(pick(h.A)), rn = run(ntxt, SEED * 100000 + i + 50000);
  stats.neg[0] += rn.ok === true; stats.neg[1]++;
  if (rn.ok === true) fas.push({ kind: "random", en: g.en, wrote: ntxt, font: fname, read: rn.text });
  const la = g.A.map(letters);
  let best = null, bd = 1e9;
  for (const k of G) {
    if (k === g) continue;
    for (const a of k.A) { const l = letters(a); if (!l || la.includes(l)) continue; for (const b of la) { const d = ed(l, b) / Math.max(l.length, b.length); if (d > 0 && d < bd) { bd = d; best = a; } } }
  }
  for (const kind of ["sub", "drop"]) {
    const t = misspell(txt, g.A, kind);
    if (!t) continue;
    const rs = run(t, SEED * 100000 + i + (kind === "sub" ? 80000 : 90000));
    stats[kind][0] += rs.ok === true; stats[kind][1]++;
    if (rs.ok === true) fas.push({ kind, en: g.en, wrote: t, font: fname, read: rs.text });
  }
  if (best && bd <= 0.4) {
    const ht = styleCase(best), rh = run(ht, SEED * 100000 + i + 70000);
    stats.hard[0] += rh.ok === true; stats.hard[1]++;
    if (rh.ok === true) fas.push({ kind: "hard", en: g.en, wrote: ht, font: fname, read: rh.text });
  }
}
const pct = (a) => (100 * a[0] / Math.max(1, a[1])).toFixed(1) + "% of " + a[1];
ms.sort((a, b) => a - b);
console.log(`accepted, correct meaning      ${pct(stats.pos)}  (${unchecked} more too long to check)`);
console.log(`accepted, random other meaning ${pct(stats.neg)}`);
console.log(`accepted, closest other spelling ${pct(stats.hard)}`);
console.log(`accepted, one letter changed  ${pct(stats.sub)}`);
console.log(`accepted, one letter left out ${pct(stats.drop)}`);
console.log(`ms per check: median ${ms[ms.length >> 1]}, p90 ${ms[Math.floor(ms.length * 0.9)]}, max ${ms[ms.length - 1]}; wall ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (VERB) {
  console.log("-- correct meanings not accepted"); for (const f of misses.slice(0, VERB)) console.log(JSON.stringify(f));
  console.log("-- other meanings accepted"); for (const f of fas.slice(0, VERB)) console.log(JSON.stringify(f));
}
