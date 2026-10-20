#!/usr/bin/env node
// Builds data/templates.json (handwriting templates for src/checker.js) from KanjiVG stroke data.
//
//   node tools/make-templates.mjs --kanjivg <dir with KanjiVG kanji/*.svg> [--fetch] [--page app.html] [--vocab dir] [--out data/templates.json]
//
// --kanjivg  folder holding KanjiVG's per-character SVG files (05-hex-digit names such as 0732b.svg),
//            e.g. the "kanji" folder of a KanjiVG release or clone. Required.
// --fetch    download any missing SVG from raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/ into that folder.
// --page     also take every kanji listed in the page's READ_SRC string (and add them to tools/checker/charset.txt).
// --vocab    also take every kanji found in a folder of vocab set JSON files (and add them to charset.txt).
//
// The SVG files are only parsed as text (path "d" attributes); nothing in them is executed.
// Output format (version 1):
//   { "version": 1, "license": "...", "unit": 109, "q": 91, "chars": { "あ": "<stroke> <stroke> ...", ... } }
// Each stroke is a string of point pairs; every point is two characters from ALPHABET (x then y),
// value v in 0..q-1 standing for v * unit / (q - 1) in KanjiVG's 109 x 109 box (y down).
// Strokes keep KanjiVG's stroke order and drawing direction; they are simplified with Douglas-Peucker.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const ALPHABET = (() => { let s = ""; for (let c = 0x21; c <= 0x7e; c++) if (c !== 0x22 && c !== 0x5c) s += String.fromCharCode(c); return s; })(); // 92 symbols
const Q = 92, UNIT = 109, TOL = 0.7;

function args() {
  const a = process.argv.slice(2), o = { out: path.join(ROOT, "data/templates.json") };
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === "--fetch") o.fetch = true;
    else if (k.startsWith("--")) o[k.slice(2)] = a[++i];
  }
  if (!o.kanjivg) { console.error("usage: node tools/make-templates.mjs --kanjivg <dir> [--fetch] [--page html] [--vocab dir] [--out file]"); process.exit(2); }
  return o;
}

// ---------- character set ----------
function builtinChars() {
  const out = [];
  for (let c = 0x3041; c <= 0x3096; c++) out.push(String.fromCodePoint(c)); // ぁ..ゖ
  for (let c = 0x30a1; c <= 0x30fa; c++) out.push(String.fromCodePoint(c)); // ァ..ヺ
  out.push("ー", "々", "、", "。", "・");
  // kanji that look like kana, so writing them for the kana can be recognised as the same thing
  out.push(..."力工口夕二八卜一才匕乂");
  for (let c = 0x30; c <= 0x39; c++) out.push(String.fromCharCode(c));
  for (let c = 0x41; c <= 0x5a; c++) out.push(String.fromCharCode(c), String.fromCharCode(c + 32));
  return out;
}
const isKanji = (c) => /[㐀-鿿豈-﫿]/u.test(c);
function readCharset(file) {
  if (!fs.existsSync(file)) return [];
  return [...fs.readFileSync(file, "utf8").split("\n").filter((l) => !l.startsWith("#")).join("")].filter(isKanji);
}
function writeCharset(file, list) {
  let out = "# Kanji that get handwriting templates (50 per line). Kana, digits, Latin and punctuation are built into make-templates.mjs.\n";
  for (let i = 0; i < list.length; i += 50) out += list.slice(i, i + 50).join("") + "\n";
  fs.writeFileSync(file, out);
}
function extraFromPage(file) {
  const m = fs.readFileSync(file, "utf8").match(/const READ_SRC = "([^"]*)"/);
  if (!m) throw new Error("READ_SRC not found in " + file);
  return m[1].split("|").map((e) => e.split(":")[0]).filter(isKanji);
}
function extraFromVocab(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    for (const w of d.words || []) for (const c of (w.kanji || "") + (w.kana || "")) if (isKanji(c)) out.push(c);
  }
  return out;
}

