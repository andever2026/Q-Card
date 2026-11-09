// Synthetic handwritten English (print letters) for testing the checker's English mode (verify({ latin: true })).
// Letters come from single-line fonts: by default the Hershey letters in tools/checker/hershey-latin.json (the same
// shapes the templates use), or any font of the hersheytext package (npm "hersheytext": its Hershey JSON fonts and its
// EMS SVG fonts, SIL OFL), which test/checker/eval-en.mjs uses so the test writing differs from the templates.
// Each glyph's plotter paths are turned into strokes the way people print (humanize), deformed, set on a slanted,
// drifting line, and given pointer noise.
import fs from "node:fs";
import path from "node:path";
import { rng, ROOT } from "./synth.mjs";

const bbox = (strokes) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const s of strokes) for (const [x, y] of s) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return [x0, y0, x1, y1]; };
const plen = (s) => { let L = 0; for (let i = 1; i < s.length; i++) L += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]); return L; };
function densify(pts, step) {
  if (pts.length < 2) return pts.map((p) => p.slice());
  const out = [pts[0].slice()];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let k = 1; k <= n; k++) out.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n]);
  }
  return out;
}

// ---------------------------------------------------------------- fonts
// A font is a Map char -> { strokes, adv } in "cap units": baseline y = 0, cap height 1 (capitals reach y = -1), y down.
function parsePath(d, flipY) {
  // absolute M / L / C / Z only (C flattened to 8 segments)
  const toks = d.match(/[MLCZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) || [];
  const strokes = [];
  let cur = null, cmd = null, i = 0;
  const num = () => +toks[i++];
  while (i < toks.length) {
    const t = toks[i];
    if (/^[MLCZ]$/i.test(t)) { cmd = t.toUpperCase(); i++; if (cmd === "Z" && cur && cur.length) cur.push(cur[0].slice()); continue; }
    if (cmd === "M") { cur = [[num(), num()]]; strokes.push(cur); cmd = "L"; }
    else if (cmd === "L") cur.push([num(), num()]);
    else if (cmd === "C") {
      const p0 = cur[cur.length - 1], p1 = [num(), num()], p2 = [num(), num()], p3 = [num(), num()];
      for (let k = 1; k <= 8; k++) { const s = k / 8, u = 1 - s; cur.push([u * u * u * p0[0] + 3 * u * u * s * p1[0] + 3 * u * s * s * p2[0] + s * s * s * p3[0], u * u * u * p0[1] + 3 * u * u * s * p1[1] + 3 * u * s * s * p2[1] + s * s * s * p3[1]]); }
    } else i++;
  }
  return strokes.map((s) => s.map(([x, y]) => [x, flipY ? -y : y]));
}
function toCapUnits(glyphs, base, cap) {
  for (const g of glyphs.values()) { g.strokes = g.strokes.map((s) => s.map(([x, y]) => [x / cap, (y - base) / cap])); g.adv /= cap; }
  return glyphs;
}
// The letters the templates use (tools/checker/hershey-latin.json). Advance = ink width plus a little space.
export function defaultFont() {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/checker/hershey-latin.json"), "utf8"));
  const glyphs = new Map();
  for (const [ch, d] of Object.entries(j.glyphs)) { const st = parsePath(d, false), b = bbox(st); glyphs.set(ch, { strokes: st, adv: b[2] - b[0] + 7 }); }
  const H = bbox(glyphs.get("H").strokes);
  toCapUnits(glyphs, H[3], H[3] - H[1]);
  glyphs.space = 0.5;
  return glyphs;
}
// A font from the hersheytext package folder: a Hershey JSON font name (futural, timesr, ...) or an SVG font file
// name in its svg_fonts folder (EMSReadability.svg, ...).
export function loadFont(pkgDir, name) {
  const glyphs = new Map();
  if (!name.endsWith(".svg")) {
    const f = JSON.parse(fs.readFileSync(path.join(pkgDir, "hersheytext.json"), "utf8"))[name];
    if (!f) throw new Error("no Hershey font " + name);
    f.chars.forEach((g, i) => glyphs.set(String.fromCharCode(33 + i), { strokes: parsePath(g.d, false), adv: g.o * 2 }));
    const H = bbox(glyphs.get("H").strokes);
    toCapUnits(glyphs, H[3], H[3] - H[1]);
    glyphs.space = 0.5;
    return glyphs;
  }
  const s = fs.readFileSync(path.join(pkgDir, "svg_fonts", name), "utf8");
  for (const m of s.matchAll(/<glyph ([^>]*?)\/>/g)) {
    const a = m[1], u = a.match(/unicode="([^"]*)"/), d = a.match(/ d="([^"]*)"/), adv = a.match(/horiz-adv-x="([^"]*)"/);
    if (!u) continue;
    const ch = u[1].replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'");
    glyphs.set(ch, { strokes: d ? parsePath(d[1], true) : [], adv: adv ? +adv[1] : 500 });
  }
  toCapUnits(glyphs, 0, -bbox(glyphs.get("H").strokes)[1]);
  glyphs.space = glyphs.get(" ")?.adv || 0.5;
  return glyphs;
}
export const FONTS = {
  futural: "futural", timesr: "timesr",
  readability: "EMSReadability.svg", readabilityI: "EMSReadabilityItalic.svg", nixish: "EMSNixish.svg", nixishI: "EMSNixishItalic.svg",
  tech: "EMSTech.svg", elfin: "EMSElfin.svg",
};

