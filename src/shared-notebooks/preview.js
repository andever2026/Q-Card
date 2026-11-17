  // ---------- the page a shared notebook's link opens (public site) ----------
  // …/#shared/<id> (page/address.js). Anyone can look through the notebook there, signed in or not; adding it to an
  // account needs a sign-in (linked.js does the adding). A visitor who signs in from here comes back to it afterwards:
  // the page starts over on signing in, so the id waits in this tab's session storage.
  // The id in the address, or of the notebook this page shows (a function, and its own note of that, because the
  // address is read while the page is still starting).
  function sharedId() { return location.hash.match(/^#shared\/([A-Za-z0-9]{20,40})$/)?.[1] || sharedId.at || ""; }
  let sharedNow = null;
  const sharedWait = (id) => { try { if (id) sessionStorage.setItem("qcard:shared", id); else sessionStorage.removeItem("qcard:shared"); } catch {} };
  async function openShared(id = sharedId()) {
    sharedId.at = id; sharedNow = null;
    show("shared");
    if (!account) sharedWait(id);
    $("#sharedHead").innerHTML = `<div class="head"><h2>Shared notebook</h2></div>`;
    $("#sharedBody").innerHTML = `<div class="empty">Loading…</div>`;
    // A notebook that was taken down after a report (report.js) can't be read, except by its owner and developers.
    let share = null, failed = false, down = false;
    try { share = await readShare(id); } catch (e) { down = e?.code === "permission-denied"; failed = !down; }
    if (share && account) share.down = await takenDown(id);
    if (sharedId.at !== id) return;
    if (!share) {
      $("#sharedBody").innerHTML = `<div class="empty"><b>${failed ? "This notebook couldn't load." : down ? "This notebook was taken down." : "This link doesn't work any more."}</b><span>${failed ? "Check your connection, then reload the page."
        : down ? "Its link doesn't work any more. If you added it before, you still have what you added." : "The notebook isn't shared now."}</span></div>`;
      return;
    }
    sharedNow = share; renderShared();
  }
  function renderShared() {
    const share = sharedNow;
    if (!share || $("#shared").hidden) return;
    const of = (c) => [...share.docs].filter(([p]) => p.startsWith(c + "/")).map(([p, d]) => ({ id: p.slice(c.length + 1), ...d }));
    const sets = of("sets").sort(sortSets), lists = of("kanji"), units = [...new Set(sets.map(unitKey))];
    const mine = nbList().find((n) => n.share === share.id), have = nbList().find((n) => n.from === share.id), here = mine || have;
    $("#sharedHead").innerHTML = `<div class="head"><h2>${esc(share.name)}</h2>${mine ? "" : `<div class="headr">${share.reported ? `<span class="muted small" id="sharedReported">Report sent. Thank you.</span>` : `<button class="link" type="button" id="sharedReport">Report this notebook</button>`}</div>`}</div>
      ${share.down ? `<div class="linknote">Taken down after a report: this link now works only for the notebook's owner and for developers.</div>` : ""}
      <p class="muted">A shared notebook: ${[plural(sets.length, "set"), plural(sets.reduce((n, s) => n + readyCount(s.words), 0), "word"), plural(lists.length, "kanji list")].join(" · ")}</p>
      ${here ? `<p>${mine ? "This is your notebook, as people who have the link see it." : "You've added this notebook."}</p><p class="tactions"><button class="btn primary" type="button" id="sharedOpen">Open it</button></p>`
      : account ? `<p class="tactions"><button class="btn primary" type="button" id="sharedAdd">Add to my notebooks</button><button class="btn" type="button" id="sharedCopy">Add as my own copy</button></p>
        <p class="muted small">Added to your notebooks, it keeps getting its owner's changes, and you can still change it yourself. A copy of your own stays as it is now.</p>`
      : `<p class="tactions"><button class="btn primary" type="button" id="sharedSignIn">Sign in to add it</button></p>
        <p class="muted small">You can look through it here. To practice with it, sign in and add it to your account.</p>`}`;
    $("#sharedBody").innerHTML = !sets.length ? `<div class="empty"><b>No vocab sets in it yet.</b></div>` : units.map((k) => {
      const us = sets.filter((s) => unitKey(s) === k), kl = lists.filter((l) => unitKey(l) === k).map((l) => l.kanji).join("");
      return `<div class="panel"><div class="head"><h2>${esc(unitPath(us[0], true))}</h2></div><div class="tscroll">${wordsTable(cardParts(us, true)).html}</div>
        ${kl ? `<p class="small"><span class="muted">Kanji: </span><span class="jp">${esc(kl)}</span></p>` : ""}</div>`; }).join("");
    const add = (linked) => async (e) => { e.target.disabled = true; if (await addShared(share, linked)) go("setup"); else e.target.disabled = false; };
    if ($("#sharedOpen")) $("#sharedOpen").onclick = () => { openNotebook(here.id); go("setup"); };
    if ($("#sharedAdd")) { $("#sharedAdd").onclick = add(true); $("#sharedCopy").onclick = add(false); }
    if ($("#sharedReport")) $("#sharedReport").onclick = async () => { if (await reportShared(share.id)) { share.reported = true; renderShared(); } };
    if ($("#sharedSignIn")) $("#sharedSignIn").onclick = (e) => signIn(e.target, (err) => banner(err || ""));
  }
  // The list of notebooks loads after the page: whether this one is here already shows once it has.
  vocabHooks.push(renderShared);
  // From boot, once someone is signed in: back to the shared notebook they were looking at before signing in.
  function resumeShared() {
    let id = "";
    try { id = sessionStorage.getItem("qcard:shared") || ""; } catch {}
    if (!account || !/^[A-Za-z0-9]{20,40}$/.test(id)) return;
    sharedWait(""); openShared(id);
  }
