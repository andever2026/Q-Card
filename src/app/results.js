  // ---------- results ----------
  function finish() {
    store.set("resume", null);
    const rows = Q.items.map((it) => ({ it, n: Q.tries[it.key] || 1 }));
    $("#rWords").textContent = rows.length;
    $("#rFirst").textContent = rows.filter((r) => r.n === 1).length;
    $("#rTries").textContent = rows.reduce((a, r) => a + r.n, 0);
    const love = rows.filter((r) => r.n > 1).sort((a, b) => b.n - a.n);
    const label = (it) => it.dir === "ej" ? jpForm(it.w) : it.w.en;
    $("#lovePanel").hidden = !love.length;
    Q.rows = rows; Q.skip = new Set(); Q.savedId = null;
    // With history on, each missed word can be left off the overall "need the most love" list.
    const canSkip = S.histOn === true;
    $("#loveList").innerHTML = love.map(({ it, n }) => `<li data-key="${esc(it.key)}"><span class="tries">${n}</span><div><div class="w">${esc(jpForm(it.w))}<small>${esc(it.w.en)}${Q.meta.dir === "both" ? (it.dir === "ej" ? " · EN→JP" : " · JP→EN") : ""}</small></div><p>You figured out ${esc(label(it))} in ${n} tries!</p></div>${canSkip ? `<button class="ghost small skipw" type="button" aria-pressed="false">Leave off overall list</button>` : ""}</li>`).join("");
    $("#skipAll").hidden = !canSkip; syncSkip();
    const firsts = rows.filter((r) => r.n === 1);
    $("#firstPanel").hidden = !firsts.length;
    $("#firstList").textContent = firsts.map(({ it }) => jpForm(it.w)).join("、");
    $("#againBtn").hidden = !love.length;
    Q.love = love.map((r) => r.it.w);
    show("results");
    saveResult(rows);
    //#if public
    afterPractice();
    //#endif
  }
  // Which missed words stay off the overall list: the buttons show it, and the saved session carries skip: true on them.
  function syncSkip() {
    const lis = [...document.querySelectorAll("#loveList li")];
    lis.forEach((li) => {
      const on = Q.skip.has(li.dataset.key), b = li.querySelector(".skipw");
      li.classList.toggle("skipped", on);
      if (b) { b.setAttribute("aria-pressed", on); b.textContent = on ? "✓ Left off overall list" : "Leave off overall list"; }
    });
    $("#skipAll").textContent = lis.length && lis.every((li) => Q.skip.has(li.dataset.key)) ? "Add all back" : "Leave all off the overall list";
  }
  function setSkip(keys, on) {
    keys.forEach((k) => (on ? Q.skip.add(k) : Q.skip.delete(k)));
    syncSkip();
    if (Q.savedId) saveResult(Q.rows, Q.savedId); // already saved: rewrite it with the new choices
  }
  $("#loveList").addEventListener("click", (e) => { const b = e.target.closest(".skipw"); if (b) { const k = b.closest("li").dataset.key; setSkip([k], !Q.skip.has(k)); } });
  $("#skipAll").onclick = () => { const ks = [...document.querySelectorAll("#loveList li")].map((li) => li.dataset.key); setSkip(ks, !ks.every((k) => Q.skip.has(k))); };
  // Each word once (Both asks it twice); words of different sets can share an id.
  $("#againBtn").onclick = () => { const seen = new Set(), k = (w) => w.set + "\u0001" + w.id; startTest(Q.love.filter((w) => !seen.has(k(w)) && seen.add(k(w))), quizUpto); };
  $("#newBtn").onclick = () => { show("setup"); renderSetup(); };

  // Saves the finished session; called again with its id when the skip choices change afterwards.
  async function saveResult(rows, again) {
    if (S.histOn !== true || (!S.local && (!db || !uid))) return; // history is saved only after the viewer turns it on
    const id = again || "t" + Date.now();
    if (!again) Q.finishedAt = new Date().toISOString();
    const doc = {
      finishedAt: Q.finishedAt, ...Q.meta,
      words: rows.map(({ it, n }) => ({ id: it.w.id, en: it.w.en, jp: jpForm(it.w), dir: it.dir, tries: n, ...(Q.skip?.has(it.key) ? { skip: true } : {}) })),
    };
    Q.savedId = id;
    if (S.local) { saveLocal([{ id, ...doc }, ...S.history.filter((t) => t.id !== id)]); return; }
    try { await db.collection("data/users/" + uid).doc(id).set(doc); } catch { if (again) banner("Couldn't save that change. Try again."); }
  }