// ---------------------------------------------------------------- plotter paths -> printed strokes
// Split at reversals, drop ink that retraces ink already drawn, straight downstrokes go top to bottom and crossbars
// left to right; then (with probability joinP) keep the pen down between pieces that touch, as people do in h, n, b, p.
function splitCusps(s) {
  const d = densify(s, 0.02), out = [];
  let cur = [d[0]];
  for (let i = 1; i < d.length; i++) {
    cur.push(d[i]);
    if (i + 1 < d.length) {
      const a = d[Math.max(0, i - 3)], b = d[i], c = d[Math.min(d.length - 1, i + 3)];
      const v1 = [b[0] - a[0], b[1] - a[1]], v2 = [c[0] - b[0], c[1] - b[1]], n1 = Math.hypot(...v1), n2 = Math.hypot(...v2);
      if (n1 > 1e-6 && n2 > 1e-6 && (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2) < -0.85) { out.push(cur); cur = [d[i]]; }
    }
  }
  out.push(cur);
  return out;
}
const near = (p, pieces, tol) => pieces.some((q) => q.some(([x, y]) => Math.hypot(x - p[0], y - p[1]) < tol));
export function humanize(strokes, r, joinP = 0.6) {
  let pieces = [];
  for (const s of strokes) {
    if (s.length < 2 || plen(s) < 0.04) { pieces.push(s); continue; }
    for (let p of splitCusps(s)) {
      let a = 0, b = p.length;
      while (a < b && near(p[a], pieces, 0.035)) a++;
      while (b > a && near(p[b - 1], pieces, 0.035)) b--;
      p = p.slice(Math.max(0, a - 1), Math.min(p.length, b + 1));
      if (plen(p) >= 0.06) pieces.push(p);
    }
  }
  pieces = pieces.map((p) => {
    if (p.length < 2) return p;
    const [x0, y0] = p[0], [x1, y1] = p[p.length - 1], dx = x1 - x0, dy = y1 - y0;
    const straight = plen(p) < 1.15 * Math.hypot(dx, dy);
    if (straight && Math.abs(dy) > 1.5 * Math.abs(dx) && dy < 0) return p.slice().reverse();
    if (straight && Math.abs(dx) > 1.5 * Math.abs(dy) && dx < 0) return p.slice().reverse();
    return p;
  });
  const out = [];
  for (const p of pieces) {
    const prev = out[out.length - 1];
    if (prev && p.length > 1 && r() < joinP) {
      let bi = -1, bd = 1e9;
      prev.forEach(([x, y], i) => { const d = Math.hypot(x - p[0][0], y - p[0][1]); if (d < bd) { bd = d; bi = i; } });
      if (bd < 0.06) { out[out.length - 1] = prev.concat(prev.slice(bi, prev.length - 1).reverse(), p); continue; }
      const [ex, ey] = prev[prev.length - 1];
      if (Math.hypot(p[0][0] - ex, p[0][1] - ey) < 0.12) { out[out.length - 1] = prev.concat(p); continue; }
    }
    out.push(p.slice());
  }
  return out;
}

