  // ---------- asking first ----------
  // A pop-up over the page before something that's hard to take back. ask(title, html, yes) resolves true for the yes
  // button (labelled yes, red when danger), false for Cancel or Escape.
  function ask(title, html, yes, danger = false) {
    const d = $("#askDlg");
    $("#askTitle").textContent = title; $("#askText").innerHTML = html; $("#askYes").textContent = yes; $("#askYes").className = danger ? "btn danger" : "btn primary"; $("#askYes").disabled = false; $("#askText").onchange = null;
    d.returnValue = ""; d.showModal(); $("#askYes").focus();
    return new Promise((done) => d.addEventListener("close", () => done(d.returnValue === "yes"), { once: true }));
  }
  // For a text box inside the pop-up: Enter presses the yes button (by itself it would press Cancel, the pop-up's first button).
  const enterYes = (inp) => { inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $("#askYes").click(); } }; };
