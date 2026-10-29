/*
 * Q-Card offline handwriting checker.
 * Verifies handwritten Japanese (or, with latin: true, English) against a list of acceptable answers, entirely in the browser.
 * Copyright (C) the Q-Card authors. AGPL-3.0-only (see LICENSE).
 * Template data (data/templates.json) is derived from KanjiVG (C) Ulrich Apel, CC BY-SA 3.0, and the Hershey Fonts
 * (Dr. A. V. Hershey, U. S. National Bureau of Standards).
 *
 * API: QCardChecker.init(templatesJson), .has(ch), .verify({strokes, candidates, box, anyKana, latin}), .top(strokes, box, n),
 *      .englishAnswers(meaning) (the candidates for an English meaning)
 * See test/checker/README.md for the algorithm.
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------- tunables
  const NP = 16;            // points per resampled stroke
  const REV = 0.07;         // penalty for drawing a stroke in the opposite direction (scaled by stroke length)
  const JOIN = 0.015;       // penalty per template-stroke boundary covered by one user stroke (cursive join)
  const SPLIT = 0.02;       // penalty for one template stroke drawn as two user strokes
  const DMAX = 0.32;        // a stroke pair farther apart than this is never matched
  const MISS = 0.42;        // cost (per weight unit) of a template stroke nothing was matched to
  const EXTRA = 0.42;       // cost (per weight unit) of a user stroke matched to nothing
  const WBASE = 0.3;        // stroke weight = WBASE + length (so tiny marks such as dakuten still count)
  const MARGIN = 0.012;     // expected char may be this much worse than the best other char of the same kind and still pass
  const MARGIN_V = 0.008;   // ... than a close variant (dakuten, small/large, the other kana script)
  const MARGIN_S = 0.03;    // ... than the same kana in the other script (や/ヤ): crude hiragana often looks angular
  const MARGIN_X = 0.05;    // ... than a char of another kind (a kanji when kana is expected, or the reverse)
  let CEIL = 0.21;          // a char costing more than this never passes
  const UNINK = 0.22;       // a char fails when more than this share of its ink matches no stroke of the expected char
  const KCOARSE = 24;       // competitors taken from the coarse ranking
  const KNEIGH = 12;        // competitors taken from the expected template's own coarse neighbours
  const KFINE = 6;          // closest competitors re-scored with the finer distance
  let KAPPA = 0.45;         // decision point between two close templates (0.5 = halfway)
  const TCLOSE = 0.09;      // templates closer than this (未/末, 士/土, 午/牛) are also told apart by their stroke ends...
  let XSHIFT = 0.6;         // ...the writing fails when its ends sit past this point towards the other one
  const XEND = 0.05;        // ... (only the stroke ends at least this far apart in the two templates count)
  const XSHAPE = 0.05;      // ... (and only when every stroke has a partner of the same shape: mean distance at unit length)
  let LMARGIN = 0.03, LMARGIN_X = 0.1, LKAPPA = 5, LCEIL = 0.25; // English: as MARGIN, MARGIN_X (letter vs digit), KAPPA (5: off), CEIL
  const LMAXLEN = 32;       // English: longer answers (letters and digits) aren't checked
  let LOOPPEN = 0.04;       // English: a closed loop matched to an open stroke, or the reverse
  let LPLACE = 0.15;        // English: cost per capital height a letter sits off where it belongs on the line
  let PSLACK = 0.12;        // ... beyond this much
  let LWIDE = 0.2, WSLACK = 0.5; // ... and per x-height a letter is wider than its template, beyond WSLACK
  const GRID = 8;           // coarse feature grid
  const AFF = 0.8;          // how far the per-template affine alignment may go (0 = off)
  const AFFPEN = 0.02;      // cost per unit of affine deformation
  const AFFGATE = 0.34;     // only refine with an affine map when the plain cost is below this
  const SMALLF = 0.65;      // handwritten small kana are about this size of the full-size form...
  const SBOT = 0.88;        // ...sitting on the same bottom line (em units from the top of the cell)
  const STRAY_SIZE = 0.15;  // a mark no bigger than this (x the height of the other writing)...
  const STRAY_GAP = 0.6;    // ...this far from every other stroke is a stray tap, not writing

  // ---------------------------------------------------------------- state
  let RAW = null;           // ch -> encoded strokes
  let CHARS = [];           // all template chars
  let DEC = new Map();      // ch -> decoded template
  let COARSE = null;        // Float32Array(CHARS.length * FD)
  let unit = 109, qn = 92, alpha = "", AIDX = null;
  let JPOOL = null, LPOOL = null; // template indices judged against Japanese / English writing
  const FD = 4 * GRID * GRID;
  const NEIGH = new Map();  // ch -> coarse neighbours of its template
  const DMAX2 = DMAX * DMAX;

  // ---------------------------------------------------------------- character tables
  const SMALL = "ぁあぃいぅうぇえぉおっつゃやゅゆょよゎわゕかゖけァアィイゥウェエォオッツャヤュユョヨヮワヵカヶケ";
  const SMALL2LARGE = new Map(), LARGE2SMALL = new Map();
  for (let i = 0; i < SMALL.length; i += 2) { SMALL2LARGE.set(SMALL[i], SMALL[i + 1]); LARGE2SMALL.set(SMALL[i + 1], SMALL[i]); }
  // small kana people actually write; a full-size kana is only size-checked when its small twin is one of these
  // (い is never failed for looking like ぃ)
  const REALSMALL = new Set("っゃゅょァィゥェォッャュョ");
  // Characters that look the same when handwritten (any member may be written for any other).
  const SAME = ["カ力", "チ千", "エ工", "ロ口", "タ夕", "ニ二", "ハ八", "ト卜", "ー一", "へヘ", "べベ", "ぺペ", "りリ", "オ才", "ヒ匕", "メ乂",
    "0Oo", "1lI", "Cc", "Kk", "Pp", "Ss", "Uu", "Vv", "Ww", "Xx", "Zz", "・."];
  const SAMEMAP = new Map();
  const link = (g) => { for (const c of g) { const s = SAMEMAP.get(c) || new Set([c]); for (const d of g) s.add(d); SAMEMAP.set(c, s); } };
  for (const g of SAME) link(g);
  // Punctuation may be left out, and so may the 〜 a set uses to mark a slot (〜さん: さん or 〜さん).
  const OPTIONAL = new Set(["、", "。", "・", ",", ".", "!", "?", "！", "？", "〜"]);
  // Templates only matched where the answer has them, never a competitor for other characters (a wavy ー is no 〜).
  const ASKED = new Set(["〜"]);
  // In English writing, ASCII punctuation is optional too.
  const LPUNCT = new Set([".", ",", "'", "-", "!", "?", ":", ";", "\"", "(", ")"]);
  const LONLY = new Set([...LPUNCT, "&"]); // templates (from the Hershey fonts) that only English writing uses
  // Other ways of writing a Latin letter or digit are extra templates named "a#1", "g#1", ...; letterOf gives the letter.
  const isDigit = (c) => c >= "0" && c <= "9";
  const letterOf = (k) => (k.length > 2 && k[1] === "#" ? k[0] : k);
  const latinKey = (k) => /^[0-9A-Za-z]$/.test(letterOf(k)) || LPUNCT.has(k);
  const isHira = (c) => c >= "ぁ" && c <= "ゖ";
  const isKata = (c) => c >= "ァ" && c <= "ヶ";
  const toOther = (c) => (isHira(c) ? String.fromCharCode(c.charCodeAt(0) + 0x60) : isKata(c) ? String.fromCharCode(c.charCodeAt(0) - 0x60) : null);
  function kindOf(c) {
    if (isHira(c) || isKata(c) || c === "ー") return 1;
    if (/[0-9A-Za-z]/.test(c)) return 2;
    if (OPTIONAL.has(c)) return 3;
    return 0;
  }
  const same = (a, b) => a === b || (SAMEMAP.has(a) && SAMEMAP.get(a).has(b));
  const scriptTwin = (a, b) => toOther(a) === b;
  const shapeTwin = (a, b) => SMALL2LARGE.get(a) === b || SMALL2LARGE.get(b) === a;

  // ---------------------------------------------------------------- geometry helpers
  function polyLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }
  // Resample a polyline [[x,y],...] to n points equally spaced along its length -> Float64Array(2n)
  function resample(pts, n) {
    const out = new Float64Array(2 * n);
    const L = pts.length > 1 ? polyLen(pts) : 0;
    if (L < 1e-9) { for (let k = 0; k < n; k++) { out[2 * k] = pts[0][0]; out[2 * k + 1] = pts[0][1]; } return out; }
    const step = L / (n - 1);
    let k = 1, acc = 0;
    out[0] = pts[0][0]; out[1] = pts[0][1];
    for (let i = 1; i < pts.length && k < n - 1; i++) {
      const x0 = pts[i - 1][0], y0 = pts[i - 1][1], x1 = pts[i][0], y1 = pts[i][1];
      const seg = Math.hypot(x1 - x0, y1 - y0);
      while (k < n - 1 && acc + seg >= k * step) {
        const t = seg > 0 ? (k * step - acc) / seg : 0;
        out[2 * k] = x0 + t * (x1 - x0); out[2 * k + 1] = y0 + t * (y1 - y0); k++;
      }
      acc += seg;
    }
    for (; k < n; k++) { out[2 * k] = pts[pts.length - 1][0]; out[2 * k + 1] = pts[pts.length - 1][1]; }
    return out;
  }
  // A stroke that ends about where it started (o, 0, the bowl of a or d), resampled around the loop so that it can be
  // compared from any starting point and in either direction; null for other strokes.
  function loopOf(pts) {
    const L = polyLen(pts);
    if (pts.length < 4 || L < 1e-9) return null;
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.18 * L) return null;
    const bb = bboxOf(pts);
    if (Math.min(bb[2] - bb[0], bb[3] - bb[1]) < 0.15 * L) return null; // a retraced line, not a loop
    const r = resample(pts.concat([a]), NP + 1);
    return r.subarray(0, 2 * NP);
  }
  let CYC = false;          // compare loops from any starting point (English writing)
  function loopDist(A, B) {
    let best = Infinity;
    for (let dir = 0; dir < 2; dir++) for (let sh = 0; sh < NP; sh++) {
      let f = 0;
      for (let k = 0; k < NP; k++) {
        const j = dir ? (NP + sh - k) % NP : (sh + k) % NP;
        f += lc(A[2 * k] - B[2 * j], A[2 * k + 1] - B[2 * j + 1]);
        if (f >= best * NP) break;
      }
      f /= NP;
      if (f < best) { best = f; loopShift = dir ? -1 - sh : sh; }
    }
    return SQ ? Math.sqrt(best) : best;
  }
  let loopShift = 0;
  function rolled(B, sh) {
    const out = new Float64Array(2 * NP);
    for (let k = 0; k < NP; k++) { const j = sh >= 0 ? (sh + k) % NP : (NP + (-1 - sh) - k) % NP; out[2 * k] = B[2 * j]; out[2 * k + 1] = B[2 * j + 1]; }
    return out;
  }
  // De-duplicate raw pointer points and smooth them lightly (mouse wobble).
  function clean(stroke) {
    const pts = [];
    for (const p of stroke) {
      if (!p) continue;
      const x = +p[0], y = +p[1];
      if (!isFinite(x) || !isFinite(y)) continue;
      if (pts.length && Math.abs(pts[pts.length - 1][0] - x) < 1e-6 && Math.abs(pts[pts.length - 1][1] - y) < 1e-6) continue;
      pts.push([x, y]);
    }
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[Math.max(0, i - 2)], b = pts[i - 1], c = pts[i], d = pts[i + 1], e = pts[Math.min(pts.length - 1, i + 2)];
      out.push([(a[0] + 2 * b[0] + 3 * c[0] + 2 * d[0] + e[0]) / 9, (a[1] + 2 * b[1] + 3 * c[1] + 2 * d[1] + e[1]) / 9]);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  function bboxOf(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    return [x0, y0, x1, y1];
  }
  // Unit frame of a set of boxes: centred on the joint bounding box, scaled by its longer side (aspect kept).
  function frameOf(boxes) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of boxes) { if (b[0] < x0) x0 = b[0]; if (b[1] < y0) y0 = b[1]; if (b[2] > x1) x1 = b[2]; if (b[3] > y1) y1 = b[3]; }
    const w = x1 - x0, h = y1 - y0;
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, s: Math.max(w, h, 1e-6), w, h, x0, y0, x1, y1 };
  }
  // A resampled stroke (or joined strokes) with its centroid, for the matcher.
  // The resampled stroke centred on its centroid and scaled to unit length: its shape regardless of size.
  function shapeQ(p) {
    let cx = 0, cy = 0, L = 0;
    for (let k = 0; k < NP; k++) { cx += p[2 * k]; cy += p[2 * k + 1]; if (k) L += Math.hypot(p[2 * k] - p[2 * k - 2], p[2 * k + 1] - p[2 * k - 1]); }
    cx /= NP; cy /= NP;
    const inv = L > 1e-9 ? 1 / L : 0, q = new Float64Array(2 * NP);
    for (let k = 0; k < NP; k++) { q[2 * k] = (p[2 * k] - cx) * inv; q[2 * k + 1] = (p[2 * k + 1] - cy) * inv; }
    return q;
  }
  function unitOf(poly, extra) {
    const p = resample(poly, NP);
    let cx = 0, cy = 0;
    for (let k = 0; k < NP; k++) { cx += p[2 * k]; cy += p[2 * k + 1]; }
    const u = { p, q: shapeQ(p), cx: cx / NP, cy: cy / NP, len: polyLen(poly) };
    if (extra) Object.assign(u, extra);
    return u;
  }

  // ---------------------------------------------------------------- templates
  function decodePolys(ch) {
    const strokes = [];
    for (const part of RAW[ch].split(" ")) {
      const pts = [];
      for (let i = 0; i + 1 < part.length; i += 2) pts.push([AIDX[part.charCodeAt(i)] * unit / (qn - 1), AIDX[part.charCodeAt(i + 1)] * unit / (qn - 1)]);
      if (pts.length) strokes.push(pts);
    }
    const f = frameOf(strokes.map(bboxOf));
    return { f, polys: strokes.map((p) => p.map(([x, y]) => [(x - f.cx) / f.s, (y - f.cy) / f.s])) };
  }
  function getT(ch) {
    let t = DEC.get(ch);
    if (t) return t;
    const { f, polys } = decodePolys(ch);
    const strokes = polys.map((np) => { const u = unitOf(np, { poly: np, lp: loopOf(np) }); u.w = WBASE + u.len; return u; });
    const chains = [];
    for (let a = 0; a < strokes.length; a++) for (let b = a + 1; b <= Math.min(a + 2, strokes.length - 1); b++) {
      let poly = [], w = 0;
      for (let k = a; k <= b; k++) { poly = poly.concat(strokes[k].poly); w += strokes[k].w; }
      chains.push(unitOf(poly, { a, b, w }));
      // the same two strokes joined in the opposite order (the writer's own stroke order)
      if (b === a + 1) chains.push(unitOf(strokes[b].poly.concat(strokes[a].poly), { a, b, w }));
    }
    let wsum = 0; for (const s of strokes) wsum += s.w;
    t = { ch, s: strokes, chains, wsum, size: f.s / unit, w: f.w / unit, h: f.h / unit, cy: f.cy / unit, cx: f.cx / unit, n: strokes.length };
    // Latin: top and bottom in capital heights from the baseline (KanjiVG's own letters and the Hershey ones sit differently)
    // and, for letters and digits, where they sit between the lines people write on: zt = 0 at the x-height, 1 at the
    // capital height; zb = 0 on the baseline, 1 at the bottom of a descender; zw = width in x-heights
    if (latinKey(ch)) {
      const fam = ch.includes("#") ? "#1" : "", H = decodePolys("H" + fam).f;
      const lt = (f.y0 - H.y1) / H.h, lb = (f.y1 - H.y1) / H.h;
      if (/^[0-9A-Za-z]$/.test(letterOf(ch)) && lb - lt > 0.3) {
        const X = (H.y1 - decodePolys("x" + fam).f.y0) / H.h, D = (decodePolys("p" + fam).f.y1 - H.y1) / H.h;
        t.zt = Math.max(-0.5, Math.min(1.3, (-lt - X) / (1 - X))); t.zb = Math.max(-0.5, Math.min(1.5, lb / D)); t.zw = f.w / H.h / X;
      }
    }
    DEC.set(ch, t);
    return t;
  }

  // ---------------------------------------------------------------- coarse directional features
  // 4 orientations (direction-free) on a GRID x GRID map of the unit frame, blurred, square-rooted and L2-normalised.
  function coarseFeat(polys) {
    const F = new Float32Array(FD), G2 = GRID * GRID;
    for (const p of polys) {
      if (p.length === 1) { addPt(F, p[0][0], p[0][1], -1, 0.05); continue; }
      for (let i = 1; i < p.length; i++) {
        const x0 = p[i - 1][0], y0 = p[i - 1][1], x1 = p[i][0], y1 = p[i][1];
        const L = Math.hypot(x1 - x0, y1 - y0);
        if (L < 1e-9) continue;
        let ang = Math.atan2(y1 - y0, x1 - x0);
        if (ang < 0) ang += Math.PI;
        const o = ang / (Math.PI / 4);
        const steps = Math.max(1, Math.ceil(L / 0.05));
        for (let k = 0; k < steps; k++) { const t = (k + 0.5) / steps; addPt(F, x0 + t * (x1 - x0), y0 + t * (y1 - y0), o, L / steps); }
      }
    }
    const B = new Float32Array(FD);
    for (let o = 0; o < 4; o++) for (let gy = 0; gy < GRID; gy++) for (let gx = 0; gx < GRID; gx++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = gy + dy; if (yy < 0 || yy >= GRID) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = gx + dx; if (xx < 0 || xx >= GRID) continue;
          s += F[o * G2 + yy * GRID + xx] * (dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1);
        }
      }
      B[o * G2 + gy * GRID + gx] = s;
    }
    let n2 = 0; for (let i = 0; i < FD; i++) { B[i] = Math.sqrt(B[i]); n2 += B[i] * B[i]; }
    n2 = Math.sqrt(n2) || 1;
    for (let i = 0; i < FD; i++) B[i] /= n2;
    return B;
  }
  function addPt(F, x, y, o, wgt) {
    const G2 = GRID * GRID;
    const fx = (x + 0.5) * GRID - 0.5, fy = (y + 0.5) * GRID - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy;
    let o1, o2, w1, w2;
    if (o < 0) { for (let k = 0; k < 4; k++) addPt(F, x, y, k, wgt / 4); return; }
    o1 = Math.floor(o) % 4; o2 = (o1 + 1) % 4; w2 = o - Math.floor(o); w1 = 1 - w2;
    for (let dy = 0; dy <= 1; dy++) {
      const yy = iy + dy; if (yy < 0 || yy >= GRID) continue;
      const wy = dy ? ay : 1 - ay;
      for (let dx = 0; dx <= 1; dx++) {
        const xx = ix + dx; if (xx < 0 || xx >= GRID) continue;
        const w = wgt * wy * (dx ? ax : 1 - ax);
        F[o1 * G2 + yy * GRID + xx] += w * w1; F[o2 * G2 + yy * GRID + xx] += w * w2;
      }
    }
  }
  function coarseRank(feat, k, pool) {
    const n = pool ? pool.length : CHARS.length, bestC = [], bestD = [];
    for (let ii = 0; ii < n; ii++) {
      const i = pool ? pool[ii] : ii;
      let d = 0; const off = i * FD;
      for (let j = 0; j < FD; j++) d += feat[j] * COARSE[off + j];
      const dist = 1 - d;
      if (bestD.length < k || dist < bestD[bestD.length - 1]) {
        let pos = bestD.length;
        while (pos > 0 && bestD[pos - 1] > dist) pos--;
        bestD.splice(pos, 0, dist); bestC.splice(pos, 0, CHARS[i]);
        if (bestD.length > k) { bestD.pop(); bestC.pop(); }
      }
    }
    return bestC.map((c, i) => [c, bestD[i]]);
  }

  // ---------------------------------------------------------------- input strokes
  function prepInput(strokes, stray) {
    let S = [];
    for (const raw of strokes || []) {
      if (!raw || !raw.length) continue;
      const poly = clean(raw);
      if (!poly.length) continue;
      const p = resample(poly, NP);
      S.push({ poly, bb: bboxOf(poly), len: polyLen(poly), p, q: shapeQ(p), lp: loopOf(poly), id: S.length });
    }
    if (stray) { S = S.filter((s) => !isStray(s, S)); S.forEach((s, i) => { s.id = i; }); }
    // two strokes in a row may be one template stroke drawn in two pieces
    for (let i = 0; i + 1 < S.length; i++) { S[i].next = resample(S[i].poly.concat(S[i + 1].poly), NP); S[i].nq = shapeQ(S[i].next); }
    return S;
  }
  // A tiny mark well away from all the other writing (a tap of the pen or a resting finger) is not part of the answer.
  // Dakuten, the dots of kanji and punctuation sit next to other strokes and are kept.
  function isStray(s, S) {
    if (S.length < 2) return false;
    const others = S.filter((o) => o !== s), f = frameOf(others.map((o) => o.bb)), [x0, y0, x1, y1] = s.bb;
    if (Math.max(x1 - x0, y1 - y0) > STRAY_SIZE * f.h) return false;
    let gap = Infinity;
    for (const o of others) {
      const dx = Math.max(0, o.bb[0] - x1, x0 - o.bb[2]), dy = Math.max(0, o.bb[1] - y1, y0 - o.bb[3]);
      gap = Math.min(gap, Math.hypot(dx, dy));
    }
    return gap > STRAY_GAP * f.h;
  }
  function normUnit(src, f, inv, len, q, lp) {
    const p = new Float64Array(2 * NP);
    let cx = 0, cy = 0;
    for (let k = 0; k < NP; k++) {
      const x = (src[2 * k] - f.cx) * inv, y = (src[2 * k + 1] - f.cy) * inv;
      p[2 * k] = x; p[2 * k + 1] = y; cx += x; cy += y;
    }
    const u = { p, q, cx: cx / NP, cy: cy / NP, len };
    if (lp) { u.lp = new Float64Array(2 * NP); for (let k = 0; k < 2 * NP; k += 2) { u.lp[k] = (lp[k] - f.cx) * inv; u.lp[k + 1] = (lp[k + 1] - f.cy) * inv; } }
    return u;
  }
  // Normalised view of a group of input strokes (ids ascending in drawing order).
  function groupView(S, ids) {
    const f = frameOf(ids.map((i) => S[i].bb));
    const inv = 1 / f.s;
    const st = ids.map((i) => normUnit(S[i].p, f, inv, S[i].len * inv, S[i].q, S[i].lp));
    const ch = [];
    for (let a = 0; a + 1 < ids.length; a++) {
      if (ids[a + 1] !== ids[a] + 1) continue;
      const u = normUnit(S[ids[a]].next, f, inv, st[a].len + st[a + 1].len, S[ids[a]].nq);
      u.a = a;
      ch.push(u);
    }
    const G = { f, st, ch, ids };
    if (CYC) G.S = S; // English: ink compared too (inkCost)
    return G;
  }
  function groupPolys(S, G) {
    const inv = 1 / G.f.s;
    return G.ids.map((i) => S[i].poly.map(([x, y]) => [(x - G.f.cx) * inv, (y - G.f.cy) * inv]));
  }

  // ---------------------------------------------------------------- fine matcher
  // Mean point distance between two resampled strokes, forward or reversed (reversal costs a little).
  let lastRev = false;
  // local point cost: plain distance, or (SQ) a Huber-robust squared distance
  let SQ = true;            // robust squared distances (false: plain mean distances)
  const HUB = 0.12;
  function lc(dx, dy) {
    const d2 = dx * dx + dy * dy;
    if (!SQ) return Math.sqrt(d2);
    return d2 < HUB * HUB ? d2 : HUB * (2 * Math.sqrt(d2) - HUB);
  }
  function sdist(A, B, tlen) {
    let f = 0, r = 0;
    for (let k = 0, j = 2 * NP - 2; k < 2 * NP; k += 2, j -= 2) {
      const ax = A[k], ay = A[k + 1];
      f += lc(ax - B[k], ay - B[k + 1]);
      r += lc(ax - B[j], ay - B[j + 1]);
    }
    f /= NP; r /= NP;
    if (SQ) { f = Math.sqrt(f); r = Math.sqrt(r); }
    r += REV * Math.min(1, tlen / 0.35);
    lastRev = r < f;
    return lastRev ? r : f;
  }
  // Same with a little dynamic time warping (band DTWR), so strokes with different proportions still line up.
  const DTWR = 2;
  const dtwBuf = new Float64Array(NP * NP);
  function dtw(A, B, rev) {
    const D = dtwBuf, INF = 1e9;
    for (let i = 0; i < NP; i++) {
      const ax = A[2 * i], ay = A[2 * i + 1];
      const j0 = Math.max(0, i - DTWR), j1 = Math.min(NP - 1, i + DTWR);
      for (let j = 0; j < NP; j++) {
        if (j < j0 || j > j1) { D[i * NP + j] = INF; continue; }
        const jj = rev ? NP - 1 - j : j;
        const v = lc(ax - B[2 * jj], ay - B[2 * jj + 1]);
        let best = 0;
        if (i > 0 || j > 0) {
          best = INF;
          if (i > 0 && j > 0 && D[(i - 1) * NP + j - 1] < best) best = D[(i - 1) * NP + j - 1];
          if (i > 0 && D[(i - 1) * NP + j] < best) best = D[(i - 1) * NP + j];
          if (j > 0 && D[i * NP + j - 1] < best) best = D[i * NP + j - 1];
        }
        D[i * NP + j] = best + v;
      }
    }
    return SQ ? Math.sqrt(D[NP * NP - 1] / NP) : D[NP * NP - 1] / NP;
  }
  let USE_DTW = false, JUDGE_DTW = true;
  function sdistW(A, B, tlen) {
    const f = dtw(A, B, false), r = dtw(A, B, true) + REV * Math.min(1, tlen / 0.35);
    lastRev = r < f;
    return lastRev ? r : f;
  }
  // Greedy stroke assignment between user units (strokes, or two consecutive strokes) and template units
  // (strokes, or 2-3 consecutive strokes written as one). Cost is normalised by the template's weight.
  function assign(ust, uch, t, fine) {
    const U = ust.length, Tn = t.s.length;
    const cand = [], single = new Array(U * Tn).fill(null);
    const push = (u, tu, ua, ub, ta, tb, w, extra) => {
      const dx = u.cx - tu.cx, dy = u.cy - tu.cy;
      if (dx * dx + dy * dy >= DMAX2) return; // mean distance >= centroid distance
      let d = (fine ? sdistW(u.p, tu.p, tu.len) : sdist(u.p, tu.p, tu.len)) + extra, A = u.p, B = tu.p, rev = lastRev;
      if (CYC && u.lp && tu.lp) { const l = loopDist(u.lp, tu.lp) + extra; if (l < d) { d = l; A = u.lp; B = rolled(tu.lp, loopShift); rev = false; } }
      // English: a closed loop drawn for an open stroke, or the reverse (o / c, a / u)
      if (CYC && ub < 0 && ta === tb && !u.lp !== !tu.lp) d += LOOPPEN;
      if (d >= DMAX) return;
      const c = { d, ua, ub, ta, tb, c: (SQ ? d * d : d) * w, rev, A, B };
      cand.push(c);
      if (ub < 0 && ta === tb && tu === t.s[ta]) single[ua * Tn + ta] = c;
    };
    for (let i = 0; i < U; i++) {
      const u = ust[i];
      for (let j = 0; j < Tn; j++) push(u, t.s[j], i, -1, j, j, t.s[j].w, 0);
      for (const c of t.chains) push(u, c, i, -1, c.a, c.b, c.w, JOIN * (c.b - c.a));
    }
    for (const c of uch) for (let j = 0; j < Tn; j++) push(c, t.s[j], c.a, c.a + 1, j, j, t.s[j].w, SPLIT);
    cand.sort((a, b) => a.d - b.d);
    // greedy: best pairs first
    const selU = new Array(U).fill(null), selT = new Array(Tn).fill(null);
    const take = (c) => { selU[c.ua] = c; if (c.ub >= 0) selU[c.ub] = c; for (let j = c.ta; j <= c.tb; j++) selT[j] = c; };
    const drop = (c) => { selU[c.ua] = null; if (c.ub >= 0) selU[c.ub] = null; for (let j = c.ta; j <= c.tb; j++) selT[j] = null; };
    for (const c of cand) {
      if (selU[c.ua] || (c.ub >= 0 && selU[c.ub])) continue;
      let clash = false; for (let j = c.ta; j <= c.tb; j++) if (selT[j]) { clash = true; break; }
      if (!clash) take(c);
    }
    // local improvement of the one-to-one part (greedy can lock a stroke out of its right partner)
    const mi = SQ ? MISS * MISS : MISS, ex = SQ ? EXTRA * EXTRA : EXTRA;
    const pu = (i) => ex * (WBASE + ust[i].len), pt = (j) => mi * t.s[j].w;
    const isS = (c) => c && c.ub < 0 && c.ta === c.tb;
    for (let it = 0; it < 4; it++) {
      let improved = false;
      for (let a = 0; a < U; a++) {
        const p = selU[a];
        if (p && !isS(p)) continue;
        for (let b = a + 1; b < U; b++) {
          const q = selU[b];
          if (q && !isS(q)) continue;
          if (!p && !q) continue;
          const x = p ? p.ta : -1, y = q ? q.ta : -1;
          // swap partners (a->y, b->x), either side may end up unmatched
          const ay = y >= 0 ? single[a * Tn + y] : null, bx = x >= 0 ? single[b * Tn + x] : null;
          if ((y >= 0 && !ay) || (x >= 0 && !bx)) continue;
          const before = (p ? p.c : pu(a)) + (q ? q.c : pu(b));
          const after = (ay ? ay.c : pu(a)) + (bx ? bx.c : pu(b));
          if (after < before - 1e-12) {
            if (p) drop(p); if (q) drop(q);
            if (ay) take(ay); if (bx) take(bx);
            improved = true;
          }
        }
        // a (matched or not) takes a free template stroke; its old partner goes free
        for (let j = 0; j < Tn; j++) {
          if (selT[j]) continue;
          const nj = single[a * Tn + j];
          if (!nj) continue;
          const cur = selU[a];
          if (cur && !isS(cur)) continue;
          const before = (cur ? cur.c + pt(j) : pu(a) + pt(j));
          const after = nj.c + (cur ? pt(cur.ta) : 0);
          if (after < before - 1e-12) { if (cur) drop(cur); take(nj); improved = true; }
        }
      }
      // a free user stroke takes over a matched template stroke whose user stroke then moves to a free template stroke
      for (let u = 0; u < U; u++) {
        if (selU[u]) continue;
        for (let x = 0; x < Tn; x++) {
          const p = selT[x];
          if (!isS(p) || !single[u * Tn + x]) continue;
          const a = p.ua;
          let bestJ = -1, bestC = pu(a);
          for (let j = 0; j < Tn; j++) if (!selT[j] && single[a * Tn + j] && single[a * Tn + j].c - pt(j) < bestC) { bestC = single[a * Tn + j].c - pt(j); bestJ = j; }
          const delta = single[u * Tn + x].c + bestC - p.c - pu(u);
          if (delta < -1e-12) { drop(p); take(single[u * Tn + x]); if (bestJ >= 0) take(single[a * Tn + bestJ]); improved = true; break; }
        }
      }
      if (!improved) break;
    }
    const sel = [...new Set(selU.filter(Boolean))];
    let cost = 0, missT = 0, extraU = 0;
    for (const c of sel) cost += c.c;
    for (let j = 0; j < Tn; j++) if (!selT[j]) { cost += pt(j); missT++; }
    let lenAll = 0, lenUn = 0;
    for (let i = 0; i < U; i++) { lenAll += ust[i].len; if (!selU[i]) { cost += pu(i); extraU++; lenUn += ust[i].len; } }
    return { cost: SQ ? Math.sqrt(cost / t.wsum) : cost / t.wsum, sel, missT, extraU, unInk: lenAll > 0 ? lenUn / lenAll : 0 };
  }
  // Least-squares affine map from user points to template points over the matched pairs, damped towards identity.
  function fitAffine(sel) {
    let n = 0, sx = 0, sy = 0, tx = 0, ty = 0;
    for (const c of sel) for (let k = 0; k < NP; k++) {
      const j = c.rev ? NP - 1 - k : k;
      sx += c.A[2 * k]; sy += c.A[2 * k + 1]; tx += c.B[2 * j]; ty += c.B[2 * j + 1]; n++;
    }
    if (n < 2 * NP) return null;
    sx /= n; sy /= n; tx /= n; ty /= n;
    let xx = 0, xy = 0, yy = 0, ux = 0, uy = 0, vx = 0, vy = 0;
    for (const c of sel) for (let k = 0; k < NP; k++) {
      const j = c.rev ? NP - 1 - k : k;
      const x = c.A[2 * k] - sx, y = c.A[2 * k + 1] - sy, u = c.B[2 * j] - tx, v = c.B[2 * j + 1] - ty;
      xx += x * x; xy += x * y; yy += y * y; ux += u * x; uy += u * y; vx += v * x; vy += v * y;
    }
    const reg = 0.02 * n; // ridge towards the identity
    xx += reg; yy += reg; ux += reg; vy += reg;
    const det = xx * yy - xy * xy;
    if (Math.abs(det) < 1e-12) return null;
    const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const a = cl(1 + AFF * ((ux * yy - uy * xy) / det - 1), 0.7, 1.4), b = cl(AFF * ((uy * xx - ux * xy) / det), -0.35, 0.35);
    const c = cl(AFF * ((vx * yy - vy * xy) / det), -0.35, 0.35), d = cl(1 + AFF * ((vy * xx - vx * xy) / det - 1), 0.7, 1.4);
    return { a, b, c, d, sx, sy, tx: sx + AFF * (tx - sx), ty: sy + AFF * (ty - sy), pen: Math.abs(a - 1) + Math.abs(d - 1) + Math.abs(b) + Math.abs(c) };
  }
  function warpUnit(u, M) {
    const q = new Float64Array(2 * NP);
    let cx = 0, cy = 0;
    for (let k = 0; k < 2 * NP; k += 2) {
      const x = u.p[k] - M.sx, y = u.p[k + 1] - M.sy;
      q[k] = M.tx + M.a * x + M.b * y; q[k + 1] = M.ty + M.c * x + M.d * y;
      cx += q[k]; cy += q[k + 1];
    }
    const out = { p: q, q: u.q, cx: cx / NP, cy: cy / NP, len: u.len, a: u.a };
    if (u.lp) {
      out.lp = new Float64Array(2 * NP);
      for (let k = 0; k < 2 * NP; k += 2) { const x = u.lp[k] - M.sx, y = u.lp[k + 1] - M.sy; out.lp[k] = M.tx + M.a * x + M.b * y; out.lp[k + 1] = M.ty + M.c * x + M.d * y; }
    }
    return out;
  }
  // Cost of explaining group G with template t (lower is better; ~0.03-0.12 for a good match).
  // ---------------------------------------------------------------- English: ink matching
  // English letters are written in many stroke orders and with or without lifting the pen, so a group may also be
  // compared by its ink alone: points every INKSTEP along the strokes with their direction, each side's mean
  // distance to the nearest point of the other (capped), averaged both ways.
  const INKSTEP = 0.04, INKLAM = 0.08, INKCAP = 0.2;
  let INKW = 2;             // ink distance weight against the stroke cost
  let INKGATE = 0.1;        // a stroke match better than this needs no ink comparison
  function inkOf(polys) {
    const out = [];
    for (const p of polys) {
      if (p.length === 1 || polyLen(p) < INKSTEP) { out.push(p[0][0], p[0][1], -1); continue; }
      for (let i = 1; i < p.length; i++) {
        const x0 = p[i - 1][0], y0 = p[i - 1][1], x1 = p[i][0], y1 = p[i][1], L = Math.hypot(x1 - x0, y1 - y0);
        if (L < 1e-9) continue;
        let a = Math.atan2(y1 - y0, x1 - x0); if (a < 0) a += Math.PI;
        const n = Math.max(1, Math.round(L / INKSTEP));
        for (let k = 0; k < n; k++) out.push(x0 + (x1 - x0) * (k + 0.5) / n, y0 + (y1 - y0) * (k + 0.5) / n, a);
      }
    }
    return Float64Array.from(out);
  }
  function inkHalf(A, B) {
    let s = 0;
    const cap2 = INKCAP * INKCAP;
    for (let i = 0; i < A.length; i += 3) {
      const x = A[i], y = A[i + 1], a = A[i + 2];
      let best = cap2;
      for (let j = 0; j < B.length; j += 3) {
        const dx = x - B[j], dy = y - B[j + 1];
        let d2 = dx * dx + dy * dy;
        if (d2 >= best) continue;
        const b = B[j + 2];
        if (a >= 0 && b >= 0) { let da = Math.abs(a - b); if (da > Math.PI / 2) da = Math.PI - da; const sa = Math.sin(da) * INKLAM; d2 += sa * sa; }
        if (d2 < best) best = d2;
      }
      s += Math.sqrt(best);
    }
    return s / Math.max(1, A.length / 3);
  }
  function inkCost(G, t) {
    if (!t.ink) t.ink = inkOf(t.s.map((u) => u.poly));
    if (!G.ink) G.ink = inkOf(groupPolys(G.S, G));
    G.ic = G.ic || new Map();
    let c = G.ic.get(t.ch);
    if (c === undefined) { c = INKW * (inkHalf(G.ink, t.ink) + inkHalf(t.ink, G.ink)) / 2; G.ic.set(t.ch, c); }
    return c;
  }
  function match(G, t, detail, fine) {
    fine = fine === undefined ? USE_DTW : fine;
    let r = assign(G.st, G.ch, t, fine);
    if (r.cost < AFFGATE && r.sel.length) {
      const M = fitAffine(r.sel);
      if (M) {
        const r2 = assign(G.st.map((u) => warpUnit(u, M)), G.ch.map((u) => warpUnit(u, M)), t, fine);
        r2.cost += AFFPEN * M.pen;
        if (r2.cost < r.cost) r = r2;
      }
    }
    if (G.S && r.cost > INKGATE) { const ic = inkCost(G, t); if (ic < r.cost) { r.cost = ic; r.byInk = true; } }
    return detail ? r : r.cost;
  }

  // ---------------------------------------------------------------- per-position judgement
  // Characters that are a different answer but close: voiced/semi-voiced/plain, small/large, the other script.
  function variantsOf(ch) {
    const out = new Set();
    const base = ch.normalize("NFD")[0];
    for (const m of ["", "゙", "゚"]) { const v = (base + m).normalize("NFC"); if (v.length === 1 && RAW[v]) out.add(v); }
    if (SMALL2LARGE.has(ch)) out.add(SMALL2LARGE.get(ch));
    if (LARGE2SMALL.has(ch)) out.add(LARGE2SMALL.get(ch));
    const o = toOther(ch); if (o && RAW[o]) out.add(o);
    out.delete(ch);
    return out;
  }
  function neighbours(ch, pool) {
    const key = (pool === LPOOL ? "L" : "J") + ch;
    let n = NEIGH.get(key);
    if (!n) { n = coarseRank(COARSE.subarray(CHARS.indexOf(ch) * FD, CHARS.indexOf(ch) * FD + FD), KNEIGH, pool).map((x) => x[0]); NEIGH.set(key, n); }
    return n;
  }
  // How far template c is from template e (c "written perfectly", judged as e). Cached.
  const TD = new Map();
  function tdist(e, c) {
    const key = e + c;
    let d = TD.get(key);
    if (d === undefined) {
      const t = getT(c);
      d = match({ st: t.s, ch: [] }, getT(e), false, JUDGE_DTW);
      TD.set(key, d);
    }
    return d;
  }
  // The stroke ends in which close templates e and c differ (strokes paired by matching c to e): each end of e at
  // least XEND from its partner in c, with the step from e to c. Empty unless every stroke of e pairs with one of c
  // of the same shape (only the lengths and places differ, as in 未/末, not 材/村). Cached.
  const XD = new Map();
  function endDiff(e, c) {
    const key = e + c;
    let D = XD.get(key);
    if (D === undefined) {
      D = [];
      const te = getT(e), tc = getT(c), sel = match({ st: tc.s, ch: [] }, te, true, JUDGE_DTW).sel;
      for (const s of sel) {
        if (s.ub >= 0 || s.ta !== s.tb) { D = []; break; }
        const pe = te.s[s.ta].p, pc = tc.s[s.ua].p, qe = te.s[s.ta].q, qc = tc.s[s.ua].q;
        let dq = 0;
        for (let k = 0; k < NP; k++) { const kc = s.rev ? NP - 1 - k : k; dq += Math.hypot(qe[2 * k] - qc[2 * kc], qe[2 * k + 1] - qc[2 * kc + 1]); }
        if (dq / NP > XSHAPE) { D = []; break; }
        for (const k of [0, NP - 1]) {
          const kc = s.rev ? NP - 1 - k : k, dx = pc[2 * kc] - pe[2 * k], dy = pc[2 * kc + 1] - pe[2 * k + 1];
          if (dx * dx + dy * dy > XEND * XEND) D.push({ j: s.ta, k, x: pe[2 * k], y: pe[2 * k + 1], dx, dy });
        }
      }
      if (sel.length !== te.n) D = [];
      XD.set(key, D);
    }
    return D;
  }
  // Where the writing's stroke ends sit between e and c (0 = as in e, 1 = as in c), over the ends in which they
  // differ, taking the strokes paired with e's in det; null when there are none.
  function endShift(G, det, e, c) {
    let num = 0, den = 0;
    for (const f of endDiff(e, c)) {
      const s = det.sel.find((s) => s.ub < 0 && s.ta === f.j && s.tb === f.j);
      if (!s) continue;
      const p = G.st[s.ua].p, k = s.rev ? NP - 1 - f.k : f.k;
      num += (p[2 * k] - f.x) * f.dx + (p[2 * k + 1] - f.y) * f.dy;
      den += f.dx * f.dx + f.dy * f.dy;
    }
    return den > 0 ? num / den : null;
  }
  // Is the writing in G the expected char (any of expSet), rather than some other char?
  function judge(S, G, expSet, latin, line) {
    const pool = latin ? LPOOL : JPOOL;
    const pl = (ch) => (line ? placement(G, getT(ch), line) : 0);
    // 1. plain costs for the expected chars and every plausible competitor
    const plain = new Map();
    const pc = (ch) => {
      let c = plain.get(ch);
      if (c === undefined) { const t = getT(ch); c = assign(G.st, G.ch, t, false).cost; if (G.S && c > INKGATE) c = Math.min(c, inkCost(G, t)); c += pl(ch); plain.set(ch, c); }
      return c;
    };
    for (const e of expSet) pc(e);
    const comp = new Set();
    for (const [c] of coarseRank(coarseFeat(groupPolys(S, G)), KCOARSE, pool)) comp.add(c);
    const vars = new Set();
    for (const e of expSet) { for (const c of neighbours(e, pool)) comp.add(c); if (!latin) for (const c of variantsOf(e)) { comp.add(c); vars.add(c); } }
    for (const e of expSet) comp.delete(e);
    const others = [...comp].filter((c) => !expSet.some((e) => same(e, c) || shapeTwin(e, c)));
    others.sort((a, b) => pc(a) - pc(b));
    // 2. re-score the expected chars and the closest competitors with the finer (time-warped) distance
    const fine = new Map();
    const fc = (ch) => { let c = fine.get(ch); if (c === undefined) { c = JUDGE_DTW ? match(G, getT(ch), false, true) + pl(ch) : pc(ch); fine.set(ch, c); } return c; };
    let bestE = null, ce = Infinity;
    for (const e of expSet) { const c = fc(e); if (c < ce) { ce = c; bestE = e; } }
    // a lot of ink that belongs to no stroke of the expected char (an extra character merged in, scribbles)
    const det = match(G, getT(bestE), true, JUDGE_DTW);
    if (!det.byInk && (det.unInk > UNINK || det.extraU >= 2)) return { ok: false, ch: bestE, cost: ce, other: null, otherCost: Infinity, unInk: det.unInk };
    const kind = kindOf(bestE);
    let co = Infinity, other = null, bar = Infinity;
    // the expected char passes when it is (nearly) as close as every competitor; for competitors whose template is
    // itself close to the expected one, "nearly" shrinks with that distance (decide at a point between the two)
    others.slice(0, KFINE).forEach((c) => {
      const v = fc(c);
      // (English: digit against letter by the char asked for, so an o also written as 0 isn't judged as a digit)
      let m = latin ? (isDigit(letterOf(c)) === isDigit(letterOf(expSet[0])) ? LMARGIN : LMARGIN_X)
        : scriptTwin(bestE, c) ? MARGIN_S : vars.has(c) ? MARGIN_V : kindOf(c) === kind ? MARGIN : MARGIN_X;
      if (SQ) {
        m = Math.min((v + m) * (v + m) - v * v, (latin ? LKAPPA : KAPPA) * tdist(bestE, c) ** 2);
        if (v * v + m < bar) { bar = v * v + m; co = v; other = c; }
      } else {
        m = Math.min(m, KAPPA * tdist(bestE, c));
        if (v + m < bar) { bar = v + m; co = v; other = c; }
      }
    });
    const ok = ce <= (latin ? LCEIL : CEIL) && (SQ ? ce * ce : ce) <= bar;
    // a close look-alike of the same kind and stroke count that is at least as near as the expected char wins when
    // the stroke ends in which the two differ are also nearer to it (the top stroke of 末 longer than the second)
    if (ok && !latin) for (const c of others.slice(0, KFINE)) {
      const v = fc(c);
      if (v >= ce || vars.has(c) || scriptTwin(bestE, c) || kindOf(c) !== kind || getT(c).n !== getT(bestE).n || tdist(bestE, c) >= TCLOSE) continue;
      const x = endShift(G, det, bestE, c);
      if (x !== null && x > XSHIFT) return { ok: false, ch: bestE, cost: ce, other: c, otherCost: v };
    }
    return { ok, ch: bestE, cost: ce, other, otherCost: co };
  }

  // ---------------------------------------------------------------- segmentation
  function candidateInfo(text, latin) {
    const pos = [], unsupported = [];
    let prev = " ";
    for (const ch of text) {
      // English: a letter that starts a word may be a capital
      const initial = /[\s"(\-]/.test(prev);
      prev = ch;
      if (/\s/.test(ch)) continue;
      const optional = OPTIONAL.has(ch) || (latin && LPUNCT.has(ch));
      // ASCII punctuation has templates for English only; Japanese answers treat it as before (no template)
      const known = !!RAW[ch] && (latin || !LONLY.has(ch));
      if (optional && !known) continue;
      if (!known) unsupported.push(ch);
      pos.push({ ch, optional, initial });
    }
    return { pos, unsupported };
  }
  // Stroke orders to try: drawing order, left-to-right, and drawing order with late small marks moved back.
  function orders(S, em) {
    const ids = S.map((s) => s.id);
    const list = [ids];
    const add = (o) => { if (!list.some((l) => l.every((v, i) => v === o[i]))) list.push(o); };
    add(ids.slice().sort((a, b) => ((S[a].bb[0] + S[a].bb[2]) - (S[b].bb[0] + S[b].bb[2])) || a - b));
    const late = [];
    for (const i of ids) {
      const s = S[i], sz = Math.max(s.bb[2] - s.bb[0], s.bb[3] - s.bb[1]);
      const cx = (s.bb[0] + s.bb[2]) / 2;
      let pos = late.length;
      if (sz < 0.35 * em) while (pos > 0 && S[late[pos - 1]].bb[0] > cx + 0.1 * em) pos--;
      late.splice(pos, 0, i);
    }
    add(late);
    return list;
  }
  function lineEm(S, n) {
    const bb = frameOf(S.map((s) => s.bb));
    return Math.max(bb.h, 0.85 * bb.w / Math.max(1, n), 1);
  }
  // Dynamic programme: split the ordered strokes into consecutive groups, one per position
  // (a position may be skipped, trailing strokes may be left over as extra writing).
  function segment(S, order, P, em, cache) {
    const n = order.length, m = P.length, INF = 1e9;
    const dp = [], bk = [];
    for (let i = 0; i <= m; i++) { dp.push(new Float64Array(n + 1).fill(INF)); bk.push(new Int32Array(n + 1).fill(-1)); }
    dp[0][0] = 0;
    const SKIP = 0.6, OPTSKIP = 0.02, EXTRAST = 0.6, BEAM = 0.6;
    for (let i = 0; i < m; i++) {
      const p = P[i];
      let tn = Infinity, tx = 0;
      for (const c of p.opts) { const k = getT(c).n; tn = Math.min(tn, k); tx = Math.max(tx, k); }
      // kana are often written with joined strokes; kanji much less
      const kanji = kindOf(p.ch) === 0;
      const lo = Math.max(1, kanji ? Math.ceil(tn * 0.45) : Math.ceil(tn / 3)), hi = tx + (kanji && tx > 8 ? 2 : 3);
      let floor = INF;
      for (let k = 0; k <= n; k++) if (dp[i][k] < floor) floor = dp[i][k];
      for (let k = 0; k <= n; k++) {
        const base = dp[i][k];
        if (base >= INF || base > floor + BEAM) continue;
        const sk = base + (p.optional ? OPTSKIP : SKIP);
        if (sk < dp[i + 1][k]) { dp[i + 1][k] = sk; bk[i + 1][k] = -2 - k; }
        let x0 = Infinity, x1 = -Infinity;
        for (let l = 1; l <= hi && k + l <= n; l++) {
          const s = S[order[k + l - 1]];
          if (s.bb[0] < x0) x0 = s.bb[0];
          if (s.bb[2] > x1) x1 = s.bb[2];
          if (l < lo) continue;
          const wr = (x1 - x0) / em;
          if (wr > 2.2) break;
          const ids = order.slice(k, k + l).sort((a, b) => a - b);
          const key = ids.join(",") + "|" + p.key;
          let c = cache.get(key);
          if (c === undefined) {
            const G = groupView(S, ids);
            c = Infinity;
            for (const ch of p.opts) c = Math.min(c, match(G, getT(ch)));
            cache.set(key, c);
          }
          const v = base + c + (wr > 1.3 ? (wr - 1.3) * 0.3 : 0);
          if (v < dp[i + 1][k + l]) { dp[i + 1][k + l] = v; bk[i + 1][k + l] = k; }
        }
      }
    }
    let best = INF, bestK = -1;
    for (let k = 0; k <= n; k++) {
      if (dp[m][k] >= INF) continue;
      const v = dp[m][k] + (n - k) * EXTRAST;
      if (v < best) { best = v; bestK = k; }
    }
    if (bestK < 0) return null;
    const groups = new Array(m);
    let k = bestK;
    for (let i = m; i > 0; i--) {
      const b = bk[i][k];
      if (b <= -2) { groups[i - 1] = null; k = -2 - b; }
      else { groups[i - 1] = order.slice(b, k).sort((a, c) => a - c); k = b; }
    }
    return { cost: best, groups, extra: order.slice(bestK) };
  }

  // ---------------------------------------------------------------- small / full-size kana
  function expectedBox(ch) {
    // [size, centre y] of ch in em units as people write it
    const L = SMALL2LARGE.get(ch);
    if (L) { const t = getT(L); return [t.size * SMALLF, SBOT - (SBOT - t.cy) * SMALLF]; }
    const t = getT(ch);
    return [t.size, t.cy];
  }
  // Log of how large group G is against a template box w x h (longer side s): the mean of the width and height
  // ratios, two measurements of one size (a dimension that is thin in the template is left out).
  function logSize(G, w, h, s) {
    let v = 0, n = 0;
    if (w >= 0.25 * s) { v += Math.log(Math.max(G.f.w, 0.02 * G.f.s) / w); n++; }
    if (h >= 0.25 * s) { v += Math.log(Math.max(G.f.h, 0.02 * G.f.s) / h); n++; }
    return n ? v / n : Math.log(G.f.s / s);
  }
  // Evidence (about 0 = full size, 1 = small) that position i was written as a small kana,
  // from its size and height relative to the other characters of the line.
  function sizeEvidence(views, P, i, ch) {
    const anchors = [];
    P.forEach((p, k) => {
      const G = views[k];
      if (!G || p.optional || k === i || p.ch === "ー" || kindOf(p.ch) === 3) return;
      const [sz, cy] = expectedBox(p.opts[0]);
      if (sz < 0.25) return;
      anchors.push({ k, em: G.f.s / sz, cy, G, kind: kindOf(p.ch) });
    });
    if (!anchors.length) return null;
    const kind = kindOf(ch);
    const sameKind = anchors.filter((a) => a.kind === kind);
    const use = sameKind.length >= 2 ? sameKind : anchors;
    // line em: mean of the implied ems (log), a quarter cut off at each end
    const lems = use.map((a) => Math.log(a.em)).sort((a, b) => a - b), cut = lems.length >> 2;
    let lem = 0;
    for (let k = cut; k < lems.length - cut; k++) lem += lems[k];
    lem /= lems.length - 2 * cut;
    const em = Math.exp(lem);
    const tl = getT(SMALL2LARGE.get(ch) || ch);
    const G = views[i];
    const q = Math.exp(logSize(G, tl.w, tl.h, tl.size) - lem);
    const eq = Math.log(Math.max(q, 0.05)) / Math.log(SMALLF);
    const near = use.slice().sort((a, b) => Math.abs(a.k - i) - Math.abs(b.k - i)).slice(0, 3);
    let cl = 0, ws = 0;
    for (const a of near) { const w = 1 / Math.abs(a.k - i); cl += w * (a.G.f.cy - (a.cy - 0.5) * em); ws += w; }
    cl /= ws;
    const dy = (G.f.cy - cl) / em - (tl.cy - 0.5);
    const ey = dy / ((SBOT - tl.cy) * (1 - SMALLF));
    return { e: 0.7 * eq + 0.3 * Math.max(-1, Math.min(2, ey)), n: use.length, q, dy };
  }

  // ---------------------------------------------------------------- English: where letters sit on the line
  // Fit the lines the writing sits on: baseline b + k * x, x-height hx, capital height ha and descender depth hd,
  // taking each group as the letter it matches best (its top at x-height or capital height or between, by the
  // template's zt; its bottom on the baseline or a descender, by zb). Robust least squares; weak priors keep ha and
  // hd in proportion to hx when the word has no tall or descending letters.
  function fitLine(views, P, mcache) {
    const rows = [];
    P.forEach((p, i) => {
      const G = views[i];
      if (!G || p.optional) return;
      let best = null, bc = Infinity;
      for (const c of p.opts) {
        const key = G.ids.join(",") + "|" + c;
        let v = mcache.get(key);
        if (v === undefined) { v = match(G, getT(c)); mcache.set(key, v); }
        if (v < bc) { bc = v; best = getT(c); }
      }
      if (!best || best.zt === undefined) return;
      const x = (G.f.x0 + G.f.x1) / 2;
      rows.push({ x, r: [1, 0, -(1 - best.zt), -best.zt, 0], y: G.f.y0 }, { x, r: [1, 0, 0, 0, best.zb], y: G.f.y1 });
    });
    if (rows.length < 4) return null;
    let x0 = 0; for (const e of rows) x0 += e.x; x0 /= rows.length;
    for (const e of rows) e.r[1] = e.x - x0;
    const prior = [{ r: [0, 0, -1.45, 1, 0], y: 0 }, { r: [0, 0, -0.5, 0, 1], y: 0 }, { r: [0, 1, 0, 0, 0], y: 0 }];
    let L = null;
    const w = rows.map(() => 1);
    for (let it = 0; it < 5; it++) {
      const A = Array.from({ length: 5 }, () => new Float64Array(5)), B = new Float64Array(5);
      const add = (r, y, wt) => { for (let a = 0; a < 5; a++) { B[a] += wt * r[a] * y; for (let b = 0; b < 5; b++) A[a][b] += wt * r[a] * r[b]; } };
      rows.forEach((e, i) => add(e.r, e.y, w[i]));
      add(prior[0].r, 0, 0.3); add(prior[1].r, 0, 0.3); add(prior[2].r, 0, 40 * rows.length);
      const u = solve(A, B);
      if (!u || !(u[2] > 1)) return L;
      L = { b: u[0], k: Math.max(-0.25, Math.min(0.25, u[1])), hx: u[2], ha: Math.max(u[3], 1.1 * u[2]), hd: Math.max(u[4], 0.2 * u[2]), x0 };
      rows.forEach((e, i) => { const res = Math.abs(e.y - (e.r[0] * L.b + e.r[1] * L.k + e.r[2] * L.hx + e.r[3] * L.ha + e.r[4] * L.hd)) / L.hx; w[i] = res < 0.2 ? 1 : 0.2 / res; });
    }
    return L;
  }
  function solve(A, B) {
    const n = B.length, m = A.map((r, i) => [...r, B[i]]);
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
      if (Math.abs(m[p][c]) < 1e-12) return null;
      [m[c], m[p]] = [m[p], m[c]];
      for (let r = 0; r < n; r++) if (r !== c) { const f = m[r][c] / m[c][c]; for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k]; }
    }
    return m.map((r, i) => r[n] / r[i]);
  }
  // How far a group's top and bottom are from where template t belongs on those lines (in x-heights, past a slack),
  // and how much wider the group is than t could be (another letter merged in).
  function placement(G, t, L) {
    if (t.zt === undefined) return 0;
    const base = L.b + L.k * ((G.f.x0 + G.f.x1) / 2 - L.x0);
    const top = base - (1 - t.zt) * L.hx - t.zt * L.ha, bot = base + t.zb * L.hd;
    const dt = Math.abs(G.f.y0 - top) / L.hx, db = Math.abs(G.f.y1 - bot) / L.hx;
    const dw = G.f.w / L.hx - t.zw - WSLACK;
    return LPLACE * (Math.max(0, dt - PSLACK) + Math.max(0, db - PSLACK)) + LWIDE * Math.max(0, dw);
  }

  function evaluate(S, P, seg, jcache, dbg, latin, mcache) {
    const chars = [], sizes = [];
    let text = "", allOk = true;
    const views = seg.groups.map((g) => (g ? groupView(S, g) : null));
    // line em from the characters' sizes, to spot a group that is far too wide (an extra character merged in)
    const ems = [];
    P.forEach((p, k) => { if (views[k] && !p.optional && p.ch !== "ー") { const [sz] = expectedBox(p.opts[0]); if (sz >= 0.25) ems.push(views[k].f.s / sz); } });
    ems.sort((a, b) => a - b);
    const lineEmRef = ems.length >= 3 ? ems[ems.length >> 1] : 0;
    const line = latin ? fitLine(views, P, mcache) : null;
    const lkey = line ? `|${line.b.toFixed(1)},${line.k.toFixed(3)},${line.hx.toFixed(1)},${line.ha.toFixed(1)},${line.hd.toFixed(1)}` : "";
    P.forEach((p, i) => {
      const G = views[i];
      if (!G) {
        if (p.optional) return;
        chars.push({ ch: p.ch, ok: false, why: "missing" }); allOk = false; text += p.ch; return;
      }
      const key = G.ids.join(",") + "|" + p.key + lkey;
      let j = jcache.get(key);
      if (!j) { j = judge(S, G, p.opts, latin, line); jcache.set(key, j); }
      let why = j.ok ? null : "shape";
      const ch = letterOf(j.ch || p.ch);
      if (!why && lineEmRef && !latin) {
        const t = getT(ch), f = SMALL2LARGE.has(ch) ? SMALLF : 1;
        if (G.f.w / lineEmRef > t.w * f * 1.5 + 0.4) why = i === P.length - 1 ? "extra" : "shape";
      }
      if (j.ok && (SMALL2LARGE.has(ch) || REALSMALL.has(LARGE2SMALL.get(ch)))) {
        const ev = sizeEvidence(views, P, i, ch);
        if (ev) {
          // (a full-size kana written for a small one stands out even next to one or two characters; a small one
          // written for a full-size one is judged more loosely when there are fewer than three)
          if (SMALL2LARGE.has(ch) && ev.e < 0.45) why = "small";
          if (LARGE2SMALL.has(ch) && ev.e > 0.75 + (ev.n >= 3 ? 0 : 0.1)) why = "large";
          if (dbg) sizes.push([ch, +ev.e.toFixed(2), +ev.q.toFixed(2), +ev.dy.toFixed(2), ev.n]);
        }
      }
      if (why) allOk = false;
      text += ch;
      // a failing position names the character that was asked for (what the student should have written)
      // (got: what it looked more like, when known)
      const got = why === "shape" ? j.other && letterOf(j.other) : why === "small" ? SMALL2LARGE.get(ch) : why === "large" ? LARGE2SMALL.get(ch) : null;
      const c = why ? { ch: p.ch, ok: false, why } : { ch, ok: true, why: null };
      if (got) c.got = got;
      if (dbg) Object.assign(c, { cost: +j.cost.toFixed(3), other: j.other, otherCost: +j.otherCost.toFixed(3) }, line && j.ch ? { pl: +placement(G, getT(j.ch), line).toFixed(3), wr: +(G.f.w / line.hx).toFixed(2), tw: getT(j.ch).zw } : {});
      chars.push(c);
    });
    if (seg.extra.length) { chars.push({ ch: "", ok: false, why: "extra" }); allOk = false; }
    const out = { ok: allOk, text, chars, score: seg.cost };
    if (dbg) Object.assign(out, { groups: seg.groups, extra: seg.extra, size: sizes, line });
    return out;
  }

  // ---------------------------------------------------------------- public API
  function now() { return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now(); }
  function init(json) {
    const t0 = now();
    if (!json || !json.chars || !json.alphabet) throw new Error("QCardChecker.init: not a templates.json object");
    RAW = Object.assign({}, json.chars); unit = json.unit || 109; qn = json.q || 92; alpha = json.alphabet;
    SAMEMAP.clear(); for (const g of SAME) link(g);
    for (const [ch, list] of Object.entries(json.alt || {})) list.forEach((s, i) => { const k = ch + "#" + (i + 1); RAW[k] = s; link([ch, k]); });
    AIDX = new Int16Array(128).fill(0);
    for (let i = 0; i < alpha.length; i++) AIDX[alpha.charCodeAt(i)] = i;
    CHARS = Object.keys(RAW);
    DEC = new Map(); NEIGH.clear();
    COARSE = new Float32Array(CHARS.length * FD);
    CHARS.forEach((ch, i) => COARSE.set(coarseFeat(decodePolys(ch).polys), i * FD));
    // English writing is judged against Latin letters and digits only; Japanese against the rest
    // (KanjiVG's own letters and digits included, as before the extra Latin templates existed)
    LPOOL = Int32Array.from(CHARS.map((k, i) => (/^[0-9A-Za-z]$/.test(letterOf(k)) && getT(k).size > 0.05 ? i : -1)).filter((i) => i >= 0));
    JPOOL = Int32Array.from(CHARS.map((k, i) => (letterOf(k) === k && !LONLY.has(k) && !ASKED.has(k) ? i : -1)).filter((i) => i >= 0));
    return { chars: CHARS.length, ms: now() - t0 };
  }
  function has(ch) { return !!(RAW && RAW[ch]); }

  function verify(opts) {
    const t0 = now();
    if (!RAW) throw new Error("QCardChecker.verify: call init() first");
    opts = opts || {};
    const S = prepInput(opts.strokes, !opts.latin);
    const cands = [...new Set((opts.candidates || []).map((c) => String(c).normalize("NFKC")).filter((c) => c.trim().length))];
    const anyKana = !!opts.anyKana, latin = !!opts.latin;
    CYC = latin;
    const infos = cands.map((c) => ({ text: c, ...candidateInfo(c, latin) }));
    // (English: a whole sentence is left to the student; reading 30+ letters is slow and less sure)
    const usable = infos.filter((x) => !x.unsupported.length && x.pos.some((p) => !p.optional) && (!latin || x.pos.filter((p) => !p.optional).length <= LMAXLEN));
    const unsupported = [...new Set(infos.flatMap((x) => x.unsupported))];
    const done = (r) => Object.assign(r, { unsupported, ms: +(now() - t0).toFixed(1) });
    if (!usable.length) return done({ ok: null, text: cands[0] || "", chars: [] });
    if (!S.length) {
      const c = usable[0];
      return done({ ok: false, text: c.text, chars: c.pos.filter((p) => !p.optional).map((p) => ({ ch: p.ch, ok: false, why: "missing" })) });
    }
    let best = null, all = null;
    const mcache = new Map(), jcache = new Map();
    for (const info of usable) {
      const P = info.pos.map((p) => {
        const o = new Set([p.ch]);
        if (anyKana) { const x = toOther(p.ch); if (x && RAW[x]) o.add(x); }
        // English: any way of writing the letter, and a capital where a word starts (a capital merged with the next
        // letter is too easy to mistake for one letter otherwise). Letters whose capital looks the same (o, s, v...)
        // are linked in SAMEMAP and so always take both.
        if (latin && /[A-Za-z]/.test(p.ch)) { o.add(p.ch.toLowerCase()); if (p.initial) o.add(p.ch.toUpperCase()); }
        // a 〜 written almost flat is still the slot's mark
        if (!latin && p.ch === "〜") o.add("ー");
        for (const c of [...o]) if (SAMEMAP.has(c)) for (const d of SAMEMAP.get(c)) if (RAW[d]) o.add(d);
        // (KanjiVG's own O is a closed loop that came out as a single point, so English leaves it out)
        const opts2 = latin ? [...o].filter((c) => getT(c).size > 0.05) : [...o];
        return { ch: p.ch, opts: opts2, optional: p.optional, key: opts2.join("") };
      });
      const em = lineEm(S, P.filter((p) => !p.optional).length);
      let seg = null;
      for (const ord of orders(S, em)) {
        const r = segment(S, ord, P, em, mcache);
        if (r && (!seg || r.cost < seg.cost)) seg = r;
      }
      if (!seg) continue;
      const res = evaluate(S, P, seg, jcache, opts.debug, latin, new Map());
      if (!res.ok) res.text = info.text; // closest candidate as given; text is the matched writing only when ok
      if (opts.debug) (all = all || []).push({ cand: info.text, ok: res.ok, text: res.text, chars: res.chars, groups: res.groups, size: res.size, line: res.line });
      if (!best || better(res, best)) best = res;
      if (best.ok) break;
    }
    if (!best) { const c = usable[0]; return done({ ok: false, text: c.text, chars: c.pos.map((p) => ({ ch: p.ch, ok: false, why: "shape" })) }); }
    if (all) best.all = all;
    delete best.score;
    if (!opts.debug) { delete best.groups; delete best.extra; delete best.size; delete best.line; }
    return done(best);
  }
  function better(a, b) {
    if (a.ok !== b.ok) return a.ok;
    const fa = a.chars.filter((c) => !c.ok).length / a.chars.length, fb = b.chars.filter((c) => !c.ok).length / b.chars.length;
    if (fa !== fb) return fa < fb;
    return a.score / a.chars.length < b.score / b.chars.length;
  }

  // The n best single-character matches for a set of strokes (debugging / demo).
  function top(strokes, box, n) {
    const S = prepInput(strokes);
    if (!S.length) return [];
    const G = groupView(S, S.map((s) => s.id));
    const pre = coarseRank(coarseFeat(groupPolys(S, G)), Math.max(40, (n || 10) * 3));
    return pre.map(([ch, cd]) => ({ ch, cost: +match(G, getT(ch)).toFixed(4), coarse: +cd.toFixed(4) }))
      .sort((a, b) => a.cost - b.cost).slice(0, n || 10);
  }

  // Every way of writing an English meaning that verify({latin: true}) should accept: alternatives split at commas,
  // semicolons and slashes; a part in parentheses may be left out (and kept when short: lip(s), (to) go); "to" before a
  // verb and a leading a / an / the may be left out; numbers up to 100 may be written as words; accents may be left
  // off; 〜 is left out.
  const NUMW = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
  const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const numWord = (n) => (n < 20 ? NUMW[n] : n < 100 ? TENS[Math.floor(n / 10)] + (n % 10 ? " " + NUMW[n % 10] : "") : n === 100 ? "one hundred" : null);
  function englishAnswers(en) {
    const s = String(en || "").normalize("NFKC").replace(/[’‘`´]/g, "'").replace(/[“”]/g, '"').replace(/[〜~]/g, " ");
    const alts = [];
    let depth = 0, cur = "";
    for (const c of s) {
      if (c === "(") depth++;
      if (c === ")") depth = Math.max(0, depth - 1);
      if (!depth && /[,;/]/.test(c)) { alts.push(cur); cur = ""; } else cur += c;
    }
    alts.push(cur);
    const out = new Set(), verb = /^\s*\(?to\)?\s/i.test(s);
    for (const a of alts) {
      let forms = [""];
      for (const p of a.trim().split(/(\([^)]*\))/)) {
        const inner = /^\(.*\)$/.test(p) ? p.slice(1, -1).trim() : null;
        if (inner === null) forms = forms.map((f) => f + p);
        else if (inner && inner.length <= 12 && !/[,;]|etc/.test(inner)) forms = forms.flatMap((f) => [f, f + inner]);
      }
      for (let f of forms) {
        f = f.replace(/\s+/g, " ").replace(/ ([.,!?:;])/g, "$1").trim();
        if (!f) continue;
        const vs = [f, f.replace(/^to\s+/i, ""), f.replace(/^(a|an|the)\s+/i, ""), verb && !/^to\s/i.test(f) ? "to " + f : ""];
        for (const v of vs.filter(Boolean)) {
          const plain = v.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // sauté -> saute
          for (const x of new Set([v, plain])) { out.add(x); out.add(x.replace(/\b\d{1,3}\b/g, (d) => numWord(+d) ?? d)); }
        }
      }
    }
    return [...out];
  }

  const api = {
    init, has, verify, top, englishAnswers,
    _: { set: (o) => { if ("SQ" in o) SQ = o.SQ; if ("KAPPA" in o) KAPPA = o.KAPPA; if ("CEIL" in o) CEIL = o.CEIL; if ("LPLACE" in o) LPLACE = o.LPLACE; if ("LMARGIN" in o) LMARGIN = o.LMARGIN; if ("LMARGIN_X" in o) LMARGIN_X = o.LMARGIN_X; if ("LKAPPA" in o) LKAPPA = o.LKAPPA; if ("LCEIL" in o) LCEIL = o.LCEIL; if ("LOOPPEN" in o) LOOPPEN = o.LOOPPEN; if ("INKW" in o) INKW = o.INKW; if ("LWIDE" in o) LWIDE = o.LWIDE; if ("WSLACK" in o) WSLACK = o.WSLACK; if ("PSLACK" in o) PSLACK = o.PSLACK; if ("INKGATE" in o) INKGATE = o.INKGATE; if ("XSHIFT" in o) XSHIFT = o.XSHIFT; TD.clear(); }, tdist, endDiff, setDTW: (v, j) => { USE_DTW = v; if (j !== undefined) JUDGE_DTW = j; }, sdist, assign, prepInput, groupView, match, getT, coarseFeat, coarseRank, judge, segment, orders, lineEm, variantsOf, SAMEMAP, SMALL2LARGE },
  };
  root.QCardChecker = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
