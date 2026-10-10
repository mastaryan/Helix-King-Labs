/* Helix King Labs — ops Accounts. Wholesale approval toggle, affiliate toggle +
   code assignment, saved profile info, CSV export, privacy banner.
   Exposes window.HKL_OPS_ACCOUNTS = { render(state), mount(view,state), detail(acct,state) }. */
(function () {
  function render(st) {
    const rows = st.desk.customers || [];
    const q = (st.acctSearch || "").toLowerCase().trim();
    const list = q ? rows.filter((c) =>
      String(c.email || "").toLowerCase().includes(q) ||
      String(c.name || "").toLowerCase().includes(q) ||
      String(c.company || "").toLowerCase().includes(q)) : rows;
    const affs = st.desk.affiliates || [];
    const affByUser = {};
    affs.forEach((a) => { if (a.userId) affByUser[a.userId] = a; });
    return `<div class="privacy"><b>Privacy:</b> customer data lives in the server database only — <b>never in the git repo</b> (it's public). No card or payment details are ever stored. This view is for accounting and support.</div>
    <div class="toolbar">
      <input type="search" id="acctSearch" placeholder="Search email, name, company…" value="${esc(st.acctSearch || "")}" />
      <a class="act sm" style="text-decoration:none" href="/api/ops/export?kind=customers">Export CSV</a>
      <span class="muted">${list.length} account${list.length === 1 ? "" : "s"}</span>
    </div>
    <table class="responsive"><thead><tr><th>Email</th><th>Name</th><th>Company</th><th>Orders</th><th>Wholesale</th><th>Affiliate</th><th></th></tr></thead><tbody>
    ${list.map((c) => {
      const aff = affByUser[c.id];
      return `<tr class="pick" data-acct="${esc(c.id)}">
        <td data-l="Email">${esc(c.email)}</td>
        <td data-l="Name">${esc(c.name || "—")}</td>
        <td data-l="Company">${esc(c.company || "—")}</td>
        <td data-l="Orders">${c.orders}</td>
        <td data-l="Wholesale">${c.wholesaleApproved ? pill("paid", "Approved") : `<span class="muted">—</span>`}</td>
        <td data-l="Affiliate">${aff ? `<b>${esc(aff.code)}</b> ${pill(aff.status)}` : `<span class="muted">—</span>`}</td>
        <td><button class="act sm" data-acct="${esc(c.id)}">Open →</button></td>
      </tr>`;
    }).join("") || `<tr><td colspan="7" class="muted">No accounts yet.</td></tr>`}
    </tbody></table>`;
  }

  function detail(c, st) {
    const d = $("#detail");
    d.hidden = false;
    $("#shell").classList.remove("no-detail");
    const affs = st.desk.affiliates || [];
    const aff = affs.find((a) => a.userId === c.id);
    const orders = (st.desk.orders || []).filter((o) => o.email === c.email);
    d.innerHTML = `<h2>${esc(c.email)}</h2>
      <p class="muted">${esc(c.name || "—")}${c.company ? " · " + esc(c.company) : ""}</p>
      <div class="kv">
        <span>Field</span><div>${esc(c.researchField || "—")}</div>
        <span>Orders</span><div>${orders.length} (${money(orders.reduce((s, o) => s + Number(o.total || 0), 0))} lifetime)</div>
        <span>Wholesale</span><div>${c.wholesaleApproved ? pill("paid", "Approved") : pill("pending", "Not approved")}</div>
        <span>Affiliate</span><div>${aff ? `<b>${esc(aff.code)}</b> ${pill(aff.status)} · owed ${money(Number(aff.earned || 0) - Number(aff.paid || 0))}` : "Not an affiliate"}</div>
      </div>
      <div class="stack">
        <button class="act" id="acctWs">${c.wholesaleApproved ? "Revoke wholesale" : "Approve wholesale"}</button>
        ${aff
          ? `<button class="act" id="acctAffToggle">${aff.status === "live" ? "Suspend affiliate" : "Activate affiliate"}</button>`
          : `<button class="act" id="acctAffMake">Make affiliate…</button>`}
        ${aff ? `<button class="act" id="acctAffCode">Change code…</button>` : ""}
        <button class="act sm" id="closeAcct">Close</button>
      </div>
      <h4 style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">Saved profile</h4>
      <div class="kv">
        <span>Name</span><div>${esc(c.name || "—")}</div>
        <span>Company</span><div>${esc(c.company || "—")}</div>
        <span>Phone</span><div>${esc(c.phone || "—")}</div>
        <span>Address</span><div>${esc(c.address || c.shipLine || "—")}</div>
      </div>
      <p class="muted" style="margin-top:10px">Profile + tax records stay in the server database for accounting. Never committed to git.</p>`;
    $("#closeAcct").onclick = () => { state.acct = null; draw(); };
    $("#acctWs").onclick = async () => {
      const ok = await confirmAction({
        title: c.wholesaleApproved ? "Revoke wholesale" : "Approve wholesale",
        orderId: c.email, action: "Wholesale access",
        consequence: c.wholesaleApproved ? "This account loses wholesale catalog + pricing immediately." : "This account gains the wholesale catalog, kit pricing, and group-commit ordering.",
        danger: !!c.wholesaleApproved,
      });
      if (!ok) return;
      try {
        await api("/api/ops/users/wholesale", { method: "POST", body: { id: c.id, approved: !c.wholesaleApproved } });
        await load(); state.acct = (state.desk.customers || []).find((x) => x.id === c.id) || null; draw();
        toast("Wholesale updated.");
      } catch { toast("Could not update wholesale status."); }
    };
    const affBtn = $("#acctAffToggle");
    if (affBtn) affBtn.onclick = async () => {
      const ok = await confirmAction({
        title: aff.status === "live" ? "Suspend affiliate" : "Activate affiliate",
        orderId: aff.code, action: "Affiliate status",
        consequence: aff.status === "live" ? "Their link stops earning immediately. Their dashboard keeps its balance." : "Their link goes live and starts earning 10%.",
        danger: aff.status === "live",
      });
      if (!ok) return;
      try {
        await api("/api/ops/affiliates", { method: "POST", body: { code: aff.code, status: aff.status === "live" ? "suspended" : "live" } });
        await load(); state.acct = (state.desk.customers || []).find((x) => x.id === c.id) || null; draw();
      } catch (err) { toast(err.error || "Could not update the affiliate."); }
    };
    const mkBtn = $("#acctAffMake");
    if (mkBtn) mkBtn.onclick = async () => {
      const code = prompt(`Affiliate code for ${c.email} (blank = auto):`, "");
      if (code === null) return;
      try {
        await api("/api/ops/affiliates/create", { method: "POST", body: { email: c.email, code: String(code || "").toUpperCase() } });
        await load(); state.acct = (state.desk.customers || []).find((x) => x.id === c.id) || null; draw();
        toast("Affiliate created.");
      } catch (err) { toast(err.error || "Could not create the affiliate."); }
    };
  }

  function mount(view, st) {
    view.querySelectorAll("[data-acct]").forEach((el) => el.addEventListener("click", (e) => {
      e.stopPropagation();
      state.acct = (st.desk.customers || []).find((c) => c.id === el.dataset.acct) || null;
      draw();
    }));
  }
  window.HKL_OPS_ACCOUNTS = { render, mount, detail };
})();
