// GA4 checkout funnel, scroll tracking, and pagehide beacon.
(function () {
  let trackingExcluded = false;
  // Skip analytics for owner IPs (e.g. Ryan's mobile) so testing doesn't pollute data
  fetch("/api/config").then((r) => r.json()).then((c) => {
    if (c && c.trackingExcluded) trackingExcluded = true;
  }).catch(() => {});
  function ga4(event, params) {
    if (trackingExcluded) return;
    try {
      if (window.dataLayer) window.dataLayer.push(Object.assign({ event }, params || {}));
      if (window.gtag) window.gtag("event", event, params || {});
    } catch (e) {}
  }

  // Checkout funnel steps
  const FUNNEL = {
    view_cart: "view_cart",
    begin_checkout: "begin_checkout",
    add_shipping_info: "add_shipping_info",
    add_payment_info: "add_payment_info",
    purchase_attempt: "purchase_attempt",
    purchase: "purchase",
  };
  function funnel(step, params) {
    ga4(FUNNEL[step] || step, Object.assign({ page: location.pathname }, params || {}));
  }

  // Scroll depth milestones (25/50/75/100)
  const scrollFired = {};
  function trackScroll() {
    const milestones = [25, 50, 75, 100];
    const onScroll = () => {
      const h = document.documentElement;
      const pct = Math.round(((h.scrollTop || 0) / ((h.scrollHeight - h.clientHeight) || 1)) * 100);
      for (const m of milestones) {
        const key = location.pathname + ":" + m;
        if (pct >= m && !scrollFired[key]) {
          scrollFired[key] = true;
          ga4("scroll_depth", { page: location.pathname, percent: m });
        }
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // Time on page (fires at 30s, 60s, 120s, 300s)
  function trackTime() {
    const marks = [30, 60, 120, 300];
    const start = Date.now();
    const page = location.pathname;
    for (const s of marks) {
      setTimeout(() => {
        // Only fire if still on the same page
        if (location.pathname === page) {
          ga4("time_on_page", { page, seconds: s });
        }
      }, s * 1000);
    }
  }

  // Pagehide beacon: last page, cart state, time spent
  let pageStart = Date.now();
  function trackExit() {
    const onHide = () => {
      const timeSpent = Math.round((Date.now() - pageStart) / 1000);
      let cartCount = 0;
      try {
        const cart = JSON.parse(localStorage.getItem("hkl_cart") || "[]");
        cartCount = Array.isArray(cart) ? cart.reduce((n, i) => n + (i.qty || 1), 0) : 0;
      } catch (e) {}
      const data = JSON.stringify({
        page: location.pathname,
        time_spent: timeSpent,
        cart_items: cartCount,
        at: new Date().toISOString(),
      });
      // Beacon is fire-and-forget, works on pagehide
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/track/exit", data);
      }
      ga4("page_exit", { page: location.pathname, time_spent: timeSpent, cart_items: cartCount });
    };
    window.addEventListener("pagehide", onHide);
    // Reset timer on SPA navigation
    const origPush = history.pushState;
    history.pushState = function () {
      pageStart = Date.now();
      return origPush.apply(this, arguments);
    };
  }

  function init() {
    trackScroll();
    trackTime();
    trackExit();
  }

  // Auto-init when DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.HKL_TRACK = { funnel, ga4 };
})();
