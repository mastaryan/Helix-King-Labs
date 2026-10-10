/* Helix King Labs — ops Affiliates. Tracking, owed balances, payout queue,
   tax-gated approval, affiliate's-view preview.
   Rules: buyer 10% off, affiliate earns 10% of merchandise, $50 payout floor,
   Dec 31 auto-sweep of $50+ balances, payout via crypto or Cash App (affiliate's choice).
   Exposes window.HKL_OPS_AFFILIATES = { render(state), mount(view,state), detail(aff,state) }. */
(function () {
  function taxBadge(a) {
    if (!a.tax) return pill("voided", "No tax forms");
    return pill("paid", "Tax ✓");
  }
  function contactBadge(a) {
    return a.contactComplete ? pill("paid", "Contact ✓") : pill("pending", "Contact…");
  }
  function render(st) {
    const rows = st.desk.affiliates || [];
    const reqs = st.desk.payoutRequests || [];
    const totalOwed = rows.reduce((s, a) => s + Math.max(0, Number(a.earned || 0) - Number(a.paid || 0)), 0);
    return `<div class="quads" style="grid-template-columns:repeat(3,1fr)">
      <div class="quad"><b>${rows.filter((a) => a.status === "live").length}</b><span>Live affiliates</span></div>
      <div class="quad"><b>${money(totalOwed)}</b><span>Total owed</span></div>
      <div class="quad"><b>${reqs.length}</b><span>Payout requests</span><span class="delta">$50 floor · Dec 31 auto-sweep</span></div>
    </div>
    <h2>New affiliate</h2>
    <form id="affForm" class="stack" style="max-width:420px;margin-bottom:18px">
      <div style="display:flex;gap:8px">
        <input name="email" type="email" placeholder="Affiliate email" required />
        <input name="code" placeholder="Code (auto)" maxlength="16" style="text-transform:uppercase" />
      </div>
      <div><button class="btn gold" type="submit">Create code</button></div>
      <div class="hard" id="affErr"></div>
    </form>
    ${reqs.length ? `<h2>Payout queue</h2>
    <table class="responsive"><thead><tr><th>Code</th><th>Email</th><th>Amount</th><th>Method</th><th>Destination</th><th>Requested</th><th></th></tr></thead><tbody>
    ${reqs.map((r) => `<tr>
      <td data-l="Code"><b>${esc(r.code)}</b></td>
      <td data-l="Email">${esc(r.email || "—")}</td>
      <td data-l="Amount"><b>${money(r.amount)}</b></td>
      <td data-l="Method">${r.method === "cashapp" ? `<span class="pill ok">Cash App</span>` : `<span class="pill gold">Crypto</span>`}</td>
      <td data-l="Destination"><code style="font-size:11px;word-break:break-all">${esc(r.detail || "—")}</code></td>
      <td data-l="Requested">${(r.requested || "").slice(0, 10)}</td>
      <td><button class="act sm" data-payreq="${esc(r.code)}" data-amt="${r.amount}">Mark paid</button></td>
    </tr>`).join("")}</tbody></table>
    <p class="muted">Affiliates choose <b>crypto or Cash App</b> when they request. Balances $50+ auto-sweep every Dec 31.</p>` : ""}
    <h2>Affiliates</h2>
    ${!rows.length ? `<p class="muted">No affiliates yet.</p>` : `
    <table class="responsive"><thead><tr><th>Code</th><th>Email</th><th>Status</th><th>Tax</th><th>Contact</th><th>Earned</th><th>Paid</th><th>Owed</th><th></th></tr></thead><tbody>
    ${rows.map((a) => {
      const earned = Number(a.earned || 0), paid = Number(a.paid || 0), owed = Math.max(0, earned - paid);
      const blocked = !a.tax;
      return `<tr class="pick" data-affrow="${esc(a.code)}">
        <td data-l="Code"><b>${esc(a.code || "—")}</b><br><span class="muted">/shop?ref=${esc(a.code || "")}</span></td>
        <td data-l="Email">${esc(a.email || a.userId || "—")}</td>
        <td data-l="Status">${pill(a.status)}</td>
        <td data-l="Tax">${taxBadge(a)}</td>
        <td data-l="Contact">${contactBadge(a)}</td>
        <td data-l="Earned">${money(earned)}</td>
        <td data-l="Paid">${money(paid)}</td>
        <td data-l="Owed"><b>${money(owed)}</b></td>
        <td style="white-space:nowrap">
          ${blocked && a.status !== "live" ? `<span class="warn" title="Tax forms required before approval">🔒</span>` : ""}
          <button class="act sm" data-affrow="${esc(a.code)}">Open →</button>
        </td>
      </tr>`;
    }).join("")}</tbody></table>
    <p class="muted">Approval is <b>hard-blocked</b> until tax forms (legal name, address, SSN/EIN, perjury certification) + full contact info pass. Payout floor $50.</p>`}
    <h2>What the affiliate sees</h2>
    <div class="panel" style="max-width:520px">
      <h3>Their dashboard <span class="tag">preview</span></h3>
      <div class="kv">
        <span>Orders referred</span><div><b>14</b></div>
        <span>Earned</span><div>$212.40</div>
        <span>Paid out</span><div>$150.00</div>
        <span>Available</span><div><b>$62.40</b></div>
      </div>
      <div style="background:#0c0d10;border-radius:8px;height:10px;margin:12px 0;overflow:hidden">
        <div style="width:100%;height:100%;background:var(--gold)"></div>
      </div>
      <p class="muted">$62.40 of $50 floor — payout unlocked.</p>
      <div class="stack" style="max-width:280px">
        <select><option>Crypto</option><option>Cash App</option></select>
        <input placeholder="Wallet address or $handle" />
        <button class="btn gold">Request payout</button>
      </div>
      <p class="muted">They pick <b>crypto or Cash App</b> + destination at request time. You see method + destination in the queue above.</p>
    </div>`;
  }

  function detail(a, st) {
    const d = $("#detail");
    d.hidden = false;
    $("#shell").classList.remove("no-detail");
    const earned = Number(a.earned || 0), paid = Number(a.paid || 0), owed = Math.max(0, earned - paid);
    const t = a.tax || {};
    const blocked = !a.tax;
    d.innerHTML = `<h2>${esc(a.code)}</h2>
      <p class="muted">${esc(a.email || a.userId || "")} · /shop?ref=${esc(a.code || "")}</p>
      <div class="kv">
        <span>Status</span><div>${pill(a.status)}</div>
        <span>Earned</span><div>${money(earned)}</div>
        <span>Paid</span><div>${money(paid)}</div>
        <span>Owed</span><div><b>${money(owed)}</b></div>
        <span>Tax forms</span><div>${taxBadge(a)}</div>
        <span>Contact</span><div>${contactBadge(a)}</div>
        <span>Payout method</span><div>${a.payoutMethod ? esc(a.payoutMethod) : `<span class="muted">chosen at request</span>`}</div>
      </div>
      ${a.tax ? `<h4 style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">Tax record (accounting)</h4>
      <div class="kv">
        <span>Legal</span><div>${esc(t.legalName || "—")}${t.businessName ? " (" + esc(t.businessName) + ")" : ""}</div>
        <span>Address</span><div>${esc(t.address || "")}<br>${esc(t.city || "")}, ${esc(t.state || "")} ${esc(t.zip || "")}</div>
        <span>ID</span><div>${esc(t.taxIdType || "").toUpperCase()}: ${esc(t.taxId || "—")}</div>
        <span>Certified</span><div>${esc((t.certifiedAt || "").slice(0, 10))}</div>
      </div>` : `<p class="warn">No tax forms on file — approval is blocked until they arrive.</p>`}
      <div class="stack">
        ${a.status !== "live" ? `<button class="act" id="affApprove" ${blocked ? "disabled title='Tax forms required'" : ""}>${blocked ? "Approve (blocked — no tax)" : "Approve affiliate"}</button>` : ""}
        <button class="act" id="affToggle">${a.status === "live" ? "Suspend" : "Activate"}</button>
        <button class="act" id="affPayout">Record payout…</button>
        ${a.status !== "removed" ? `<button class="act" id="affRemove">Remove code</button>` : ""}
        <button class="act sm" id="closeAff">Close</button>
      </div>
      <p class="muted">Profile + tax records stay in the server database for accounting. Never committed to git.</p>`;
    $("#closeAff").onclick = () => { state.aff = null; draw(); };
    const ap = $("#affApprove");
    if (ap && !blocked) ap.onclick = async () => {
      const ok = await confirmAction({ title: "Approve affiliate", orderId: a.code, action: "Go live",
        consequence: "Their link (/shop?ref=" + a.code + ") starts earning 10% of referred merchandise immediately. Tax forms are on file.", danger: false });
      if (!ok) return;
      try { await api("/api/ops/affiliates", { method: "POST", body: { code: a.code, status: "live" } }); await load(); state.aff = null; draw(); }
      catch (err) { toast(err.error || "Could not approve."); }
    };
    $("#affToggle").onclick = async () => {
      const ok = await confirmAction({ title: a.status === "live" ? "Suspend affiliate" : "Activate affiliate", orderId: a.code, action: "Status change",
        consequence: a.status === "live" ? "Their link stops earning immediately. Balance is kept." : "Their link goes live.", danger: a.status === "live" });
      if (!ok) return;
      try { await api("/api/ops/affiliates", { method: "POST", body: { code: a.code, status: a.status === "live" ? "suspended" : "live" } }); await load(); state.aff = null; draw(); }
      catch (err) { toast(err.error || "Could not update."); }
    };
    $("#affPayout").onclick = async () => {
      const amt = prompt(`Payout amount for ${a.code} (USD, owed ${money(owed)}):`);
      if (amt === null) return;
      const ok = await confirmAction({ title: "Record payout", orderId: a.code, action: `Pay ${money(Number(amt))}`,
        consequence: `Marks ${money(Number(amt))} paid on the affiliate's dashboard. Send the ${a.payoutMethod || "crypto/Cash App"} payment yourself, then confirm.`, danger: false });
      if (!ok) return;
      try { await api("/api/ops/affiliates/payout", { method: "POST", body: { code: a.code, amount: Number(amt) } }); await load(); state.aff = null; draw(); toast("Payout recorded."); }
      catch (err) { toast(err.error || "Could not record the payout."); }
    };
    const rm = $("#affRemove");
    if (rm) rm.onclick = async () => {
      const ok = await confirmAction({ title: "Remove affiliate", orderId: a.code, action: "Remove code",
        consequence: "Their link stops working immediately. They keep their dashboard to cash out any remaining balance.", danger: true });
      if (!ok) return;
      try { await api("/api/ops/affiliates", { method: "POST", body: { code: a.code, status: "removed" } }); await load(); state.aff = null; draw(); }
      catch (err) { toast(err.error || "Could not remove."); }
    };
  }

  function mount(view, st) {
    view.querySelectorAll("[data-affrow]").forEach((el) => el.addEventListener("click", () => {
      state.aff = (st.desk.affiliates || []).find((a) => a.code === el.dataset.affrow) || null;
      draw();
    }));
    const af = view.querySelector("#affForm");
    if (af) af.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fd = new FormData(af);
      try {
        await api("/api/ops/affiliates/create", { method: "POST", body: {
          email: String(fd.get("email") || ""), code: String(fd.get("code") || "").toUpperCase(),
        }});
        await load(); draw(); toast("Affiliate created.");
      } catch (err) { view.querySelector("#affErr").textContent = err.error || "Could not create the affiliate."; }
    });
    view.querySelectorAll("[data-payreq]").forEach((b) => b.addEventListener("click", async () => {
      const ok = await confirmAction({ title: "Mark payout paid", orderId: b.dataset.payreq, action: `Pay ${money(Number(b.dataset.amt))}`,
        consequence: "Clears this request from the queue and marks it paid on the affiliate's dashboard. Send the payment first.", danger: false });
      if (!ok) return;
      try { await api("/api/ops/affiliates/payout", { method: "POST", body: { code: b.dataset.payreq, amount: Number(b.dataset.amt) } }); await load(); draw(); toast("Payout recorded."); }
      catch (err) { toast(err.error || "Could not record the payout."); }
    }));
  }
  window.HKL_OPS_AFFILIATES = { render, mount, detail };
})();
