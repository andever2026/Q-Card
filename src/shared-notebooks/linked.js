  // ---------- notebooks added from a shared one (public site) ----------
  // Someone who opens a shared notebook's link can add it to their account (preview.js). What they get is a notebook of
  // their own with the shared documents copied into it, so nothing of it depends on the shared copy staying there.
  // Added with its owner's changes, its line in the list keeps the shared copy's id as from, each set and kanji list
  // keeps what came from the owner beside it (base), and meta/link keeps the rest. When the notebook is opened and the
  // shared copy has changed, the owner's changes are merged in: a word, a set's details or a kanji list this person
  // changed stays as they have it, what they deleted stays deleted, and what they added is theirs. Added as a copy of
  // their own, or after "Keep it as my own copy", none of that is kept and nothing arrives any more.
  // A shared copy as it is now: { id, name, rev, docs (by path, cleaned: it's somebody else's writing) }, or null when
  // nothing is shared under that id. With the rev this person last merged, { same: true } when nothing changed since.
  async function readShare(id, rev) {
    const sh = platform.shared(id), info = dataOrNull(await sh.info.get());
    if (!info) return null;
    const now = (Array.isArray(info.rev) ? info.rev : []).join("\n");
    if (rev != null && rev === now) return { same: true };
    const v = await readVocab(sh.db), docs = new Map();
    for (const d of v.sets) { const c = cleanSet(d); if (c) docs.set("sets/" + d.id, c); }
    for (const d of v.kanji) { const c = cleanKanji(d); if (c) docs.set("kanji/" + d.id, c); }
    for (const [p, c] of [["meta/books", cleanBooks(v.books)], ["meta/views", cleanViews(v.views)], ["meta/courses", cleanCourses(v.courses)]]) if (c) docs.set(p, c);
    return { id, name: tidy(info.name, 60) || NB_NAME, rev: now, docs };
  }
  const metaPaths = ["meta/books", "meta/views", "meta/courses"];
  // meta/link: which shared copy, as of when (rev), every document it had (so one deleted here isn't brought back), and
  // its collection order and views (so this person's own changes to them can be told from the owner's).
  const linkDoc = (share) => ({ share: share.id, rev: share.rev, seen: [...share.docs.keys()], metas: JSON.stringify(Object.fromEntries(metaPaths.map((p) => [p, share.docs.get(p) || null]))) });
  // Adds a shared notebook to this account and opens it: linked to its owner's changes, or as a copy.
  async function addShared(share, linked) {
    const id = "n" + rid(), at = inNotebook(db, id), now = new Date().toISOString();
    if (nbList().length >= NB_MAX) { banner(`An account holds up to ${NB_MAX} notebooks. Delete one to add this.`); return false; }
    try {
      for (const [p, d] of share.docs) await at.doc(p).set({ ...d, ...(linked && !p.startsWith("meta/") ? { base: d } : {}), updatedAt: now });
      if (linked) await at.doc("meta/link").set(linkDoc(share));
    } catch { banner("Couldn't add that notebook. Try again."); return false; }
    if (!(await saveNotebooks([...nbList(), { id, name: nbFree(share.name), ...(linked ? { from: share.id } : {}) }]))) return false;
    pulled = `${id} ${share.id}`; // just copied: nothing to merge
    openNotebook(id);
    return true;
  }
  // The owner's set n merged into this person's t, which came as b.
  const mergeFields = (b, t, n, fields) => Object.fromEntries(fields.map((f) => [f, same(t[f] ?? null, b[f] ?? null) ? n[f] ?? null : t[f] ?? null]));
  function mergeSet(b, t, n) {
    const was = new Map(b.words.map((w) => [w.id, wordKey(w)])), now = new Map(n.words.map((w) => [w.id, w])), have = new Set(t.words.map((w) => w.id));
    // Their own words and the ones they changed stay; an untouched one follows the owner's (changed, or taken out); the owner's new words go at the end.
    const words = t.words.flatMap((w) => (!was.has(w.id) || wordKey(w) !== was.get(w.id) ? [w] : now.has(w.id) ? [now.get(w.id)] : []));
    return { ...mergeFields(b, t, n, ["collection", "unit", "name"]), tags: (same(t.tags ?? [], b.tags ?? []) ? n.tags : t.tags) ?? [],
      words: [...words, ...n.words.filter((w) => !was.has(w.id) && !have.has(w.id))] };
  }
  async function mergeShare(at, share, link) {
    const now = new Date().toISOString(), seen = new Set(link.seen || []), mine = new Map(), base = new Map();
    for (const [c, list, clean] of [["sets", raw.sets, cleanSet], ["kanji", raw.kanji, cleanKanji]]) for (const d of list) {
      mine.set(`${c}/${d.id}`, clean(d));
      if (d.base) base.set(`${c}/${d.id}`, clean({ ...d.base, id: d.id }));
    }
    for (const [p, n] of share.docs) {
      if (p.startsWith("meta/")) continue;
      const t = mine.get(p), b = base.get(p);
      // New from the owner (one this person deleted stays deleted); one of their own under the same id stays theirs.
      if (!t) { if (!seen.has(p)) await at.doc(p).set({ ...n, base: n, updatedAt: now }); continue; }
      if (!b || same(b, n)) continue;
      await at.doc(p).update({ ...(p.startsWith("sets/") ? mergeSet(b, t, n) : mergeFields(b, t, n, ["collection", "unit", "kanji"])), base: n, updatedAt: now });
    }
    // What the owner took out goes, unless this person changed it: then it stays, as theirs.
    for (const [p, b] of base) if (!share.docs.has(p)) await (same(mine.get(p), b) ? at.doc(p).delete() : at.doc(p).update({ base: null }));
    // The collection order and the views follow the owner's while this person hasn't changed them.
    let was = {};
    try { was = JSON.parse(link.metas || "{}"); } catch {}
    const have = { "meta/books": cleanBooks(raw.books), "meta/views": cleanViews(raw.views), "meta/courses": cleanCourses(raw.courses) };
    for (const p of metaPaths) {
      const n = share.docs.get(p) || null, b = was[p] || null;
      if (!same(n, b) && same(have[p], b)) await (n ? at.doc(p).set({ ...n, updatedAt: now }) : at.doc(p).delete());
    }
    await at.doc("meta/link").set(linkDoc(share));
  }
  // Once each time a linked notebook is opened and its vocab has loaded.
  let pulled = "", pullTimer = 0, linkGone = false;
  async function pullShare() {
    const n = nbNow(), key = `${n?.id} ${n?.from}`;
    if (!n?.from || !account || !S.loaded || !S.kLoaded || pulled === key) return;
    pulled = key; linkGone = false;
    const at = inNotebook(db, n.id);
    try {
      const link = dataOrNull(await at.doc("meta/link").get()) || {}, share = await readShare(n.from, link.rev || "");
      if (nb !== n.id) return;
      linkGone = !share;
      if (share && !share.same) await mergeShare(at, share, link);
    } catch (e) { if (e?.code === "permission-denied") linkGone = true; else pulled = ""; } // offline, say: tried again at the next change
    renderLink();
  }
  // The line over the vocab table that says what a linked notebook is.
  function renderLink() {
    const n = nbNow(), box = $("#linkNote");
    box.hidden = !n?.from;
    if (box.hidden) return;
    box.innerHTML = `<span>${linkGone ? "The notebook this was added from isn't shared any more, so nothing in it will change again."
      : "This notebook was added from a shared one. Its owner's changes arrive when you open it."} <span class="ownkey">Tinted words</span> are ones you changed or added: they stay as you have them.</span>
      <button class="link" type="button" id="ownCopyBtn">Keep it as my own copy</button>`;
    $("#ownCopyBtn").onclick = ownCopy;
  }
  vocabHooks.push(() => { renderLink(); clearTimeout(pullTimer); pullTimer = setTimeout(pullShare, 600); });
  // Cuts the notebook loose from the shared copy: everything in it is this person's, and nothing arrives any more.
  async function ownCopy() {
    const { from, ...rest } = nbNow(), at = inNotebook(db, rest.id);
    if (!(await ask("Keep this as your own copy?", `<p>The owner's changes stop arriving, and everything in this notebook counts as yours. To get their changes again, you would add the shared notebook again.</p>`, "Keep my own copy"))) return;
    try {
      for (const [c, list] of [["sets", raw.sets], ["kanji", raw.kanji]]) for (const d of list) if (d.base) await at.doc(`${c}/${d.id}`).update({ base: null });
      await at.doc("meta/link").delete();
    } catch { return banner("Couldn't do that. Try again."); }
    await saveNb(rest);
  }
