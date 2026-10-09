/* Helix King Labs — consent management v2.
   Granular, hard-gated, honest. No tag loads without the matching consent.
   Categories: necessary (always on), analytics, marketing.
   Exposes window.HKL_CONSENT { get, show, identify }. */
(function () {
  "use strict";
  var KEY = "hkl_consent_v2";
  var OLD_KEY = "hkl_consent";
  var listeners = [];
  var userEmail = "";

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

  function inject(id, src, defer) {
    if (document.getElementById(id)) return;
    var s = document.createElement("script");
    s.id = id;
    s.async = true;
    if (defer) s.defer = true;
    s.src = src;
    document.head.appendChild(s);
  }
  function inline(id, code) {
    if (document.getElementById(id)) return;
    var s = document.createElement("script");
    s.id = id;
    s.text = code;
    document.head.appendChild(s);
  }

  function dataLayer() {
    window.dataLayer = window.dataLayer || [];
    return window.dataLayer;
  }

  function loadAnalytics() {
    var ga = window.HKL_GA_MEASUREMENT_ID || "";
    dataLayer();
    // Consent defaults: everything denied until we explicitly grant below.
    if (!window.__hklConsentDefaults) {
      window.__hklConsentDefaults = true;
      dataLayer().push({ event: "consent_init", analytics: false, marketing: false });
    }
    dataLayer().push({ event: "consent_update", analytics: true, marketing: false });
    if (ga) {
      inject("hkl-ga", "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(ga));
      inline("hkl-gtag", "window.gtag=function(){window.dataLayer.push(arguments)};gtag('js',new Date());gtag('config','" + ga.replace(/'/g, "") + "',{anonymize_ip:true});");
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
    dataLayer().push({ event: "consent_update", analytics: true, marketing: true });
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
    if (pref.analytics) loadAnalytics();
    if (pref.marketing) loadMarketing();
  }

  var box;
  function render() {
    box = document.getElementById("consent");
    if (!box) return;
    var pref = read();
    if (gpc() && !pref) {
      pref = { necessary: true, analytics: false, marketing: false, gpc: true };
      write(pref);
    }
    if (pref) {
      box.classList.add("hidden");
      box.innerHTML = "";
      apply(pref);
      return;
    }
    box.classList.remove("hidden");
    box.innerHTML =
      '<p><strong>Cookies, your call.</strong> Necessary cookies keep the cart, the account, and checkout working. ' +
      'Analytics cookies help us understand visits. Marketing cookies run ad pixels that measure our campaigns. ' +
      'Nothing optional loads until you allow it. <a href="/privacy" data-link>Privacy notice</a>.</p>' +
      '<div class="consent-toggles hidden" id="cToggles">' +
      '<label class="consent-row"><span><strong>Necessary</strong><br><small>Cart, account, checkout. Always on.</small></span><input type="checkbox" checked disabled></label>' +
      '<label class="consent-row"><span><strong>Analytics</strong><br><small>Google Analytics, Contentsquare visit replay.</small></span><input type="checkbox" id="cAn"></label>' +
      '<label class="consent-row"><span><strong>Marketing</strong><br><small>Meta and TikTok ad pixels. May receive a hashed copy of your account email for matching — never your name or order details.</small></span><input type="checkbox" id="cMk"></label>' +
      '</div>' +
      '<div class="consent-actions">' +
      '<button class="btn" type="button" id="cAll">Accept all</button>' +
      '<button class="btn ghost" type="button" id="cNec">Necessary only</button>' +
      '<button class="btn ghost" type="button" id="cCustom">Customize</button>' +
      '<button class="btn hidden" type="button" id="cSave">Save choices</button>' +
      '</div>';
    var done = function (p, reload) {
      write(p);
      box.classList.add("hidden");
      box.innerHTML = "";
      apply(p);
      if (reload) location.reload();
    };
    document.getElementById("cAll").onclick = function () { done({ necessary: true, analytics: true, marketing: true }); };
    document.getElementById("cNec").onclick = function () { done({ necessary: true, analytics: false, marketing: false }); };
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
      try { localStorage.removeItem(KEY); } catch (e) {}
      render();
      if (box) box.scrollIntoView({ block: "nearest" });
    },
    identify: function (email) { userEmail = String(email || ""); },
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
