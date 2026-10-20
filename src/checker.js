/*
 * Q-Card offline handwriting checker.
 * Verifies handwritten Japanese against a list of acceptable answers, entirely in the browser.
 * Copyright (C) the Q-Card authors. AGPL-3.0-only (see LICENSE).
 * Template data (data/templates.json) is derived from KanjiVG (C) Ulrich Apel, CC BY-SA 3.0.
 *
 * API: QCardChecker.init(templatesJson), .has(ch), .verify({strokes, candidates, box, anyKana}), .top(strokes, box, n)
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
  const MARGIN_X = 0.05;    // ... than a char of another kind (a kanji when kana is expected, or the reverse)
  const CEIL = 0.2;         // a char costing more than this never passes
  const KCOARSE = 24;       // competitors taken from the coarse ranking
  const GRID = 8;           // coarse feature grid
  const AFF = 0.8;          // how far the per-template affine alignment may go (0 = off)
  const AFFPEN = 0.02;      // cost per unit of affine deformation

  // ---------------------------------------------------------------- state
  let RAW = null;           // ch -> encoded strokes
  let CHARS = [];           // all template chars
  let DEC = new Map();      // ch -> decoded template
  let COARSE = null;        // Float32Array(CHARS.length * FD)
  let unit = 109, qn = 92, alpha = "";
  const FD = 4 * GRID * GRID;
  const NEIGH = new Map();  // ch -> coarse neighbours of its template

  // ---------------------------------------------------------------- character tables
  const SMALL = "ぁあぃいぅうぇえぉおっつゃやゅゆょよゎわゕかゖけァアィイゥウェエォオッツャヤュユョヨヮワヵカヶケ";
  const SMALL2LARGE = new Map(), LARGE2SMALL = new Map();
  for (let i = 0; i < SMALL.length; i += 2) { SMALL2LARGE.set(SMALL[i], SMALL[i + 1]); LARGE2SMALL.set(SMALL[i + 1], SMALL[i]); }
  // Characters that look the same when handwritten (any member may be written for any other).
  const SAME = ["カ力", "チ千", "エ工", "ロ口", "タ夕", "ニ二", "ハ八", "ト卜", "ー一", "へヘ", "べベ", "ぺペ", "りリ", "オ才", "ヒ匕", "ム厶", "メ乂",
    "0Oo〇", "1lI|", "Cc", "Kk", "Oo", "Pp", "Ss", "Uu", "Vv", "Ww", "Xx×", "Zz", "・.", "、,", "。○"];
  const SAMEMAP = new Map();
  for (const g of SAME) for (const c of g) { const s = SAMEMAP.get(c) || new Set([c]); for (const d of g) s.add(d); SAMEMAP.set(c, s); }
  const OPTIONAL = new Set(["、", "。", "・", ",", ".", "!", "?", "！", "？", " ", "　"]);
  const isHira = (c) => c >= "ぁ" && c <= "ゖ";
  const isKata = (c) => c >= "ァ" && c <= "ヶ";
  const toOther = (c) => isHira(c) ? String.fromCharCode(c.charCodeAt(0) + 0x60) : isKata(c) ? String.fromCharCode(c.charCodeAt(0) - 0x60) : null;
  const isKanaLike = (c) => isHira(c) || isKata(c) || c === "ー";

  // ---------------------------------------------------------------- geometry helpers
  function polyLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }
  // Resample a polyline [[x,y],...] to n points equally spaced along its length -> Float64Array(2n)
  function resample(pts, n) {
    const out = new Float64Array(2 * n);
    if (pts.length === 1) { for (let k = 0; k < n; k++) { out[2 * k] = pts[0][0]; out[2 * k + 1] = pts[0][1]; } return out; }
    const L = polyLen(pts);
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
  // Light smoothing and de-duplication of raw pointer points.
  function clean(stroke) {
    const pts = [];
    for (const p of stroke) {
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

  // ---------------------------------------------------------------- templates
  function decodeRaw(ch) {
    const s = RAW[ch];
    const strokes = [];
    for (const part of s.split(" ")) {
      const pts = [];
      for (let i = 0; i + 1 < part.length; i += 2) pts.push([alpha.indexOf(part[i]) * unit / (qn - 1), alpha.indexOf(part[i + 1]) * unit / (qn - 1)]);
      // densify so arc-length resampling of joined strokes behaves
      strokes.push(pts);
    }
    return strokes;
  }
  // Normalise a set of polylines (absolute coords) into the unit frame of their joint bounding box.
  function frameOf(boxes) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of boxes) { if (b[0] < x0) x0 = b[0]; if (b[1] < y0) y0 = b[1]; if (b[2] > x1) x1 = b[2]; if (b[3] > y1) y1 = b[3]; }
    const w = x1 - x0, h = y1 - y0;
    const s = Math.max(w, h, 1e-6);
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, s, w, h, x0, y0, x1, y1 };
  }
  function getT(ch) {
    let t = DEC.get(ch);
    if (t) return t;
    const polys = decodeRaw(ch);
    const boxes = polys.map(bboxOf);
    const f = frameOf(boxes);
    const strokes = polys.map((p) => {
      const np = p.map(([x, y]) => [(x - f.cx) / f.s, (y - f.cy) / f.s]);
      const len = polyLen(np);
      return { poly: np, p: resample(np, NP), len, w: WBASE + len };
    });
    const chains = [];
    for (let a = 0; a < strokes.length; a++) for (let b = a + 1; b <= Math.min(a + 2, strokes.length - 1); b++) {
      let poly = [];
      for (let k = a; k <= b; k++) poly = poly.concat(strokes[k].poly);
      let w = 0; for (let k = a; k <= b; k++) w += strokes[k].w;
      chains.push({ a, b, p: resample(poly, NP), len: polyLen(poly), w });
      if (b === a + 1) {
        // the same two strokes joined in the opposite order (writer's own stroke order)
        const poly2 = strokes[b].poly.concat(strokes[a].poly);
        chains.push({ a, b, p: resample(poly2, NP), len: polyLen(poly2), w, swapped: true });
      }
    }
    let wsum = 0; for (const s of strokes) wsum += s.w;
    t = { ch, s: strokes, chains, wsum, size: f.s / unit, w: f.w / unit, h: f.h / unit, cy: f.cy / unit, cx: f.cx / unit, n: strokes.length };
    DEC.set(ch, t);
    return t;
  }

  // ---------------------------------------------------------------- coarse directional features
  // 4 orientations (0, 45, 90, 135 deg; direction-free) on a GRID x GRID map of the unit frame, blurred and L2-normalised.
  function coarseFeat(polys /* normalised polylines in [-.5,.5] */) {
    const F = new Float32Array(FD);
    for (const p of polys) {
      if (p.length === 1) {
        // a dot: spread over all orientations
        addPt(F, p[0][0], p[0][1], -1, 0.05);
        continue;
      }
      for (let i = 1; i < p.length; i++) {
        const x0 = p[i - 1][0], y0 = p[i - 1][1], x1 = p[i][0], y1 = p[i][1];
        const L = Math.hypot(x1 - x0, y1 - y0);
        if (L < 1e-9) continue;
        let ang = Math.atan2(y1 - y0, x1 - x0);
        if (ang < 0) ang += Math.PI;
        const o = ang / (Math.PI / 4); // 0..4
        const steps = Math.max(1, Math.ceil(L / 0.04));
        for (let k = 0; k < steps; k++) {
          const t = (k + 0.5) / steps;
          addPt(F, x0 + t * (x1 - x0), y0 + t * (y1 - y0), o, L / steps);
        }
      }
    }
    // blur 3x3 per orientation
    const B = new Float32Array(FD);
    for (let o = 0; o < 4; o++) for (let gy = 0; gy < GRID; gy++) for (let gx = 0; gx < GRID; gx++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = gy + dy, xx = gx + dx;
        if (yy < 0 || yy >= GRID || xx < 0 || xx >= GRID) continue;
        s += F[o * GRID * GRID + yy * GRID + xx] * (dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1);
      }
      B[o * GRID * GRID + gy * GRID + gx] = s;
    }
    let n2 = 0; for (let i = 0; i < FD; i++) { B[i] = Math.sqrt(B[i]); n2 += B[i] * B[i]; }
    n2 = Math.sqrt(n2) || 1;
    for (let i = 0; i < FD; i++) B[i] /= n2;
    return B;
  }
  function addPt(F, x, y, o, wgt) {
    const fx = (x + 0.5) * GRID - 0.5, fy = (y + 0.5) * GRID - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy;
    const os = [], ow = [];
    if (o < 0) { for (let k = 0; k < 4; k++) { os.push(k); ow.push(0.25); } }
    else { const io = Math.floor(o) % 4, ao = o - Math.floor(o); os.push(io, (io + 1) % 4); ow.push(1 - ao, ao); }
    for (let q = 0; q < os.length; q++) for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
      const xx = ix + dx, yy = iy + dy;
      if (xx < 0 || xx >= GRID || yy < 0 || yy >= GRID) continue;
      F[os[q] * GRID * GRID + yy * GRID + xx] += wgt * ow[q] * (dx ? ax : 1 - ax) * (dy ? ay : 1 - ay);
    }
  }
  function coarseRank(feat, k, exclude) {
    const n = CHARS.length, best = [];
    for (let i = 0; i < n; i++) {
      let d = 0; const off = i * FD;
      for (let j = 0; j < FD; j++) d += feat[j] * COARSE[off + j];
      const dist = 1 - d;
      if (best.length < k || dist < best[best.length - 1][1]) {
        best.push([CHARS[i], dist]);
        best.sort((a, b) => a[1] - b[1]);
        if (best.length > k) best.pop();
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- input strokes
  function prepInput(strokes) {
    const S = [];
    for (const raw of strokes || []) {
      if (!raw || !raw.length) continue;
      const poly = clean(raw);
      if (!poly.length) continue;
      const bb = bboxOf(poly);
      S.push({ poly, bb, len: polyLen(poly), p: resample(poly, NP), id: S.length });
    }
    // user chains: consecutive strokes in drawing order (a template stroke drawn in two pieces)
    for (let i = 0; i + 1 < S.length; i++) S[i].next = resample(S[i].poly.concat(S[i + 1].poly), NP);
    return S;
  }
  // Build the normalised view of a group of input strokes (ids ascending in drawing order).
  function groupView(S, ids) {
    const f = frameOf(ids.map((i) => S[i].bb));
    const inv = 1 / f.s;
    const st = ids.map((i) => {
      const a = S[i].p, p = new Float64Array(2 * NP);
      for (let k = 0; k < NP; k++) { p[2 * k] = (a[2 * k] - f.cx) * inv; p[2 * k + 1] = (a[2 * k + 1] - f.cy) * inv; }
      return { p, len: S[i].len * inv, id: i };
    });
    const ch = [];
    for (let a = 0; a + 1 < ids.length; a++) {
      if (ids[a + 1] !== ids[a] + 1) continue;
      const src = S[ids[a]].next, p = new Float64Array(2 * NP);
      for (let k = 0; k < NP; k++) { p[2 * k] = (src[2 * k] - f.cx) * inv; p[2 * k + 1] = (src[2 * k + 1] - f.cy) * inv; }
      ch.push({ a, p, len: st[a].len + st[a + 1].len });
    }
    return { f, st, ch, ids };
  }
  function groupPolys(S, G) {
    const inv = 1 / G.f.s;
    return G.ids.map((i) => S[i].poly.map(([x, y]) => [(x - G.f.cx) * inv, (y - G.f.cy) * inv]));
  }

  // ---------------------------------------------------------------- fine matcher
  function pdist(A, B, rev) {
    let s = 0;
    if (!rev) for (let k = 0; k < 2 * NP; k += 2) { const dx = A[k] - B[k], dy = A[k + 1] - B[k + 1]; s += Math.sqrt(dx * dx + dy * dy); }
    else for (let k = 0; k < NP; k++) { const j = NP - 1 - k; const dx = A[2 * k] - B[2 * j], dy = A[2 * k + 1] - B[2 * j + 1]; s += Math.sqrt(dx * dx + dy * dy); }
    return s / NP;
  }
  let lastRev = false;
  function sdist(A, B, tlen) {
    const f = pdist(A, B, false), r = pdist(A, B, true) + REV * Math.min(1, tlen / 0.35);
    lastRev = r < f;
    return f <= r ? f : r;
  }
  // Greedy stroke assignment between user units (strokes, or two consecutive strokes) and template units
  // (strokes, or 2-3 consecutive strokes written as one). Returns total cost and the chosen pairs.
  function assign(ust, uch, t) {
    const U = ust.length, Tn = t.s.length;
    const cand = [];
    for (let i = 0; i < U; i++) {
      const u = ust[i];
      for (let j = 0; j < Tn; j++) {
        const ts = t.s[j];
        const d = sdist(u.p, ts.p, ts.len);
        if (d < DMAX) cand.push([d, i, -1, j, j, d * ts.w, lastRev, u.p, ts.p]);
      }
      for (const c of t.chains) {
        const d = sdist(u.p, c.p, c.len) + JOIN * (c.b - c.a);
        if (d < DMAX) cand.push([d, i, -1, c.a, c.b, d * c.w, lastRev, u.p, c.p]);
      }
    }
    for (const c of uch) {
      for (let j = 0; j < Tn; j++) {
        const ts = t.s[j];
        const d = sdist(c.p, ts.p, ts.len) + SPLIT;
        if (d < DMAX) cand.push([d, c.a, c.a + 1, j, j, d * ts.w, lastRev, c.p, ts.p]);
      }
    }
    cand.sort((a, b) => a[0] - b[0]);
    const usedU = new Uint8Array(U), usedT = new Uint8Array(Tn);
    let cost = 0;
    const sel = [];
    for (const c of cand) {
      const ua = c[1], ub = c[2], ta = c[3], tb = c[4];
      if (usedU[ua] || (ub >= 0 && usedU[ub])) continue;
      let clash = false; for (let j = ta; j <= tb; j++) if (usedT[j]) { clash = true; break; }
      if (clash) continue;
      usedU[ua] = 1; if (ub >= 0) usedU[ub] = 1;
      for (let j = ta; j <= tb; j++) usedT[j] = 1;
      cost += c[5];
      sel.push(c);
    }
    let missT = 0, extraU = 0;
    for (let j = 0; j < Tn; j++) if (!usedT[j]) { cost += MISS * t.s[j].w; missT++; }
    for (let i = 0; i < U; i++) if (!usedU[i]) { cost += EXTRA * (WBASE + ust[i].len); extraU++; }
    return { cost: cost / t.wsum, sel, missT, extraU };
  }
  // Least-squares affine map from user points to template points over the matched pairs, damped towards identity.
  function fitAffine(sel) {
    let sw = 0, sx = 0, sy = 0, tx = 0, ty = 0;
    const P = [];
    for (const c of sel) {
      const A = c[7], B = c[8], rev = c[6], w = c[5] > 0 ? 1 : 1;
      for (let k = 0; k < NP; k++) {
        const j = rev ? NP - 1 - k : k;
        P.push(A[2 * k], A[2 * k + 1], B[2 * j], B[2 * j + 1]);
      }
      sw += NP * w;
    }
    const n = P.length / 4;
    if (n < 2 * NP) return null;
    for (let i = 0; i < P.length; i += 4) { sx += P[i]; sy += P[i + 1]; tx += P[i + 2]; ty += P[i + 3]; }
    sx /= n; sy /= n; tx /= n; ty /= n;
    let xx = 0, xy = 0, yy = 0, ux = 0, uy = 0, vx = 0, vy = 0;
    for (let i = 0; i < P.length; i += 4) {
      const x = P[i] - sx, y = P[i + 1] - sy, u = P[i + 2] - tx, v = P[i + 3] - ty;
      xx += x * x; xy += x * y; yy += y * y; ux += u * x; uy += u * y; vx += v * x; vy += v * y;
    }
    const reg = 0.02 * n; // ridge towards identity
    xx += reg; yy += reg; ux += reg; vy += reg;
    const det = xx * yy - xy * xy;
    if (Math.abs(det) < 1e-12) return null;
    let a = (ux * yy - uy * xy) / det, b = (uy * xx - ux * xy) / det, c = (vx * yy - vy * xy) / det, d = (vy * xx - vx * xy) / det;
    const L = AFF;
    a = 1 + L * (a - 1); b = L * b; c = L * c; d = 1 + L * (d - 1);
    // keep it sane
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    a = clamp(a, 0.7, 1.4); d = clamp(d, 0.7, 1.4); b = clamp(b, -0.35, 0.35); c = clamp(c, -0.35, 0.35);
    return { a, b, c, d, sx, sy, tx: sx + L * (tx - sx), ty: sy + L * (ty - sy), pen: Math.abs(a - 1) + Math.abs(d - 1) + Math.abs(b) + Math.abs(c) };
  }
  function warp(p, M) {
    const q = new Float64Array(p.length);
    for (let k = 0; k < p.length; k += 2) {
      const x = p[k] - M.sx, y = p[k + 1] - M.sy;
      q[k] = M.tx + M.a * x + M.b * y; q[k + 1] = M.ty + M.c * x + M.d * y;
    }
    return q;
  }
  // cost of explaining group G with template t (lower is better)
  function match(G, t, detail) {
    let r = assign(G.st, G.ch, t);
    if (AFF > 0 && r.sel.length) {
      const M = fitAffine(r.sel);
      if (M) {
        const st = G.st.map((s) => ({ p: warp(s.p, M), len: s.len }));
        const ch = G.ch.map((c) => ({ a: c.a, p: warp(c.p, M), len: c.len }));
        const r2 = assign(st, ch, t);
        r2.cost += AFFPEN * M.pen;
        if (r2.cost < r.cost) r = r2;
      }
    }
    if (detail) return r;
    return r.cost;
  }

  // ---------------------------------------------------------------- per-position judgement
  function variantsOf(ch) {
    // chars that are a *different answer* but close: voiced/semi-voiced/plain, small/large, other script
    const out = new Set();
    const base = ch.normalize("NFD")[0];
    for (const m of ["", "\u3099", "\u309a"]) { const v = (base + m).normalize("NFC"); if (v.length === 1 && RAW[v]) out.add(v); }
    if (SMALL2LARGE.has(ch)) out.add(SMALL2LARGE.get(ch));
    if (LARGE2SMALL.has(ch)) out.add(LARGE2SMALL.get(ch));
    const o = toOther(ch); if (o && RAW[o]) out.add(o);
    return out;
  }
  function neighbours(ch) {
    let n = NEIGH.get(ch);
    if (n) return n;
    const t = getT(ch);
    const feat = coarseFeat(t.s.map((s) => s.poly));
    n = coarseRank(feat, 12).map((x) => x[0]);
    NEIGH.set(ch, n);
    return n;
  }
  // size class: same shape as its small/large partner, so only size tells them apart
  function shapeTwin(a, b) { return SMALL2LARGE.get(a) === b || SMALL2LARGE.get(b) === a; }
  function kindOf(c) {
    if (isHira(c) || isKata(c) || c === "ー" || c === "ゔ" || c === "ヴ") return 1;
    if (/[0-9A-Za-z]/.test(c)) return 2;
    if (OPTIONAL.has(c)) return 3;
    return 0;
  }
  function same(a, b) { return a === b || (SAMEMAP.has(a) && SAMEMAP.get(a).has(b)); }

  function judge(S, G, expSet, ctx) {
    // expSet: array of acceptable chars at this position
    const costs = new Map();
    const cost = (ch) => { let c = costs.get(ch); if (c === undefined) { c = match(G, getT(ch)); costs.set(ch, c); } return c; };
    let bestE = null, ce = Infinity;
    for (const e of expSet) { const c = cost(e); if (c < ce) { ce = c; bestE = e; } }
    const feat = coarseFeat(groupPolys(S, G));
    const comp = new Set();
    for (const [c] of coarseRank(feat, KCOARSE)) comp.add(c);
    for (const e of expSet) { for (const c of neighbours(e)) comp.add(c); for (const c of variantsOf(e)) comp.add(c); }
    const vars = new Set();
    for (const e of expSet) for (const c of variantsOf(e)) vars.add(c);
    const kind = kindOf(bestE);
    let co = Infinity, other = null, worst = Infinity;
    for (const c of comp) {
      if (expSet.some((e) => same(e, c) || shapeTwin(e, c))) continue;
      const v = cost(c);
      const m = vars.has(c) ? MARGIN_V : kindOf(c) === kind ? MARGIN : MARGIN_X;
      if (v + m < worst) { worst = v + m; co = v; other = c; }
    }
    const ok = ce <= CEIL && ce <= worst;
    return { ok, ch: bestE, cost: ce, other, otherCost: co };
  }

  // ---------------------------------------------------------------- segmentation
  function candidateInfo(cand) {
    // positions: [{opts:[chars], optional}]
    const pos = [];
    const unsupported = [];
    for (const ch of cand) {
      if (OPTIONAL.has(ch) && !(ch in RAW)) continue;
      if (/\s/.test(ch)) continue;
      const opts = [ch];
      if (!RAW[ch]) { unsupported.push(ch); }
      pos.push({ ch, opts, optional: OPTIONAL.has(ch) });
    }
    return { pos, unsupported };
  }

  function orders(S, em) {
    const ids = S.map((s) => s.id);
    const list = [ids];
    const xs = ids.slice().sort((a, b) => ((S[a].bb[0] + S[a].bb[2]) - (S[b].bb[0] + S[b].bb[2])) || a - b);
    if (xs.some((v, i) => v !== ids[i])) list.push(xs);
    // late small strokes (e.g. a dakuten added after the next character) moved back to where they sit
    const late = [];
    for (const i of ids) {
      const s = S[i], sz = Math.max(s.bb[2] - s.bb[0], s.bb[3] - s.bb[1]);
      const cx = (s.bb[0] + s.bb[2]) / 2;
      if (late.length && sz < 0.35 * em) {
        let pos = late.length;
        while (pos > 0) {
          const q = S[late[pos - 1]];
          if (q.bb[0] <= cx + 0.1 * em) break;
          pos--;
        }
        late.splice(pos, 0, i);
      } else late.push(i);
    }
    if (!list.some((l) => l.every((v, i) => v === late[i]))) list.push(late);
    return list;
  }

  function lineEm(S, n) {
    const bb = frameOf(S.map((s) => s.bb));
    return Math.max(bb.h, 0.85 * bb.w / Math.max(1, n), 1);
  }

  // Dynamic programme: split the ordered strokes into consecutive groups, one per position.
  function segment(S, order, P, em, cache) {
    const n = order.length, m = P.length;
    const INF = 1e9;
    const dp = []; const bk = [];
    for (let i = 0; i <= m; i++) { dp.push(new Float64Array(n + 1).fill(INF)); bk.push(new Int32Array(n + 1).fill(-1)); }
    dp[0][0] = 0;
    const SKIP = 0.6, OPTSKIP = 0.02, EXTRAST = 0.6;
    for (let i = 0; i < m; i++) {
      const p = P[i];
      const tn = Math.min(...p.opts.map((c) => getT(c).n)), tx = Math.max(...p.opts.map((c) => getT(c).n));
      const lo = Math.max(1, Math.ceil(tn / 3) - (tn >= 6 ? 1 : 0)), hi = tx + 3;
      for (let k = 0; k <= n; k++) {
        const base = dp[i][k];
        if (base >= INF) continue;
        // skip this position
        const sk = base + (p.optional ? OPTSKIP : SKIP);
        if (sk < dp[i + 1][k]) { dp[i + 1][k] = sk; bk[i + 1][k] = -2 - k; }
        let x0 = Infinity, x1 = -Infinity;
        for (let l = 1; l <= hi && k + l <= n; l++) {
          const s = S[order[k + l - 1]];
          if (s.bb[0] < x0) x0 = s.bb[0]; if (s.bb[2] > x1) x1 = s.bb[2];
          if (l < lo) continue;
          if (x1 - x0 > 2.2 * em) break;
          const ids = order.slice(k, k + l).sort((a, b) => a - b);
          const key = ids.join(",") + "|" + i;
          let c = cache.get(key);
          if (c === undefined) {
            const G = groupView(S, ids);
            c = Infinity;
            for (const ch of p.opts) c = Math.min(c, match(G, getT(ch)));
            // layout: a group much wider than a character is unlikely
            const wr = (x1 - x0) / em;
            if (wr > 1.3) c += (wr - 1.3) * 0.3;
            cache.set(key, c);
          }
          const v = base + c;
          if (v < dp[i + 1][k + l]) { dp[i + 1][k + l] = v; bk[i + 1][k + l] = k; }
        }
      }
    }
    // trailing strokes count as extra writing
    let best = INF, bestK = -1;
    for (let k = 0; k <= n; k++) {
      if (dp[m][k] >= INF) continue;
      let extra = 0; for (let q = k; q < n; q++) extra += EXTRAST;
      if (dp[m][k] + extra < best) { best = dp[m][k] + extra; bestK = k; }
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

  // ---------------------------------------------------------------- public API
  function init(json) {
    const t0 = now();
    RAW = json.chars; unit = json.unit || 109; qn = json.q || 92; alpha = json.alphabet;
    CHARS = Object.keys(RAW);
    DEC = new Map(); NEIGH.clear();
    COARSE = new Float32Array(CHARS.length * FD);
    CHARS.forEach((ch, i) => {
      const t = getT(ch);
      COARSE.set(coarseFeat(t.s.map((s) => s.poly)), i * FD);
    });
    return { chars: CHARS.length, ms: now() - t0 };
  }
  function has(ch) { return !!(RAW && RAW[ch]); }
  function now() { return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now(); }

  function verify(opts) {
    const t0 = now();
    const S = prepInput(opts.strokes);
    const cands = (opts.candidates || []).map((c) => String(c)).filter((c) => c.length);
    const anyKana = !!opts.anyKana;
    const infos = cands.map((c) => ({ text: c, ...candidateInfo([...c]) }));
    const usable = infos.filter((x) => !x.unsupported.length && x.pos.length);
    const unsupported = [...new Set(infos.flatMap((x) => x.unsupported))];
    if (!usable.length) return { ok: null, text: cands[0] || "", chars: [], unsupported, ms: now() - t0 };
    if (!S.length) {
      const c = usable[0];
      return { ok: false, text: c.text, chars: c.pos.map((p) => ({ ch: p.ch, ok: false, why: "missing" })), unsupported, ms: now() - t0 };
    }
    let best = null, allRes = null;
    const cache = new Map();
    for (const info of usable) {
      const P = info.pos.map((p) => {
        const o = new Set(p.opts);
        if (anyKana) { const x = toOther(p.ch); if (x && RAW[x]) o.add(x); }
        for (const c of [...o]) if (SAMEMAP.has(c)) for (const d of SAMEMAP.get(c)) if (RAW[d]) o.add(d);
        return { ch: p.ch, opts: [...o], optional: p.optional };
      });
      const em = lineEm(S, P.filter((p) => !p.optional).length);
      let seg = null;
      const ckey = new Map();
      for (const ord of orders(S, em)) {
        const r = segment(S, ord, P, em, ckey);
        if (r && (!seg || r.cost < seg.cost)) seg = r;
      }
      if (!seg) continue;
      const res = evaluate(S, P, seg, em, opts.debug);
      res.text = res.text || info.text;
      if (opts.debug) (allRes = allRes || []).push({ cand: info.text, ok: res.ok, text: res.text, chars: res.chars, groups: res.groups, size: res.size, refEm: res.refEm });
      if (!best || better(res, best)) best = res;
      if (best.ok) break;
    }
    if (allRes) best.all = allRes;
    best.unsupported = unsupported;
    best.ms = now() - t0;
    delete best.score;
    return best;
  }
  function better(a, b) {
    if (a.ok !== b.ok) return a.ok;
    const fa = a.chars.filter((c) => !c.ok).length / a.chars.length, fb = b.chars.filter((c) => !c.ok).length / b.chars.length;
    if (fa !== fb) return fa < fb;
    return a.score < b.score;
  }

  // Handwritten small kana are about SMALLF of the full-size form, sitting on the same bottom line.
  const SMALLF = 0.65, SBOT = 0.88;
  function expectedBox(ch) {
    // [size, centre y] of ch in em units as people write it
    const L = SMALL2LARGE.get(ch);
    if (L) { const t = getT(L); return [t.size * SMALLF, SBOT - (SBOT - t.cy) * SMALLF]; }
    const t = getT(ch); return [t.size, t.cy];
  }
  function sizeEvidence(views, P, i, ch) {
    // returns evidence in [~0 (full size) .. ~1 (small)] that position i was written small, and how sure the reference is
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
    const same = anchors.filter((a) => a.kind === kind);
    const use = same.length >= 2 ? same : anchors;
    const ems = use.map((a) => a.em).sort((a, b) => a - b);
    const em = ems.length % 2 ? ems[ems.length >> 1] : (ems[ems.length / 2 - 1] + ems[ems.length / 2]) / 2;
    const L = SMALL2LARGE.get(ch) || ch, tl = getT(L);
    const G = views[i];
    const q = G.f.s / (em * tl.size);
    const eq = Math.log(Math.max(q, 0.05)) / Math.log(SMALLF);
    // vertical: centre line estimated from the nearest anchors on each side
    const near = use.slice().sort((a, b) => Math.abs(a.k - i) - Math.abs(b.k - i)).slice(0, 3);
    let cl = 0, wsum = 0;
    for (const a of near) { const w = 1 / Math.abs(a.k - i); cl += w * (a.G.f.cy - (a.cy - 0.5) * em); wsum += w; }
    cl /= wsum;
    const dy = (G.f.cy - cl) / em - (tl.cy - 0.5);
    const ey = dy / ((SBOT - tl.cy) * (1 - SMALLF));
    const e = 0.7 * eq + 0.3 * Math.max(-1, Math.min(2, ey));
    return { e, n: use.length, q, dy };
  }
  function evaluate(S, P, seg, em, dbg) {
    const chars = [];
    let text = "", allOk = true, score = seg.cost;
    const views = seg.groups.map((g) => (g ? groupView(S, g) : null));
    P.forEach((p, i) => {
      const G = views[i];
      if (!G) {
        if (p.optional) return;
        chars.push({ ch: p.ch, ok: false, why: "missing" }); allOk = false; text += p.ch; return;
      }
      const j = judge(S, G, p.opts, {});
      let why = j.ok ? null : "shape";
      const ch = j.ch || p.ch;
      if (j.ok && (SMALL2LARGE.has(ch) || LARGE2SMALL.has(ch))) {
        const ev = sizeEvidence(views, P, i, ch);
        if (ev) {
          const loose = ev.n >= 3 ? 0 : ev.n === 2 ? 0.1 : 0.2;
          if (SMALL2LARGE.has(ch) && ev.e < 0.32 - loose) why = "large";
          if (LARGE2SMALL.has(ch) && ev.e > 0.75 + loose) why = "small";
          if (dbg) chars.dbgSize = (chars.dbgSize || []).concat([[ch, +ev.e.toFixed(2), +ev.q.toFixed(2), +ev.dy.toFixed(2), ev.n]]);
        }
      }
      const ok = why === null;
      if (!ok) allOk = false;
      text += ch;
      chars.push({ ch, ok, why, cost: +j.cost.toFixed(3), other: j.other, otherCost: +j.otherCost.toFixed(3) });
    });
    if (seg.extra.length) { chars.push({ ch: "", ok: false, why: "extra" }); allOk = false; }
    const out = { ok: allOk, text, chars, score };
    if (dbg) { out.groups = seg.groups; out.extra = seg.extra; out.size = chars.dbgSize; }
    return out;
  }

  function top(strokes, box, n) {
    const S = prepInput(strokes);
    if (!S.length) return [];
    const G = groupView(S, S.map((s) => s.id));
    const feat = coarseFeat(groupPolys(S, G));
    const pre = coarseRank(feat, Math.max(40, (n || 10) * 3));
    return pre.map(([ch, cd]) => ({ ch, cost: +match(G, getT(ch)).toFixed(4), coarse: +cd.toFixed(4) }))
      .sort((a, b) => a.cost - b.cost).slice(0, n || 10);
  }

  const api = {
    init, has, verify, top,
    _: { sdist, assign, prepInput, groupView, match, getT, coarseFeat, coarseRank, judge, segment, orders, lineEm, variantsOf, SAMEMAP, SMALL2LARGE },
  };
  root.QCardChecker = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
