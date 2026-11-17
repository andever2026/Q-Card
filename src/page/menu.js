  // ---------- a small menu under a button ----------
  // makeMenu(box, btn, list): btn opens and closes list, a role="menu" of buttons; box holds them both. Arrow keys move
  // between the items; Escape, Tab or a click anywhere else closes it. Returns open(on, refocus): refocus puts the focus
  // back on btn when closing. The account at the top right (account/menu.js) and the notebooks (vocab/notebooks.js) are two.
  function makeMenu(box, btn, list) {
    const isOpen = () => !list.hidden;
    function open(on, refocus) {
      list.hidden = !on; btn.setAttribute("aria-expanded", on);
      if (on) list.querySelector("button").focus(); else if (refocus) btn.focus();
    }
    btn.onclick = () => open(!isOpen());
    box.addEventListener("keydown", (e) => {
      if (!isOpen()) return;
      const items = [...list.querySelectorAll("button")], i = items.indexOf(document.activeElement);
      if (e.key === "Escape") { e.stopPropagation(); open(false, true); } // the menu only, not the drawer it may be in
      else if (e.key === "Tab") open(false);
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus(); }
    });
    document.addEventListener("pointerdown", (e) => { if (isOpen() && !box.contains(e.target)) open(false); });
    return open;
  }
