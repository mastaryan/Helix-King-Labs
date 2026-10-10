/* Helix King Labs — waitlist: "Join waitlist" button on sold-out product pages.
   Public script (NOT ops-only): the notify button lives on the storefront,
   but ops-fulfill.js is stripped for public visitors. Loaded before app.js;
   uses window.HKL at runtime. */
(function () {
  "use strict";
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

// ---- Notify-me: single gold button replaces out-of-stock, expands inline form ----
function trackEvent(name, params) {
  try {
    if (window.gtag) window.gtag("event", name, params || {});
    else if (window.dataLayer) window.dataLayer.push({ event: name, ...(params || {}) });
  } catch (e) {}
}

function notifyFormHtml(p, userEmail) {
  return `<form id="notifyForm" data-sku="${esc(p.sku || p.id)}" class="notify-form">
    <p class="notify-title">Get notified when ${esc(p.name)} ${esc(p.size)} is back.</p>
    <input type="email" name="email" placeholder="Email" required value="${esc(userEmail || "")}" />
    <textarea name="note" placeholder="What are you researching? (10+ characters)" required minlength="10" rows="2" style="width:100%"></textarea>
    <div class="captcha-row" style="display:flex;gap:8px;align-items:center;margin:8px 0">
      <span id="captchaQ" class="muted">Loading…</span>
      <input type="number" name="captchaAnswer" placeholder="?" required style="width:64px" />
      <input type="hidden" name="captchaId" id="captchaId" />
    </div>
    <label class="check"><input type="checkbox" name="consent" required /> Email me when it's back in stock. One email, no marketing list.</label>
    <div class="notify-actions">
      <button class="btn" type="submit">Notify me</button>
      <button class="btn ghost" type="button" id="notifyDismiss">No thanks</button>
    </div>
    <p class="muted" id="notifyMsg"></p>
  </form>`;
}

(function initNotify() {
  if (document.__hklNotifyBound) return;
  document.__hklNotifyBound = true;

  // Expand form on button click
  document.addEventListener("click", function (e) {
    var btn = e.target && e.target.id === "notifyBtn" ? e.target : null;
    if (!btn) return;
    var wrap = document.getElementById("notifyWrap");
    if (!wrap) return;
    if (wrap.innerHTML) { wrap.innerHTML = ""; return; } // toggle closed
    var HKL = window.HKL || {};
    var sku = btn.getAttribute("data-s") || "";
    // Find product data from HKL state
    var p = null;
    try {
      var items = (HKL.state && HKL.state.catalog && HKL.state.catalog.items) || [];
      p = items.find(function (x) { return x.sku === sku || x.id === sku; }) || { sku: sku, name: sku, size: "" };
    } catch (err) { p = { sku: sku, name: sku, size: "" }; }
    var userEmail = (HKL.state && HKL.state.user && HKL.state.user.email) || "";
    wrap.innerHTML = notifyFormHtml(p, userEmail);
    // Load CAPTCHA
    var api = HKL.api;
    if (api) {
      api("/api/captcha").then(function (c) {
        var q = document.getElementById("captchaQ");
        var cid = document.getElementById("captchaId");
        if (q) q.textContent = c.question || "";
        if (cid) cid.value = c.id || "";
      }).catch(function () {
        var q = document.getElementById("captchaQ");
        if (q) q.textContent = "CAPTCHA unavailable — try again.";
      });
    }
    trackEvent("notify_click", { sku: sku });
  });

  // Dismiss
  document.addEventListener("click", function (e) {
    if (e.target && e.target.id === "notifyDismiss") {
      var wrap = document.getElementById("notifyWrap");
      if (wrap) wrap.innerHTML = "";
      var btn = document.getElementById("notifyBtn");
      trackEvent("notify_dismiss", { sku: btn ? btn.getAttribute("data-s") : "" });
    }
  });

  // Submit
  document.addEventListener("submit", async function (e) {
    var form = e.target && e.target.id === "notifyForm" ? e.target : null;
    if (!form) return;
    e.preventDefault();
    var HKL = window.HKL || {};
    var api = HKL.api;
    var toast = HKL.toast || alert;
    var fd = new FormData(form);
    var msg = document.getElementById("notifyMsg");
    var sku = form.getAttribute("data-s");
    try {
      await api("/api/waitlist", { method: "POST", body: { email: fd.get("email"), sku: sku, note: fd.get("note"), consent: !!fd.get("consent"), captchaId: fd.get("captchaId"), captchaAnswer: fd.get("captchaAnswer") } });
      trackEvent("notify_submit", { sku: sku });
      if (msg) msg.textContent = "You're on the list. We'll email you once when it's back.";
      else toast("You're on the notify list.");
      form.reset();
      setTimeout(function () { var w = document.getElementById("notifyWrap"); if (w) w.innerHTML = ""; }, 3000);
    } catch (err) {
      var m = err.message === "consent_required" ? "Check the consent box to get notified." : "Could not join the list: " + (err.message || "error");
      if (msg) msg.textContent = m;
      else toast(m);
    }
  });
})();
})();
