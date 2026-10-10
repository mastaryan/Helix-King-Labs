/* Helix King Labs — post-Google-redirect age/terms confirmation.
   After Google redirect sign-in, if the user hasn't confirmed age/terms,
   show a modal. Uses window.HKL for state, api, toast. */
(function () {
  async function signInGoogle(age, terms) {
    const HKL = window.HKL || {};
    const state = HKL.state || {};
    if (!state.auth || !state.auth.google || !state.auth.googleClientId) {
      if (!state.auth || !state.auth.demo) throw new Error("google_not_configured");
      return HKL.api("/api/auth/google", { method: "POST", body: { age: !!age, terms: !!terms } });
    }
    await HKL.loadScript("https://accounts.google.com/gsi/client", "hkl-gsi");
    try {
      sessionStorage.setItem("hkl_google_confirm", JSON.stringify({ age: !!age, terms: !!terms }));
    } catch {}
    window.google.accounts.id.initialize({
      client_id: state.auth.googleClientId,
      login_uri: window.location.origin + "/api/auth/google/redirect",
      ux_mode: "redirect",
      auto_select: false,
    });
    window.google.accounts.id.prompt((n) => {
      if (n && (n.isNotDisplayed?.() || n.isSkippedMoment?.())) {
        const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        u.searchParams.set("client_id", state.auth.googleClientId);
        u.searchParams.set("redirect_uri", window.location.origin + "/api/auth/google/redirect");
        u.searchParams.set("response_type", "id_token");
        u.searchParams.set("scope", "openid email profile");
        u.searchParams.set("nonce", Math.random().toString(36).slice(2));
        window.location.href = u.toString();
      }
    });
    return new Promise(() => {});
  }
  window.HKL_SIGNIN_GOOGLE = signInGoogle;

  function maybeShowConfirm() {
    const HKL = window.HKL || {};
    const state = HKL.state;
    if (!state || !state.user) return;
    if (new URLSearchParams(location.search).get("confirm") !== "1") return;
    if (state.user.age && state.user.terms) return;
    const stashed = (() => { try { return JSON.parse(sessionStorage.getItem("hkl_google_confirm") || "{}"); } catch { return {}; } })();
    const overlay = document.createElement("div");
    overlay.id = "confirmOverlay";
    overlay.innerHTML = `<div class="gate-card" style="max-width:420px;margin:8vh auto;">
      <h3>One more step</h3>
      <p>Confirm you're 18+ and accept the permitted-use terms to finish signing in.</p>
      <label class="check"><input type="checkbox" id="cfAge"${stashed.age ? " checked" : ""} /> I am 18 or older.</label>
      <label class="check"><input type="checkbox" id="cfTerms"${stashed.terms ? " checked" : ""} /> I accept the permitted-use terms. Research materials stay in the lab. This is not a clinic or a pharmacy.</label>
      <button class="btn" id="cfGo">Confirm and continue</button>
      <p class="err" id="cfErr"></p>
    </div>`;
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;padding:16px;";
    document.body.appendChild(overlay);
    overlay.querySelector("#cfGo").onclick = async () => {
      const age = overlay.querySelector("#cfAge").checked;
      const terms = overlay.querySelector("#cfTerms").checked;
      if (!age || !terms) { overlay.querySelector("#cfErr").textContent = "Both boxes are required."; return; }
      try {
        const out = await HKL.api("/api/auth/confirm", { method: "POST", body: { age, terms } });
        state.user = out.user;
        sessionStorage.removeItem("hkl_google_confirm");
        overlay.remove();
        history.replaceState(null, "", "/account");
        (HKL.toast || alert)("Signed in.");
      } catch { overlay.querySelector("#cfErr").textContent = "Couldn't save — try again."; }
    };
  }

  // Run on account page load and route changes.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", maybeShowConfirm);
  } else {
    maybeShowConfirm();
  }
  window.addEventListener("hkl:route", maybeShowConfirm);
})();
