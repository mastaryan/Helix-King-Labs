/* Helix King Labs — seller desk shell.
   Dispatcher: nav, state, api, boot, confirm modal. Views live in ops-*.js modules
   exposing window.HKL_OPS_<NAME>.render(state) -> HTML string, plus optional
   .mount(viewEl, state) for wiring after innerHTML. Loaded by ops.html. */
const $ = (s) => document.querySelector(s);
const state = {
  tab: "overview", filter: "open", kind: "all", order: null,
  desk: null, user: null, orderSearch: "", orderSort: "newest",
  integrations: null, certs: null, lots: null,
};

const TABS = [
  ["overview", "Overview"],
  ["orders", "Orders"],
  ["payments", "Payments"],
  ["receiving", "Receiving"],
  ["certificates", "Certificates"],
  ["inventory", "Inventory"],
  ["accounts", "Accounts"],
  ["affiliates", "Affiliates"],
  ["list", "Email list"],
  ["promos", "Promos"],
  ["suggest", "Requests"],
  ["wholesale", "Wholesale"],
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
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function escA(s) { return esc(s); }
function pill(status, label) {
  const map = {
    not_paid: ["NOT PAID", "wait"],
    committed: ["COMMITTED", "wait"],
    paid: ["PAID", "ok"],
    shipped: ["SHIPPED", "info"],
    delivered: ["DELIVERED", "ok"],
    voided: ["VOID", "bad"],
    disputed: ["DISPUTED", "bad"],
    hold: ["HOLD", "wait"],
    live: ["ACTIVE", "ok"],
    suspended: ["SUSPENDED", "bad"],
    removed: ["REMOVED", "dim"],
    expired: ["EXPIRED", "dim"],
    approved: ["APPROVED", "ok"],
    denied: ["DENIED", "bad"],
    pending: ["PENDING", "wait"],
  };
  const hit = map[status] || [(status || "—").toUpperCase(), "dim"];
  return `<span class="pill ${hit[1]}">${esc(label || hit[0])}</span>`;
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
let toastTimer = null;
function toast(msg) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}
/* Are-you-sure modal for every money-moving action. Returns a Promise<boolean>. */
function confirmAction({ title, orderId, action, consequence, danger }) {
  return new Promise((resolve) => {
    const veil = document.createElement("div");
    veil.className = "modal-veil";
    veil.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <h3>${esc(title)}</h3>
      <div class="kv">
        <span>Order</span><div><b>${esc(orderId || "—")}</b></div>
        <span>Action</span><div>${esc(action)}</div>
      </div>
      <div class="consequence">${consequence}</div>
      <div class="row">
        <button class="btn" data-x="no">Cancel</button>
        <button class="btn ${danger ? "danger" : "gold"}" data-x="yes">${esc(title)}</button>
      </div>
    </div>`;
    const done = (v) => { veil.remove(); resolve(v); };
    veil.querySelector('[data-x="no"]').onclick = () => done(false);
    veil.querySelector('[data-x="yes"]').onclick = () => done(true);
    veil.addEventListener("click", (e) => { if (e.target === veil) done(false); });
    document.addEventListener("keydown", function esc2(e) {
      if (e.key === "Escape") { document.removeEventListener("keydown", esc2); done(false); }
    });
    document.body.appendChild(veil);
    veil.querySelector('[data-x="no"]').focus();
  });
}
function shipLine(o) {
  const s = o.ship || {};
  if (!s.line1) return `<span class="warn">Ship-to missing</span>`;
  return `${esc(s.city || "")}, ${esc(s.region || "")} ${esc(s.postal || "")}`;
}
function orderKind(o) {
  return String(o.id || "").startsWith("HKL-WS-") || o.wholesale ? "wholesale" : "retail";
}

function nav() {
  const orders = (state.desk && state.desk.orders) || [];
  const unpaid = orders.filter((o) => o.status === "not_paid").length;
  const payreqs = (state.desk && state.desk.payoutRequests || []).length;
  $("#nav").innerHTML = TABS.map(([id, label]) => {
    let n = "";
    if (id === "orders" && unpaid) n = `<span class="nbadge">${unpaid}</span>`;
    if (id === "affiliates" && payreqs) n = `<span class="nbadge">${payreqs}</span>`;
    return `<button data-tab="${id}" class="${state.tab === id ? "on" : ""}">${label}${n}</button>`;
  }).join("");
  $("#nav").onclick = (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    state.tab = btn.dataset.tab;
    state.order = null;
    draw();
  };
}

const MODULES = {
  overview: "HKL_OPS_OVERVIEW",
  orders: "HKL_OPS_ORDERS",
  payments: "HKL_OPS_PAYMENTS",
  receiving: "HKL_OPS_RECEIVING",
  certificates: "HKL_OPS_CERTS",
  inventory: "HKL_OPS_INVENTORY",
  accounts: "HKL_OPS_ACCOUNTS",
  affiliates: "HKL_OPS_AFFILIATES",
};
const TITLES = Object.fromEntries(TABS);

function draw() {
  nav();
  $("#title").innerHTML = `${esc(TITLES[state.tab] || "")}<span class="sub">Helix King Labs seller desk</span>`;
  const mod = window[MODULES[state.tab]];
  let html = `<p class="muted">Loading…</p>`;
  if (mod && typeof mod.render === "function") {
    try { html = mod.render(state); } catch (err) { html = `<p class="hard">Couldn't render this view: ${esc(err.message)}</p>`; }
  } else if (state.tab === "list") {
    html = legacyList();
  } else if (state.tab === "promos") {
    html = legacyPromos();
  } else if (state.tab === "suggest") {
    html = `<div id="suggestView"><p class="muted">Loading requests…</p></div>`;
  } else if (state.tab === "wholesale") {
    html = `<div id="wholesaleView"><p class="muted">Loading wholesale…</p></div>`;
  } else if (state.tab === "audit") {
    html = legacyAudit();
  } else if (state.tab === "catalog") {
    html = `<p class="muted">Prices, lot edits, photos, certificates, and payment notes stay on the catalog editor.</p><p><a href="/ops/catalog">Open catalog editor</a></p>`;
  }
  const view = $("#view");
  view.innerHTML = html;
  if (mod && typeof mod.mount === "function") {
    try { mod.mount(view, state); } catch (err) { console.error("mount", state.tab, err); }
  }
  if (state.tab === "suggest" && window.HKL_SUGGEST) {
    window.HKL_SUGGEST.renderOpsSuggestions(document.getElementById("suggestView"));
  }
  if (state.tab === "wholesale" && window.HKL_WHOLESALE_OPS) {
    window.HKL_WHOLESALE_OPS.render(document.getElementById("wholesaleView"));
  }
  // Ops 2FA self-enrollment (overview module renders the card; wire here).
  const tfaBtn = document.getElementById("ops2faBtn");
  const tfaStatus = document.getElementById("ops2faStatus");
  const tfaBox = document.getElementById("ops2faBox");
  if (tfaBtn && tfaStatus && tfaBox) {
    api("/api/ops/2fa/setup", { method: "POST", body: {} }).then((r) => {
      tfaStatus.textContent = r.hasTotp
        ? "Authenticator is enabled on your ops account."
        : "No authenticator yet — set one up to secure ops sign-in.";
      tfaBtn.textContent = r.hasTotp ? "Re-set authenticator" : "Set up authenticator";
      tfaBtn.onclick = () => {
        tfaBox.innerHTML = `<p class="hard" id="ops2faErr"></p>`;
        if (window.HKL_OPS_2FA) window.HKL_OPS_2FA.enroll(tfaBox, document.getElementById("ops2faErr"), r.setupToken);
        else tfaStatus.textContent = "2FA module failed to load — hard-refresh and try again.";
      };
    }).catch(() => { tfaStatus.textContent = "Couldn't check 2FA status."; });
  }
  // Search + sort (delegated; toolbar re-renders).
  if (!draw._wired) {
    draw._wired = true;
    document.addEventListener("input", (e) => {
      if (e.target && e.target.id === "orderSearch") {
        state.orderSearch = e.target.value;
        const pos = e.target.selectionStart;
        draw();
        const s = document.getElementById("orderSearch");
        if (s) { s.focus(); try { s.setSelectionRange(pos, pos); } catch {} }
      }
      if (e.target && e.target.id === "acctSearch") {
        state.acctSearch = e.target.value;
        draw();
      }
    });
    document.addEventListener("change", (e) => {
      if (e.target && e.target.id === "orderSort") { state.orderSort = e.target.value; draw(); }
    });
  }
  // Detail drawer
  if (state.order && MODULES[state.tab] === "HKL_OPS_ORDERS" && window.HKL_OPS_ORDERS.detail) {
    window.HKL_OPS_ORDERS.detail(state.order, state);
  } else if (state.acct && MODULES[state.tab] === "HKL_OPS_ACCOUNTS" && window.HKL_OPS_ACCOUNTS.detail) {
    window.HKL_OPS_ACCOUNTS.detail(state.acct, state);
  } else if (state.aff && MODULES[state.tab] === "HKL_OPS_AFFILIATES" && window.HKL_OPS_AFFILIATES.detail) {
    window.HKL_OPS_AFFILIATES.detail(state.aff, state);
  } else {
    const d = $("#detail");
    if (d) { d.hidden = true; }
    $("#shell").classList.add("no-detail");
  }
}

/* Legacy fallbacks for tabs not yet modularized (list, promos, audit). */
function legacyList() {
  const rows = state.desk.captures || [];
  return `<p class="muted">Stored addresses. Export is the orders and inventory CSV links above.</p>
  <table class="responsive"><thead><tr><th>Email</th><th>Source</th><th>Joined</th></tr></thead><tbody>
  ${rows.map((c) => `<tr><td data-l="Email">${esc(c.email)}</td><td data-l="Source">${esc(c.source || "—")}</td><td data-l="Joined">${when(c.created)}</td></tr>`).join("") || `<tr><td colspan="3">No addresses yet.</td></tr>`}
  </tbody></table>`;
}
function legacyPromos() {
  const rows = state.desk.coupons || [];
  return `<h2>Coupon codes</h2>
  <form id="couponForm" class="stack" style="max-width:420px">
    <input name="code" placeholder="CODE" maxlength="16" required style="text-transform:uppercase" />
    <div style="display:flex;gap:8px"><input name="pct" type="number" min="0" max="90" placeholder="% off" /><input name="amount" type="number" min="0" step="0.01" placeholder="$ off" /></div>
    <div style="display:flex;gap:8px"><input name="maxUses" type="number" min="0" step="1" placeholder="Max uses (0 = ∞)" /><input name="minTotal" type="number" min="0" step="1" placeholder="Min order $" /></div>
    <input name="expires" type="date" />
    <input name="note" placeholder="Note (optional)" maxlength="80" />
    <label><input type="checkbox" name="active" checked style="width:auto" /> Active</label>
    <button class="btn gold" type="submit">Save code</button>
    <div class="hard" id="couponErr"></div>
  </form>
  ${rows.length ? `<table class="responsive"><thead><tr><th>Code</th><th>Off</th><th>Uses</th><th>Min</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody>
  ${rows.map((c) => `<tr><td data-l="Code">${esc(c.code)}</td><td data-l="Off">${c.pct ? c.pct + "%" : ""}${c.amount ? "$" + c.amount : ""}</td><td data-l="Uses">${c.uses || 0}${c.maxUses ? " / " + c.maxUses : ""}</td><td data-l="Min">${money(c.minTotal || 0)}</td><td data-l="Expires">${(c.expires || "").slice(0, 10) || "—"}</td><td data-l="Status">${c.active === false ? "off" : "on"}</td>
  <td><button class="act sm" data-coupon="${esc(c.code)}" data-on="${c.active === false ? 1 : 0}">${c.active === false ? "Enable" : "Disable"}</button></td></tr>`).join("")}
  </tbody></table>` : `<p class="muted">No codes yet. HELIX10 (first order over $99) is automatic.</p>`}
  <p class="muted">One discount per order: an affiliate code beats a coupon, a coupon beats HELIX10.</p>`;
}
function legacyAudit() {
  const rows = state.desk.audit || [];
  if (!rows.length) return `<p class="muted">No desk actions yet.</p>`;
  return `<table class="responsive"><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>
  ${rows.map((a) => `<tr><td data-l="When">${when(a.at)}</td><td data-l="Who">${esc(a.email || a.by || "—")}</td><td data-l="What">${esc(a.action || "")} ${esc(a.detail || a.note || "")}</td></tr>`).join("")}
  </tbody></table>`;
}

async function load() {
  state.desk = await api("/api/ops/desk");
  try { state.integrations = await api("/api/ops/integrations"); } catch { state.integrations = null; }
  try { state.certs = await api("/api/certificates"); } catch { state.certs = null; }
  try { state.lots = (await api("/api/ops/lots")).lots || []; } catch { state.lots = []; }
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
    // Coupon form + toggle (delegated once).
    document.addEventListener("submit", async (ev) => {
      if (ev.target.id !== "couponForm") return;
      ev.preventDefault();
      const fd = new FormData(ev.target);
      try {
        await api("/api/ops/coupons", { method: "POST", body: {
          code: String(fd.get("code") || ""), pct: Number(fd.get("pct") || 0),
          amount: Number(fd.get("amount") || 0), maxUses: Number(fd.get("maxUses") || 0),
          minTotal: Number(fd.get("minTotal") || 0), expires: String(fd.get("expires") || ""),
          note: String(fd.get("note") || ""), active: fd.get("active") === "on",
        }});
        await load(); draw();
      } catch (err) { document.getElementById("couponErr").textContent = err.error || "Could not save the code."; }
    });
    document.addEventListener("click", async (e) => {
      const cb = e.target.closest("[data-coupon]");
      if (cb) {
        const rows = state.desk.coupons || [];
        const cur = rows.find((c) => c.code === cb.dataset.coupon);
        try {
          await api("/api/ops/coupons", { method: "POST", body: { code: cb.dataset.coupon, pct: cur ? cur.pct : 10, active: cb.dataset.on === "1" } });
          await load(); draw();
        } catch (err) { toast(err.error || "Could not update the code."); }
        return;
      }
    });
    draw();
  } catch (err) {
    $("#boot").innerHTML = `Couldn't open the desk. ${esc(err.detail || err.error || err.message || "")}`;
  }
}
document.addEventListener("DOMContentLoaded", boot);
