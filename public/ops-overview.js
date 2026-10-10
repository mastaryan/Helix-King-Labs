/* Helix King Labs — ops Overview. 4-quadrant stats + integration panels.
   Exposes window.HKL_OPS_OVERVIEW = { render(state) }. */
(function () {
  function quads(st) {
    const orders = st.desk.orders || [];
    const retail = orders.filter((o) => orderKind(o) === "retail");
    const ws = orders.filter((o) => orderKind(o) === "wholesale");
    const rev = orders.filter((o) => ["paid", "shipped", "delivered"].includes(o.status))
      .reduce((s, o) => s + Number(o.total || 0), 0);
    const unpaid = orders.filter((o) => o.status === "not_paid").length;
    const ready = orders.filter((o) => o.status === "paid").length;
    return `<div class="quads">
      <div class="quad"><b>${retail.length}</b><span>Retail orders</span><span class="delta">${retail.filter((o) => o.status === "not_paid").length} unpaid</span></div>
      <div class="quad"><b>${ws.length}</b><span>Wholesale orders</span><span class="delta">${ws.filter((o) => o.status === "not_paid").length} unpaid</span></div>
      <div class="quad"><b>${orders.length}</b><span>All orders</span><span class="delta">${unpaid} unpaid · ${ready} ready to ship</span></div>
      <div class="quad"><b>${money(rev)}</b><span>Revenue (paid+)</span><span class="delta">excludes unpaid</span></div>
    </div>`;
  }

  function gaPanel(st) {
    const g = st.integrations && st.integrations.ga;
    const body = (g && g.configured)
      ? `<div class="kv">
          <span>Sessions today</span><div><b>${g.sessions ?? "—"}</b></div>
          <span>Conversion rate</span><div><b>${g.conversion ?? "—"}</b></div>
          <span>Top pages</span><div>${(g.topPages || []).map((p) => esc(p)).join("<br>") || "—"}</div>
          <span>Top sources</span><div>${(g.sources || []).map((p) => esc(p)).join("<br>") || "—"}</div>
          <span>Funnel drop-off</span><div>${esc(g.funnel || "—")}</div>
        </div>`
      : `<div class="connect-box">
          <p><b>Google Analytics not wired to the desk yet.</b></p>
          <p>Set <code>GA_PROPERTY_ID</code> + a service-account key and the daily pulse — sessions, conversion, top pages, sources, funnel drop-off — lands here via the GA Data API. No offsite needed.</p>
        </div>`;
    return `<div class="panel"><h3>Google Analytics <span class="tag">GA4 · G-6HZJNLG29P</span></h3>${body}</div>`;
  }

  function resendPanel(st) {
    const r = st.integrations && st.integrations.resend;
    const recent = (r && r.recent) || [];
    const body = (r && r.configured)
      ? (recent.length
        ? `<table class="responsive"><thead><tr><th>To</th><th>Subject</th><th>Status</th><th>When</th></tr></thead><tbody>
           ${recent.slice(0, 8).map((m) => `<tr><td data-l="To">${esc(m.to || "—")}</td><td data-l="Subject">${esc(m.subject || "—")}</td>
           <td data-l="Status">${pill(m.status === "delivered" ? "paid" : m.status === "bounced" ? "voided" : "pending", m.status)}</td>
           <td data-l="When">${when(m.at)}</td></tr>`).join("")}</tbody></table>
           <p class="muted" style="margin-top:8px">Per-order: sent → delivered / opened / bounced, from the Resend API.</p>`
        : `<p class="muted">Resend is configured. Delivery events appear here once the webhook feed is wired.</p>`)
      : `<div class="connect-box"><p><b>Resend not configured.</b></p><p>Outbound mail status (order confirmations, expiry nudges) will show here.</p></div>`;
    return `<div class="panel"><h3>Resend <span class="tag">email delivery</span></h3>${body}</div>`;
  }

  function csPanel(st) {
    const c = st.integrations && st.integrations.contentsquare;
    return `<div class="panel"><h3>Contentsquare <span class="tag">session replay</span></h3>
      <div class="kv">
        <span>Project</span><div>${esc((c && c.projectId) || "1068524")}</div>
        <span>Status</span><div>${pill("live", (c && c.live) ? "Capturing" : "Tag live")}</div>
      </div>
      <p class="muted" style="margin-top:8px">Open a disputed or abandoned order → <b>watch session</b> links replay the buyer's visit. Full analysis stays in the Contentsquare dashboard.</p>
      <p><a href="https://app.contentsquare.com" target="_blank" rel="noopener">Open Contentsquare →</a></p>
    </div>`;
  }

  function discordPanel(st) {
    const d = st.integrations && st.integrations.discord;
    const invite = (d && d.invite) || "https://discord.gg/duGpW96r3a";
    let body;
    if (d && d.connected) {
      const sources = (d.inviteSources || []).map((s) =>
        `<div>${esc(s.name)} — <b>${s.joins}</b></div>`).join("") || `<span class="muted">Invite tracking needs the bot — member totals only for now.</span>`;
      body = `<div class="discord-stats">
          <div class="discord-stat"><b>${d.members ?? "—"}</b><span>Members</span></div>
          <div class="discord-stat"><b>${d.online ?? "—"}</b><span>Online now</span></div>
        </div>
        <h4 style="margin:12px 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">Where they came from</h4>
        ${sources}
        <p class="muted" style="margin-top:10px"><a href="${esc(invite)}" target="_blank" rel="noopener">Open invite →</a></p>`;
    } else {
      body = `<div class="connect-box">
        <p><b>Discord stats not connected yet.</b></p>
        <p>Server invite: <a href="${esc(invite)}" target="_blank" rel="noopener">${esc(invite)}</a></p>
        <p>Set <code>DISCORD_WIDGET_URL</code> (server widget JSON) and member count + online-now land here. Invite-source tracking needs the bot.</p>
      </div>`;
    }
    return `<div class="panel"><h3>Discord <span class="tag">community</span></h3>${body}</div>`;
  }

  function needsDecision(st) {
    const orders = st.desk.orders || [];
    const rows = orders.filter((o) => ["not_paid", "paid"].includes(o.status)).slice(0, 10);
    if (!rows.length) return `<p class="muted">Nothing waiting. The bench is clear.</p>`;
    return `<table class="responsive"><thead><tr><th>Order</th><th>Buyer</th><th>Total</th><th>Method</th><th>Status</th></tr></thead><tbody>
      ${rows.map((o) => rowHtml(o)).join("")}</tbody></table>`;
  }
  function rowHtml(o) {
    return `<tr class="pick" data-oid="${esc(o.id)}">
      <td data-l="Order"><b>${esc(o.id)}</b><br><span class="muted">${orderKind(o)}</span></td>
      <td data-l="Buyer">${esc(o.email || "—")}</td>
      <td data-l="Total">${money(o.total)}</td>
      <td data-l="Method">${esc(o.paymentMethod || "—")}</td>
      <td data-l="Status">${pill(o.status)}</td>
    </tr>`;
  }

  function render(st) {
    return `${quads(st)}
    <div class="panels">
      ${gaPanel(st)}
      ${resendPanel(st)}
      ${csPanel(st)}
      ${discordPanel(st)}
    </div>
    <h2>Needs a decision</h2>
    ${needsDecision(st)}
    <h2>How an order moves</h2>
    <ol>
      <li><b>NOT PAID</b> — match the Venmo/Cash App note to the order id, or wait for the crypto status to read finished.</li>
      <li><b>Mark PAID.</b> Stock is already held from checkout. Void puts it back.</li>
      <li>Pick the lot, book the label, paste carrier + tracking.</li>
      <li><b>Mark SHIPPED.</b> The public tracker only answers that tracking number.</li>
    </ol>
    <h2>Two-factor authentication</h2>
    <div class="panel" style="max-width:520px">
      <p class="muted" id="ops2faStatus">Checking…</p>
      <div class="stack" style="max-width:240px"><button class="btn" id="ops2faBtn">Set up authenticator</button></div>
      <div id="ops2faBox"></div>
    </div>
    <p class="muted" style="margin-top:16px">Nothing leaves the bench until the order is marked paid. Venmo and Cash App do not confirm themselves. Crypto updates when NOWPayments posts back.</p>`;
  }

  function mount(view, st) {
    view.querySelectorAll("[data-oid]").forEach((tr) => {
      tr.addEventListener("click", () => {
        state.order = (st.desk.orders || []).find((o) => o.id === tr.dataset.oid) || null;
        state.tab = "orders";
        draw();
      });
    });
  }

  window.HKL_OPS_OVERVIEW = { render, mount };
})();
