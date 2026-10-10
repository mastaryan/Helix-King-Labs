/* Helix King Labs — ops Payments. NOWPayments panel + manual (Cash App/Venmo) panel.
   Exposes window.HKL_OPS_PAYMENTS = { render(state), mount(view,state) }. */
(function () {
  function npPanel(st) {
    const np = st.integrations && st.integrations.nowpayments;
    const orders = (st.desk.orders || []).filter((o) => String(o.paymentMethod || "").toLowerCase() === "crypto");
    const open = orders.filter((o) => o.status === "not_paid");
    const finished = orders.filter((o) => ["paid", "shipped", "delivered"].includes(o.status));
    const statusLine = np && np.configured
      ? `<div class="kv">
          <span>API key</span><div>${pill("live", "Connected")}</div>
          <span>Auto-forward</span><div>${np.autoForward ? pill("live", "To your wallet") : `<span class="warn">Dashboard setting — not confirmed</span>`}</div>
          <span>Open invoices</span><div><b>${open.length}</b></div>
          <span>Finished</span><div><b>${finished.length}</b></div>
        </div>
        <p class="muted" style="margin-top:8px">Only <b>finished</b> marks an order PAID. IPN + the 3-minute recheck poller cover missed callbacks.</p>`
      : `<div class="connect-box"><p><b>NOWPayments not connected.</b></p><p>Set <code>NOWPAYMENTS_API_KEY</code> + <code>NOWPAYMENTS_IPN_SECRET</code> and live invoice status lands here.</p></div>`;
    const rows = orders.slice(0, 12).map((o) => {
      const p = o.payment || {};
      return `<tr>
        <td data-l="Order"><b>${esc(o.id)}</b><br><span class="muted">${when(o.created)}</span></td>
        <td data-l="Payment ID"><code style="font-size:11px">${esc(p.paymentId || p.payId || "—")}</code></td>
        <td data-l="Coin">${esc(p.payCurrency || p.currency || "—").toUpperCase()}</td>
        <td data-l="Expected">${p.payAmount ? money(p.payAmount) : "—"}</td>
        <td data-l="Received">${p.receivedAmount ? money(p.receivedAmount) : "—"}</td>
        <td data-l="Status">${pill(o.status === "not_paid" ? "not_paid" : "paid", p.status ? String(p.status).toUpperCase() : undefined)}</td>
      </tr>`;
    }).join("");
    return `<div class="panel full"><h3>NOWPayments <span class="tag">crypto rail</span></h3>
      ${statusLine}
      ${orders.length ? `<table class="responsive" style="margin-top:10px"><thead><tr><th>Order</th><th>Payment ID</th><th>Coin</th><th>Expected</th><th>Received</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<p class="muted" style="margin-top:8px">No crypto orders yet.</p>`}
    </div>`;
  }

  function manualPanel(st) {
    const orders = st.desk.orders || [];
    const manual = orders.filter((o) => ["venmo", "cashapp", "cash_app"].includes(String(o.paymentMethod || "").toLowerCase()));
    const today = new Date().toISOString().slice(0, 10);
    const todayTotal = manual.filter((o) => String(o.created || "").slice(0, 10) === today && o.status !== "voided")
      .reduce((s, o) => s + Number(o.total || 0), 0);
    const awaiting = manual.filter((o) => o.status === "not_paid");
    return `<div class="panel"><h3>Cash App <span class="tag">manual</span></h3>
      <div class="kv">
        <span>Handle</span><div><b>$FibKingPep</b></div>
        <span>QR</span><div><img src="/img/cashapp-qr.png" alt="Cash App QR" style="width:120px;border-radius:8px;border:1px solid var(--line)" onerror="this.outerHTML='<span class=&quot;muted&quot;>QR not uploaded yet</span>'" /></div>
        <span>Deep link</span><div><a href="https://cash.app/$FibKingPep" target="_blank" rel="noopener">cash.app/$FibKingPep</a></div>
      </div>
    </div>
    <div class="panel"><h3>Venmo <span class="tag">manual</span></h3>
      <div class="kv">
        <span>Handle</span><div><b>@fibkingpeps</b></div>
        <span>QR</span><div><img src="/img/venmo-qr.png" alt="Venmo QR" style="width:120px;border-radius:8px;border:1px solid var(--line)" onerror="this.outerHTML='<span class=&quot;muted&quot;>QR not uploaded yet</span>'" /></div>
        <span>Deep link</span><div><a href="https://venmo.com/u/fibkingpeps" target="_blank" rel="noopener">venmo.com/u/fibkingpeps</a></div>
      </div>
    </div>
    <div class="panel full"><h3>Manual review queue <span class="tag">${awaiting.length} awaiting</span></h3>
      <div class="kv" style="margin-bottom:10px">
        <span>Today's manual total</span><div><b>${money(todayTotal)}</b></div>
      </div>
      ${awaiting.length ? `<table class="responsive"><thead><tr><th>Order</th><th>Buyer</th><th>Total</th><th>Rail</th><th>Proof</th><th></th></tr></thead><tbody>
        ${awaiting.map((o) => `<tr>
          <td data-l="Order"><b>${esc(o.id)}</b></td>
          <td data-l="Buyer">${esc(o.email || "—")}</td>
          <td data-l="Total">${money(o.total)}</td>
          <td data-l="Rail">${esc(o.paymentMethod)}</td>
          <td data-l="Proof">${o.proofCount ? `<span class="pill info">${o.proofCount} 📎</span>` : `<span class="warn">none yet</span>`}</td>
          <td><button class="act sm" data-goto="${esc(o.id)}">Review →</button></td>
        </tr>`).join("")}</tbody></table>`
        : `<p class="muted">No manual payments waiting. Match the app note to the order id, check the proof, then mark PAID.</p>`}
    </div>`;
  }

  function render(st) {
    return `<div class="panels">${npPanel(st)}${manualPanel(st)}</div>
      <p class="muted">Crypto settles itself via NOWPayments. Venmo and Cash App never confirm themselves — every manual order needs eyes before PAID.</p>`;
  }
  function mount(view, st) {
    view.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", () => {
      state.order = (st.desk.orders || []).find((o) => o.id === b.dataset.goto) || null;
      state.tab = "orders";
      draw();
    }));
  }
  window.HKL_OPS_PAYMENTS = { render, mount };
})();
