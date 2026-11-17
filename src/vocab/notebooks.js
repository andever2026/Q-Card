  // ---------- notebooks: the one that's open, and the menu at the top of the sidebar ----------
  // What a notebook is and where its documents are: vocab/docs.js. The page shows one at a time (nb, page/core.js):
  // Practice, Vocabulary, Export and Import are all that notebook's. Progress and Settings are the whole account's.
  // The menu lists them and opens one; whoever can change the vocab can also add, rename and delete.
  const nbList = () => S.notebooks || [{ id: MAIN_NB, name: NB_NAME }];
  const nbName = (id = nb) => nbList().find((n) => n.id === id)?.name ?? NB_NAME;
  const nbRef = () => db.doc("meta/notebooks");
  // Whether the list has loaded, for what mustn't write into a notebook this account may not have (the sample sets).
  let nbLoaded = () => {};
  const nbReady = new Promise((ok) => (nbLoaded = ok));
  function watchNotebooks() {
    nbRef().onSnapshot((snap) => {
      S.notebooks = cleanNotebooks(dataOrNull(snap));
      // The open one may be gone (deleted on another device, or remembered by this browser from another account): the first opens.
      if (!openNotebook(nb)) renderNotebooks();
      nbLoaded();
    }, () => nbLoaded());
  }
  // Opens a notebook: its vocab and its own choices replace what the page holds. false when that one is open already.
  function openNotebook(id) {
    if (S.notebooks && !S.notebooks.some((n) => n.id === id)) id = S.notebooks[0].id;
    if (id === nb) return false;
    nb = id; kept.set("notebook", id);
    Object.assign(S, { sets: [], loaded: false, kanjiLists: [], kLoaded: false, colOrder: [], courses: [], viewDoc: null, colEdit: null, editNew: null,
      confirmDel: null, kConfirmDel: null, leaveAsk: false, formCol: null, oldBooks: null, tableBook: null, tableCh: null, tq: "", kAll: false, tAll: false });
    Object.assign(raw, { sets: [], kanji: [], books: null, courses: null, views: null });
    for (const k of ["drafts", "kdrafts", "openSets", "touched"]) S[k].clear();
    $("#tSearch").value = "";
    readPicks();
    if (db) watchVocab();
    renderNotebooks();
    // Results are of a practice from the notebook before: back to Practice. Any other part shows the new notebook.
    if (!$("#results").hidden) show("setup");
    renderSetup(); renderTable();
    if (!$("#history").hidden) renderHistory();
    if (!$("#settings").hidden) renderSettings();
    return true;
  }
  // Saves the list (shown at once; the saved copy comes back through watchNotebooks). false if it couldn't be saved.
  async function saveNotebooks(list) {
    const was = S.notebooks;
    S.notebooks = list; renderNotebooks();
    try { await nbRef().set({ list, updatedAt: new Date().toISOString() }); return true; }
    catch { S.notebooks = was; renderNotebooks(); banner("Couldn't save that. Try again."); return false; }
  }
  // Every document of one notebook, deleted (its line in the list is the caller's). Deleting an account uses it too.
  async function emptyNotebook(id) {
    const at = inNotebook(db, id);
    for (const c of ["sets", "kanji"]) for (const d of (await at.collection(c).get()).docs) await at.doc(`${c}/${d.id}`).delete();
    for (const p of ["meta/books", "meta/courses", "meta/views"]) await at.doc(p).delete();
  }
  // A name typed into the page's pop-up: "" when it's cancelled or left empty. A name another notebook has gets a number.
  async function askNbName(title, yes, was = "") {
    const answer = ask(title, `<input class="tsearch" id="nbNameIn" maxlength="60" aria-label="Notebook name" placeholder="Japanese 2" value="${esc(was)}">`, yes);
    const inp = $("#nbNameIn");
    inp.focus(); inp.select();
    inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $("#askYes").click(); } }; // Enter would press Cancel, the pop-up's first button
    const typed = (await answer) ? tidy(inp.value, 56) : "", taken = (t) => nbList().some((n) => sameName(n.name, t) && !sameName(n.name, was));
    let name = typed;
    for (let i = 2; name && taken(name); i++) name = `${typed} ${i}`;
    return name;
  }
  async function addNotebook() {
    const name = await askNbName("New notebook", "Create");
    if (!name) return;
    const id = "n" + rid();
    if (await saveNotebooks([...nbList(), { id, name }])) openNotebook(id);
  }
  async function renameNotebook() {
    const name = await askNbName("Rename this notebook", "Rename", nbName());
    if (name && name !== nbName()) saveNotebooks(nbList().map((n) => (n.id === nb ? { ...n, name } : n)));
  }
  async function deleteNotebook() {
    const id = nb, rest = nbList().filter((n) => n.id !== id);
    if (!rest.length) return;
    const holds = [S.sets.length && plural(S.sets.length, "set"), S.kanjiLists.length && plural(S.kanjiLists.length, "kanji list")].filter(Boolean).join(" and ");
    if (!(await ask(`Delete “${nbName()}”?`, `<p>${holds ? `This notebook and its ${holds} are deleted for good. Export it first if you want a copy.` : "This notebook is empty."}</p>`, "Delete notebook", true))) return;
    try { await emptyNotebook(id); } catch { return banner("Couldn't delete all of that notebook. Try again."); }
    if (!(await saveNotebooks(rest))) return;
    // Its own choices go with it.
    if (id === MAIN_NB) NB_KEYS.forEach((k) => kept.set(k, null)); else { const all = { ...kept.get("nbPicks", null) }; delete all[id]; kept.set("nbPicks", all); }
    openNotebook(rest[0].id);
  }
  // Opening another one from the vocab table asks about unsaved changes first, as leaving the table any other way does.
  function pickNotebook(id) {
    if (id === nb) return;
    if (!$("#table").hidden) leaveTable(() => { openNotebook(id); show("table"); }); else openNotebook(id);
  }
  const nbMenu = makeMenu($("#nbPick"), $("#nbBtn"), $("#nbList")); // page/menu.js
  function renderNotebooks() {
    const list = nbList(), icon = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
    $("#nbName").textContent = nbName();
    // Headings over what is the open notebook's alone (its hard words in Progress, its counts and Export / Import in Settings) name it once there's more than one.
    document.querySelectorAll(".nbin").forEach((e) => (e.textContent = list.length < 2 ? "" : ` in ${nbName()}`));
    $("#nbBtn").setAttribute("aria-label", `Notebook: ${nbName()}`);
    if ($("#nbBtn").title) $("#nbBtn").title = nbName(); // shown only while the sidebar is shrunk to its icons (page/nav.js)
    $("#nbList").innerHTML = `<p class="small muted">Notebooks</p>
      ${list.map((n) => `<button type="button" role="menuitemradio" aria-checked="${n.id === nb}" data-nb="${esc(n.id)}">${icon(n.id === nb ? "M5 12.5 L10 17.5 L19 7" : "")}${esc(n.name)}</button>`).join("")}
      ${canWrite && db ? `<hr><button type="button" role="menuitem" data-nb-do="add">${icon("M12 5 V19 M5 12 H19")}New notebook</button>
      <button type="button" role="menuitem" data-nb-do="rename">${icon("M4.5 19.5 L5.3 15.7 L15.4 5.6 a2 2 0 0 1 2.8 0 l.2 .2 a2 2 0 0 1 0 2.8 L8.3 18.7Z")}Rename this notebook</button>
      ${list.length > 1 ? `<button type="button" role="menuitem" class="danger" data-nb-do="delete">${icon("M4 7 H20 M9.5 7 V4.5 H14.5 V7 M6.5 7 L7.3 19.5 H16.7 L17.5 7")}Delete this notebook</button>` : ""}` : ""}`;
    const act = { add: addNotebook, rename: renameNotebook, delete: deleteNotebook };
    $("#nbList").querySelectorAll("button").forEach((b) => (b.onclick = () => { nbMenu(false); menu(false); if (b.dataset.nb) pickNotebook(b.dataset.nb); else act[b.dataset.nbDo](); }));
  }
  renderNotebooks();
