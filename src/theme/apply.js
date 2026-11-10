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
