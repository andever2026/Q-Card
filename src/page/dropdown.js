  // ---------- a dropdown in the page's own style ----------
  // A button showing the picked option; clicking it opens a short list under it (over it, near the bottom of the
  // screen). Arrow keys, Enter and Escape work, and a click anywhere else closes it.
  //   makeDropdown(box, label, [[value, text], …], pick(value)) fills box and returns { set(value) },
  //   which shows a value chosen elsewhere without calling pick.
  function makeDropdown(box, label, options, pick) {
    const id = box.id || "dd";
    box.classList.add("dd");
    box.innerHTML = `<button type="button" class="dd-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="${esc(label)}"><span></span><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <ul class="dd-list" role="listbox" aria-label="${esc(label)}" tabindex="-1" hidden>${options.map(([v, t], i) => `<li role="option" id="${id}-o${i}" data-v="${esc(v)}">${esc(t)}</li>`).join("")}</ul>`;
    const btn = box.querySelector(".dd-btn"), list = box.querySelector(".dd-list"), items = [...list.children];
    let value = null, at = -1;
    const mark = (i) => { at = i; items.forEach((li, j) => li.classList.toggle("on", j === i)); if (i >= 0) list.setAttribute("aria-activedescendant", items[i].id); };
    function set(v) {
      value = String(v);
      const i = items.findIndex((li) => li.dataset.v === value);
      items.forEach((li, j) => li.setAttribute("aria-selected", j === i));
      btn.firstChild.textContent = i < 0 ? "" : items[i].textContent;
    }
    function open(on) {
      list.hidden = !on; btn.setAttribute("aria-expanded", on);
      if (!on) return;
      box.classList.remove("up");
      if (list.getBoundingClientRect().bottom > innerHeight - 8) box.classList.add("up");
      mark(items.findIndex((li) => li.dataset.v === value)); list.focus({ preventScroll: true });
    }
    function choose(i) {
      open(false); btn.focus({ preventScroll: true });
      if (items[i] && items[i].dataset.v !== value) { set(items[i].dataset.v); pick(value); }
    }
    btn.onclick = () => open(list.hidden);
    list.onclick = (e) => { const li = e.target.closest("li"); if (li) choose(items.indexOf(li)); };
    list.onpointermove = (e) => { const li = e.target.closest("li"); if (li) mark(items.indexOf(li)); };
    list.onkeydown = (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); mark((at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(at); }
      else if (e.key === "Escape" || e.key === "Tab") { open(false); btn.focus({ preventScroll: true }); }
    };
    document.addEventListener("pointerdown", (e) => { if (!list.hidden && !box.contains(e.target)) open(false); });
    return { set };
  }
