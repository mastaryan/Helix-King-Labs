/* Helix King Labs — consent management v2.1.
   Granular, hard-gated, honest. No tag loads without the matching consent.
   Categories: necessary (always on), analytics, marketing.
   Uses real Google Consent Mode v2 (gtag consent default/update) — not custom
   events — so GA4/GTM honor the visitor's choice natively.
   Exposes window.HKL_CONSENT { get, show, identify, onChange, render }. */
(function () {
  "use strict";
  var KEY = "hkl_consent_v2";
  var OLD_KEY = "hkl_consent";
  var listeners = [];
  var userEmail = "";
  var marketingActive = false;

  // ---- gtag shim + dataLayer (defined before anything else) ----
  window.dataLayer = window.dataLayer || [];
  if (!window.gtag) {
    window.gtag = function () { window.dataLayer.push(arguments); };
  }
  function gtag() { window.gtag.apply(null, arguments); }

  // Consent Mode v2 defaults: everything denied until the visitor chooses.
  // Pushed at parse time, before any tag library loads.
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
    functionality_storage: "denied",
    personalization_storage: "denied",
    security_storage: "granted"
  });

  function consentUpdate(pref) {
    gtag("consent", "update", {
      analytics_storage: pref.analytics ? "granted" : "denied",
      ad_storage: pref.marketing ? "granted" : "denied",
      ad_user_data: pref.marketing ? "granted" : "denied",
      ad_personalization: pref.marketing ? "granted" : "denied",
      functionality_storage: "granted",
      personalization_storage: pref.marketing ? "granted" : "denied"
    });
  }

  function read() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || "null");
      if (v && typeof v.analytics === "boolean") return v;
    } catch (e) {}
    // Migrate v1 conservatively: analytics yes -> analytics yes, marketing no.
    try {
      var old = JSON.parse(localStorage.getItem(OLD_KEY) || "null");
      if (old && typeof old.analytics === "boolean") {
        return { necessary: true, analytics: old.analytics, marketing: false, at: old.at || new Date().toISOString(), migrated: true };
      }
    } catch (e2) {}
    return null;
  }
  function write(pref) {
    pref.at = new Date().toISOString();
    try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch (e) {}
    try { localStorage.removeItem(OLD_KEY); } catch (e2) {}
    listeners.forEach(function (fn) { try { fn(pref); } catch (e3) {} });
  }
  function gpc() {
    return typeof navigator !== "undefined" && navigator.globalPrivacyControl === true;
  }
  function get() {
    var p = read();
    if (!p) return null;
    return { necessary: true, analytics: !!p.analytics, marketing: !!p.marketing };
  }

  // ---- script injection ----
  // The storefront CSP uses a per-request nonce with no 'unsafe-inline', so
  // dynamically created inline scripts must carry the page nonce. Grab it
  // from any script tag the server already stamped (including this one).
  var pageNonce = "";
  try {
    var stamped = document.querySelector("script[nonce]");
    if (stamped) pageNonce = stamped.getAttribute("nonce") || "";
  } catch (e4) {}

  function stamp(s) {
    if (pageNonce) s.setAttribute("nonce", pageNonce);
    return s;
  }
  function inject(id, src, defer) {
    if (document.getElementById(id)) return;
    var s = document.createElement("script");
    s.id = id;
    s.async = true;
    if (defer) s.defer = true;
    s.src = src;
    document.head.appendChild(stamp(s));
  }
  function inline(id, code) {
    if (document.getElementById(id)) return;
    var s = document.createElement("script");
    s.id = id;
    s.text = code;
    document.head.appendChild(stamp(s));
  }

  function loadAnalytics() {
    var ga = window.HKL_GA_MEASUREMENT_ID || "";
    if (ga) {
      inject("hkl-ga", "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(ga));
      // gtag shim is defined above; just configure. The library picks up
      // the queued commands when it finishes loading.
      inline("hkl-gtag", "gtag('js',new Date());gtag('config','" + ga.replace(/'/g, "") + "',{anonymize_ip:true});");
    }
    // Contentsquare session replay — analytics category.
    inject("hkl-cs", "https://t.contentsquare.net/uxa/d9b45ed974805.js", true);
    // GTM container — tags inside it inherit the dataLayer consent state.
    var gtm = window.HKL_GTM_ID || "";
    if (gtm && !document.getElementById("hkl-gtm")) {
      inject("hkl-gtm", "https://www.googletagmanager.com/gtm.js?id=" + encodeURIComponent(gtm));
    }
  }

  function sha256(str) {
    if (!window.crypto || !crypto.subtle) return Promise.resolve("");
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(str.trim().toLowerCase())).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    });
  }

  function loadMarketing() {
    var meta = window.HKL_META_PIXEL_ID || "";
    var tiktok = window.HKL_TIKTOK_PIXEL_ID || "";
    marketingActive = true;
    // Hashed-email advanced matching uses whatever email we know RIGHT NOW;
    // identify() below re-pushes it if the user signs in after the pixel loads.
    var match = userEmail ? sha256(userEmail) : Promise.resolve("");
    match.then(function (emHash) {
      if (meta) {
        inline("hkl-meta",
          "!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};" +
          "if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;" +
          "s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');" +
          "fbq('init','" + meta.replace(/'/g, "") + "'" + (emHash ? ",{em:'" + emHash + "'}" : "") + ");fbq('track','PageView');");
      }
      if (tiktok) {
        inline("hkl-tt",
          "!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=['page','track','identify'];" +
          "ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};" +
          "for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);" +
          "var s=d.createElement('script');s.async=!0;s.src='https://analytics.tiktok.com/i18n/pixel/events.js';" +
          "d.head.appendChild(s)}(window,document,'ttq');" +
          "ttq.load('" + tiktok.replace(/'/g, "") + "');" +
          (emHash ? "ttq.identify({email:'" + emHash + "'});" : "") + "ttq.page();");
      }
    });
  }

  function apply(pref) {
    consentUpdate(pref);
    if (pref.analytics) loadAnalytics();
    if (pref.marketing) loadMarketing();
  }

  var box;
  function render(forceShow) {
    box = document.getElementById("consent");
    if (!box) return;
    var pref = read();
    if (gpc() && !pref) {
      pref = { necessary: true, analytics: false, marketing: false, gpc: true };
      write(pref);
    }
    if (pref && !forceShow) {
      box.style.display = "none";
      box.classList.add("hidden");
      box.innerHTML = "";
      apply(pref);
      return;
    }
    // Banner (first visit, or re-opened via Cookie Settings). Pre-check the
    // toggles from the stored preference so the visitor sees their current
    // choice instead of a blank form. Never delete the stored pref first —
    // the save handler compares against it to decide if a reload is needed
    // to truly unload already-running tags.
    var cur = pref || { analytics: false, marketing: false };
    box.style.display = "";
    box.classList.remove("hidden");
    box.innerHTML =
      '<p><strong>Cookies, your call.</strong> Necessary cookies keep the cart, the account, and checkout working. ' +
      'Analytics cookies help us understand visits. Marketing cookies run ad pixels that measure our campaigns. ' +
      'Nothing optional loads until you allow it. <a href="/privacy" data-link>Privacy notice</a>.</p>' +
      '<div class="consent-toggles hidden" id="cToggles">' +
      '<label class="consent-row"><span><strong>Necessary</strong><br><small>Cart, account, checkout. Always on.</small></span><input type="checkbox" checked disabled></label>' +
      '<label class="consent-row"><span><strong>Analytics</strong><br><small>Google Analytics, Contentsquare visit replay.</small></span><input type="checkbox" id="cAn"' + (cur.analytics ? " checked" : "") + "></label>" +
      '<label class="consent-row"><span><strong>Marketing</strong><br><small>Meta and TikTok ad pixels. May receive a hashed copy of your account email for matching — never your name or order details.</small></span><input type="checkbox" id="cMk"' + (cur.marketing ? " checked" : "") + "></label>" +
      "</div>" +
      '<div class="consent-actions">' +
      '<button class="btn" type="button" id="cAll">Accept all</button>' +
      '<button class="btn ghost" type="button" id="cNec">Necessary only</button>' +
      '<button class="btn ghost" type="button" id="cCustom">Customize</button>' +
      '<button class="btn hidden" type="button" id="cSave">Save choices</button>' +
      "</div>";
    var done = function (p, reload) {
      write(p);
      box.style.display = "none";
      box.classList.add("hidden");
      box.innerHTML = "";
      apply(p);
      if (reload) location.reload();
    };
    document.getElementById("cAll").onclick = function () {
      // Accept All is a superset of any previous choice: no reload needed.
      done({ necessary: true, analytics: true, marketing: true }, false);
    };
    document.getElementById("cNec").onclick = function () {
      var prev = read();
      var stricter = prev && (prev.analytics || prev.marketing);
      done({ necessary: true, analytics: false, marketing: false }, stricter);
    };
    document.getElementById("cCustom").onclick = function () {
      document.getElementById("cToggles").classList.remove("hidden");
      document.getElementById("cSave").classList.remove("hidden");
      document.getElementById("cCustom").classList.add("hidden");
    };
    document.getElementById("cSave").onclick = function () {
      var an = document.getElementById("cAn").checked;
      var mk = document.getElementById("cMk").checked;
      var prev = read();
      var stricter = prev && ((prev.analytics && !an) || (prev.marketing && !mk));
      done({ necessary: true, analytics: an, marketing: mk }, stricter);
    };
  }

  window.HKL_CONSENT = {
    get: get,
    show: function () {
      render(true);
      if (box) box.scrollIntoView({ block: "nearest" });
    },
    identify: function (email) {
      userEmail = String(email || "");
      // If the marketing pixel already loaded before sign-in, push the
      // hashed email now so advanced matching still works.
      if (userEmail && marketingActive) {
        sha256(userEmail).then(function (h) {
          if (!h) return;
          try { if (window.fbq && window.HKL_META_PIXEL_ID) window.fbq("init", window.HKL_META_PIXEL_ID, { em: h }); } catch (e) {}
          try { if (window.ttq && window.ttq.identify) window.ttq.identify({ email: h }); } catch (e2) {}
        });
      }
    },
    onChange: function (fn) { listeners.push(fn); },
    render: render
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest("#cookieSettings") : null;
    if (t) { e.preventDefault(); window.HKL_CONSENT.show(); }
  });
})();
