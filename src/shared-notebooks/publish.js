  // ---------- sharing a notebook by link: its owner's side (public site) ----------
  // A shared notebook has a copy of its documents under shares/<id> (account/firebase.js and firestore.rules: anyone who
  // has the id can read the copy, only the owner can write it), and its line in the list of notebooks keeps that id as
  // share. Whatever changes in the notebook is copied over a moment later, so the link always shows the notebook as it
  // is, and people who added it get the changes (linked.js). Only the notebook is copied: its sets, kanji lists,
  // collection order and views. Nothing of the account goes with it.
  const shareLink = (id) => `${location.origin}${location.pathname}#shared/${id}`;
  // Long and random: having the link is what lets someone read the copy.
  const newShareId = () => [...crypto.getRandomValues(new Uint8Array(24))].map((b) => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"[b % 56]).join("");
  // A document's fingerprint: enough to tell that it changed. shares/<id> lists one per document ("path fingerprint").
  const docStamp = (d) => { const s = JSON.stringify(d); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return `${h.toString(36)}.${s.length.toString(36)}`; };
  const revOf = (list) => new Map((Array.isArray(list) ? list : []).map((x) => String(x).split(" ")).filter((x) => x.length === 2));
  // The open notebook's documents as its shared copy holds them, by path (what Export writes, without rows left blank).
  function shareDocs() {
    const v = vocabNow(), docs = new Map();
    for (const { id, ...d } of v.sets) docs.set("sets/" + id, { ...d, words: d.words.filter(wordReady) });
    for (const { id, ...d } of v.kanji) docs.set("kanji/" + id, d);
    for (const [p, d] of [["meta/books", v.collections], ["meta/views", v.views], ["meta/courses", v.courses]]) if (d) docs.set(p, d);
    return docs;
  }
  // Brings the shared copy up to date with the open notebook: the documents that changed are written, the ones that are
  // gone deleted, then shares/<id> says what the copy holds now.
  let shareAt = "", shareRev = new Map(), shareName = "", shareBusy = false, shareAgain = false, shareTimer = 0;
  async function syncShare() {
    const n = nbNow(), id = n?.share;
    if (!id || !account || !S.loaded || !S.kLoaded) return;
    if (shareBusy) { shareAgain = true; return; }
    shareBusy = true;
    try {
      const sh = platform.shared(id), docs = shareDocs(), next = new Map([...docs].map(([p, d]) => [p, docStamp(d)]));
      if (shareAt !== id) { const info = dataOrNull(await sh.info.get()); shareRev = revOf(info?.rev); shareName = info?.name ?? null; shareAt = id; }
      const put = [...next.keys()].filter((p) => shareRev.get(p) !== next.get(p)), gone = [...shareRev.keys()].filter((p) => !next.has(p));
      if (put.length || gone.length || shareName !== n.name) {
        for (const p of put) await sh.db.doc(p).set(docs.get(p));
        for (const p of gone) await sh.db.doc(p).delete();
        await sh.info.set({ name: n.name, rev: [...next].map(([p, h]) => `${p} ${h}`), updatedAt: new Date().toISOString() });
        shareRev = next; shareName = n.name;
      }
    } catch { shareAt = ""; } // the copy is read again, and brought up to date, at the next change
    shareBusy = false;
    if (shareAgain) { shareAgain = false; shareSoon(); }
  }
  const shareSoon = () => { clearTimeout(shareTimer); shareTimer = setTimeout(syncShare, 1500); };
  vocabHooks.push(shareSoon);
  // Shares the open notebook: "" if it couldn't be.
  async function startShare() {
    const id = newShareId(), sh = platform.shared(id), n = nbNow(), now = new Date().toISOString();
    try { await sh.owner.set({ uid, nb: n.id, createdAt: now }); await sh.info.set({ name: n.name, rev: [], updatedAt: now }); }
    catch { banner("Couldn't share it. Try again."); return ""; }
    if (!(await saveNb({ ...n, share: id }))) { dropShare(id).catch(() => {}); return ""; }
    await syncShare();
    return id;
  }
  // A shared copy, deleted: its link stops working. (The notebook's line in the list is the caller's.)
  async function dropShare(id) {
    const sh = platform.shared(id);
    if (!(await sh.owner.get().catch(() => null))?.exists) return; // gone already
    await emptyVocab(sh.db); await sh.info.delete(); await sh.owner.delete();
    if (shareAt === id) shareAt = "";
  }
  // A notebook that's deleted (or the whole account) takes its shared copy with it.
  nbGone.push(async (id) => { const share = nbList().find((n) => n.id === id)?.share; if (share) await dropShare(share); });
  async function stopShare() {
    const { share, ...rest } = nbNow();
    try { await dropShare(share); } catch { return banner("Couldn't stop sharing. Try again."); }
    await saveNb(rest);
  }
  // "Share this notebook" in the notebook menu: asks first, then shows the link, with Copy and Stop sharing.
  async function shareDialog() {
    if (!nbNow().share) {
      const ok = await ask(`Share “${nbNow().name}”`, `<p>Sharing makes a link. Anyone who has it can look at this notebook's sets and kanji lists and add them to their own account, and what you change here later reaches them too.</p>
        <p class="muted small">Only the notebook is shared, not your progress, your settings or your other notebooks.</p>`, "Create link");
      if (!ok || !(await startShare())) return;
    }
    const id = nbNow().share;
    const closed = ask(`“${nbNow().name}” is shared`, `<p>Anyone who has this link can look at it and add it to their own account.</p>
      <input class="tsearch" id="shareLinkIn" readonly aria-label="Link" value="${esc(shareLink(id))}">
      <p class="tactions sharedo"><button class="btn" type="button" id="shareCopy">Copy link</button><button class="link" type="button" id="shareStop">Stop sharing</button></p>`, "Done");
    let stop = false;
    $("#shareLinkIn").onfocus = (e) => e.target.select();
    $("#shareCopy").onclick = async (e) => { try { await navigator.clipboard.writeText(shareLink(id)); e.target.textContent = "Copied"; } catch { $("#shareLinkIn").focus(); } };
    $("#shareStop").onclick = () => { stop = true; $("#askDlg").close("no"); };
    await closed;
    if (stop && await ask(`Stop sharing “${nbNow().name}”?`, `<p>The link stops working. People who already added this notebook keep what they have, and get no more changes from you.</p>`, "Stop sharing", true)) await stopShare();
  }
  // (Not a notebook that was added from somebody else's shared one: that one is its owner's to share.)
  nbMore.push({ key: "share", label: () => (nbNow()?.share ? "Shared: link and options" : "Share this notebook"), icon: "M8.6 13.5 L15.4 17.5 M15.4 6.5 L8.6 10.5 M21 5 a3 3 0 1 1 -6 0 a3 3 0 0 1 6 0 M9 12 a3 3 0 1 1 -6 0 a3 3 0 0 1 6 0 M21 19 a3 3 0 1 1 -6 0 a3 3 0 0 1 6 0",
    run: shareDialog, when: () => !!account && !nbNow()?.from });
