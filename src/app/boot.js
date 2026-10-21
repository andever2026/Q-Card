  // ---------- boot ----------
  //#if claude
  renderSetup();
  (async () => {
    const cl = window.claude;
    const gate = (title, sub) => { $("#gate").innerHTML = `<b>${title}</b>${sub}`; };
    if (!cl?.use) { gate("Open this page in claude.ai to use it", "You'll need to be signed in to claude.ai."); return; }
    [db, user, sample] = await Promise.all([cl.use("db"), cl.use("user"), cl.use("sample")]);
    if (user) {
      uid = await user.id();
      owner = await user.isOwner();
      const w = await user.can("data.write");
      canWrite = w == null ? await user.canEdit() : w;
    }
    if (!sample) banner("Handwriting checking needs Claude, which isn't available in this view. Open the page in claude.ai while signed in.");
    if (!db) { gate("Sign in to claude.ai to use this page", "Already signed in? Reload the page."); return; }
    document.body.classList.add("ready");
    cl.use("downloads").then((d) => { downloads = d; renderPort(); });
    db.collection("kanji").onSnapshot(onKanji, () => {});
    db.collection("sets").onSnapshot(onSets, () => banner("The vocab sets couldn't load. Reload the page to try again."));
    db.doc("meta/books").onSnapshot(onBookOrder, () => {});
    db.doc("meta/courses").onSnapshot(onCourses, () => {});
    // Visitors by link can't write to the database, so their history stays in their own browser.
    if (owner) { watchHistory(); syncPrefs(); } else if (uid) watchLocal();
  })();
  //#else
  renderSetup();
  (() => {
    if (!platform) { $("#gate").innerHTML = "<b>The page couldn't start</b>Reload it to try again."; return; }
    let started = null;
    const start = (id, store) => {
      started = uid = id;
      db = store; user = platform.user(uid); owner = canWrite = true; downloads = platform.downloads;
      document.body.classList.add("ready");
      renderPort();
      db.collection("kanji").onSnapshot(onKanji, () => {});
      db.collection("sets").onSnapshot(onSets, () => banner("Your vocab sets couldn't load. Reload the page to try again."));
      db.doc("meta/books").onSnapshot(onBookOrder, () => {});
      db.doc("meta/courses").onSnapshot(onCourses, () => {});
      watchHistory();
      if (id !== "local") stopPrefs = syncPrefs();
      offerSamples();
    };
    // As a guest, everything is kept in this browser (src/platform/local.js); choosing it in the welcome pop-up is remembered.
    startLocal = () => {
      start("local", platform.localDb());
      $("#histWhere").textContent = "Saved only in this browser";
    };
    platform.onAuth((u) => {
      // Signing in or out (here or in another tab) or switching accounts starts the page over.
      if (started) { if ((u?.uid || "local") !== started && (u || started !== "local")) location.reload(); return; }
      if (!u) {
        let guest = false;
        try { guest = localStorage.getItem("qcard:mode") === "local" || localStorage.getItem("qcard:welcomed") === "1"; } catch {}
        startLocal();
        if (!guest) welcome();
        return;
      }
      // Signing in leaves this browser's own data where it is; it's there again after "Use without signing in".
      try { localStorage.removeItem("qcard:mode"); } catch {}
      welcomed();
      account = u;
      start(u.uid, platform.db(u.uid));
      checkSiteOwner();
    });
  })();
  //#endif
