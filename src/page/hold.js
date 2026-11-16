  // ---------- holding something down ----------
  // onHold(root, sel, open): holding a finger or a pen still on an element matching sel inside root, or right-clicking
  // it, runs open(el) instead of what a tap does. root stays while what's in it is drawn again.
  function onHold(root, sel, open) {
    const HOLD = 500, SLOP = 8;
    let h = null, swallow = false;
    const cancel = () => { if (h) clearTimeout(h.timer); h = null; };
    const at = (e) => { const el = e.target.closest(sel); return el && root.contains(el) ? el : null; };
    root.classList.add("holds");
    root.addEventListener("pointerdown", (e) => {
      cancel(); swallow = false;
      const el = at(e);
      if (!el || e.pointerType === "mouse") return;
      h = { id: e.pointerId, x: e.clientX, y: e.clientY, timer: setTimeout(() => { h = null; swallow = true; open(el); }, HOLD) };
    });
    root.addEventListener("pointermove", (e) => { if (h && e.pointerId === h.id && Math.hypot(e.clientX - h.x, e.clientY - h.y) > SLOP) cancel(); }); // a scroll
    ["pointerup", "pointercancel"].forEach((t) => root.addEventListener(t, (e) => { if (h && e.pointerId === h.id) cancel(); }));
    // The tap that ends a hold doesn't also do what a tap does. A right-click (and Android's own long press) opens it too.
    root.addEventListener("click", (e) => { if (swallow) { swallow = false; e.stopPropagation(); e.preventDefault(); } }, true);
    root.addEventListener("contextmenu", (e) => {
      const el = at(e);
      if (!el) return;
      e.preventDefault();
      const opened = swallow;
      cancel(); swallow = true;
      if (!opened) open(el);
    });
  }
