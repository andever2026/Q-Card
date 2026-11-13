  // ---------- asking first ----------
  // A pop-up over the page before something that's hard to take back. ask(title, html, yes) resolves true for the yes
  // button (labelled yes), false for Cancel or Escape.
  function ask(title, html, yes) {
    const d = $("#askDlg");
    $("#askTitle").textContent = title; $("#askText").innerHTML = html; $("#askYes").textContent = yes;
    d.returnValue = ""; d.showModal(); $("#askYes").focus();
    return new Promise((done) => d.addEventListener("close", () => done(d.returnValue === "yes"), { once: true }));
  }
