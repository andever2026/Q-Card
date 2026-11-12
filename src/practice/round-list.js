  // ---------- public site, Admin: the words of this round, during a practice ----------
  // A developer's look at what's left (Settings → Admin, off until turned on, in this browser): the word on screen, the
  // ones still to come this round, and the ones missed this round, which come back in the next.
  const roundOn = () => isDev && !!store.get("roundList", false);
  function showRound() {
    const box = $("#roundList");
    box.hidden = !roundOn() || !Q.cur;
    if (box.hidden) return;
    const both = Q.meta?.dir === "both";
    const li = (it, cls) => `<li${cls ? ` class="${cls}"` : ""}>${esc(jpForm(it.w))} <small>${esc(it.w.en)} · ${esc(it.w.set)}${both ? (it.dir === "ej" ? " · EN→JP" : " · JP→EN") : ""}</small></li>`;
    $("#roundHead").textContent = `Round ${Q.round}: ${Q.queue.length + 1} to go${Q.wrong.length ? `, ${Q.wrong.length} missed so far` : ""}`;
    $("#roundItems").innerHTML = [li(Q.cur, "now"), ...Q.queue.map((it) => li(it)), ...Q.wrong.map((it) => li(it, "missed"))].join("");
  }
  $("#roundListOn").checked = !!store.get("roundList", false);
  $("#roundListOn").onchange = (e) => { store.set("roundList", e.target.checked); showRound(); };
