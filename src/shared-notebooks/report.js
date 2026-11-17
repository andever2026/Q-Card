  // ---------- reporting a shared notebook (public site) ----------
  // Sharing passes along what other people typed in, so the page a shared notebook's link opens has "Report this
  // notebook". Sending a report needs an account (signed out, the button offers to sign in): which notebook, one of the
  // reasons, what they wrote and the account that sent it. Only developers can read reports (firestore.rules); theirs is Settings → Admin (moderation.js).
  // The reasons: what the person picks from, and the short name Admin lists it under.
  const REPORT_WHY = { wrong: ["It has mistakes", "Mistakes"], unsuitable: ["It doesn't belong on a study site", "Doesn't belong"], rights: ["It shares material that isn't theirs to share", "Not theirs to share"], other: ["Something else", "Something else"] };
  // True once the report is sent.
  async function reportShared(id) {
    // Signed out: sign in first. The page comes back to this notebook afterwards (preview.js).
    if (!account) { if (await ask("Report this notebook", `<p>Sign in to report this notebook.</p>`, "Sign in")) signIn($("#sharedReport"), banner); return false; }
    const sent = ask("Report this notebook", `<p>What's wrong with it?</p>
      ${Object.entries(REPORT_WHY).map(([k, [t]]) => `<label class="checkrow"><input type="radio" name="repWhy" value="${k}"> ${t}</label>`).join("")}
      <textarea class="repnote" id="repNote" maxlength="1000" rows="4" aria-label="Details" placeholder="Anything that helps us look into it (optional)"></textarea>
      <p class="muted small">The report includes the notebook, your reason, your details and your account.</p>`, "Send report");
    // No reason is picked at first, and Send report waits for one.
    $("#askYes").disabled = true; $("#askText input").focus();
    $("#askText").onchange = () => { $("#askYes").disabled = !$("#askText [name=repWhy]:checked"); };
    if (!(await sent)) return false;
    const why = $("#askText [name=repWhy]:checked")?.value || "other", note = tidy($("#repNote").value, 1000);
    try { await platform.reports.doc(rid() + rid()).set({ share: id, why, note, at: new Date().toISOString(), by: uid }); }
    catch { banner("Couldn't send the report. Try again."); return false; }
    return true;
  }
  // Deleting an account (account/account.js) takes it off the reports it sent: they stay, and say Deleted user in Admin.
  async function forgetReports() {
    if (account) for (const d of (await platform.reports.where("by", "==", uid).get()).docs) await platform.reports.doc(d.id).update({ by: null });
  }
  // Whether a developer took this shared notebook down after a report (moderation.js): then its link works only for
  // its owner and for developers.
  const takenDown = async (id) => !!(await platform.shared(id).down.get().catch(() => null))?.exists;
