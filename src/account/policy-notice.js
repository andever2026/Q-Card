  // ---------- the privacy policy notice (public site) ----------
  // When the privacy policy's "Last updated" date is newer than the one this visitor last saw, a small notice in the
  // corner links to it until it's closed. The date comes from src/side-pages/privacy.html: the build writes it in here,
  // so changing that line is all it takes. A first visit only records the date (nothing has changed for them). Signed
  // in, the date seen is one of the account's choices (PREF_KEYS), so the notice comes once per account.
  const POLICY_UPDATED = "%PRIVACY_LAST_UPDATED%";
  const policyDay = (iso) => new Date(iso + "T12:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  function checkPolicy() {
    const seen = store.get("policySeen", null);
    if (typeof seen !== "string") store.set("policySeen", POLICY_UPDATED);
    else if (seen < POLICY_UPDATED) showPolicyNote();
  }
  function showPolicyNote() { $("#policyDate").textContent = policyDay(POLICY_UPDATED); $("#policyNote").hidden = false; }
  const policyRead = () => { $("#policyNote").hidden = true; store.set("policySeen", POLICY_UPDATED); };
  $("#policyClose").onclick = policyRead;
  $("#policyLink").addEventListener("click", policyRead);
  // Settings → Admin: see the notice now, or as a visitor who saw an older policy will on their next visit.
  $("#devPolicyInfo").textContent = `The policy was last updated ${policyDay(POLICY_UPDATED)}. Anyone who last saw an older version gets the notice once.`;
  $("#devPolicyNow").onclick = showPolicyNote;
  $("#devPolicyNext").onclick = () => { store.set("policySeen", "2000-01-01"); sayIn($("#devPolicyMsg"))("Reload the page to see it as a returning visitor would."); };
