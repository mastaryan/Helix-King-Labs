const $ = (s) => document.querySelector(s);
const state = { tab: "overview", filter: "open", order: null, desk: null, user: null };

const TABS = [
  ["overview", "Overview"],
  ["orders", "Orders"],
  ["accounts", "Accounts"],
  ["list", "Email list"],
  ["inventory", "Inventory"],
  ["affiliates", "Affiliates"],
  ["promos", "Promos"],
  ["audit", "Audit"],
  ["catalog", "Catalog editor"],
];

function money(n) {
  const v = Number(n || 0);
  return "$" + v.toFixed(2);
}
function when(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function pill(status) {
  const map = {
    awaiting_settlement: ["Unpaid", "wait"],
    settled: ["Paid", "ok"],
    shipped: ["Shipped", "ok"],
    voided: ["Void", "bad"],
    hold: ["Hold", "wait"],
    ready: ["Ready", "ok"],
    hold_until_minimum: ["Group hold", "wait"],
  };
  const hit = map[status] || [status || "—", ""];
  return `<span class="pill ${hit[1]}">${hit[0]}</span>`;
}
async function api(path, opts) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: opts && opts.body ? { "Content-Type": "application/json" } : {},
    method: (opts && opts.method) || "GET",
    body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw data;
  return data;
}
function shipLine(o) {
  const s = o.ship || {};
  if (!s.line1) return `<span class="warn">Ship-to missing</span>`;
  return `${s.city || ""}, ${s.region || ""} ${s.postal || ""}`;
}
function openOrders(rows) {
  return rows.filter((o) => o.status === "awaiting_settlement" || o.status === "settled");
}

function nav() {
  const orders = (state.desk && state.desk.orders) || [];
  const unpaid = orders.filter((o) => o.status === "awaiting_settlement").length;
  $("#nav").innerHTML = TABS.map(([id, label]) => {
    const n = id === "orders" && unpaid ? unpaid : "";
    return `<button data-tab="${id}" class="${state.tab === id ? "on" : ""}">${label}<span>${n}</span></button>`;
  }).join("");
  $("#nav").onclick = (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    state.tab = btn.dataset.tab;
    state.order = null;
    draw();
  };
}

function overview() {
  const d = state.desk;
  const s = d.summary || {};
  const unpaid = (d.orders || []).filter((o) => o.status === "awaiting_settlement");
  const ready = (d.orders || []).filter((o) => o.status === "settled");
  return `<div class="cards">
    <div class="card"><b>${unpaid.length}</b><span>Unpaid</span></div>
    <div class="card"><b>${ready.length}</b><span>Paid, not shipped</span></div>
    <div class="card"><b>${s.low || 0}</b><span>Low stock</span></div>
    <div class="card"><b>${s.list || 0}</b><span>Email list</span></div>
  </div>
  <p class="muted">Nothing leaves the bench until the order is marked paid. Venmo and Cash App do not confirm themselves. Crypto updates when NOWPayments posts back.</p>
  <h2>Needs a decision</h2>
  ${table(unpaid.concat(ready).slice(0, 12), true)}
  <h2>How an order moves</h2>
  <ol>
    <li>Unpaid — match the Venmo or Cash App note to the order id, or wait for the crypto status to read finished.</li>
    <li>Mark paid. Stock is already held from checkout. Void puts it back.</li>
    <li>Pick the lot printed on the line. Book the label. Paste carrier and tracking.</li>
    <li>Mark shipped. The public tracker only answers that tracking number.</li>
  </ol>`;
}

function table(rows, compact) {
  if (!rows.length) return `<p class="muted">Nothing in this view.</p>`;
  return `<table><thead><tr><th>Order</th><th>Buyer</th><th>Ship</th><th>Pay</th><th>Status</th><th>Total</th></tr></thead><tbody>
    ${rows.map((o) => `<tr class="pick ${state.order && state.order.id === o.id ? "on" : ""}" data-id="${o.id}">
      <td>${o.id}<div class="muted">${when(o.created)}${o.channel === "group_buy" ? " · group" : ""}</div></td>
      <td>${o.email}<div class="muted">${o.company || o.name || ""}</div></td>
      <td>${shipLine(o)}</td>
      <td>${o.paymentMethod || "—"}${o.paymentStatus ? `<div class="muted">${o.paymentStatus}</div>` : ""}</td>
      <td>${pill(o.status)} ${pill(o.fulfillment)}</td>
      <td>${money(o.total)}</td>
    </tr>`).join("")}
  </tbody></table>`;
}

