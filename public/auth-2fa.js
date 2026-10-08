// Customer 2FA (TOTP) setup UI for /account Security section.
(function () {
  function api(path, opts) { return window.HKL.api(path, opts); }
  function toast(m) { return window.HKL.toast(m); }
  function esc(s) { return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  async function refresh(box, btn) {
    let st;
    try { st = await api("/api/auth/2fa/status"); }
    catch { box.innerHTML = `<p class="hard">Couldn't load 2FA status.</p>`; return; }
    if (st.enabled) {
      btn.textContent = "Manage 2FA";
      box.innerHTML = `<p class="ok" style="margin:0">Two-factor authentication is <b>on</b> for this account.</p>
        <p style="margin:12px 0 0"><button class="btn ghost" type="button" id="tfaDisable">Turn off 2FA</button></p>
        <div id="tfaDisableBox" style="margin-top:12px"></div>`;
      box.querySelector("#tfaDisable").onclick = () => {
        const dbox = box.querySelector("#tfaDisableBox");
        dbox.innerHTML = `<form id="tfaDisableForm" class="tool-form" style="max-width:320px">
          <input type="password" name="pw" placeholder="Current password" autocomplete="current-password" />
          <button class="btn" type="submit">Confirm — turn off 2FA</button>
          <p class="hard" id="tfaDisableNote" style="margin:0"></p></form>`;
        dbox.querySelector("#tfaDisableForm").onsubmit = async (e) => {
          e.preventDefault();
          const note = dbox.querySelector("#tfaDisableNote");
          try {
            await api("/api/auth/2fa/disable", { method: "POST", body: { password: e.target.pw.value } });
            toast("2FA turned off.");
            refresh(box, btn);
          } catch (err) {
            note.textContent = err.message === "credentials" ? "Password didn't match." : "Couldn't turn off 2FA.";
          }
        };
      };
    } else {
      btn.textContent = "Set up 2FA";
      box.innerHTML = `<p class="muted" style="margin:0">Add an authenticator app (Google Authenticator, Authy, 1Password…) as a second step when signing in.</p>
        <p style="margin:12px 0 0"><button class="btn" type="button" id="tfaStart">Start setup</button></p>
        <div id="tfaSetupBox" style="margin-top:12px"></div>`;
      box.querySelector("#tfaStart").onclick = async () => {
        const sbox = box.querySelector("#tfaSetupBox");
        sbox.innerHTML = `<p class="muted">Generating…</p>`;
        let r;
        try { r = await api("/api/auth/2fa/setup", { method: "POST", body: {} }); }
        catch { sbox.innerHTML = `<p class="hard">Couldn't start setup — try again.</p>`; return; }
        sbox.innerHTML = `
          ${r.qr ? `<p><img src="${r.qr}" alt="2FA QR code" style="width:220px;height:220px" /></p>` : ""}
          <p class="muted">Scan with your authenticator app, or enter this key manually:<br><code style="user-select:all">${esc(r.secret)}</code></p>
          <form id="tfaConfirmForm" class="tool-form" style="max-width:320px">
            <input name="code" inputmode="numeric" placeholder="6-digit code" maxlength="6" required />
            <button class="btn" type="submit">Verify &amp; enable</button>
            <p class="hard" id="tfaConfirmNote" style="margin:0"></p></form>`;
        sbox.querySelector("#tfaConfirmForm").onsubmit = async (e) => {
          e.preventDefault();
          const note = sbox.querySelector("#tfaConfirmNote");
          try {
            const out = await api("/api/auth/2fa/confirm", { method: "POST", body: { code: e.target.code.value } });
            const rec = (out.recovery || []).map(esc).join("<br>");
            sbox.innerHTML = `<div class="paybox" style="border-color:#2a7"><h3>2FA is on</h3>
              <p>Save these recovery codes somewhere safe — each works once if you lose your authenticator:</p>
              <p class="codeaddr">${rec}</p>
              <p class="muted">This is the only time they are shown.</p></div>`;
            toast("Two-factor authentication enabled.");
            btn.textContent = "Manage 2FA";
          } catch (err) {
            note.textContent = err.message === "code" ? "That code didn't match — try the current one." : "Couldn't enable 2FA.";
          }
        };
      };
    }
  }

  function mount() {
    const btn = document.getElementById("tfaBtn");
    const box = document.getElementById("tfaBox");
    if (!btn || !box) return;
    btn.onclick = () => {
      const det = document.getElementById("securityDetails");
      if (det && !det.open) det.open = true;
      box.scrollIntoView({ behavior: "smooth", block: "nearest" });
      refresh(box, btn);
    };
    // Preload status label when the Security section is opened
    const det = document.getElementById("securityDetails");
    if (det) det.addEventListener("toggle", () => { if (det.open && !box.dataset.loaded) { box.dataset.loaded = "1"; refresh(box, btn); } });
  }

  // Login form 2FA is handled inline in app.js (totp_required -> show code field).
  // This stub remains for compatibility.
  function wireLoginTotp() {}

  window.HKL_2FA = { mount, wireLoginTotp };
})();
