  // ---------- public site: welcome / sign-in ----------
  // A first-time visitor sees a welcome pop-up over the page, which runs as a guest behind it. Once they've picked
  // anything (guest, the tour, the X, or signing in) it's remembered (qcard:welcomed) and doesn't come back, signed out
  // or not, until "Delete" starts the browser over (the owner's call). Signing in from Settings goes straight to Google.
  let startLocal = () => {};
  const welcomed = () => { try { localStorage.setItem("qcard:welcomed", "1"); } catch {} };
  function welcome(err) {
    $("#welcomeErr").textContent = err || ""; $("#welcomeErr").hidden = !err;
    if (!$("#welcome").open) $("#welcome").showModal();
  }
  // Closing the pop-up (its X, or Escape) is the same as continuing as a guest.
  $("#guestBtn").onclick = $("#welcomeClose").onclick = () => { try { localStorage.setItem("qcard:mode", "local"); } catch {} welcomed(); $("#welcome").close(); };
  $("#welcome").addEventListener("cancel", () => $("#welcomeClose").click());
  // Google's sign-in window; the page then reloads into the account (see boot). onErr says why it didn't work.
  async function signIn(btn, onErr) {
    btn.disabled = true;
    try { await platform.signIn(); }
    catch (e) {
      btn.disabled = false;
      if (/popup-closed-by-user|cancelled-popup-request/.test(e?.code)) return;
      onErr(e?.code === "auth/popup-blocked" ? "Your browser blocked the sign-in window. Allow pop-ups for this site, then try again." : "Sign-in didn't work. Try again.");
    }
  }
  $("#signInBtn").onclick = () => signIn($("#signInBtn"), welcome);
  // Settings → Account and Delete. account is the signed-in person ({uid, email, name}), or null for a guest.
  let account = null, delAsk = false, stopPrefs = () => {};
  $("#settings").addEventListener("close", () => { delAsk = false; });
  function renderAccount() {
    $("#acctName").innerHTML = account ? `Signed in with Google as <b>${esc(account.email || account.name || "")}</b>.`
      : "Not signed in. As a guest, everything is kept in this browser on this device.";
    $("#signOutBtn").textContent = account ? "Sign out" : "Sign in with Google";
    $("#acctErr").hidden = true;
    $("#signOutBtn").onclick = account ? () => platform.signOut() : () => signIn($("#signOutBtn"), (m) => { $("#acctErr").textContent = m; $("#acctErr").hidden = false; });
    const what = account ? "your account and its sets, kanji lists and practice history" : "the sets, kanji lists and practice history saved in this browser";
    $("#delAcct").innerHTML = !delAsk
      ? account ? `<button class="btn danger" type="button" id="delStart">Delete my account</button>`
        : `<div class="delrow"><button class="btn danger" type="button" id="delStart" aria-describedby="delTip">Delete local storage</button>
          <span class="qtip" tabindex="0" role="button" aria-label="What this does"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.4a2.8 2.8 0 1 1 3.9 2.6c-.8.4-1.2.9-1.2 1.7v.5"/><circle cx="12" cy="17.2" r=".4" fill="currentColor"/></svg><span class="qtipbody" role="tooltip" id="delTip">This deletes all local data (sets, kanji lists, practice history and settings), refreshes the page and treats you as a new user.</span></span></div>`
      : `<p class="small">This deletes ${what}, for good. Export your vocab first if you want a copy.</p>
        <div class="tactions"><button class="btn danger" type="button" id="delYes">Delete everything</button><button class="btn" type="button" id="delNo">Cancel</button></div>
        <p class="keyerr small" id="delErr" hidden></p>`;
    if (!delAsk) {
      $("#delStart").onclick = () => { delAsk = true; renderAccount(); };
      // A tap shows the tip on touch screens, where there's no hover.
      const q = $("#delAcct .qtip");
      if (q) { q.onclick = () => q.classList.toggle("open"); q.onblur = q.onmouseleave = () => q.classList.remove("open"); }
      return;
    }
    $("#delNo").onclick = () => { delAsk = false; renderAccount(); };
    $("#delYes").onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = "Deleting…";
      stopPrefs();
      try {
        const paths = [];
        for (const c of ["sets", "kanji", "training", "data/users/" + uid]) for (const d of (await db.collection(c).get()).docs) paths.push(`${c}/${d.id}`);
        for (const p of [...paths, "meta/books", "meta/courses", "meta/samples"]) await db.doc(p).delete();
        try { localStorage.removeItem("qcard:mode"); localStorage.removeItem("qcard:welcomed"); } catch {}
        // Every choice this site kept in this browser goes too (colours, picks, a practice to resume with its writing): signed in,
        // they're the account's copy. A guest's own sets and history (qcard:local:…) stay unless it's the guest being deleted.
        try { for (const k of Object.keys(localStorage)) if (k.startsWith("jpq:") || (!account && k.startsWith("qcard:"))) localStorage.removeItem(k); } catch {}
        if (account) await platform.deleteAccount(); // which signs out, and the page starts over (see boot)
        else location.reload(); // a guest starts over as a new visitor
      } catch (err) {
        e.target.disabled = false; e.target.textContent = "Delete everything";
        $("#delErr").hidden = false;
        $("#delErr").textContent = err?.code === "auth/popup-blocked" ? "Your data is deleted. To delete the account itself, allow pop-ups for this site so Google can confirm it's you, then try again."
          : "Something went wrong. Try again.";
      }
    };
  }