// ---------------------------------------------------------------- writing
function deform(strokes, r, lvl) {
  const b = bbox(strokes), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  const rot = r.norm() * 0.05 * lvl, sx = 1 + r.norm() * 0.08 * lvl, sy = 1 + r.norm() * 0.08 * lvl;
  const wv = [];
  for (let k = 0; k < 3; k++) wv.push({ ax: r.norm() * 0.02 * lvl, ay: r.norm() * 0.02 * lvl, fx: r.range(1, 3), fy: r.range(1, 3), px: r.range(0, 6.28), py: r.range(0, 6.28) });
  const c = Math.cos(rot), s = Math.sin(rot);
  const f = ([x, y]) => {
    let u = x - cx, v = y - cy;
    for (const w of wv) { u += w.ax * Math.sin(w.fx * 6.28 * y + w.px); v += w.ay * Math.sin(w.fy * 6.28 * x + w.py); }
    u *= sx; v *= sy;
    return [cx + c * u - s * v, cy + s * u + c * v];
  };
  return strokes.map((st) => {
    const sb = bbox([st]), scx = (sb[0] + sb[2]) / 2, scy = (sb[1] + sb[3]) / 2;
    const dx = r.norm() * 0.03 * lvl, dy = r.norm() * 0.03 * lvl, a = r.norm() * 0.06 * lvl, sc = 1 + r.norm() * 0.08 * lvl;
    const ca = Math.cos(a), sa = Math.sin(a);
    return st.map(([x, y]) => { const u = (x - scx) * sc, v = (y - scy) * sc; return [scx + ca * u - sa * v + dx, scy + sa * u + ca * v + dy]; }).map(f);
  });
}
// writeEnglish(text, font, seed, opt) -> { strokes, box: { w, h } } in px.
// opt: level (deformation), join (chance a letter joins the next), late (chance a word's i/j dots and t/f crossbars
// come after the whole word), swap / reverse (stroke order and direction slips), mouse (noisier pointer), capPx.
export function writeEnglish(text, font, seed, opt = {}) {
  const r = rng(seed);
  const o = { level: 1, join: 0, late: 0.4, swap: 0.15, reverse: 0.05, mouse: r() < 0.3, ...opt };
  const cap = o.capPx || r.range(26, 64);
  const slant = r.norm() * 0.12;
  let x = r.range(10, 30);
  const base = r.range(cap * 1.3, cap * 1.8), drift = r.norm() * 0.02;
  const out = [];
  for (const wd of text.split(/(\s+)/)) {
    if (!wd) continue;
    if (/^\s+$/.test(wd)) { x += cap * font.space * r.range(0.7, 1.6); continue; }
    const wordStrokes = [], late = [], lateWord = r() < o.late;
    let joinable = false;
    for (const ch of wd) {
      const g = font.get(ch);
      if (!g) throw new Error("no glyph " + JSON.stringify(ch));
      const st = deform(humanize(g.strokes, r, o.penDown ?? 0.6), r, o.level);
      const sc = cap * (1 + r.norm() * 0.07), y0 = base + r.norm() * 0.04 * cap + drift * x;
      let px = st.map((s) => s.map(([u, v]) => [x + (u - v * slant) * sc, y0 + v * sc]));
      // marks (i/j dots, t/f crossbars): every stroke but the longest
      let marks = [];
      if ("ijtf".includes(ch) && px.length > 1) {
        const L = px.map(plen), main = L.indexOf(Math.max(...L));
        marks = px.filter((_, k) => k !== main); px = px.filter((_, k) => k === main);
      }
      if (px.length >= 2 && r() < o.swap) { const i = r.int(0, px.length - 2); [px[i], px[i + 1]] = [px[i + 1], px[i]]; }
      px = px.map((s) => (r() < o.reverse ? s.slice().reverse() : s));
      if (joinable && px.length && r() < o.join) {
        const p = wordStrokes[wordStrokes.length - 1], [ex, ey] = p[p.length - 1], [sx, sy] = px[0][0];
        if (Math.hypot(sx - ex, sy - ey) < cap * 0.9) { wordStrokes[wordStrokes.length - 1] = p.concat(px[0]); px = px.slice(1); }
      }
      wordStrokes.push(...px);
      if (lateWord) late.push(...marks); else wordStrokes.push(...marks);
      joinable = true;
      x += g.adv * sc * r.range(0.92, 1.15) + cap * r.range(0, 0.08);
    }
    out.push(...wordStrokes, ...late);
  }
  const step = r.range(1, 4), amp = cap * (o.mouse ? r.range(0.008, 0.025) : r.range(0.002, 0.008));
  const strokes = out.map((s) => {
    let ox = 0, oy = 0;
    return densify(s, step).map(([px, py]) => {
      ox = 0.8 * ox + r.norm() * amp * 0.6; oy = 0.8 * oy + r.norm() * amp * 0.6;
      return [Math.round((px + ox + r.norm() * amp * 0.3) * 10) / 10, Math.round((py + oy + r.norm() * amp * 0.3) * 10) / 10];
    });
  });
  const b = bbox(strokes);
  return { strokes, box: { w: Math.max(300, Math.ceil(b[2] + 20)), h: Math.max(120, Math.ceil(b[3] + 20)) } };
}
