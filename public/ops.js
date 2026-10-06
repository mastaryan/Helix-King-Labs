const $ = (s) => document.querySelector(s);
const state = { tab: "overview", filter: "open", order: null, desk: null, user: null };

const TABS = [
  ["overview", "Overview"],
  ["orders", "Orders"],
  ["accounts", "Accounts"],
  ["list", "Email list"],
  ["inventory", "Inventory"],
  ["affiliates", "Affiliates"],
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
  if (!rows.length) return `<p class="muted">No desks open.</p>`;
  return `<table><thead><tr><th>Code</th><th>Email</th><th>Status</th></tr></thead><tbody>
  ${rows.map((a) => `<tr><td>${a.code || "—"}</td><td>${a.email || a.userId || "—"}</td><td>${a.status || "—"}</td></tr>`).join("")}
  </tbody></table>`;
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
  const view = { overview, orders, accounts, list, inventory, affiliates, audit, catalog: () => `<p class="muted">Prices, lot edits, photos, certificates, and payment notes stay on the catalog editor.</p><p><a href="/ops/catalog">Open catalog editor</a></p>` }[state.tab];
  $("#view").innerHTML = view();
  const sweep = document.getElementById("sweepNow");
  if (sweep) sweep.onclick = async () => {
    const out = await api("/api/ops/sweep", { method: "POST", body: {} });
    await load();
    draw();
    alert((out.released || 0) + " stale orders released.");
  };
  $("#view").onclick = (e) => {
    const f = e.target.closest("[data-f]");
    if (f) { state.filter = f.dataset.f; draw(); return; }
    const row = e.target.closest("[data-id]");
    if (!row) return;
    state.order = (state.desk.orders || []).find((o) => o.id === row.dataset.id) || null;
    state.tab = "orders";
    draw();
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
