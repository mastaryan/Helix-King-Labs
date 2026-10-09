// Ops TOTP enrollment UI: shown when an ops account signs in without 2FA.
// Fetches the QR/secret with the setup token, verifies one code, shows
// the recovery codes once, then returns to the normal login form.
(function () {
  function api(path, opts) {
    return window.HKL.api(path, opts);
  }

// Ops TOTP enrollment: shown when an ops account signs in without 2FA.
// Fetches the QR/secret with the setup token, verifies one code, shows
// the recovery codes once, then returns to the normal login form.
async function opsTotpEnroll(login, errEl, setupToken) {
  errEl.textContent = "";
  let panel = login.querySelector("#opsTotpPanel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "opsTotpPanel";
    login.appendChild(panel);
  }
  panel.innerHTML = `<p style="margin:8px 0"><strong>Two-factor setup required.</strong><br/>Scan the code below with your authenticator app, then enter the 6-digit code.</p>
    <div id="opsTotpQr" style="margin:8px 0"></div>
    <p style="font-size:12px;word-break:break-all" id="opsTotpSecret"></p>
    <input id="opsTotpCode" inputmode="numeric" placeholder="6-digit code" maxlength="6" style="margin-top:8px" />
    <div><button type="button" id="opsTotpGo" style="margin-top:8px">Verify &amp; enable</button></div>
    <p id="opsTotpErr" style="color:#b00"></p>`;
  login.querySelectorAll("input[name=email], input[name=password], button[type=submit]").forEach((el) => (el.style.display = "none"));
  try {
    const out = await api("/api/auth/ops-2fa/setup", { method: "POST", body: { setupToken } });
    if (out.qr) panel.querySelector("#opsTotpQr").innerHTML = `<img src="${out.qr}" alt="2FA QR code" width="220" height="220" />`;
    panel.querySelector("#opsTotpSecret").textContent = "Manual entry: " + out.secret;
  } catch (e) {
    panel.querySelector("#opsTotpErr").textContent = "Setup expired — sign in again to get a fresh code.";
    return;
  }
  panel.querySelector("#opsTotpGo").onclick = async () => {
    const code = panel.querySelector("#opsTotpCode").value;
    try {
      const out = await api("/api/auth/ops-2fa/confirm", { method: "POST", body: { setupToken, code } });
      panel.innerHTML = `<p style="margin:8px 0"><strong>Two-factor enabled.</strong> Save these recovery codes somewhere safe — each works once:</p>
        <p style="font-family:monospace;word-break:break-all">${(out.recovery || []).join("<br/>")}</p>
        <p>Now sign in again with your password plus a 6-digit code from your authenticator app.</p>`;
      login.querySelectorAll("input[name=email], input[name=password], button[type=submit]").forEach((el) => (el.style.display = ""));
    } catch (e) {
      panel.querySelector("#opsTotpErr").textContent = "That code didn't work — try again.";
    }
  };
  const ci = panel.querySelector("#opsTotpCode");
  if (ci) ci.focus();
}

  window.HKL_OPS_2FA = { enroll: opsTotpEnroll };
})();