// ---------- SVG path parsing (M/m C/c S/s L/l H/h V/v Q/q T/t Z/z) ----------
function parsePath(d) {
  const toks = d.match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  let i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0, lcx = 0, lcy = 0, lqx = 0, lqy = 0, prev = "";
  const pts = [];
  const num = () => parseFloat(toks[i++]);
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    const n = 12;
    for (let k = 1; k <= n; k++) {
      const t = k / n, u = 1 - t;
      pts.push([u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]);
    }
    lcx = x2; lcy = y2; x = x3; y = y3;
  };
  while (i < toks.length) {
    if (/[A-Za-z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === "M") { x = ox + num(); y = oy + num(); sx = x; sy = y; pts.push([x, y]); cmd = rel ? "l" : "L"; prev = "M"; continue; }
    if (C === "Z") { x = sx; y = sy; pts.push([x, y]); prev = "Z"; continue; }
    if (C === "L") { x = ox + num(); y = oy + num(); pts.push([x, y]); }
    else if (C === "H") { x = ox + num(); pts.push([x, y]); }
    else if (C === "V") { y = (rel ? y : 0) + num(); pts.push([x, y]); }
    else if (C === "C") { const a = [num(), num(), num(), num(), num(), num()]; cubic(ox + a[0], oy + a[1], ox + a[2], oy + a[3], ox + a[4], oy + a[5]); }
    else if (C === "S") {
      const a = [num(), num(), num(), num()];
      const x1 = "CS".includes(prev) ? 2 * x - lcx : x, y1 = "CS".includes(prev) ? 2 * y - lcy : y;
      cubic(x1, y1, ox + a[0], oy + a[1], ox + a[2], oy + a[3]);
    } else if (C === "Q" || C === "T") {
      let qx, qy;
      if (C === "Q") { qx = ox + num(); qy = oy + num(); } else { qx = "QT".includes(prev) ? 2 * x - lqx : x; qy = "QT".includes(prev) ? 2 * y - lqy : y; }
      const ex = ox + num(), ey = oy + num();
      cubic(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey), ex, ey);
      lqx = qx; lqy = qy;
    } else throw new Error("unsupported path command " + cmd);
    prev = C;
  }
  return pts;
}

function strokesFromSvg(text) {
  const paths = [];
  const re = /<path\b([^>]*)>/g;
  let m;
  while ((m = re.exec(text))) {
    const attrs = m[1];
    const id = (attrs.match(/\bid="([^"]*)"/) || [])[1] || "";
    const d = (attrs.match(/\bd="([^"]*)"/) || [])[1];
    const sn = id.match(/-s(\d+)$/);
    if (!d || !sn) continue;
    paths.push({ n: +sn[1], pts: parsePath(d) });
  }
  paths.sort((a, b) => a.n - b.n);
  return paths.map((p) => p.pts);
}

// ---------- simplification ----------
function dp(pts, tol) {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const quant = (v) => Math.max(0, Math.min(Q - 1, Math.round((v * (Q - 1)) / UNIT)));
function encodeStroke(pts) {
  let s = dp(pts, TOL).map(([x, y]) => [quant(x), quant(y)]);
  s = s.filter((p, i) => i === 0 || p[0] !== s[i - 1][0] || p[1] !== s[i - 1][1]);
  if (s.length === 1) s.push(s[0].slice());
  return s.map(([x, y]) => ALPHABET[x] + ALPHABET[y]).join("");
}

async function main() {
  const o = args();
  const csFile = path.join(HERE, "checker/charset.txt");
  let kanji = readCharset(csFile);
  const extra = [];
  if (o.page) extra.push(...extraFromPage(o.page));
  if (o.vocab) extra.push(...extraFromVocab(o.vocab));
  if (extra.length) {
    const set = new Set(kanji), before = set.size;
    for (const c of extra) set.add(c);
    if (set.size > before) { kanji = [...set]; writeCharset(csFile, kanji); console.error(`charset.txt: +${set.size - before} kanji`); }
  }
  const chars = [...new Set([...builtinChars(), ...kanji])];
  const out = {};
  const missing = [];
  for (const ch of chars) {
    const file = path.join(o.kanjivg, ch.codePointAt(0).toString(16).padStart(5, "0") + ".svg");
    if (!fs.existsSync(file) && o.fetch) {
      const url = "https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/" + path.basename(file);
      const r = await fetch(url);
      if (r.ok) fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    }
    if (!fs.existsSync(file)) { missing.push(ch); continue; }
    const strokes = strokesFromSvg(fs.readFileSync(file, "utf8"));
    if (!strokes.length) { missing.push(ch); continue; }
    out[ch] = strokes.map(encodeStroke).join(" ");
  }
  const json = {
    version: 1,
    license: "Stroke data derived from KanjiVG (https://kanjivg.tagaini.net), Copyright (C) 2009/2010/2011 Ulrich Apel, " +
      "licensed under the Creative Commons Attribution-Share Alike 3.0 licence (https://creativecommons.org/licenses/by-sa/3.0/). " +
      "This derived file (resampled, simplified, quantized strokes) is distributed under the same licence. Built by tools/make-templates.mjs.",
    unit: UNIT,
    q: Q,
    alphabet: ALPHABET,
    chars: out,
  };
  fs.writeFileSync(o.out, JSON.stringify(json));
  const size = fs.statSync(o.out).size;
  console.error(`wrote ${o.out}: ${Object.keys(out).length} characters, ${(size / 1024).toFixed(0)} KB` + (missing.length ? `; no KanjiVG data for: ${missing.join(" ")}` : ""));
}
main().catch((e) => { console.error(e); process.exit(1); });