function orders() {
  const all = state.desk.orders || [];
  const f = state.filter;
  const rows = all.filter((o) => {
    if (f === "open") return o.status === "awaiting_settlement" || o.status === "settled";
    if (f === "all") return true;
    return o.status === f;
  });
  return `<div class="filters">
    ${["open", "awaiting_settlement", "settled", "shipped", "voided", "all"].map((id) => `<button data-f="${id}" class="${f === id ? "on" : ""}">${id === "open" ? "Open" : id === "all" ? "All" : id.replace("_", " ")}</button>`).join("")}
  </div>${table(rows)}`;
}

function accounts() {
  const rows = state.desk.customers || [];
  const ops = new Set((state.desk.opsEmails || []).map((e) => e.toLowerCase()));
  return `<p class="muted">Desk access is the ops email list plus any account marked ops. Customers do not see prices until they pass the age gate, and they cannot check out without an account.</p>
  <table><thead><tr><th>Email</th><th>Name</th><th>Company</th><th>Field</th><th>Orders</th><th>Desk</th></tr></thead><tbody>
  ${rows.map((c) => `<tr><td>${c.email}</td><td>${c.name || "—"}</td><td>${c.company || "—"}</td><td>${c.researchField || "—"}</td><td>${c.orders}</td><td>${ops.has(String(c.email).toLowerCase()) ? "ops" : "—"}</td></tr>`).join("")}
  </tbody></table>`;
}

function list() {
  const rows = state.desk.captures || [];
  return `<p class="muted">Stored addresses. Outbound mail still waits on SMTP. Export is the orders and inventory CSV links above.</p>
  <table><thead><tr><th>Email</th><th>Source</th><th>Joined</th></tr></thead><tbody>
  ${rows.map((c) => `<tr><td>${c.email}</td><td>${c.source || "—"}</td><td>${when(c.created)}</td></tr>`).join("") || `<tr><td colspan="3">No addresses yet.</td></tr>`}
  </tbody></table>`;
}

function inventory() {
  const rows = state.desk.inventory || [];
  return `<table><thead><tr><th>SKU</th><th>Material</th><th>Lot</th><th>On hand</th><th>Cost</th><th>List</th><th>Certificate</th></tr></thead><tbody>
  ${rows.map((r) => `<tr><td>${r.sku}</td><td>${r.name} ${r.size}</td><td>${r.lot || "—"}</td><td class="${r.low ? "warn" : ""}">${r.on_hand}</td><td>${r.unit_cost == null ? "—" : money(r.unit_cost)}</td><td>${r.price == null ? "—" : money(r.price)}</td><td>${r.certificate}</td></tr>`).join("")}
  </tbody></table>
  <p class="muted">Lot, stock, cost, and certificate edits stay on the catalog editor below this table in the old desk tools, and on /tools/label for print.</p>
  <p><a href="/tools/label">Label maker</a></p>`;
}

