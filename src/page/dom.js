  // Finding an element, and making text safe to put into HTML: for the page and for the AI page's import.
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // A one-line message under a control: sayIn(el)("…") shows it, sayIn(el)("") takes it away.
  const sayIn = (el) => (m) => { el.hidden = !m; el.textContent = m || ""; };
  // Marks which of a menu's buttons is the one showing (the styles key on aria-current).
  const markCurrent = (els, on) => els.forEach((b) => (on(b) ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  // A (?) that shows a short explanation in a bubble when pointed at, focused or (on a touch screen) tapped. qtip(id, label,
  // text) is its HTML (id names the bubble, for aria-describedby); tipTaps(box) makes the ones in box open on a tap.
  const qtip = (id, label, text) => `<span class="qtip" tabindex="0" role="button" aria-label="${esc(label)}"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.4a2.8 2.8 0 1 1 3.9 2.6c-.8.4-1.2.9-1.2 1.7v.5"/><circle cx="12" cy="17.2" r=".4" fill="currentColor"/></svg><span class="qtipbody" role="tooltip" id="${id}">${esc(text)}</span></span>`;
  const tipTaps = (box) => box.querySelectorAll(".qtip").forEach((q) => { q.onclick = () => q.classList.toggle("open"); q.onblur = q.onmouseleave = () => q.classList.remove("open"); });
