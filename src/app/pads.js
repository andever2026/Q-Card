  // ---------- handwriting pads ----------
  // Palm rejection: a finger draws unless the pencil is down or was used in the last moment.
  let penDown = false, penAt = 0;
  const PALM_MS = 600;
  const active = new Map(); // pointerId -> the pad its stroke is in now (a stroke can move to the other box)
  // Undo history: { gid } for a stroke (all its pieces, in any box), { erased: [[pad, stroke, index], …] } for one eraser drag.
  const history = [];
  let gidSeq = 0, erasing = false, eraseG = null, inkTimer = null;
  const ERASE_R = 12; // px around the eraser that counts as touching a stroke
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  // Beside each stroke's points: when each was drawn (ms from the stroke's start, t0) and the pen pressure, plus the kind
  // of pointer. Only shared handwriting (see share.js) uses them.
  const stamp = (st, ev) => { st.ts.push(Math.round(ev.timeStamp - st.t0)); st.fs.push(Math.round((ev.pressure || 0) * 100) / 100); };
  const startStroke = (st, t0, dev) => Object.assign(st, { t0, dev, ts: [], fs: [] });
  // Every point the pointer passed through since the last event. Safari sometimes hands back an empty list, which would
  // drop the whole move, so the event itself stands in for it then.
  const coalesced = (e) => { const c = e.getCoalescedEvents ? e.getCoalescedEvents() : []; return c.length ? c : [e]; };
  class Pad {
    constructor(canvas, kind) {
      this.c = canvas; this.kind = kind; this.strokes = []; this.cur = null; this.onChange = () => {};
      this.ctx = canvas.getContext("2d");
      canvas.addEventListener("pointerdown", (e) => this.down(e));
      canvas.addEventListener("pointermove", (e) => (active.get(e.pointerId) || this).move(e));
      ["pointerup", "pointercancel"].forEach((t) => canvas.addEventListener(t, (e) => (active.get(e.pointerId) || this).up(e)));
      // Leaving the box a stroke has already moved out of doesn't end it.
      canvas.addEventListener("pointerleave", (e) => { if (!active.has(e.pointerId) || active.get(e.pointerId) === this) this.up(e); });
      // The box keeps the pointer until the stroke ends; losing it any other way ends the stroke, so a pointerup
      // that never arrives can't leave the box refusing every stroke after it.
      canvas.addEventListener("lostpointercapture", (e) => { if (this.cur && e.pointerId === this.curId) this.endCur(); });
      // iOS Safari still starts text selection and the loupe from touches (Apple Pencil included) unless the touch events themselves are cancelled.
      ["touchstart", "touchmove"].forEach((t) => canvas.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
      new ResizeObserver(() => this.resize()).observe(canvas);
    }
    pt(e) { const r = this.c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    down(e) {
      if (e.pointerType === "pen") {
        penDown = true; penAt = performance.now();
        // A palm that landed just before the pencil already started a stroke: drop it.
        for (const p of pads) if (p.cur && p.curType === "touch") p.dropCur();
      } else if (e.pointerType === "touch" && (penDown || performance.now() - penAt < PALM_MS)) return;
      // There is only ever one pencil, so a pen stroke still open when another starts never got its pointerup
      // (iPadOS loses one now and then): end it rather than turn the new stroke away.
      if (this.cur && e.pointerType === "pen" && this.curType === "pen" && e.pointerId !== this.curId) this.endCur();
      if (this.cur || eraseG) return; // one stroke at a time per box
      e.preventDefault();
      try { this.c.setPointerCapture(e.pointerId); } catch {} // a pointer already gone would throw and lose the stroke
      // Eraser mode, or a stylus's own eraser end (buttons bit 32), removes whole strokes instead of drawing.
      if (erasing || (e.pointerType === "pen" && e.buttons & 32)) { eraseG = { id: e.pointerId, erased: [] }; eraseAt(e); return; }
      this.curType = e.pointerType; this.curId = e.pointerId; active.set(e.pointerId, this);
      this.ink = cssVar("--ink"); // read once a stroke, not once a point
      this.cur = [this.pt(e)]; this.cur.gid = ++gidSeq;
      startStroke(this.cur, e.timeStamp, e.pointerType); stamp(this.cur, e);
      this.strokes.push(this.cur);
      history.push({ gid: this.cur.gid });
      this.tail(0);
    }
    move(e) {
      if (e.pointerType === "pen") penAt = performance.now();
      if (eraseG && e.pointerId === eraseG.id) { for (const ev of coalesced(e)) eraseAt(ev); return; }
      if (!this.cur || e.pointerId !== this.curId) return;
      let pad = this, from = pad.cur.length;
      for (const ev of coalesced(e)) {
        const to = pad.handoff(ev);
        if (to !== pad) { pad = to; from = 0; }
        pad.cur.push(pad.pt(ev)); stamp(pad.cur, ev);
      }
      pad.tail(from);
    }
    // A stroke that crosses into the other box (furigana ↔ answer) carries on there as a new stroke in that box.
    handoff(ev) {
      const inside = (c) => { const r = c.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom; };
      if (inside(this.c)) return this;
      const to = pads.find((p) => p !== this && !p.cur && !p.c.hidden && !p.c.classList.contains("locked") && inside(p.c));
      if (!to) return this;
      const id = this.curId, type = this.curType, gid = this.cur.gid, t0 = this.cur.t0;
      this.cur = null; this.draw(); this.onChange();
      try { to.c.setPointerCapture(id); } catch {}
      to.curType = type; to.curId = id; to.ink = this.ink; to.cur = startStroke([], t0, type); to.cur.gid = gid; active.set(id, to); // same gid: Undo and the eraser treat both parts as one stroke
      to.strokes.push(to.cur);
      return to;
    }
    up(e) {
      if (e?.pointerType === "pen") { penDown = false; penAt = performance.now(); }
      if (eraseG && (!e || e.pointerId === eraseG.id)) { if (eraseG.erased.length) history.push({ erased: eraseG.erased }); eraseG = null; return; }
      if (!this.cur || (e && e.pointerId !== this.curId)) return;
      this.endCur();
    }
    endCur() { if (!this.cur) return; active.delete(this.curId); this.cur = null; this.onChange(); }
    dropCur() {
      const i = this.strokes.lastIndexOf(this.cur);
      if (i >= 0) this.strokes.splice(i, 1);
      active.delete(this.curId); this.cur = null; this.draw(); this.onChange();
    }
    clear() { if (this.cur) active.delete(this.curId); this.strokes = []; this.cur = null; this.draw(); this.onChange(); }
    get empty() { return this.strokes.length === 0; }
    lw() { return 3; } // one pen width in every box (the owner picked the thinner furigana one)
    resize() {
      const r = this.c.getBoundingClientRect(); if (!r.width) return;
      const d = window.devicePixelRatio || 1;
      this.w = r.width; this.h = r.height;
      this.c.width = Math.round(r.width * d); this.c.height = Math.round(r.height * d);
      this.ctx.setTransform(d, 0, 0, d, 0, 0);
      this.draw();
    }
    // One stroke, from the point at `from` onwards. Starting partway in, the line begins at the midpoint before it,
    // which is where the curve through the whole stroke passes, so a piece drawn on its own lands exactly on the rest.
    line(ctx, s, scale, from) {
      if (s.length === 1) { ctx.beginPath(); ctx.arc(s[0][0] * scale, s[0][1] * scale, ctx.lineWidth / 2, 0, 7); ctx.fill(); return; }
      const mid = (a, b, k) => ((a[k] + b[k]) / 2) * scale;
      ctx.beginPath();
      if (from > 0) ctx.moveTo(mid(s[from - 1], s[from], 0), mid(s[from - 1], s[from], 1));
      else ctx.moveTo(s[0][0] * scale, s[0][1] * scale);
      for (let i = Math.max(1, from); i < s.length - 1; i++) ctx.quadraticCurveTo(s[i][0] * scale, s[i][1] * scale, mid(s[i], s[i + 1], 0), mid(s[i], s[i + 1], 1));
      const l = s[s.length - 1]; ctx.lineTo(l[0] * scale, l[1] * scale); ctx.stroke();
    }
    paint(ctx, color, scale) {
      ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = this.lw() * scale;
      for (const s of this.strokes) this.line(ctx, s, scale, 0);
      ctx.restore();
    }
    // Only the newest piece of the stroke being written, painted over what is already there. Repainting every stroke on
    // every move left the scratch pad (the biggest box, and the one that fills up) behind an Apple Pencil's stream of
    // points, and points arriving faster than they were drawn went missing.
    tail(from) {
      if (!this.w || !this.cur) return;
      const ctx = this.ctx;
      ctx.save(); ctx.strokeStyle = ctx.fillStyle = this.ink || cssVar("--ink"); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = this.lw();
      this.line(ctx, this.cur, 1, Math.max(0, Math.min(from, this.cur.length - 1) - 2));
      ctx.restore();
    }
    draw() {
      if (!this.w) return;
      this.ctx.clearRect(0, 0, this.w, this.h);
      this.paint(this.ctx, cssVar("--ink"), 1);
    }
    // Black ink on white, no guides, cropped to the writing: what Claude sees.
    toBlob(scale = 2) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const s of this.strokes) for (const [x, y] of s) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      const pad = 16;
      x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(this.w, x1 + pad); y1 = Math.min(this.h, y1 + pad);
      const c = document.createElement("canvas");
      c.width = Math.ceil((x1 - x0) * scale); c.height = Math.ceil((y1 - y0) * scale);
      const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.translate(-x0 * scale, -y0 * scale); this.paint(ctx, "#000", scale);
      return new Promise((res) => c.toBlob(res, "image/png"));
    }
  }
  // Strip and box stacked as on screen, so Claude sees which character each furigana sits over.
  function sheetBlob() {
    const scale = 2, gap = 14, w = Math.max(furi.w, main.w), h = furi.h + gap + main.h;
    let x0 = Infinity, x1 = -Infinity;
    for (const p of [furi, main]) for (const s of p.strokes) for (const [x] of s) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    x0 = Math.max(0, x0 - 24); x1 = Math.min(w, x1 + 24);
    const c = document.createElement("canvas");
    c.width = Math.ceil((x1 - x0) * scale); c.height = Math.ceil(h * scale);
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.translate(-x0 * scale, 0);
    furi.paint(ctx, "#000", scale);
    const sy = (furi.h + gap / 2) * scale;
    ctx.strokeStyle = "#bbb"; ctx.lineWidth = 2; ctx.setLineDash([8, 8]);
    ctx.beginPath(); ctx.moveTo(x0 * scale, sy); ctx.lineTo(x1 * scale, sy); ctx.stroke(); ctx.setLineDash([]);
    ctx.translate(0, (furi.h + gap) * scale);
    main.paint(ctx, "#000", scale);
    return new Promise((res) => c.toBlob(res, "image/png"));
  }
  const furi = new Pad($("#furiPad"), "furi");
  const main = new Pad($("#mainPad"), "main");
  const scratch = new Pad($("#scratchPad"), "main");
  const pads = [furi, main, scratch];
  setPalette(store.get("palette", "indigo"));
  const redrawAll = () => pads.forEach((p) => p.draw());
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redrawAll);
  new MutationObserver(redrawAll).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const syncCheck = () => { $("#checkBtn").disabled = main.empty || Q.busy || Q.answered; };
  furi.onChange = main.onChange = () => { syncCheck(); inkChanged(); };
  // Undo the latest stroke or eraser drag that touched one of these boxes; entries whose strokes are already gone are skipped.
  function undoIn(ps) {
    while (history.length) {
      const h = history.pop();
      if (h.erased) {
        if (!h.erased.some(([p]) => ps.includes(p))) continue;
        for (const [p, st, i] of h.erased.slice().reverse()) p.strokes.splice(Math.min(i, p.strokes.length), 0, st);
        new Set(h.erased.map(([p]) => p)).forEach((p) => { p.draw(); p.onChange(); });
        return;
      }
      if (ps.some((p) => p.strokes.some((st) => st.gid === h.gid))) { removeGid(h.gid); return; }
    }
  }
  function removeGid(gid, log) {
    for (const p of pads) {
      let hit = false;
      for (let i = p.strokes.length - 1; i >= 0; i--) if (p.strokes[i].gid === gid && p.strokes[i] !== p.cur) { log?.push([p, p.strokes[i], i]); p.strokes.splice(i, 1); hit = true; }
      if (hit) { p.draw(); p.onChange(); }
    }
  }
  // The stroke eraser: any stroke passing within ERASE_R of the pointer goes, whole (both parts of one that crossed boxes).
  function eraseAt(ev) {
    for (const p of pads) {
      if (p.c.hidden || p.c.classList.contains("locked")) continue;
      const [x, y] = p.pt(ev);
      if (x < -ERASE_R || y < -ERASE_R || x > p.w + ERASE_R || y > p.h + ERASE_R) continue;
      const near = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l)) : 0; return Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y) <= ERASE_R; };
      for (const st of [...p.strokes]) if (st.length === 1 ? near(st[0], st[0]) : st.some((q, i) => i && near(st[i - 1], q))) removeGid(st.gid, eraseG.erased);
    }
  }
  function setErasing(on) {
    erasing = on;
    document.querySelectorAll(".igroup [data-tool]").forEach((b) => b.setAttribute("aria-pressed", (b.dataset.tool === "erase") === on));
    document.body.classList.toggle("erasing", on);
  }
  // Two tools only, so any tap switches: tapping the one that's off picks it, tapping the one that's on picks the other.
  document.querySelectorAll(".igroup [data-tool]").forEach((b) => (b.onclick = () => setErasing(!erasing)));
  $("#undoBtn").onclick = () => undoIn([furi, main]);
  $("#scratchUndo").onclick = () => undoIn([scratch]);
  // Ctrl+Z / ⌘Z undoes the last stroke: in the answer boxes while writing, in the scratch pad after checking.
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || !((e.key || "").toLowerCase() === "z" || e.code === "KeyZ")) return;
    const el = document.activeElement;
    if ($("#quiz").hidden || /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName || "") || el?.isContentEditable) return;
    e.preventDefault();
    if (!$("#tools").hidden) undoIn([furi, main]);
    else if (!$("#feedback").hidden) undoIn([scratch]);
  });
  $("#clearBtn").onclick = () => { furi.clear(); main.clear(); };
  $("#scratchClear").onclick = () => scratch.clear();
