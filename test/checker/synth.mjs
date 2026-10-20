// Synthetic and "real composite" handwriting for evaluating src/checker.js.
// Everything here is deterministic given the seed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../..");

// ---------------------------------------------------------------- rng
export function rng(seed) {
  let s = seed >>> 0 || 1;
  const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  r.range = (a, b) => a + (b - a) * r();
  r.norm = () => { let u = 0, v = 0; while (u === 0) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.int = (a, b) => a + Math.floor(r() * (b - a + 1));
  return r;
}

// ---------------------------------------------------------------- templates (109-unit KanjiVG box)
let TPL = null;
export function templates() {
  if (TPL) return TPL;
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, "data/templates.json"), "utf8"));
  const map = new Map();
  for (const [ch, s] of Object.entries(j.chars)) {
    map.set(ch, s.split(" ").map((part) => {
      const pts = [];
      for (let i = 0; i + 1 < part.length; i += 2) pts.push([j.alphabet.indexOf(part[i]) * j.unit / (j.q - 1), j.alphabet.indexOf(part[i + 1]) * j.unit / (j.q - 1)]);
      return pts;
    }));
  }
  TPL = { json: j, map };
  return TPL;
}
// template strokes in em units (cell = 1 x 1)
export function tplStrokes(ch) {
  const t = templates().map.get(ch);
  if (!t) return null;
  return t.map((s) => s.map(([x, y]) => [x / 109, y / 109]));
}

// ---------------------------------------------------------------- real handwriting sources
// KanjiCanvas ref-patterns.js (MIT, (c) Dominik Klein): hand-drawn with jTegaki, moment-normalised.
// Tomoe handwriting-ja.xml (from the tegaki repository): hand-drawn, reduced to corner points.
let REAL = null;
export function realPatterns(dir) {
  if (REAL) return REAL;
  REAL = new Map();
  const add = (ch, strokes, src) => { if (!REAL.has(ch)) REAL.set(ch, []); REAL.get(ch).push({ strokes, src }); };
  const kc = path.join(dir, "ref-patterns.js");
  if (fs.existsSync(kc)) {
    const s = fs.readFileSync(kc, "utf8");
    const body = s.slice(s.indexOf("KanjiCanvas.refPatterns = [") + "KanjiCanvas.refPatterns = ".length);
    // each entry: ["字", n, [[[x,y],...],...]],  -- parsed as JSON line by line, never evaluated
    for (const line of body.split("\n")) {
      const m = line.trim().replace(/,\s*$/, "");
      if (!m.startsWith("[\"")) continue;
      try {
        const e = JSON.parse(m);
        if (typeof e[0] === "string" && Array.isArray(e[2])) add(e[0], e[2], "kanjicanvas");
      } catch (_) { /* skip */ }
    }
  }
  const tm = path.join(dir, "handwriting-ja.xml");
  if (fs.existsSync(tm)) {
    const s = fs.readFileSync(tm, "utf8");
    const re = /<character>([\s\S]*?)<\/character>/g;
    let m;
    while ((m = re.exec(s))) {
      const u = m[1].match(/<utf8>([^<]*)<\/utf8>/);
      if (!u) continue;
      const ch = u[1].replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
      const strokes = [];
      const sr = /<stroke>([\s\S]*?)<\/stroke>/g;
      let k;
      while ((k = sr.exec(m[1]))) {
        const pts = [...k[1].matchAll(/x="(-?\d+)"\s+y="(-?\d+)"/g)].map((q) => [+q[1], +q[2]]);
        if (pts.length) strokes.push(pts);
      }
      if (strokes.length) add(ch, strokes, "tomoe");
    }
  }
  return REAL;
}

