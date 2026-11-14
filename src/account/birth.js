  // ---------- public site: birth month and year ----------
  // Sharing handwriting is for people 16 and older, so saying yes to it takes a birth month and year (account/share.js).
  // It's kept with the account's profile (data/users/<uid>/profile, born: "YYYY-MM"), empty until then, and Settings →
  // Account shows it and lets it be given, changed or cleared. Month and year only: enough to tell an age, and less to
  // keep than a birthday (the owner's plan, 2026-11-12).
  let born = "";
  const BORN_TIP = "Age information is used for handwriting consent, and for advertising if we add it later.";
  const cleanBorn = (v) => (/^(19|20)\d\d-(0[1-9]|1[0-2])$/.test(v) ? v : "");
  // Certainly 16: the month they turn 16 in is over (the day isn't known).
  const oldEnough = (b, now = new Date()) => { const [y, m] = b.split("-").map(Number); return (now.getFullYear() - y) * 12 + now.getMonth() + 1 - m > 16 * 12; };
  const tooYoung = (b) => !!b && !oldEnough(b);
  // The (?) beside wherever it's asked.
  const bornTip = (at, id) => { at.innerHTML = qtip(id, "What this is used for", BORN_TIP); tipTaps(at); };
  // Month and year dropdowns in box; changed() runs on each pick. get() is "YYYY-MM", or "" until both are picked;
  // half() says one is picked without the other.
  function birthPick(box, changed) {
    box.classList.add("bornpick");
    box.innerHTML = `<span id="${box.id}M"></span><span id="${box.id}Y"></span>`;
    const year = new Date().getFullYear(), two = (n) => String(n).padStart(2, "0");
    let m = "", y = "";
    const months = makeDropdown(box.firstChild, "Birth month", [["", "Month"], ...Array.from({ length: 12 }, (_, i) => [two(i + 1), new Date(2000, i, 1).toLocaleDateString("en", { month: "long" })])], (v) => { m = v; changed(); });
    const years = makeDropdown(box.lastChild, "Birth year", [["", "Year"], ...Array.from({ length: 101 }, (_, i) => [String(year - i), String(year - i)])], (v) => { y = v; changed(); });
    const set = (b) => { [y, m] = b ? b.split("-") : ["", ""]; months.set(m); years.set(y); };
    set("");
    return { set, get: () => (m && y ? `${y}-${m}` : ""), half: () => !m !== !y };
  }

  // Settings → Account: saved as soon as both are picked; Clear (or both back to nothing) empties it.
  const bornMsg = (t) => { $("#bornMsg").textContent = t; };
  const bornIn = birthPick($("#bornIn"), () => (bornIn.half() ? bornMsg("Pick both to save.") : keepBorn(bornIn.get())));
  bornTip($("#bornTipAt"), "bornTip");
  async function keepBorn(b) {
    if (b === born) return bornMsg("");
    try { await saveProfile({ born: b }); const off = shareAged(); bornMsg(off ? "Saved. Sharing handwriting is for people 16 and older, so it's off now." : b ? "Saved." : "Cleared."); }
    catch { bornMsg("Couldn't save. Try again."); }
    renderBorn();
  }
  $("#bornClear").onclick = () => keepBorn("");
  $("#settings").addEventListener("leave", () => { bornMsg(""); renderBorn(); });
  function renderBorn() {
    $("#bornRow").hidden = !account;
    bornIn.set(born); $("#bornClear").hidden = !born;
  }
