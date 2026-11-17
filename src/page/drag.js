  // ---------- dragging things around ----------
  // makeDrag(root, sel, { over(el, x, y), drop(el, x, y), end() }): the elements matching sel inside root can be picked up
  // and dropped elsewhere. With a mouse, dragging starts once the pointer moves a little; with a finger or a pen, after
  // holding still for a moment (so a swipe still scrolls the page), when the element grows a little to show it's picked up.
  // A copy follows the pointer; over() hears where it is (to mark where it would land), drop() where it was let go, and
  // end() that it's over either way (Escape lets go without dropping). Near the top or bottom of the window the page scrolls.
  // root stays while what's in it is drawn again, so it can be redrawn between drags.
  function makeDrag(root, sel, on) {
    let d = null, justDropped = false;
    const HOLD = 380, SLOP = 8;
    const stop = (dropIt) => {
      if (!d) return;
      const { el, ghost, x, y, live } = d;
      clearTimeout(d.timer); cancelAnimationFrame(d.raf); ghost?.remove(); el.classList.remove("dragsrc", "lifting");
      document.body.classList.remove("dragging"); d = null;
      if (live) { justDropped = true; setTimeout(() => (justDropped = false), 0); if (dropIt) on.drop(el, x, y); on.end(); }
    };
    function lift() {
      const r = d.el.getBoundingClientRect(), g = d.el.cloneNode(true);
      g.classList.add("dragghost"); g.removeAttribute("id");
      Object.assign(g.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
      document.body.append(g);
      Object.assign(d, { live: true, ghost: g, dx: d.x - r.left, dy: d.y - r.top });
      d.el.classList.remove("lifting"); d.el.classList.add("dragsrc"); document.body.classList.add("dragging");
      if (navigator.vibrate && d.touch) navigator.vibrate(8);
      follow(); scroll();
    }
    function follow() { d.ghost.style.transform = `translate(${d.x - d.dx - parseFloat(d.ghost.style.left)}px, ${d.y - d.dy - parseFloat(d.ghost.style.top)}px) scale(1.06)`; on.over(d.el, d.x, d.y); }
    function scroll() {
      if (!d?.live) return;
      const edge = 60, v = d.y < edge ? -(edge - d.y) / 4 : d.y > innerHeight - edge ? (d.y - innerHeight + edge) / 4 : 0;
      if (v) { window.scrollBy(0, v); on.over(d.el, d.x, d.y); }
      d.raf = requestAnimationFrame(scroll);
    }
    root.addEventListener("pointerdown", (e) => {
      const el = e.target.closest(sel);
      if (!el || !root.contains(el) || e.button > 0 || d) return;
      const touch = e.pointerType !== "mouse";
      d = { el, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, touch, live: false, id: e.pointerId };
      if (touch) { el.classList.add("lifting"); d.timer = setTimeout(() => d && lift(), HOLD); }
    });
    addEventListener("pointermove", (e) => {
      if (!d || e.pointerId !== d.id) return;
      d.x = e.clientX; d.y = e.clientY;
      const far = Math.hypot(d.x - d.x0, d.y - d.y0) > SLOP;
      if (d.live) follow();
      else if (far) { if (d.touch) stop(false); else lift(); } // a finger that moves before the hold is a scroll
    });
    addEventListener("pointerup", (e) => { if (d && e.pointerId === d.id) stop(true); });
    addEventListener("pointercancel", (e) => { if (d && e.pointerId === d.id) stop(false); });
    addEventListener("keydown", (e) => { if (d?.live && e.key === "Escape") stop(false); });
    // Once something is picked up the page doesn't scroll under the finger, and the click that ends a drag does nothing.
    addEventListener("touchmove", (e) => { if (d?.live) e.preventDefault(); }, { passive: false });
    root.addEventListener("click", (e) => { if (justDropped) { e.stopPropagation(); e.preventDefault(); } }, true);
    root.addEventListener("contextmenu", (e) => { if (d) e.preventDefault(); });
    return { busy: () => !!d?.live };
  }
