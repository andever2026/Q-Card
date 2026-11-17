  // ---------- the Browse page: shared notebooks their owners list for everyone (public site) ----------
  // A shared notebook is found only by its link, unless its owner also lists it (publish.js): then listed/<id> holds
  // its line here: its name, the owner's line about it and how much is in it. Nothing says whose it is. Anyone can read
  // the list, signed in or not; a line opens the same page the notebook's link does (preview.js), where it can be
  // added or reported. A notebook that is taken down loses its line (moderation.js).
  let browseList = null;
  async function openBrowse() {
    show("browse");
    browseList = null;
    $("#browseList").innerHTML = `<div class="empty">Loading…</div>`;
    try {
      const snap = await platform.listed.orderBy("updatedAt", "desc").limit(200).get();
      browseList = snap.docs.filter((d) => SHARE_RE.test(d.id)).map((d) => { const l = d.data(); return { id: d.id, name: tidy(l.name, 60) || NB_NAME, about: tidy(l.about, 200), sets: +l.sets || 0, words: +l.words || 0, at: l.updatedAt }; });
    } catch { $("#browseList").innerHTML = `<div class="empty"><b>The list couldn't load.</b><span>Check your connection, then open Browse again.</span></div>`; return; }
    renderBrowse();
  }
  function renderBrowse() {
    if (!browseList || $("#browse").hidden) return;
    const q = $("#browseSearch").value.trim().toLowerCase(), list = browseList.filter((l) => !q || `${l.name} ${l.about}`.toLowerCase().includes(q));
    const tag = (l) => (nbList().some((n) => n.share === l.id) ? "Yours" : nbList().some((n) => n.from === l.id) ? "Added" : "");
    $("#browseList").innerHTML = !browseList.length ? `<div class="empty"><b>No notebooks are listed yet.</b><span>To list one of yours, share it from the notebook menu and choose to list it here.</span></div>`
      : !list.length ? `<div class="empty"><b>No notebook matches that search.</b></div>`
      : list.map((l) => `<a class="bcard" href="#shared/${l.id}"><span class="bname"><b>${esc(l.name)}</b>${tag(l) ? `<span class="btag">${tag(l)}</span>` : ""}</span>
        ${l.about ? `<span class="babout">${esc(l.about)}</span>` : ""}<span class="muted small">${[plural(l.sets, "set"), plural(l.words, "word"), ...(isNaN(new Date(l.at)) ? [] : ["Updated " + dayText(l.at)])].join(" · ")}</span></a>`).join("");
  }
  $("#browseSearch").oninput = renderBrowse;
  // The list of notebooks loads after the page: which of these are here already shows once it has.
  vocabHooks.push(renderBrowse);
