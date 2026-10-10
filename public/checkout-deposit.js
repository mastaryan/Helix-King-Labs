/* Helix King Labs — on-site crypto deposit screen.
   Auto-polling status steps: no "I sent it" button needed.
   The backend detects the payment via NOWPayments; this page just watches.
   Venmo/Cash App keep their "I sent it" + proof upload flow (separate). */
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
    app.innerHTML = `<section class="page wrap np-pay">
      <div class="kicker">Crypto deposit</div>
      <h1>Send ${pay.payAmount} ${pay.payCurrency}</h1>
      <p class="lede">Order <b>${oid}</b> · ${money(order.quote && order.quote.total)} · ${pay.network} network</p>
      <div class="card" style="max-width:480px;margin:24px auto;padding:28px;text-align:center">
        <img src="${qrUrl}" alt="Deposit QR code" style="display:block;margin:0 auto;max-width:60vw;width:220px;height:auto;border:1px solid var(--line-2);border-radius:8px" />
        <p style="margin:16px 0 8px"><b>${pay.payAmount} ${pay.payCurrency}</b></p>
        <p class="muted" style="font-size:13px">on ${pay.network} — send exactly this amount</p>
        <div style="display:flex;gap:8px;margin:16px 0">
          <input id="depAddr" readonly value="${pay.payAddress}" style="flex:1;padding:10px;font-family:monospace;font-size:12px;border:1px solid var(--line-2);border-radius:6px" />
          <button class="btn" id="depCopy" type="button">Copy</button>
        </div>
        <p class="codeaddr" style="font-family:monospace;font-size:13px;margin:-6px 0 14px;overflow-wrap:anywhere;word-break:break-all">${pay.payAddress}</p>
        <p id="depTimer" class="muted" style="font-size:14px"></p>
        <div id="depSteps" style="text-align:left;margin:20px 0">
          <div class="dep-step" data-step="created" style="display:flex;align-items:center;gap:12px;padding:8px 0">
            <span class="dep-dot" style="width:28px;height:28px;border-radius:50%;background:#2a5a2a;color:#8f8;display:flex;align-items:center;justify-content:center;font-weight:bold">✓</span>
            <span>Invoice created</span>
          </div>
          <div class="dep-step" data-step="waiting" style="display:flex;align-items:center;gap:12px;padding:8px 0">
            <span class="dep-dot" style="width:28px;height:28px;border-radius:50%;background:#d4a843;color:#000;display:flex;align-items:center;justify-content:center;font-weight:bold;animation:depPulse 1.5s infinite">◌</span>
            <span><b>Waiting for your payment…</b><br><span style="font-size:12px;color:#888">Checking every 10 seconds</span></span>
          </div>
          <div class="dep-step" data-step="detected" style="display:flex;align-items:center;gap:12px;padding:8px 0;opacity:0.4">
            <span class="dep-dot" style="width:28px;height:28px;border-radius:50%;background:#333;color:#888;display:flex;align-items:center;justify-content:center;font-weight:bold">3</span>
            <span>Payment detected</span>
          </div>
          <div class="dep-step" data-step="confirmed" style="display:flex;align-items:center;gap:12px;padding:8px 0;opacity:0.4">
            <span class="dep-dot" style="width:28px;height:28px;border-radius:50%;background:#333;color:#888;display:flex;align-items:center;justify-content:center;font-weight:bold">4</span>
            <span>Confirmed — order paid</span>
          </div>
        </div>
        <style>@keyframes depPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }</style>
        <p class="muted" style="font-size:12px;margin-top:16px">Just send the crypto. This page updates on its own when it arrives. You can close this tab — we'll email you.</p>
        <p class="muted" style="font-size:12px;margin-top:8px">Do not send a different coin or network.</p>
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

    const timerEl = $("#depTimer");
    const tick = () => {
      const left = Math.max(0, expiresAt - Date.now());
      const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      timerEl.textContent = left > 0 ? `Address expires in ${m}:${String(s).padStart(2, "0")}` : "Address expired — start a new order if needed.";
      if (left <= 0) { clearInterval(timer); clearInterval(poll); }
    };
    const timer = setInterval(tick, 1000);
    tick();

    function setStep(name) {
      const steps = { waiting: 1, detected: 2, confirmed: 3 };
      const order = ["waiting", "detected", "confirmed"];
      document.querySelectorAll("#depSteps .dep-step").forEach((el) => {
        const s = el.getAttribute("data-step");
        if (s === "created") return;
        const dot = el.querySelector(".dep-dot");
        if (steps[s] < steps[name]) {
          el.style.opacity = "1";
          dot.style.background = "#2a5a2a"; dot.style.color = "#8f8"; dot.textContent = "✓";
        } else if (s === name) {
          el.style.opacity = "1";
          dot.style.background = "#d4a843"; dot.style.color = "#000"; dot.textContent = "◌";
          dot.style.animation = "depPulse 1.5s infinite";
        }
      });
    }

    let polls = 0;
    const poll = setInterval(async () => {
      polls++;
      if (polls > 180) { clearInterval(poll); return; } // 30 min max
      try {
        const d = await api("/api/orders/" + encodeURIComponent(oid) + "/payment");
        if (!d) return;
        if (d.status === "paid" || d.status === "shipped" || d.status === "delivered") {
          clearInterval(poll); clearInterval(timer);
          setStep("confirmed");
          setTimeout(() => { location.href = "/account/receipt/" + oid; }, 2000);
        } else if (d.paymentStatus === "confirming" || d.paymentStatus === "confirmed" || d.paymentStatus === "sending") {
          setStep("detected");
        } else if (d.actuallyPaid != null && Number(d.actuallyPaid) > 0) {
          setStep("detected");
        }
      } catch {}
    }, 10000);
    window.scrollTo(0, 0);
  }

  window.HKL_DEPOSIT = showDepositScreen;
})();
