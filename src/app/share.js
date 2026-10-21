  // ---------- public site: sharing handwriting to train the checker ----------
  // Opt-in (the owner): after every 10th finished practice, a signed-in person who hasn't said yes is asked whether their
  // handwriting may be kept to tune and train the checker. The first time there's no "Don't ask me again"; from the
  // second time there is. With sharing on, each checked answer is saved to users/<uid>/training/<id>: its strokes
  // (points, timing, pressure, pointer kind), the word and direction, the checker's verdict and the student's own call.
  // Only the account itself (and the site's owner, through Firebase) can read it. Settings turns sharing off and deletes
  // what was shared; deleting the account deletes it too. The choice and counts live in the synced choices:
  // share = { on, at, asked, never, n }, practices = finished practices.
  const SHARE_EVERY = 10;
  const shareState = () => store.get("share", null) || {};
  const setShare = (o) => store.set("share", { ...shareState(), ...o });
  const sharing = () => !!account && shareState().on === true;
  let shareId = null; // the saved record of the answer on screen, which the student's own marking updates

  // A box's strokes as Firestore can store them (flat lists only): xy = x, y, x, y…; t = ms from the stroke's start;
  // f = pressure; at = ms from the answer's first stroke; dev = pen, touch or mouse.
  function strokeData(pad) {
    const sts = pad.strokes.filter((st) => st.length && st !== pad.cur), first = Math.min(...sts.map((st) => st.t0 ?? Infinity));
    return { w: Math.round(pad.w), h: Math.round(pad.h), s: sts.map((st) => ({ xy: flatXY(st),
      ...(st.ts ? { t: st.ts, f: st.fs, at: Math.round(st.t0 - first), dev: st.dev || "" } : {}) })) };
  }
  // Called once the checker has had its say: right, wrong, unmatched (日本語 → English worded differently) or unread.
  function shareAnswer(verdict, r) {
    shareId = null;
    if (!sharing() || !Q.cur || main.empty) return;
    const { w, dir } = Q.cur, id = "a" + Date.now().toString(36) + rid();
    const doc = { v: 1, at: new Date().toISOString(), dir, mode: S.mode, word: { en: w.en || "", kana: w.kana || "", kanji: w.kanji || "" },
      checker: { verdict, read: r?.main || "", furigana: r?.furigana || "", reason: r?.reason || "" }, student: "",
      main: strokeData(main), furi: strokeData(furi), dpr: window.devicePixelRatio || 1 };
    shareId = id;
    db.doc("training/" + id).set(doc).then(() => setShare({ n: (shareState().n || 0) + 1 })).catch(() => {});
  }
  // The student's own call on that answer: right or missed (self-marking), or misread (the checker got it wrong).
  const shareMark = (student) => { if (shareId) db.doc("training/" + shareId).update({ student }).catch(() => {}); shareId = null; };
  $("#selfGot").addEventListener("click", () => shareMark("right"));
  $("#selfMiss").addEventListener("click", () => shareMark("missed"));
  $("#overrideBtn").addEventListener("click", () => shareMark("misread"));

  // After each finished practice: count it, and on every 10th ask (signed in, not sharing, not "don't ask again").
  function afterPractice() {
    const done = (+store.get("practices", 0) || 0) + 1, s = shareState();
    store.set("practices", done);
    if (account && !s.on && !s.never && done % SHARE_EVERY === 0) { askShare(done); setShare({ asked: (s.asked || 0) + 1 }); }
  }
  // done = practices finished (0 when opened from Settings); again = offer "Don't ask me again", which it does from the
  // second time it's asked after a practice.
  function askShare(done, again = !!done && (shareState().asked || 0) > 0) {
    $("#shareCount").textContent = done ? `You've finished ${done} practices! ` : "";
    $("#shareNeverRow").hidden = !again;
    $("#shareNever").checked = false;
    $("#shareAsk").showModal();
  }
  $("#shareYes").onclick = () => { setShare({ on: true, at: new Date().toISOString(), never: false }); $("#shareAsk").close(); renderShare(); };
  $("#shareNo").onclick = () => { if (!$("#shareNeverRow").hidden && $("#shareNever").checked) setShare({ never: true }); $("#shareAsk").close(); };

  // Settings → Help train the checker (signed in only).
  let shareDelAsk = false;
  $("#settings").addEventListener("close", () => { shareDelAsk = false; });
  function renderShare() {
    $("#ownerSet").hidden = !siteOwner;
    $("#shareSet").hidden = !account;
    if (!account) return;
    const s = shareState(), n = s.n || 0, when = s.at && !isNaN(new Date(s.at)) ? new Date(s.at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
    $("#shareInfo").textContent = s.on
      ? `On${when ? " since " + when : ""}. ${n} ${n === 1 ? "answer" : "answers"} shared: the strokes, the word and how it was marked, kept to tune and train the checker.`
      : `Off. Turn it on to let your handwriting help train the checker.${n ? ` ${n} ${n === 1 ? "answer is" : "answers are"} still kept from before.` : ""}`;
    $("#shareToggle").textContent = s.on ? "Turn off" : "Turn on…";
    $("#shareDel").hidden = !n || shareDelAsk;
    $("#shareDelAsk").hidden = !shareDelAsk;
  }
  $("#shareToggle").onclick = () => { if (shareState().on) { setShare({ on: false }); renderShare(); } else askShare(0); };
  // Owner tools: only for the site's owner (owners/<uid> in Firestore, see firestore.rules), to see the question as people get it.
  let siteOwner = false;
  const checkSiteOwner = async () => { siteOwner = !!account && (await platform.isSiteOwner(account.uid)); renderShare(); };
  $("#ownAsk1").onclick = () => askShare(SHARE_EVERY, false);
  $("#ownAsk2").onclick = () => askShare(2 * SHARE_EVERY, true);
  $("#shareDel").onclick = () => { shareDelAsk = true; renderShare(); };
  $("#shareDelNo").onclick = () => { shareDelAsk = false; renderShare(); };
  $("#shareDelYes").onclick = async (e) => {
    e.target.disabled = true;
    try {
      for (const d of (await db.collection("training").get()).docs) await db.doc("training/" + d.id).delete();
      setShare({ n: 0 });
    } catch { banner("Some shared answers couldn't be deleted. Try again."); }
    e.target.disabled = false; shareDelAsk = false; renderShare();
  };
