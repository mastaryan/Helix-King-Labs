/* Helix King Labs — lead-capture popup (Phase 1 funnel).
   Timed / exit-intent / scroll-depth entry popup offering the research
   guides starter kit. Consent-aware: never stacks on the cookie banner,
   never shows to signed-in users or recent dismissers. Standalone so
   app.js stays untouched. Exposes window.HKL_LEAD { maybeShow }. */
(function () {
  "use strict";
  var LS_TS = "hkl_lead_ts";       // last shown/dismissed timestamp
  var LS_DONE = "hkl_capture";     // already subscribed
  var COOLDOWN_MS = 30 * 864e5;    // 30 days
  var TIMER_MS = 45 * 1000;        // 45 seconds
  var SCROLL_PCT = 0.6;            // 60% scroll depth
  var timer = null;
  var shown = false;

  function api(path, opts) { return window.HKL.api(path, opts); }
  function toast(m) { return window.HKL.toast(m); }

  function cooledDown() {
    try {
      var t = Number(localStorage.getItem(LS_TS) || 0);
      return Date.now() - t < COOLDOWN_MS;
    } catch (e) { return false; }
  }
  function subscribed() {
    try { return localStorage.getItem(LS_DONE) === "1"; } catch (e) { return false; }
  }
  function stamp() {
    try { localStorage.setItem(LS_TS, String(Date.now())); } catch (e) {}
  }
  function signedIn() {
    try { return !!(window.HKL && window.HKL.state && window.HKL.state.user); }
    catch (e) { return false; }
  }
  function consentBlocking() {
    try {
      // Don't stack on the cookie banner. If consent unresolved and the
      // banner is visible, wait for another visit.
      var c = window.HKL_CONSENT && window.HKL_CONSENT.get();
      if (c) return false;
      var box = document.getElementById("consent");
      return !!(box && !box.classList.contains("hidden"));
    } catch (e) { return false; }
  }
  function badPage() {
    var p = (location.pathname || "").toLowerCase();
    return p.indexOf("/account") === 0 || p.indexOf("/ops") === 0 ||
           p.indexOf("/cart") === 0 || p.indexOf("/checkout") === 0;
  }
  function eligible() {
    return !shown && !subscribed() && !cooledDown() && !signedIn() &&
           !consentBlocking() && !badPage() && !!window.HKL;
  }

  function close(mark) {
    var host = document.getElementById("leadpop");
    if (host) { host.classList.add("hidden"); host.innerHTML = ""; }
    if (mark) stamp();
    shown = false;
  }

  function show() {
    if (!eligible()) return;
    shown = true;
    stamp();
    if (timer) { clearTimeout(timer); timer = null; }
    var host = document.getElementById("leadpop");
    if (!host) {
      host = document.createElement("div");
      host.id = "leadpop";
      host.className = "popup";
      host.setAttribute("role", "dialog");
      host.setAttribute("aria-label", "Research starter kit");
      document.body.appendChild(host);
    }
    host.classList.remove("hidden");
    host.innerHTML =
      '<div class="popup-card">' +
      '<div class="kicker">Free starter kit</div>' +
      "<h2>Peptide research, explained.</h2>" +
      "<p>Get our 10 research guides (BPC-157, Retatrutide, TB-500…) plus the reconstitution calculator — free by email, with lot alerts and restocks.</p>" +
      '<form id="leadForm">' +
      '<input type="email" name="email" placeholder="Email" required autocomplete="email" />' +
      '<label class="check"><input type="checkbox" name="consent" /> Email me the starter kit, lot alerts, restocks, and group buys.</label>' +
      '<button class="btn" type="submit">Send the kit</button>' +
      "</form>" +
      '<button class="dismiss" id="leadDismiss" type="button">Not now</button>' +
      "</div>";
    document.getElementById("leadDismiss").onclick = function () { close(true); };
    host.onclick = function (e) { if (e.target === host) close(true); };
    document.getElementById("leadForm").onsubmit = function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var email = String(fd.get("email") || "").trim();
      var consent = !!fd.get("consent");
      if (!consent) { toast("Tick the checkbox to get the kit by email."); return; }
      var btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      api("/api/capture", { method: "POST", body: { email: email, source: "popup", consent: true, series: "welcome" } })
        .then(function (out) {
          try { localStorage.setItem(LS_DONE, "1"); } catch (e2) {}
          host.innerHTML = '<div class="popup-card"><div class="kicker">Done</div>' +
            "<h2>Check your inbox.</h2><p>The starter kit is on its way — three more short emails over the next week.</p></div>";
          setTimeout(function () { close(false); }, 3500);
          toast(out && out.subscribed ? "You're on the list." : "Done.");
        })
        .catch(function (err) {
          btn.disabled = false;
          toast((err && err.error === "email") ? "Use a valid email." : "Couldn't subscribe — try again.");
        });
    };
  }

  function arm() {
    if (!window.HKL || shown || subscribed() || cooledDown() || badPage()) return;
    // Timer trigger.
    if (!timer) {
      timer = setTimeout(function () { timer = null; show(); }, TIMER_MS);
    }
    // Exit-intent (desktop): mouse leaves toward the top chrome.
    document.addEventListener("mouseout", function (e) {
      if (shown || !e.relatedTarget) return;
      if (e.clientY <= 8) show();
    });
    // Scroll depth (mobile-friendly): 60% of the page.
    var fired = false;
    window.addEventListener("scroll", function () {
      if (fired || shown) return;
      var h = document.documentElement;
      var pct = (window.scrollY + window.innerHeight) / (h.scrollHeight || 1);
      if (pct >= SCROLL_PCT) { fired = true; show(); }
    }, { passive: true });
    // Escape closes.
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close(true);
    });
  }

  window.HKL_LEAD = { maybeShow: show, arm: arm };
  // Arm after the app boots (HKL global ready). Retry briefly if early.
  var tries = 0;
  var boot = setInterval(function () {
    tries++;
    if (window.HKL && window.HKL.api) { clearInterval(boot); arm(); }
    else if (tries > 40) clearInterval(boot);
  }, 500);
})();