function affiliates() {
  const rows = state.desk.affiliates || [];
  const reqs = state.desk.payoutRequests || [];
  return `<h2>New affiliate</h2>
  <form id="affForm" class="tool-form" style="margin-bottom:16px">
    <input name="email" type="email" placeholder="Affiliate email" required />
    <input name="code" placeholder="Code (auto if blank)" maxlength="16" style="text-transform:uppercase" />
    <button class="btn" type="submit">Create code</button>
    <div class="err" id="affErr"></div>
  </form>
  ${reqs.length ? `<h2>Payout requests</h2>
  <table><thead><tr><th>Code</th><th>Email</th><th>Amount</th><th>Method</th><th>Detail</th><th>Requested</th><th></th></tr></thead><tbody>
  ${reqs.map((r) => `<tr><td>${r.code}</td><td>${r.email || "—"}</td><td><b>${money(r.amount)}</b></td><td>${r.method === "cashapp" ? "Cash App" : "Crypto"}</td><td class="muted">${r.detail || "—"}</td><td>${(r.requested || "").slice(0, 10)}</td>
  <td><button class="act" data-payreq="${r.code}" data-amt="${r.amount}">Mark paid</button></td></tr>`).join("")}
  </tbody></table>` : ``}
  <h2>Affiliates</h2>
  ${!rows.length ? `<p class="muted">No desks open.</p>` : `
  <table><thead><tr><th>Code</th><th>Email</th><th>Status</th><th>Earned</th><th>Paid</th><th>Owed</th><th></th></tr></thead><tbody>
  ${rows.map((a) => {
    const earned = Number(a.earned || 0), paid = Number(a.paid || 0);
    return `<tr><td>${a.code || "—"}<div class="muted">/shop?ref=${a.code || ""}</div></td><td>${a.email || a.userId || "—"}</td><td>${a.status || "—"}</td><td>${money(earned)}</td><td>${money(paid)}</td><td><b>${money(earned - paid)}</b></td>
    <td><button class="act" data-aff="${a.code}" data-op="toggle">${a.status === "live" ? "Suspend" : "Activate"}</button>
    <button class="act" data-aff="${a.code}" data-op="payout">Payout</button>
    ${a.tax ? `<button class="act" data-aff="${a.code}" data-tax='${JSON.stringify(a.tax).replace(/'/g, "&#39;")}' data-op="tax">Tax</button>` : `<span class="muted">no tax</span>`}
    ${a.status !== "removed" && a.status !== "expired" ? `<button class="act" data-aff="${a.code}" data-op="remove">Remove</button>` : ``}</td></tr>`;
  }).join("")}
  </tbody></table>
  <p class="muted">Payout floor is $50. Recording a payout marks it paid on the affiliate's dashboard.</p>`}
`;
}

function promos() {
  const rows = state.desk.coupons || [];
  return `<h2>Coupon codes</h2>
  <form id="couponForm" class="tool-form" style="margin-bottom:16px">
    <input name="code" placeholder="CODE" maxlength="16" required style="text-transform:uppercase" />
    <input name="pct" type="number" min="0" max="90" placeholder="% off" />
    <input name="amount" type="number" min="0" step="0.01" placeholder="$ off" />
    <input name="maxUses" type="number" min="0" step="1" placeholder="Max uses (0 = unlimited)" />
    <input name="minTotal" type="number" min="0" step="1" placeholder="Min order $" />
    <input name="expires" type="date" />
    <input name="note" placeholder="Note (optional)" maxlength="80" />
    <label class="check"><input type="checkbox" name="active" checked /> Active</label>
    <button class="btn" type="submit">Save code</button>
    <div class="err" id="couponErr"></div>
  </form>
  ${rows.length ? `<table><thead><tr><th>Code</th><th>Off</th><th>Uses</th><th>Min</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody>
  ${rows.map((c) => `<tr><td>${c.code}</td><td>${c.pct ? c.pct + "%" : ""}${c.amount ? "$" + c.amount : ""}</td><td>${c.uses || 0}${c.maxUses ? " / " + c.maxUses : ""}</td><td>${money(c.minTotal || 0)}</td><td>${(c.expires || "").slice(0, 10) || "—"}</td><td>${c.active === false ? "off" : "on"}</td>
  <td><button class="act" data-coupon="${c.code}" data-on="${c.active === false ? 1 : 0}">${c.active === false ? "Enable" : "Disable"}</button></td></tr>`).join("")}
  </tbody></table>` : `<p class="muted">No codes yet. HELIX10 (first order over $99) is automatic.</p>`}
  <p class="muted">One discount per order: an affiliate code beats a coupon, a coupon beats HELIX10.</p>`;
}

function audit() {
  const rows = state.desk.audit || [];
  if (!rows.length) return `<p class="muted">No desk actions yet.</p>`;
  return `<table><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>
  ${rows.map((a) => `<tr><td>${when(a.at)}</td><td>${a.email || a.by || "—"}</td><td>${a.action || ""} ${a.detail || a.note || ""}</td></tr>`).join("")}
  </tbody></table>`;
}

function detail(o) {
  if (!o) return;
  const s = o.ship || {};
  const pay = o.payment || {};
  const lines = (o.lines || []).map((l) => `<tr><td>${l.sku}</td><td>${l.name} ${l.size}</td><td>${l.lot || "—"}</td><td>${l.qty}${l.kind === "kit" ? " kit" : ""}</td><td>${money(l.line)}</td></tr>`).join("");
  $("#detail").hidden = false;
  $("#shell").classList.remove("no-detail");
  $("#detail").innerHTML = `<h2>${o.id}</h2>
    <p class="muted">${when(o.created)} · ${o.channel || "shop"} · ${o.email}</p>
    <div class="kv">
      <span>Status</span><div>${pill(o.status)} ${pill(o.fulfillment)}</div>
      <span>Buyer</span><div>${o.name || "—"} · ${o.phone || "no phone"}<br>${o.company || "—"} · ${o.researchField || "—"} · ${o.researchAck ? "research ack" : "no ack"}</div>
      <span>Ship-to</span><div>${s.line1 ? `${s.name || ""}<br>${s.line1}${s.line2 ? "<br>" + s.line2 : ""}<br>${s.city}, ${s.region} ${s.postal}` : "Missing — do not ship."}</div>
      <span>Pay</span><div>${o.paymentMethod || "—"} · ${o.paymentStatus || "—"}<br>${pay.payAddress ? pay.payAmount + " " + pay.payCurrency + " · " + pay.payAddress : pay.handle ? "@" + pay.handle + " note " + o.id : ""}</div>
      <span>Money</span><div>Merch ${money(o.merchandise)} · ship ${money(o.shipping)} · code ${o.coupon || "—"} ${o.couponOff ? "−" + money(o.couponOff) : ""}<br>Total ${money(o.total)}${o.affiliateCode ? " · affiliate " + o.affiliateCode + " " + money(o.affiliatePayout) : ""}</div>
      <span>Track</span><div>${o.carrier || "—"} ${o.tracking || ""}</div>
    </div>
    <table><thead><tr><th>SKU</th><th>Line</th><th>Lot</th><th>Qty</th><th></th></tr></thead><tbody>${lines}</tbody></table>
    <div class="stack">
      <input id="dCarrier" placeholder="Carrier" value="${o.carrier || ""}" />
      <input id="dTrack" placeholder="Tracking number" value="${o.tracking || ""}" />
      <textarea id="dNote" rows="3" placeholder="Internal note — not on the receipt">${o.internalNote || ""}</textarea>
      ${o.status === "awaiting_settlement" && o.paymentMethod === "crypto" ? `<button class="act" id="recheck">Re-check crypto</button><p class="muted">Opened ${when(o.created)}. Re-check asks NOWPayments if the callback was missed.</p>` : ""}
      <button class="act" data-act="settled">Mark paid</button>
      <button class="act" data-act="shipped">Mark shipped</button>
      <button class="act" data-act="note">Save note</button>
      <button class="act" data-act="voided">Void and restore stock</button>
    </div>
    <p class="muted">${(o.events || []).map((e) => when(e.at) + " · " + e.kind + " · " + (e.by || "")).join("<br>")}</p>`;
  const re = document.getElementById("recheck");
  if (re) re.onclick = async () => {
    try {
      const out = await api("/api/ops/orders/recheck", { method: "POST", body: { id: o.id } });
      await load();
      state.order = (state.desk.orders || []).find((x) => x.id === o.id) || null;
      draw();
      alert("Payment status: " + (out.paymentStatus || out.status));
    } catch (err) {
      alert(err.error || "Re-check failed.");
    }
  };
  $("#detail").onclick = async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const status = btn.dataset.act === "note" ? o.status : btn.dataset.act;
    try {
      await api("/api/ops/orders", { method: "POST", body: {
        id: o.id,
        status,
        carrier: $("#dCarrier").value,
        tracking: $("#dTrack").value,
        internalNote: $("#dNote").value,
      }});
      await load();
      state.order = (state.desk.orders || []).find((x) => x.id === o.id) || null;
      draw();
    } catch (err) {
      alert(err.error === "settle_first" ? "Mark paid before shipped." : "Could not save that order.");
    }
  };
}

function draw() {
  nav();
  const titles = Object.fromEntries(TABS);
  $("#title").textContent = titles[state.tab];
  const view = { overview, orders, accounts, list, inventory, affiliates, promos, audit, catalog: () => `<p class="muted">Prices, lot edits, photos, certificates, and payment notes stay on the catalog editor.</p><p><a href="/ops/catalog">Open catalog editor</a></p>` }[state.tab];
  $("#view").innerHTML = view();
  const sweep = document.getElementById("sweepNow");
  if (sweep) sweep.onclick = async () => {
    const out = await api("/api/ops/sweep", { method: "POST", body: {} });
    await load();
    draw();
    alert((out.released || 0) + " stale orders released.");
  };
  $("#view").onclick = async (e) => {
    const ab = e.target.closest("[data-aff]");
    if (ab) {
      const code = ab.dataset.aff, op = ab.dataset.op;
      try {
        if (op === "toggle") {
          const row = (state.desk.affiliates || []).find((a) => a.code === code);
          await api("/api/ops/affiliates", { method: "POST", body: { code, status: row && row.status === "live" ? "suspended" : "live" } });
        } else if (op === "remove") {
          if (!confirm("Remove affiliate " + code + "? Their link stops working immediately.")) return;
          await api("/api/ops/affiliates", { method: "POST", body: { code, status: "removed" } });
        } else if (op === "tax") {
          try {
            const t = JSON.parse(ab.dataset.tax.replace(/&#39;/g, "'"));
            alert("Legal: " + t.legalName + (t.businessName ? " (" + t.businessName + ")" : "") + "\n" + t.address + "\n" + t.city + ", " + t.state + " " + t.zip + "\n" + t.taxIdType.toUpperCase() + ": " + t.taxId + "\nCertified: " + (t.certifiedAt || "").slice(0, 10));
          } catch { alert("Could not read tax record."); }
        } else if (op === "payout") {
          const amt = prompt("Payout amount for " + code + " (USD):");
          if (amt === null) return;
          await api("/api/ops/affiliates/payout", { method: "POST", body: { code, amount: Number(amt) } });
        }
        await load(); draw();
      } catch (err) { alert(err.error || "Could not update the affiliate."); }
      return;
    }
    const pr = e.target.closest("[data-payreq]");
    if (pr) {
      try {
        await api("/api/ops/affiliates/payout", { method: "POST", body: { code: pr.dataset.payreq, amount: Number(pr.dataset.amt) } });
        await load(); draw();
      } catch (err) { alert(err.error || "Could not record the payout."); }
      return;
    }
    const cb2 = e.target.closest("[data-coupon]");
    if (cb2) {
      try {
        const rows = state.desk.coupons || [];
        const cur = rows.find((c) => c.code === cb2.dataset.coupon);
        await api("/api/ops/coupons", { method: "POST", body: { code: cb2.dataset.coupon, pct: cur ? cur.pct : 10, active: cb2.dataset.on === "1" } });
        await load(); draw();
      } catch (err) { alert(err.error || "Could not update the code."); }
      return;
    }
    const f = e.target.closest("[data-f]");
    if (f) { state.filter = f.dataset.f; draw(); return; }
    const row = e.target.closest("[data-id]");
    if (!row) return;
    state.order = (state.desk.orders || []).find((o) => o.id === row.dataset.id) || null;
    state.tab = "orders";
    draw();
  };
  const af = document.getElementById("affForm");
  if (af) af.onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(af);
    try {
      await api("/api/ops/affiliates/create", { method: "POST", body: {
        email: String(fd.get("email") || ""),
        code: String(fd.get("code") || ""),
      }});
      await load(); draw();
    } catch (err) { document.getElementById("affErr").textContent = err.error || "Could not create the affiliate."; }
  };
  const cf = document.getElementById("couponForm");
  if (cf) cf.onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(cf);
    try {
      await api("/api/ops/coupons", { method: "POST", body: {
        code: String(fd.get("code") || ""),
        pct: Number(fd.get("pct") || 0),
        amount: Number(fd.get("amount") || 0),
        maxUses: Number(fd.get("maxUses") || 0),
        minTotal: Number(fd.get("minTotal") || 0),
        expires: String(fd.get("expires") || ""),
        note: String(fd.get("note") || ""),
        active: fd.get("active") === "on",
      }});
      await load(); draw();
    } catch (err) { document.getElementById("couponErr").textContent = err.error || "Could not save the code."; }
  };
  if (state.order) detail(state.order);
  else {
    $("#detail").hidden = true;
    $("#shell").classList.add("no-detail");
  }
}

async function load() {
  state.desk = await api("/api/ops/desk");
}
async function boot() {
  try {
    const sess = await api("/api/session");
    state.user = sess.user;
    if (!state.user || !state.user.isOps) {
      $("#boot").innerHTML = `This desk is for the seller account. <a href="/account">Sign in</a>.`;
      return;
    }
    await load();
    $("#who").textContent = state.user.email;
    $("#boot").hidden = true;
    $("#shell").hidden = false;
    draw();
  } catch {
    $("#boot").innerHTML = `Sign in on the catalog, then reopen the desk. <a href="/account">Account</a>.`;
  }
}
boot();
