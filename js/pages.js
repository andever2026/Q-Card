// Made by tools/build.mjs from src/side-pages/pages.js; edit that file instead.
// Every side page (ai/, privacy/): the colours and light or dark picked in the site's Settings. Loaded in <head>, so the
// colours are right before anything shows. Without it the pages still read fine.
(() => {
// The one place the page's colours are set, for the page itself and for the side pages (ai/, privacy/).
// <html data-palette="claude"> is Warm (none is Blue); data-theme="light" or "dark" is a fixed choice (none follows the device).
// The choices are kept in this browser, where every page of the site reads them.
const colours = {
  saved() { const get = (k) => { try { return JSON.parse(localStorage.getItem("jpq:" + k)); } catch { return null; } }; return [get("palette"), get("theme")]; },
  apply(palette, theme) {
    const at = document.documentElement.dataset;
    if (palette === "claude") at.palette = "claude"; else delete at.palette;
    if (theme === "light" || theme === "dark") at.theme = theme; else delete at.theme;
  },
};
  const recolour = () => colours.apply(...colours.saved());
  recolour();
  addEventListener("storage", recolour); // changed in Settings in another tab
  document.documentElement.classList.add("js");
  // Opened from disk, a link to the site's folder would list its files, so it names the page.
  if (location.protocol === "file:") addEventListener("DOMContentLoaded", () => document.querySelectorAll('a[href="../"]').forEach((a) => (a.href = "../index.html")));
})();
