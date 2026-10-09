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
    const pretty = out.secret.replace(/(.{4})/g, "$1 ").trim();
    panel.querySelector("#opsTotpSecret").innerHTML = `Manual entry (no spaces when typing):<br/><code style="font-size:15px;letter-spacing:1px">${pretty}</code><br/><button type="button" id="opsTotpCopy" class="btn ghost" style="margin-top:6px">Copy key</button>`;
    panel.querySelector("#opsTotpCopy").onclick = () => {
      const k = out.secret;
      if (navigator.clipboard) navigator.clipboard.writeText(k).catch(() => {});
      else { const t = document.createElement("textarea"); t.value = k; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); } catch (e) {} t.remove(); }
      panel.querySelector("#opsTotpCopy").textContent = "Copied";
    };
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

// TOTP code prompt for completing a magic-link sign-in on an ops account.
// Renders into `container`; calls `onSuccess(out)` with the session response.
async function opsTotpPrompt(container, pendingToken, onSuccess) {
  container.innerHTML = `<div class="kicker">Security check</div>
    <h1>Enter your authenticator code</h1>
    <p class="lede">This ops account has 2FA enabled.</p>
    <form id="magicTotpF" class="tool-form" style="max-width:320px">
      <input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" required minlength="6" maxlength="6" />
      <button class="btn" type="submit">Verify</button>
      <p class="hard" id="magicTotpE"></p>
    </form>`;
  container.querySelector("#magicTotpF").onsubmit = async (e) => {
    e.preventDefault();
    const code = new FormData(e.target).get("code");
    try {
      const out = await api("/api/auth/ops-2fa/verify", { method: "POST", body: { pendingToken, code } });
      onSuccess(out);
    } catch (err) {
      container.querySelector("#magicTotpE").textContent =
        err && err.message === "totp" ? "That code didn't match — try the current one." : "Couldn't verify — try again.";
    }
  };
}

  window.HKL_OPS_2FA = { enroll: opsTotpEnroll, magicPrompt: opsTotpPrompt, magicPage, resetPage: opsTotpResetPage };

async function opsTotpResetPage(app, { api, $ }) {
  const token = new URLSearchParams(location.search).get("token") || "";
  app.innerHTML = `<section class="page wrap"><h1>Resetting 2FA</h1><p class="lede" id="r2faMsg">Checking the link…</p><div id="r2faBox"></div></section>`;
  if (!token) { $("#r2faMsg").textContent = "This link is missing a token."; return; }
  try {
    const out = await api("/api/auth/ops-2fa/reset-consume", { method: "POST", body: { token } });
    $("#r2faMsg").textContent = "Authenticator cleared. Set it up fresh — type the key with no spaces, or use Copy.";
    opsTotpEnroll($("#r2faBox"), $("#r2faMsg"), out.setupToken);
  } catch {
    $("#r2faMsg").textContent = "This link is expired or already used.";
  }
}

// Magic-link sign-in page (with ops TOTP gating).
async function magicPage(app, ctx) {
  const { api, state, loadBase, go, $ } = ctx;
  const token = new URLSearchParams(location.search).get("token") || "";
  app.innerHTML = `<section class="page wrap"><h1>Signing in</h1><p class="lede" id="magicMsg">Checking the link.</p></section>`;
  const finishMagic = async (out) => {
    state.user = out.user;
    state.gateOk = true;
    localStorage.setItem("hkl_gate", "1");
    await loadBase();
    go("/account");
  };
  if (!token) { $("#magicMsg").textContent = "This link is missing a token."; return; }
  try {
    await finishMagic(await api("/api/auth/magic/consume", { method: "POST", body: { token } }));
  } catch (err) {
    if (err.data && err.data.error === "totp_required") {
      opsTotpPrompt(app, err.data.pendingToken, finishMagic);
    } else if (err.data && err.data.error === "totp_setup_required") {
      app.innerHTML = `<section class="page wrap"><div class="kicker">Security setup</div><h1>Set up two-factor authentication</h1><p class="lede">Ops accounts require an authenticator app.</p><div id="magicEnroll"></div><p class="hard" id="magicEnrollErr"></p></section>`;
      opsTotpEnroll(document.getElementById("magicEnroll"), document.getElementById("magicEnrollErr"), err.data.setupToken);
    } else {
      const msg = $("#magicMsg");
      if (msg) msg.textContent = "This link is expired or already used.";
    }
  }
}
})();
