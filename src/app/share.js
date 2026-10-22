  // ---------- public site: sharing handwriting to train the checker ----------
  // For dev accounts only for now (Annie, 2026-10-22: no "give us your data" while the site is a demo with few users; the
  // tool comes first). Everyone else gets no question and no Settings section, and an earlier yes saves nothing. To offer
  // it to everyone again, set SHARE_FOR_ALL to true.
  // Opt-in (Annie): after every 10th finished practice, a signed-in person who hasn't said yes is asked whether their
  // handwriting may be kept to tune and train the checker. The first time there's no "Don't ask me again"; from the
  // second time there is. With sharing on, each checked answer is saved to users/<uid>/training/<id>: its strokes
  // (points, timing, pressure, pointer kind), the word and direction, the checker's verdict and the student's own call.
  // Only the account itself (and the site's owner, through Firebase) can read it. The pop-up says it may go into products
  // offered to others and goes with the site if it becomes or joins a company (Annie's plans, 2026-10-21). Settings turns
  // sharing off and deletes what was shared (models already trained on it stay); deleting the account deletes it too. The choice and counts live in the synced choices:
  // share = { on, at, asked, never, n }, practices = finished practices.
  const SHARE_EVERY = 10, SHARE_FOR_ALL = false;
  // Dev tools and (for now) sharing: only for developers (dev/<uid> in Firestore, see firestore.rules).
  let isDev = false;
  const offered = () => !!account && (SHARE_FOR_ALL || isDev);
  const shareState = () => store.get("share", null) || {};
  const setShare = (o) => store.set("share", { ...shareState(), ...o });
  const sharing = () => offered() && shareState().on === true;
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

  // After each finished practice: count it, and on every 10th ask (offered, not sharing, not "don't ask again").
  function afterPractice() {
    const done = (+store.get("practices", 0) || 0) + 1, s = shareState();
    store.set("practices", done);
    if (offered() && !s.on && !s.never && done % SHARE_EVERY === 0) { askShare(done); setShare({ asked: (s.asked || 0) + 1 }); }
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

  // Settings → Help train the checker (wherever it's offered).
  let shareDelAsk = false;
  $("#settings").addEventListener("close", () => { shareDelAsk = false; });
  function renderShare() {
    $("#devSet").hidden = !isDev;
    $("#shareSet").hidden = !offered();
    if (!offered()) return;
    const s = shareState(), n = s.n || 0, when = s.at && !isNaN(new Date(s.at)) ? new Date(s.at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
    $("#shareInfo").textContent = s.on
      ? `On${when ? " since " + when : ""}. ${n} ${n === 1 ? "answer" : "answers"} shared: the strokes, the word and how it was marked, kept to build better handwriting recognition.`
      : `Off. Turn it on to let your handwriting help train the checker.${n ? ` ${n} ${n === 1 ? "answer is" : "answers are"} still kept from before.` : ""}`;
    $("#shareToggle").textContent = s.on ? "Turn off" : "Turn on…";
    $("#shareDl").hidden = !n || shareDelAsk;
    $("#shareDel").hidden = !n || shareDelAsk;
    $("#shareDelAsk").hidden = !shareDelAsk;
  }
  $("#shareToggle").onclick = () => { if (shareState().on) { setShare({ on: false }); renderShare(); } else askShare(0); };
  // Dev tools: to see the question as people get it.
  const checkDev = async () => {
    const uid = account?.uid; isDev = false; renderShare(); // nothing carried over from the last account while it asks
    isDev = !!uid && (await platform.isDev(uid)) && account?.uid === uid; renderShare();
  };
  $("#devAsk1").onclick = () => askShare(SHARE_EVERY, false);
  $("#devAsk2").onclick = () => askShare(2 * SHARE_EVERY, true);
  // Everything shared, as one JSON file, oldest answer first: each with its strokes and their timing, so writing can be
  // replayed at its real speed (Annie wants her own in the promo video).
  $("#shareDl").onclick = async (e) => {
    e.target.disabled = true;
    try {
      const answers = (await db.collection("training").get()).docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.at).localeCompare(String(b.at)));
      await downloads.save({ filename: `japanese-vocab-handwriting-${new Date().toLocaleDateString("en-CA")}.json`,
        data: JSON.stringify({ app: APP, kind: "handwriting", version: 1, exportedAt: new Date().toISOString(), answers }) });
    } catch (err) { if (err?.code !== "declined") banner("Your shared answers couldn't be downloaded. Try again."); }
    e.target.disabled = false;
  };
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
