  // ---------- colours: the two choices in Settings ----------
  // Blue or Warm, and light, dark or the device's setting: per viewer, remembered in this browser (and in the account,
  // see account/choices.js). colours.apply (theme/apply.js) is what changes the page.
  function setPalette(name) {
    name = name === "claude" ? "claude" : "indigo";
    colours.apply(name, document.documentElement.dataset.theme);
    document.querySelectorAll("#palPick [data-pal]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.pal === name));
    store.set("palette", name);
    pads.forEach((p) => p.draw());
  }
  document.querySelectorAll("#palPick [data-pal]").forEach((b) => (b.onclick = () => setPalette(b.dataset.pal)));
  function setTheme(t) {
    t = t === "light" || t === "dark" ? t : "";
    colours.apply(document.documentElement.dataset.palette, t);
    document.querySelectorAll("#themePick [data-theme-pick]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.themePick === t));
    store.set("theme", t);
  }
  document.querySelectorAll("#themePick [data-theme-pick]").forEach((b) => (b.onclick = () => setTheme(b.dataset.themePick)));
  setTheme(store.get("theme", ""));
