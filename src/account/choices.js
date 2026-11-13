  // ---------- choices that follow the account ----------
  // On load the account's copy of the choices replaces this browser's (a first sign-in saves this browser's instead),
  // and each later change is saved back shortly after it's made. Returns a function that stops the saving.
  // loaded() runs once the account's choices are in this browser (or, for a new account, sent up from it).
  function syncPrefs(loaded = () => {}) {
    const ref = db.doc(`data/users/${uid}/prefs`);
    let first = true, timer = null, stopped = false;
    // Firestore refuses a whole document with an empty field name, and sets with no collection are under "" in bookShow and tShow:
    // that one row's choice stays in this browser.
    const named = (v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([k]) => k)) : v);
    const save = () => {
      clearTimeout(timer); timer = null;
      if (stopped) return;
      const p = Object.fromEntries(PREF_KEYS.map((k) => [k, named(store.get(k, null))]).filter(([, v]) => v != null));
      Promise.resolve().then(() => ref.set({ ...p, updatedAt: new Date().toISOString() })).catch(() => {});
    };
    const off = ref.onSnapshot((snap) => {
      if (!first) return;
      first = false; setTimeout(() => typeof off === "function" && off(), 0);
      // A yes to sharing handwriting left in this browser is another account's, so a first sign-in doesn't take it along.
      if (snap.exists) usePrefs(snap.data() || {}); else { store.set("share", null); save(); }
      prefsChanged = () => { clearTimeout(timer); timer = setTimeout(save, 800); };
      loaded();
      const flush = () => { if (timer) save(); };
      addEventListener("pagehide", flush);
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
    }, () => {});
    return () => { stopped = true; clearTimeout(timer); prefsChanged = () => {}; };
  }
  function usePrefs(p) {
    // A practice to resume is the account's, or none: one left in this browser may be from another account or already finished elsewhere.
    // So is the answer to sharing handwriting: only the account's own yes counts.
    for (const k of PREF_KEYS) if (p[k] != null || k === "resume" || k === "share") store.set(k, p[k] ?? null);
    S.selected = new Set(store.get("selected", []));
    Object.assign(S.pick, { show: store.get("bookShow", null), picks: new Set(store.get("pickChs", [])) });
    Object.assign(S.tpick, { show: store.get("tShow", null), picks: new Set(store.get("tChs", [])) });
    S.groupBy = store.get("groupBy", "main");
    S.pickTags = new Set(store.get("pickTags", []));
    S.dir = store.get("dir", "ej"); S.mode = store.get("mode", "default"); S.upto = store.get("uptoPick", "auto");
    S.loveWin = String(store.get("loveWin", "10")); S.sessPer = String(store.get("sessPer", "20")); S.loveTop = store.get("loveTop", "jp") === "en" ? "en" : "jp";
    setPalette(store.get("palette", "indigo"));
    setTheme(store.get("theme", ""));
    renderSetup(); renderTable();
  }
