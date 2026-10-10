/* Helix King Labs — checkout confirmation renderer.
   Renders the Venmo/Cash App payment instructions after order placement.
   Loaded before app.js; uses window.HKL. */
(function () {
  function renderConfirm(order, pay) {
    const HKL = window.HKL || {};
    const money = HKL.money || ((n) => "$" + Number(n || 0).toFixed(2));
    const box = document.querySelector("#orderDone");
    if (!box) return;
    const total = money(order.quote && order.quote.total);
    const isVenmo = pay.provider === "venmo";
    if (isVenmo || pay.provider === "cashapp") {
      const name = isVenmo ? "Venmo" : "Cash App";
      const handle = isVenmo ? "@fibkingpeps" : "$FibKingPep";
      const qr = isVenmo ? "/img/venmo-qr.png" : "/img/cashapp-qr.png";
      const link = isVenmo ? "https://venmo.com/u/fibkingpeps" : "https://cash.app/$FibKingPep";
      box.innerHTML = `<div class="order-confirm" style="text-align:center;max-width:520px;margin:0 auto">
        <h3>Thank you — order ${order.id} placed</h3>
        <p class="grand">Total: ${total}</p>
        <div class="card" style="padding:20px;margin:16px 0">
          <img src="${qr}" alt="${name} QR" style="width:180px;height:180px;border-radius:8px" onerror="this.style.display='none'" />
          <p style="margin:12px 0 4px">${name} <b>${handle}</b> — send <b>${total}</b></p>
          <p class="muted" style="font-size:13px">Put <b>${order.id}</b> in the payment note. Friends &amp; family / personal payment.</p>
          <a class="btn" href="${link}" target="_blank" rel="noopener" style="margin-top:8px">Pay with ${name} →</a>
        </div>
        <p class="hard" style="font-size:15px">⚠️ The order does not ship until your ${name} payment is confirmed.</p>
        <p>You <b>must</b> upload your payment receipt on the next page — screenshot your payment confirmation and upload the photo.</p>
        <a class="btn" href="/account/receipt/${order.id}" data-link>Go to my receipt to upload proof</a>
        <p class="muted" style="font-size:12px;margin-top:12px">You cannot cancel the order after it is marked paid.</p>
      </div>`;
    } else {
      box.innerHTML = `<p class="lede">Payment could not start. ${pay.message || "Try again or use Venmo."}</p>`;
    }
  }
  window.HKL_CONFIRM = renderConfirm;
})();