// ---------------------------------------------------------------- helpers
const bbox = (strokes) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const [x, y] of s) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
};
function densify(pts, step) {
  if (pts.length < 2) return pts.map((p) => p.slice());
  const out = [pts[0].slice()];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) out.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n]);
  }
  return out;
}
// smooth chaikin-ish to round off polygon corners a little (for sparse sources)
function soften(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    if (i > 0) out.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1]);
    if (i < pts.length - 2) out.push([0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// Map char-local strokes (em units, 1x1 cell) through a random smooth deformation.
function deformChar(strokes, r, lvl) {
  const rot = r.norm() * 0.05 * lvl, sh = r.norm() * 0.08 * lvl;
  const sx = 1 + r.norm() * 0.08 * lvl, sy = 1 + r.norm() * 0.08 * lvl;
  // low-frequency displacement field
  const wv = [];
  for (let k = 0; k < 3; k++) wv.push({ ax: r.norm() * 0.018 * lvl, ay: r.norm() * 0.018 * lvl, fx: r.range(1, 3), fy: r.range(1, 3), px: r.range(0, 6.28), py: r.range(0, 6.28) });
  const c = Math.cos(rot), s = Math.sin(rot);
  const f = ([x, y]) => {
    let u = x - 0.5, v = y - 0.5;
    for (const w of wv) { u += w.ax * Math.sin(w.fx * 6.28 * y + w.px); v += w.ay * Math.sin(w.fy * 6.28 * x + w.py); }
    u *= sx; v *= sy; u += sh * v;
    return [0.5 + c * u - s * v, 0.5 + s * u + c * v];
  };
  return strokes.map((st) => {
    // per-stroke jitter: shift, rotate and scale about its own centre
    const b = bbox([st]), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    const dx = r.norm() * 0.022 * lvl, dy = r.norm() * 0.022 * lvl, a = r.norm() * 0.06 * lvl, sc = 1 + r.norm() * 0.08 * lvl;
    const ca = Math.cos(a), sa = Math.sin(a);
    let pts = st.map(([x, y]) => { const u = (x - cx) * sc, v = (y - cy) * sc; return [cx + ca * u - sa * v + dx, cy + sa * u + ca * v + dy]; });
    // length change at the ends (extend/shorten along end tangent)
    if (pts.length >= 2 && r() < 0.5) {
      const e = r.norm() * 0.03 * lvl, n = pts.length;
      const [x0, y0] = pts[n - 2], [x1, y1] = pts[n - 1], L = Math.hypot(x1 - x0, y1 - y0) || 1;
      pts[n - 1] = [x1 + (x1 - x0) / L * e, y1 + (y1 - y0) / L * e];
    }
    return pts.map(f);
  });
}

// Reorder / reverse / join strokes the way people do.
function messOrder(strokes, r, opt, keepTail) {
  const all = strokes.map((s) => s.map((p) => p.slice()));
  const tail = all.splice(all.length - keepTail, keepTail);
  // cursive: join strokes that follow each other in the standard order and end/start close together
  let st = [all[0]];
  if (r() < opt.join) {
    let run = 1;
    for (let i = 1; i < all.length; i++) {
      const prev = st[st.length - 1], cur = all[i];
      const [ex, ey] = prev[prev.length - 1], [sx, sy] = cur[0];
      if (run < 3 && Math.hypot(sx - ex, sy - ey) < 0.33 && r() < 0.5) { st[st.length - 1] = prev.concat(cur); run++; }
      else { st.push(cur); run = 1; }
    }
  } else st = all.slice();
  const n = st.length;
  if (n >= 2 && r() < opt.swap) { const i = r.int(0, n - 2); [st[i], st[i + 1]] = [st[i + 1], st[i]]; }
  if (n >= 3 && r() < opt.swap / 2) { const i = r.int(0, n - 1), j = r.int(0, n - 1); [st[i], st[j]] = [st[j], st[i]]; }
  st = st.map((s) => (r() < opt.reverse ? s.slice().reverse() : s));
  return st.concat(tail);
}

export function hasDakuten(ch) { const d = ch.normalize("NFD"); return d.length > 1 && (d[1] === "\u3099" || d[1] === "\u309a"); }
export function baseOf(ch) { return ch.normalize("NFD")[0]; }
const SMALL_MAP = { "ぁ": "あ", "ぃ": "い", "ぅ": "う", "ぇ": "え", "ぉ": "お", "っ": "つ", "ゃ": "や", "ゅ": "ゆ", "ょ": "よ", "ゎ": "わ", "ァ": "ア", "ィ": "イ", "ゥ": "ウ", "ェ": "エ", "ォ": "オ", "ッ": "ツ", "ャ": "ヤ", "ュ": "ユ", "ョ": "ヨ", "ヮ": "ワ", "ヵ": "カ", "ヶ": "ケ" };
export const SMALL_TO_LARGE = SMALL_MAP;

// Character strokes in em units within a 1x1 cell, from real data if asked and available.
// Returns { strokes, real: bool, tail: number of trailing strokes that are a dakuten/handakuten }
export function charStrokes(ch, r, mode, realDir, pick) {
  const T = tplStrokes(ch);
  if (mode === "real") {
    const R = realPatterns(realDir);
    const fit = (pat, tpl) => {
      // place a real pattern into the cell where the template sits
      const pb = bbox(pat), tb = bbox(tpl);
      const pw = pb[2] - pb[0], ph = pb[3] - pb[1], tw = tb[2] - tb[0], th = tb[3] - tb[1];
      const s = Math.max(tw, th) / Math.max(pw, ph, 1e-9);
      const tcx = (tb[0] + tb[2]) / 2, tcy = (tb[1] + tb[3]) / 2, pcx = (pb[0] + pb[2]) / 2, pcy = (pb[1] + pb[3]) / 2;
      return pat.map((st) => soften(st).map(([x, y]) => [tcx + (x - pcx) * s, tcy + (y - pcy) * s]));
    };
    if (R.has(ch)) {
      const pat = pick !== undefined ? R.get(ch)[pick % R.get(ch).length] : r.pick(R.get(ch));
      return { strokes: fit(pat.strokes, T), real: true, aug: false, tail: 0 };
    }
    // dakuten / handakuten on a real base: base from real data, marks from the template (in the base's frame)
    const b = baseOf(ch);
    if (hasDakuten(ch) && R.has(b) && T) {
      const tb = tplStrokes(b), nb = tb.length;
      const base = fit(r.pick(R.get(b)).strokes, tb);
      return { strokes: base.concat(T.slice(nb)), real: true, aug: true, tail: T.length - nb };
    }
    const L = SMALL_MAP[ch];
    if (L && R.has(L)) {
      return { strokes: fit(r.pick(R.get(L)).strokes, T), real: true, aug: true, tail: 0 };
    }
    return { strokes: T, real: false, aug: false, tail: hasDakuten(ch) ? T.length - (tplStrokes(baseOf(ch)) || T).length : 0 };
  }
  return { strokes: T, real: false, aug: false, tail: hasDakuten(ch) && tplStrokes(baseOf(ch)) ? T.length - tplStrokes(baseOf(ch)).length : 0 };
}

// Render a whole written line. Returns { strokes (px, dense), box, realChars, totalChars }.
export function writeWord(text, seed, opt = {}) {
  const r = rng(seed);
  const o = {
    mode: "synth", level: 1, swap: 0.25, reverse: 0.04, join: 0.3, lateDakuten: 0.3, mouse: r() < 0.4, realDir: null,
    boxW: r.range(320, 760), ...opt,
  };
  const chars = [...text];
  const boxH = o.boxH || Math.max(120, Math.min(190, o.boxW * 0.2));
  let em = o.em || r.range(45, Math.min(110, (o.boxW - 30) / Math.max(1, chars.length) / 1.05, boxH * 0.85));
  em = Math.max(22, em);
  let x = r.range(8, 30), base = r.range(boxH * 0.1, Math.max(boxH * 0.12, boxH - em * 1.05));
  const drift = r.norm() * 0.04;
  const all = [];
  let realChars = 0, augChars = 0;
  const pendingTail = [];
  chars.forEach((ch, ci) => {
    const cs = charStrokes(ch, r, o.mode, o.realDir, o.pick);
    if (!cs.strokes) throw new Error("no strokes for " + ch);
    if (cs.real) realChars++;
    if (cs.aug) augChars++;
    const scale = em * (1 + r.norm() * 0.1);
    let src = cs.strokes;
    // people write small kana clearly smaller than KanjiVG draws them: shrink towards the bottom of the cell
    if (SMALL_MAP[ch]) { const f = r.range(0.68, 0.88); src = src.map((s) => s.map(([u, v]) => [0.45 + (u - 0.45) * f, 0.9 + (v - 0.9) * f])); }
    const st = deformChar(src, r, cs.real ? o.level * 0.5 : o.level);
    // stroke direction is what tells ン from ソ and シ from ツ, so people who know them do not reverse those strokes
    const mess = messOrder(st, r, "ンソシツッ".includes(ch) ? { ...o, reverse: 0 } : o, cs.tail);
    const y0 = base + r.norm() * 0.05 * em + drift * x;
    const cellW = scale * r.range(0.95, 1.12);
    const pxs = mess.map((s) => s.map(([u, v]) => [x + u * scale, y0 + v * scale]));
    // dakuten written after the next character
    let tail = [];
    if (cs.tail && ci < chars.length - 1 && r() < o.lateDakuten) tail = pxs.splice(pxs.length - cs.tail, cs.tail);
    all.push(...pxs);
    if (pendingTail.length) { all.push(...pendingTail); pendingTail.length = 0; }
    pendingTail.push(...tail);
    x += cellW * (chars.length > 1 ? r.range(0.92, 1.12) : 1);
  });
  all.push(...pendingTail);
  // raw pointer sampling with wobble
  const step = r.range(1, 4);
  const amp = o.mouse ? r.range(0.6, 1.8) : r.range(0.1, 0.5);
  const strokes = all.map((s) => {
    const d = densify(s, step);
    let ox = 0, oy = 0;
    return d.map(([px, py]) => {
      ox = 0.8 * ox + r.norm() * amp * 0.6; oy = 0.8 * oy + r.norm() * amp * 0.6;
      return [Math.round((px + ox + r.norm() * amp * 0.3) * 10) / 10, Math.round((py + oy + r.norm() * amp * 0.3) * 10) / 10];
    });
  });
  return { strokes, box: { w: Math.round(o.boxW), h: Math.round(boxH) }, realChars, augChars, totalChars: chars.length };
}
