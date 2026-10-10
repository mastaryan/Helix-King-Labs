/* Helix King Labs — Google sign-in via GIS popup.
   Uses the Identity Services popup flow: Google returns the ID token directly
   to our callback, we POST it to /api/auth/google. No redirect, no fragments. */
(function () {
  async function signInGoogle(age, terms) {
    const HKL = window.HKL || {};
    const state = HKL.state || {};
    if (!state.auth || !state.auth.google || !state.auth.googleClientId) {
      if (!state.auth || !state.auth.demo) throw new Error("google_not_configured");
      return HKL.api("/api/auth/google", { method: "POST", body: { age: !!age, terms: !!terms } });
    }
    await HKL.loadScript("https://accounts.google.com/gsi/client", "hkl-gsi");
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn) => (v) => { if (!settled) { settled = true; fn(v); } };
      const ok = done(resolve), fail = done(reject);
      try {
        window.google.accounts.id.initialize({
          client_id: state.auth.googleClientId,
          callback: async (resp) => {
            if (!resp || !resp.credential) { fail(new Error("google_no_credential")); return; }
            try {
              const out = await HKL.api("/api/auth/google", {
                method: "POST",
                body: { credential: resp.credential, age: !!age, terms: !!terms },
              });
              ok(out);
            } catch (err) { fail(err); }
          },
          auto_select: false,
          ux_mode: "popup",
        });
        window.google.accounts.id.prompt((n) => {
          if (n && (n.isNotDisplayed() || n.isSkippedMoment() || n.isDismissedMoment())) {
            fail(new Error("google_cancelled"));
          }
        });
        // Safety: if Google never calls back, don't hang forever.
        setTimeout(() => fail(new Error("google_timeout")), 120000);
      } catch (err) { fail(err); }
    });
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
