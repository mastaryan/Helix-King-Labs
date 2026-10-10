/* Helix King Labs — ops Orders. Tabs, pills, table, detail drawer, confirm modals.
   Exposes window.HKL_OPS_ORDERS = { render(state), mount(view,state), detail(order,state) }. */
(function () {
  const KIND_TABS = [["all", "All"], ["retail", "Retail"], ["wholesale", "Wholesale"]];
  const STATUS_PILLS = [
    ["open", "Latest"], ["not_paid", "Not paid"], ["paid", "Paid"],
    ["shipped", "Shipped"], ["delivered", "Delivered"], ["voided", "Void"],
  ];
  function statusLabel(s) {
    return { not_paid: "NOT PAID", committed: "COMMITTED", paid: "PAID", shipped: "SHIPPED", delivered: "DELIVERED", voided: "VOID", disputed: "DISPUTED" }[s] || s;
  }
  function filtered(st) {
    const all = st.desk.orders || [];
    const kind = st.kind || "all";
    const f = st.filter || "open";
    const q = (st.orderSearch || "").toLowerCase().trim();
    let rows = all.filter((o) => {
      if (kind !== "all" && orderKind(o) !== kind) return false;
      if (f === "open") return ["not_paid", "paid", "committed"].includes(o.status);
      if (f === "not_paid") return ["not_paid", "committed"].includes(o.status);
      return o.status === f;
    });
    if (q) rows = rows.filter((o) =>
      String(o.id || "").toLowerCase().includes(q) ||
      String(o.email || "").toLowerCase().includes(q) ||
      String(o.company || o.name || "").toLowerCase().includes(q));
    const sortKey = st.orderSort || "newest";
    const fns = {
      newest: (a, b) => new Date(b.created || 0) - new Date(a.created || 0),
      oldest: (a, b) => new Date(a.created || 0) - new Date(b.created || 0),
      totalHigh: (a, b) => (b.total || 0) - (a.total || 0),
      totalLow: (a, b) => (a.total || 0) - (b.total || 0),
    };
    return rows.slice().sort(fns[sortKey] || fns.newest);
  }
  function methodBadge(o) {
    const m = String(o.paymentMethod || "").toLowerCase();
    if (m === "crypto") return `<span class="pill gold">Crypto</span>`;
    if (m === "venmo") return `<span class="pill info">Venmo</span>`;
    if (m === "cashapp" || m === "cash_app") return `<span class="pill ok">Cash App</span>`;
    return `<span class="pill dim">${esc(o.paymentMethod || "—")}</span>`;
  }
  function render(st) {
    const rows = filtered(st);
    const f = st.filter || "open";
    const kind = st.kind || "all";
    return `<div class="toolbar">
      <div class="filters" role="tablist" aria-label="Kind">
        ${KIND_TABS.map(([id, l]) => `<button data-kind="${id}" class="${kind === id ? "on" : ""}">${l}</button>`).join("")}
      </div>
      <div class="filters" aria-label="Status">
        ${STATUS_PILLS.map(([id, l]) => `<button data-f="${id}" class="${f === id ? "on" : ""}">${l}</button>`).join("")}
      </div>
      <input type="search" id="orderSearch" placeholder="Search ID, email, name…" value="${esc(st.orderSearch || "")}" />
      <select id="orderSort">
        <option value="newest"${st.orderSort === "newest" ? " selected" : ""}>Newest first</option>
        <option value="oldest"${st.orderSort === "oldest" ? " selected" : ""}>Oldest first</option>
        <option value="totalHigh"${st.orderSort === "totalHigh" ? " selected" : ""}>Highest total</option>
        <option value="totalLow"${st.orderSort === "totalLow" ? " selected" : ""}>Lowest total</option>
      </select>
      <span class="muted">${rows.length} order${rows.length === 1 ? "" : "s"}</span>
    </div>
    <table class="responsive"><thead><tr>
      <th>Order</th><th>Buyer</th><th>Items</th><th>Total</th><th>Method</th><th>Status</th><th>Proof</th><th></th>
    </tr></thead><tbody>
    ${rows.map((o) => {
      const n = (o.lines || []).reduce((s, l) => s + Number(l.qty || 0), 0);
      const proof = o.proofCount ? `<span class="pill info">${o.proofCount} 📎</span>` : `<span class="muted">—</span>`;
      return `<tr class="pick" data-oid="${esc(o.id)}">
        <td data-l="Order"><b>${esc(o.id)}</b></td>
        <td data-l="Buyer">${esc(o.email || "—")}<br><span class="muted">${esc(o.name || "")}</span></td>
        <td data-l="Items">${n}</td>
        <td data-l="Total"><b>${money(o.total)}</b></td>
        <td data-l="Method">${methodBadge(o)}</td>
        <td data-l="Status">${pill(o.status, statusLabel(o.status))}</td>
        <td data-l="Proof">${proof}</td>
        <td>${o.status === "voided" ? `<button class="act sm" data-del-order="${esc(o.id)}">Delete</button>` : ""}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="8" class="muted">No orders in this view.</td></tr>`}
    </tbody></table>`;
  }

  function detail(o, st) {
    const s = o.ship || {};
    const pay = o.payment || {};
    const lines = (o.lines || []).map((l) =>
      `<tr><td>${esc(l.sku)}</td><td>${esc(l.name)} ${esc(l.size || "")}</td><td>${esc(l.lot || "—")}</td><td>${l.qty}${l.kind === "kit" ? " kit" : ""}</td><td>${money(l.line)}</td></tr>`).join("");
    const d = $("#detail");
    d.hidden = false;
    $("#shell").classList.remove("no-detail");
    d.innerHTML = `<h2>${esc(o.id)}</h2>
      <p class="muted">${when(o.created)} · ${esc(o.channel || "shop")} · ${esc(o.email || "")} · ${orderKind(o)}</p>
      <div class="kv">
        <span>Status</span><div>${pill(o.status, statusLabel(o.status))}</div>
        <span>Buyer</span><div>${esc(o.name || "—")} · ${esc(o.phone || "no phone")}<br>${esc(o.company || "—")} · ${esc(o.researchField || "—")}</div>
        <span>Ship-to</span><div>${s.line1 ? `${esc(s.name || "")}<br>${esc(s.line1)}${s.line2 ? "<br>" + esc(s.line2) : ""}<br>${esc(s.city || "")}, ${esc(s.region || "")} ${esc(s.postal || "")}` : `<span class="warn">Missing — do not ship.</span>`}</div>
        <span>Pay</span><div>${esc(o.paymentMethod || "—")} · ${esc(o.paymentStatus || o.status)}<br>${pay.payAddress ? `${esc(pay.payAmount)} ${esc(pay.payCurrency)} · <code style="word-break:break-all">${esc(pay.payAddress)}</code>` : pay.handle ? "@" + esc(pay.handle) + " note " + esc(o.id) : ""}</div>
        <span>Money</span><div>Merch ${money(o.merchandise)} · ship ${money(o.shipping)}${o.coupon ? ` · code ${esc(o.coupon)}` : ""}${o.couponOff ? " −" + money(o.couponOff) : ""}<br>Total <b>${money(o.total)}</b>${o.affiliateCode ? ` · affiliate ${esc(o.affiliateCode)} ${money(o.affiliatePayout)}` : ""}</div>
        <span>Track</span><div>${esc(o.carrier || "—")} ${esc(o.tracking || "")}</div>
      </div>
      <table><thead><tr><th>SKU</th><th>Line</th><th>Lot</th><th>Qty</th><th></th></tr></thead><tbody>${lines}</tbody></table>
      <div class="stack">
        <input id="dCarrier" placeholder="Carrier" value="${esc(o.carrier || "")}" />
        <input id="dTrack" placeholder="Tracking number" value="${esc(o.tracking || "")}" />
        <textarea id="dNote" rows="3" placeholder="Internal note — not on the receipt">${esc(o.internalNote || "")}</textarea>
        ${o.status === "not_paid" && o.paymentMethod === "crypto" ? `<button class="act" id="recheck">Re-check crypto</button><p class="muted">Re-check asks NOWPayments if the callback was missed.</p>` : ""}
        <button class="act" data-act="paid">Mark paid</button>
        <button class="act" data-act="shipped">Mark shipped</button>
        <button class="act" data-act="note">Save note</button>
        <button class="act" data-act="voided">Void and restore stock</button>
        <button class="act sm" id="closeDetail">Close</button>
      </div>
      <p class="muted">${(o.events || []).map((e) => when(e.at) + " · " + esc(e.kind) + " · " + esc(e.by || "")).join("<br>")}</p>`;
    $("#closeDetail").onclick = () => { state.order = null; draw(); };
    const re = document.getElementById("recheck");
    if (re) re.onclick = async () => {
      try {
        const out = await api("/api/ops/orders/recheck", { method: "POST", body: { id: o.id } });
        await load();
        state.order = (state.desk.orders || []).find((x) => x.id === o.id) || null;
        draw();
        toast("Payment status: " + (out.paymentStatus || out.status));
      } catch (err) { toast(err.error || "Re-check failed."); }
    };
    d.querySelectorAll("[data-act]").forEach((btn) => {
      btn.onclick = async () => {
        const act = btn.dataset.act;
        const trackVal = $("#dTrack") ? $("#dTrack").value.trim() : "";
        const carrierVal = $("#dCarrier") ? $("#dCarrier").value.trim() : "";
        const map = {
          paid: { title: "Mark paid", consequence: "The customer is told their payment cleared. Stock stays held. This cannot be undone by the customer.", danger: false },
          shipped: { title: "Mark shipped", consequence: trackVal && carrierVal ? "Tracking goes live for the customer." : "⚠️ NO TRACKING SAVED. The customer will see 'shipped' with no tracking number. Add carrier + tracking first, or confirm you want to ship without it.", danger: !(trackVal && carrierVal) },
          voided: { title: "Void order", consequence: "The order is cancelled, held stock is released back to inventory, and the customer is notified.", danger: true },
          note: null,
        };
        if (map[act]) {
          const ok = await confirmAction({ title: map[act].title, orderId: o.id, action: map[act].title, consequence: map[act].consequence, danger: map[act].danger });
          if (!ok) return;
        }
        try {
          await api("/api/ops/orders", { method: "POST", body: {
            id: o.id, status: act === "note" ? o.status : act,
            carrier: $("#dCarrier").value, tracking: $("#dTrack").value, internalNote: $("#dNote").value,
          }});
          await load();
          state.order = (state.desk.orders || []).find((x) => x.id === o.id) || null;
          draw();
          toast(act === "note" ? "Note saved." : `Order ${o.id}: ${act}.`);
        } catch (err) {
          toast(err.error === "settle_first" ? "Mark paid before shipped." : "Could not save that order.");
        }
      };
    });
  }

  function mount(view, st) {
    view.querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => { state.kind = b.dataset.kind; draw(); }));
    view.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => { state.filter = b.dataset.f; draw(); }));
    view.querySelectorAll("[data-oid]").forEach((tr) => tr.addEventListener("click", (e) => {
      if (e.target.closest("[data-del-order]")) return;
      state.order = (st.desk.orders || []).find((o) => o.id === tr.dataset.oid) || null;
      draw();
    }));
    view.querySelectorAll("[data-del-order]").forEach((b) => b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = b.dataset.delOrder;
      const o = (st.desk.orders || []).find((x) => x.id === id);
      if (!o || o.status !== "voided") { toast("Only voided orders can be deleted."); return; }
      const ok = await confirmAction({
        title: "Delete order", orderId: id, action: "Permanently delete",
        consequence: "This voided order is removed from the desk forever. Stock was already restored when it was voided — deleting does not touch inventory again.",
        danger: true,
      });
      if (!ok) return;
      const typed = prompt(`Type the order ID to confirm deletion of ${id}:`);
      if (typed !== id) { toast("Delete cancelled."); return; }
      try {
        await api("/api/ops/orders?id=" + encodeURIComponent(id), { method: "DELETE" });
        state.desk.orders = (state.desk.orders || []).filter((x) => x.id !== id);
        toast(`Order ${id} deleted.`);
        draw();
      } catch { toast("Delete failed — try again."); }
    }));
  }

  window.HKL_OPS_ORDERS = { render, mount, detail };
})();
