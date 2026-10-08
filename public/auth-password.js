/* Helix King Labs — password management. Loaded before app.js; uses window.HKL at runtime.
   - Account page: set/change password card.
   - Forced reset: blocking modal when the account has mustChangePassword.
   - Ops accounts table: per-row "Reset pw" issuing a one-time temp password. */
(function () {
  function api(path, opts) { return window.HKL.api(path, opts); }
  function toast(m) { return window.HKL.toast(m); }

  var securityCache = null;
  async function security() {
    if (securityCache) return securityCache;
    try {
      securityCache = await api("/api/auth/security");
    } catch (e) {
      securityCache = { hasPassword: false, mustChangePassword: false };
    }
    return securityCache;
  }

  /* ---------- Account page: set/change password card ---------- */
  var cardPending = false;
  async function injectAccountCard() {
    if (document.getElementById("setPwCard") || cardPending) return;
    var slot = document.getElementById("pwSlot") || document.getElementById("profileForm");
    if (!slot) return;
    if (!window.HKL.state || !window.HKL.state.user) return;
    cardPending = true;
    try {
      var sec = await security();
    } catch (e) {
      cardPending = false;
      return;
    }
    var card = document.createElement("div");
    card.id = "setPwCard";
    card.className = "card";
    card.style.cssText = "max-width:560px;margin-top:24px;padding:28px";
    card.innerHTML =
      '<h3 style="margin:0 0 8px">Password</h3>' +
      '<p class="lede" style="margin:0 0 16px">' +
      (sec.hasPassword
        ? "A password is set on this account. Change it here — you'll need your current one."
        : "No password is set on this account yet. Set one to sign in with email + password — no more waiting on email links.") +
      "</p>" +
      '<form id="setPwForm" class="tool-form" style="margin:0">' +
      (sec.hasPassword ? '<input type="password" name="cur" placeholder="Current password" autocomplete="current-password" />' : "") +
      '<input type="password" name="pw" placeholder="New password (8+ characters)" required minlength="8" maxlength="72" autocomplete="new-password" />' +
      '<input type="password" name="pw2" placeholder="Confirm new password" required minlength="8" maxlength="72" autocomplete="new-password" />' +
      '<button class="btn" type="submit">' + (sec.hasPassword ? "Change password" : "Set password") + "</button>" +
      '<p class="hard" id="setPwNote" style="margin:0"></p>' +
      "</form>";
    slot.appendChild(card);
    cardPending = false;
    card.querySelector("#setPwForm").addEventListener("submit", async function (e) {
      e.preventDefault();
      var note = card.querySelector("#setPwNote");
      var fd = new FormData(e.target);
      var pw = String(fd.get("pw") || "");
      var pw2 = String(fd.get("pw2") || "");
      if (pw !== pw2) { note.textContent = "The two passwords don't match."; return; }
      if (pw.length < 8) { note.textContent = "Use at least 8 characters."; return; }
      note.textContent = "Saving…";
      try {
        if (sec.hasPassword) {
          await api("/api/auth/password/change", { method: "POST", body: { password: pw, currentPassword: String(fd.get("cur") || "") } });
        } else {
          await api("/api/auth/password/set", { method: "POST", body: { password: pw } });
        }
        securityCache = { hasPassword: true, mustChangePassword: false };
        note.textContent = "";
        toast("Password saved. You can now sign in with email + password.");
        e.target.reset();
      } catch (err) {
        note.textContent = err && err.message === "credentials"
          ? "Current password didn't match — try again."
          : "Couldn't save — try again.";
      }
    });
  }

  /* ---------- Forced password change (blocking modal) ---------- */
  function showForcedModal() {
    if (document.getElementById("forcedPwModal")) return;
    var overlay = document.createElement("div");
    overlay.id = "forcedPwModal";
    overlay.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(4,4,6,.92);display:flex;align-items:center;justify-content:center;padding:20px";
    overlay.innerHTML =
      '<div class="card" style="max-width:440px;width:100%;padding:32px">' +
      '<h2 style="margin:0 0 8px">Choose a new password</h2>' +
      '<p class="lede" style="margin:0 0 20px">Your password was reset. Enter a new one to continue — this only takes a moment.</p>' +
      '<form id="forcedPwForm" class="tool-form" style="margin:0">' +
      '<input type="password" name="pw" placeholder="New password (8+ characters)" required minlength="8" maxlength="72" autocomplete="new-password" />' +
      '<input type="password" name="pw2" placeholder="Confirm new password" required minlength="8" maxlength="72" autocomplete="new-password" />' +
      '<button class="btn" type="submit">Save new password</button>' +
      '<p class="hard" id="forcedPwNote" style="margin:0"></p>' +
      "</form></div>";
    document.body.appendChild(overlay);
    overlay.querySelector("#forcedPwForm").addEventListener("submit", async function (e) {
      e.preventDefault();
      var note = overlay.querySelector("#forcedPwNote");
      var fd = new FormData(e.target);
      var pw = String(fd.get("pw") || "");
      if (pw !== String(fd.get("pw2") || "")) { note.textContent = "The two passwords don't match."; return; }
      if (pw.length < 8) { note.textContent = "Use at least 8 characters."; return; }
      note.textContent = "Saving…";
      try {
        await api("/api/auth/password/change", { method: "POST", body: { password: pw } });
        securityCache = { hasPassword: true, mustChangePassword: false };
        overlay.remove();
        toast("Password updated. You're all set.");
      } catch (err) {
        note.textContent = "Couldn't save — try again.";
      }
    });
    var first = overlay.querySelector('input[name="pw"]');
    if (first) first.focus();
  }

  async function checkForced() {
    if (!window.HKL.state || !window.HKL.state.user) return;
    var sec = await security();
    if (sec.mustChangePassword) showForcedModal();
  }

  /* ---------- Ops: per-row "Reset pw" buttons + temp password display ---------- */
  function showTempModal(email, temp) {
    var overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(4,4,6,.9);display:flex;align-items:center;justify-content:center;padding:20px";
    overlay.innerHTML =
      '<div class="card" style="max-width:440px;width:100%;padding:32px">' +
      '<h3 style="margin:0 0 8px">Temporary password</h3>' +
      '<p class="lede" style="margin:0 0 16px">For <b>' + email.replace(/</g, "&lt;") + '</b>. Share this once — it will not be shown again. They sign in with it, then choose their own password.</p>' +
      '<div style="display:flex;gap:8px">' +
      '<input id="tempPwVal" readonly value="' + temp.replace(/"/g, "&quot;") + '" style="flex:1;font-family:monospace" />' +
      '<button class="btn" type="button" id="tempPwCopy">Copy</button>' +
      "</div>" +
      '<p style="margin:16px 0 0"><button class="btn ghost" type="button" id="tempPwClose">Done</button></p>' +
      "</div>";
    document.body.appendChild(overlay);
    overlay.querySelector("#tempPwCopy").onclick = function () {
      var inp = overlay.querySelector("#tempPwVal");
      inp.select();
      try { document.execCommand("copy"); } catch (e) {}
      if (navigator.clipboard) navigator.clipboard.writeText(inp.value).catch(function () {});
      toast("Copied.");
    };
    overlay.querySelector("#tempPwClose").onclick = function () { overlay.remove(); };
  }

  function injectOpsButtons() {
    var desk = document.getElementById("custDesk");
    if (!desk) return;
    desk.querySelectorAll("tr[data-uid]").forEach(function (row) {
      if (row.querySelector(".op-pw-reset")) return;
      var uid = row.getAttribute("data-uid");
      var actionsCell = row.querySelector("td:last-child");
      if (!actionsCell) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn ghost op-pw-reset";
      btn.textContent = "Reset pw";
      btn.style.marginLeft = "6px";
      btn.onclick = async function () {
        var email = row.querySelector("td") ? row.querySelector("td").textContent : "this account";
        if (!window.confirm("Reset the password for " + email + "?\n\nThey'll be signed out everywhere, get a one-time temporary password, and must choose a new password on next sign-in.")) return;
        btn.disabled = true;
        try {
          var r = await api("/api/ops/users/password-reset", { method: "POST", body: { id: uid } });
          showTempModal(r.email || email, r.tempPassword);
        } catch (err) {
          toast(err && err.message === "cannot_reset_ops" ? "Ops accounts can't be reset this way." : "Reset failed.");
        }
        btn.disabled = false;
      };
      actionsCell.appendChild(btn);
    });
  }

  /* ---------- Wiring ---------- */
  function boot() {
    if (!window.HKL || !window.HKL.state) return;
    injectAccountCard();
    checkForced();
    injectOpsButtons();
  }

  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    boot();
    if (tries > 40) clearInterval(timer);
  }, 700);
  window.addEventListener("hkl:route", function () { securityCache = null; cardPending = false; boot(); });
})();
