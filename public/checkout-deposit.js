/* Helix King Labs — on-site crypto deposit screen.
   Widget-style embedded checkout: QR + address + amount + countdown, powered
   by the NOWPayments API (dynamic amounts per order). Uses window.HKL. */
(function () {
  function $(s) { return document.querySelector(s); }

  function showDepositScreen(order, pay) {
    const HKL = window.HKL || {};
    const money = HKL.money || ((n) => "$" + Number(n || 0).toFixed(2));
    const toast = HKL.toast || alert;
    const api = HKL.api;
    const app = $("#app");
    if (!app || !api) return;
    const qrUrl = "/api/qr?data=" + encodeURIComponent(pay.payAddress);
    const expiresAt = pay.expiresAt ? new Date(pay.expiresAt).getTime() : Date.now() + 30 * 60 * 1000;
    const oid = order.id;
    app.innerHTML = `<section class="page wrap">
      <div class="kicker">Crypto deposit</div>
      <h1>Send ${pay.payAmount} ${pay.payCurrency}</h1>
      <p class="lede">Order <b>${oid}</b> · ${money(order.quote && order.quote.total)} · ${pay.network} network</p>
      <div class="card" style="max-width:480px;margin:24px auto;padding:28px;text-align:center">
        <img src="${qrUrl}" alt="Deposit QR code" style="width:220px;height:220px;border:1px solid var(--line-2);border-radius:8px" />
        <p style="margin:16px 0 8px"><b>${pay.payAmount} ${pay.payCurrency}</b></p>
        <p class="muted" style="font-size:13px">on ${pay.network} — send exactly this amount</p>
        <div style="display:flex;gap:8px;margin:16px 0">
          <input id="depAddr" readonly value="${pay.payAddress}" style="flex:1;padding:10px;font-family:monospace;font-size:12px;border:1px solid var(--line-2);border-radius:6px" />
          <button class="btn" id="depCopy" type="button">Copy</button>
        </div>
        <p id="depTimer" class="muted" style="font-size:14px"></p>
        <p id="depStatus" class="hard" style="min-height:20px"></p>
        <div style="display:flex;gap:12px;justify-content:center;margin-top:16px;flex-wrap:wrap">
          <button class="btn" id="depSent" type="button">I sent it</button>
          <button class="btn ghost" id="depEdit" type="button">Edit order</button>
        </div>
        <p class="muted" style="font-size:12px;margin-top:16px">Do not send a different coin or network. Payment confirms automatically — or upload a screenshot on your receipt.</p>
      </div>
    </section>`;
    $("#depCopy").onclick = () => {
      const inp = $("#depAddr");
      inp.select();
      try {
        document.execCommand("copy");
        toast("Address copied.");
      } catch { toast("Copy the address manually."); }
    };
    // "I sent it" — flag the claim, thank them, send to receipt for proof upload.
    $("#depSent").onclick = async () => {
      try { await api("/api/orders/" + encodeURIComponent(oid) + "/claim", { method: "POST" }); } catch {}
      app.innerHTML = `<section class="page wrap" style="text-align:center;padding-top:48px">
        <div class="kicker">Thank you</div>
        <h1>Payment claimed</h1>
        <p class="lede">We're watching the blockchain for your deposit. It'll show as <b>PAID</b> automatically once confirmed.</p>
        <p class="hard" style="max-width:520px;margin:16px auto">Upload your payment receipt on the next page — it speeds things up if anything needs a manual check.</p>
        <a class="btn" href="/account/receipt/${oid}" data-link>Go to my receipt</a>
      </section>`;
      window.scrollTo(0, 0);
    };
    // "Edit order" — warn that nothing is finalized.
    $("#depEdit").onclick = () => {
      const ok = window.confirm(
        "Your order is NOT finalized.\n\n" +
        "If you go back now, the order will stay NOT PAID until you send the crypto " +
        "and hit \"I sent it\".\n\n" +
        "Continue back to edit your order?"
      );
      if (ok) location.href = "/cart";
    };
    const timerEl = $("#depTimer");
    const tick = () => {
      const left = Math.max(0, expiresAt - Date.now());
      const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      timerEl.textContent = left > 0 ? `Address expires in ${m}:${String(s).padStart(2, "0")}` : "Address expired — start a new order if needed.";
      if (left <= 0) clearInterval(timer);
    };
    const timer = setInterval(tick, 1000);
    tick();
    const statusEl = $("#depStatus");
    let polls = 0;
    const poll = setInterval(async () => {
      polls++;
      if (polls > 40) { clearInterval(poll); return; }
      try {
        const d = await api("/api/orders");
        const o = (d.orders || []).find((x) => x.id === oid);
        if (o && (o.status === "paid" || o.status === "shipped")) {
          clearInterval(poll);
          clearInterval(timer);
          statusEl.innerHTML = `<span style="color:#2a7">✓ Payment confirmed! Redirecting…</span>`;
          setTimeout(() => { location.href = "/account/receipt/" + oid; }, 1500);
        } else if (o && o.payment && (o.payment.paymentStatus === "confirming" || o.payment.paymentStatus === "confirmed")) {
          statusEl.textContent = "Payment detected — confirming…";
        }
      } catch {}
    }, 15000);
    window.scrollTo(0, 0);
  }

  window.HKL_DEPOSIT = showDepositScreen;
})();
