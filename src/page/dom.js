  // Finding an element, and making text safe to put into HTML: for the page and for the AI page's import.
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // A one-line message under a control: sayIn(el)("…") shows it, sayIn(el)("") takes it away.
  const sayIn = (el) => (m) => { el.hidden = !m; el.textContent = m || ""; };
  // Marks which of a menu's buttons is the one showing (the styles key on aria-current).
  const markCurrent = (els, on) => els.forEach((b) => (on(b) ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
