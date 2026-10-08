/* Helix King Labs — set a password on the account page. Loaded before app.js; uses window.HKL at runtime. */
(function () {
  function api(path, opts) { return window.HKL.api(path, opts); }
  function toast(m) { return window.HKL.toast(m); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  function inject() {
    if (document.getElementById("setPwCard")) return;
    const profile = document.getElementById("profileForm");
    if (!profile) return;
    if (!window.HKL.state || !window.HKL.state.user) return;
    const hasPw = (window.HKL.state.user.providers || []).includes("password");
    const card = document.createElement("div");
    card.id = "setPwCard";
    card.className = "card";
    card.style.cssText = "max-width:560px;margin-top:24px;padding:28px";
    card.innerHTML =
      '<h3 style="margin:0 0 8px">Password</h3>' +
      '<p class="lede" style="margin:0 0 16px">' +
      (hasPw ? "A password is already set on this account. You can change it here." : "No password is set on this account yet. Set one to sign in with email + password — no more waiting on email links.") +
      "</p>" +
      '<form id="setPwForm" class="tool-form" style="margin:0">' +
      '<input type="password" name="pw" placeholder="New password (8+ characters)" required minlength="8" maxlength="72" autocomplete="new-password" />' +
      '<input type="password" name="pw2" placeholder="Confirm password" required minlength="8" maxlength="72" autocomplete="new-password" />' +
      '<button class="btn" type="submit">' + (hasPw ? "Change password" : "Set password") + "</button>" +
      '<p class="hard" id="setPwNote" style="margin:0"></p>' +
      "</form>";
    profile.after(card);
    card.querySelector("#setPwForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const note = card.querySelector("#setPwNote");
      const fd = new FormData(e.target);
      const pw = String(fd.get("pw") || "");
      const pw2 = String(fd.get("pw2") || "");
      if (pw !== pw2) { note.textContent = "The two passwords don't match."; return; }
      if (pw.length < 8) { note.textContent = "Use at least 8 characters."; return; }
      note.textContent = "Saving…";
      try {
        await api("/api/auth/password/set", { method: "POST", body: { password: pw } });
        note.textContent = "";
        toast("Password saved. You can now sign in with email + password.");
        e.target.reset();
      } catch (err) {
        note.textContent = "Couldn't save — try again.";
      }
    });
  }

  // The account page renders client-side after route changes; watch for it.
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    if (window.HKL && window.HKL.state) inject();
    if (tries > 120) clearInterval(timer);
  }, 500);
  new MutationObserver(() => { if (window.HKL && window.HKL.state) inject(); })
    .observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("hkl:route", inject);
})();
