/* Helix King Labs — checkout funnel wiring.
   Standalone module; does not modify app.js (which is near the push size limit).
   Fires GA4 ecommerce events via window.HKL_TRACK at each funnel step:
   view_item -> add_to_cart -> view_cart -> begin_checkout ->
   add_payment_info -> add_shipping_info -> purchase_attempt -> purchase */
(function () {
  function funnel(step, params) {
    try {
      if (window.HKL_TRACK && window.HKL_TRACK.funnel) window.HKL_TRACK.funnel(step, params || {});
    } catch (e) {}
  }

  function currentSku() {
    try {
      var q = new URLSearchParams(location.search);
      return q.get("sku") || (location.pathname.split("/")[2] || "");
    } catch (e) {
      return "";
    }
  }

  // Catch the checkout response for the purchase event (order id + total).
  function wrapFetch() {
    if (window.fetch.__hklFunnel) return;
    var orig = window.fetch;
    window.fetch = async function (url, opts) {
      var res = await orig.apply(this, arguments);
      try {
        var u = String((url && url.url) || url || "");
        var method = String((opts && opts.method) || "GET").toUpperCase();
        if (u === "/api/checkout" && method === "POST" && res.ok) {
          var data = await res.clone().json().catch(function () { return {}; });
          var order = data.order || {};
          if (order.id) {
            funnel("purchase", {
              transaction_id: order.id,
              value: order.quote && order.quote.total,
              currency: "USD",
              payment_method: (order.payment && order.payment.provider) || "",
            });
          }
        }
      } catch (e) {}
      return res;
    };
    window.fetch.__hklFunnel = true;
  }

  function onRoute() {
    var p = location.pathname;
    if (p === "/cart") {
      funnel("view_cart", {});
      // The cart page carries the payment form — that IS checkout here.
      setTimeout(function () {
        if (document.querySelector("#payForm")) funnel("begin_checkout", {});
      }, 400);
    } else if (p.indexOf("/product/") === 0) {
      funnel("view_item", { item_sku: currentSku() });
    }
  }

  function wrapHistory() {
    if (history.pushState.__hklFunnel) return;
    var orig = history.pushState;
    history.pushState = function () {
      var r = orig.apply(this, arguments);
      setTimeout(onRoute, 60);
      return r;
    };
    history.pushState.__hklFunnel = true;
    window.addEventListener("popstate", function () { setTimeout(onRoute, 60); });
  }

  function bind() {
    document.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("#addBtn, #addKit") : null;
      if (!t) return;
      var isKit = t.id === "addKit";
      var qEl = document.querySelector(isKit ? "#kitQty" : "#qty");
      var qty = qEl ? Math.max(1, Number(qEl.value) || 1) : 1;
      funnel("add_to_cart", { item_sku: currentSku(), quantity: qty, kind: isKit ? "kit" : "single" });
    });
    document.addEventListener("change", function (e) {
      if (e.target && e.target.name === "paymentMethod") {
        funnel("add_payment_info", { payment_method: e.target.value });
      }
    });
    document.addEventListener("submit", function (e) {
      if (e.target && e.target.id === "payForm") {
        var checked = e.target.querySelector('input[name="paymentMethod"]:checked');
        funnel("add_shipping_info", {});
        funnel("purchase_attempt", { payment_method: (checked && checked.value) || "" });
      }
    });
  }

  function boot() {
    if (!window.HKL_TRACK) return void setTimeout(boot, 500);
    wrapFetch();
    wrapHistory();
    bind();
    onRoute();
  }
  boot();
})();
