  // ---------- public site: birth month and year ----------
  // Sharing handwriting is for people 16 and older, so a yes to it is followed by a second pop-up asking for a birth
  // month and year (askBorn, from account/share.js). It's kept with the account's profile (data/users/<uid>/profile,
  // born: "YYYY-MM", bornAt: when it was given), empty until then, and Settings → Account shows it and lets it be given,
  // changed or cleared. Month and year only: enough to tell an age, and less to keep than a birthday. Once given it
  // stays for 3 months (the owner, 2026-11-14), so an age that didn't fit can't just be picked again; clearing it is
  // always possible and doesn't shorten the wait (bornCleared: when). Saving and deleting are confirmed in a pop-up first.
  // The wait is the page's own: firestore.rules lets an account write its profile as it likes.
  let born = "", bornAt = "", bornCleared = "";
  const BORN_TIP = "Age information is used for handwriting consent, and for advertising if we add it later.", BORN_WAIT = 3;
  const cleanBorn = (v) => (/^(19|20)\d\d-(0[1-9]|1[0-2])$/.test(v) ? v : "");
  // Certainly 16: the month they turn 16 in is over (the day isn't known).
  const oldEnough = (b, now = new Date()) => { const [y, m] = b.split("-").map(Number); return (now.getFullYear() - y) * 12 + now.getMonth() + 1 - m > 16 * 12; };
  const tooYoung = (b) => !!b && !oldEnough(b);
  const monthName = (m) => new Date(2000, m - 1, 1).toLocaleDateString("en", { month: "long" });
  // While the wait runs after deleting it, the text says when it was deleted (the line under it, when it can be given again).
  const bornText = (b) => (b ? `${monthName(+b.slice(5))} ${b.slice(0, 4)}` : bornCleared && bornWait() ? `Cleared on ${dayText(bornCleared)}` : "Not given");
  // The day it can be given or changed again, or null when it can be now.
  function bornWait() {
    const d = new Date(bornAt || NaN); d.setMonth(d.getMonth() + BORN_WAIT);
    return d > new Date() ? d : null;
  }
  const waitText = (d) => `It can be ${born ? "changed" : "updated"} after ${dayText(d)}.`;
  // Giving or changing it starts the wait; clearing it leaves the wait as it is.
  const saveBorn = (b) => saveProfile(b ? { born: b, bornAt: new Date().toISOString(), bornCleared: "" } : { born: "", bornCleared: new Date().toISOString() });
  // The (?) beside wherever it's asked.
  const bornTip = (at, id) => { at.innerHTML = qtip(id, "What this is used for", BORN_TIP); tipTaps(at); };
  // Month and year dropdowns in box; changed() runs on each pick. get() is "YYYY-MM", or "" until both are picked.
  function birthPick(box, changed) {
    box.classList.add("bornpick");
    box.innerHTML = `<span id="${box.id}M"></span><span id="${box.id}Y"></span>`;
    const year = new Date().getFullYear();
    let m = "", y = "";
    const months = makeDropdown(box.firstChild, "Birth month", [["", "Month"], ...Array.from({ length: 12 }, (_, i) => [String(i + 1).padStart(2, "0"), monthName(i + 1)])], (v) => { m = v; changed(); });
    const years = makeDropdown(box.lastChild, "Birth year", [["", "Year"], ...Array.from({ length: 101 }, (_, i) => [String(year - i), String(year - i)])], (v) => { y = v; changed(); });
    const set = (b) => { [y, m] = b ? b.split("-") : ["", ""]; months.set(m); years.set(y); };
    set("");
    return { set, get: () => (m && y ? `${y}-${m}` : "") };
  }
  // One place it's asked: the dropdowns (the month and year as text during the wait), and a line saying when it can
  // change. ids: pick, now, note, and rule (say how often it can change, in the pop-up). Returns the dropdowns, with draw() to show which of the two it is now.
  function bornField(ids, changed) {
    const pick = birthPick($(ids.pick), changed);
    pick.draw = () => {
      const wait = bornWait();
      $(ids.pick).hidden = !!wait;
      $(ids.now).hidden = !wait; $(ids.now).textContent = bornText(born);
      $(ids.note).textContent = wait ? waitText(wait) : ids.rule ? `It can be changed once every ${BORN_WAIT} months.` : "";
      return wait;
    };
    return pick;
  }

  // The pop-up after a yes to sharing handwriting. yes() runs once a birth month and year of 16 or older is on the
  // account; under 16 it's saved all the same, and the pop-up stays to say sharing is for 16 and older.
  let bornYes = () => {};
  const askPick = bornField({ pick: "#bornAskIn", now: "#bornAskNow", note: "#bornAskNote", rule: true }, () => drawBornAsk());
  bornTip($("#bornAskTip"), "bornAskTipText");
  function drawBornAsk(err = "") {
    const wait = askPick.draw();
    $("#bornAskYoung").hidden = !tooYoung(born);
    $("#bornAskErr").textContent = err; $("#bornAskErr").hidden = !err;
    $("#bornAskGo").hidden = !!wait; $("#bornAskNo").textContent = wait ? "Close" : "Cancel";
  }
  function askBorn(yes) {
    if (born && oldEnough(born)) return yes();
    bornYes = yes; askPick.set(born); drawBornAsk();
    $("#bornAsk").showModal();
  }
  $("#bornAskNo").onclick = () => $("#bornAsk").close();
  $("#bornAskForm").onsubmit = async (e) => {
    e.preventDefault();
    const b = askPick.get();
    if (!b) return drawBornAsk("Pick both the month and the year.");
    if (b !== born) try { await saveBorn(b); renderBorn(); } catch { return drawBornAsk("It couldn't be saved. Try again."); }
    if (tooYoung(born)) return drawBornAsk();
    $("#bornAsk").close(); bornYes();
  };

  // Settings → Account: Save keeps what's picked and Delete empties it, each after a pop-up saying what it means.
  const bornMsg = (t) => { $("#bornMsg").textContent = t; };
  const syncBorn = () => { $("#bornSave").disabled = !bornIn.get() || bornIn.get() === born; };
  const bornIn = bornField({ pick: "#bornIn", now: "#bornNow", note: "#bornNote" }, () => { bornMsg(""); syncBorn(); });
  bornTip($("#bornTipAt"), "bornTip");
  async function keepBorn(b) {
    try { await saveBorn(b); const off = shareAged(); bornMsg((b ? "Saved." : "Cleared.") + (off ? " Sharing handwriting is off now: it needs a birth month and year of 16 or older." : "")); }
    catch { bornMsg("It couldn't be saved. Try again."); }
    renderBorn();
  }
  $("#bornForm").onsubmit = async (e) => {
    e.preventDefault();
    const b = bornIn.get();
    if (!b || bornWait()) return;
    if (await ask("Confirm your birthday", `<p>Confirming your birthday is <b>${esc(bornText(b))}</b>.</p><p>This information can only be changed once every ${BORN_WAIT} months. It can be deleted at any time.</p>`, "Confirm")) keepBorn(b);
  };
  $("#bornClear").onclick = async () => {
    const wait = bornWait(), again = wait ? `any time after ${dayText(wait)}` : "at any time";
    if (await ask("Delete your birthday?", `<p>This information will be cleared from our database. You can choose to give your birthday again ${again}.</p>`, "Delete", true)) keepBorn("");
  };
  $("#settings").addEventListener("leave", () => { bornMsg(""); renderBorn(); });
  // Admin: the wait ended for the developer's own account, to try giving it again.
  $("#devBornReset").onclick = async () => {
    if (!isDev) return;
    const say = sayIn($("#devBornMsg"));
    try { await saveProfile({ bornAt: "" }); renderBorn(); say("The wait is over. Change it in Account, or say yes to the sharing question."); }
    catch { say("It couldn't be reset. Try again."); }
  };
  function renderBorn() {
    $("#bornRow").hidden = !account;
    bornIn.set(born); $("#bornSave").hidden = !!bornIn.draw(); $("#bornClear").hidden = !born; syncBorn();
  }
