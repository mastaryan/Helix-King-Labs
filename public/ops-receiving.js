/* Helix King Labs — ops Receiving. Chain of custody:
   Intake → COA Review → Labels → Live Stock.
   COA review happens HERE. The label maker unlocks only for accepted lots.
   Exposes window.HKL_OPS_RECEIVING = { render(state), mount(view,state) }. */
(function () {
  function lotStage(l) {
    if (l.certificate !== "accepted") return "intake";
    if (!l.labelsCreated) return "labels";
    return "live";
  }
  function stageOf(l) {
    if (l.certificate === "rejected") return "rejected";
    return lotStage(l);
  }
  function render(st) {
    const lots = st.lots || [];
    const counts = { intake: 0, coa: 0, labels: 0, live: 0 };
    lots.forEach((s) => (s.lots || []).forEach((l) => {
      const sg = stageOf(l);
      if (sg === "intake" || sg === "rejected") counts.intake++;
      else if (sg === "labels") counts.labels++;
      else counts.live++;
      if (l.certificate === "pending") counts.coa++;
    }));
    return `<div class="pipe">
      <div class="pipe-step"><h4>Intake</h4><div class="n">${counts.intake}</div><span class="muted">lots received, COA pending</span></div>
      <div class="pipe-step"><h4>COA Review</h4><div class="n">${counts.coa}</div><span class="muted">awaiting accept / reject</span></div>
      <div class="pipe-step"><h4>Labels</h4><div class="n">${counts.labels}</div><span class="muted">COA accepted, labels needed</span></div>
      <div class="pipe-step"><h4>Live Stock</h4><div class="n">${counts.live}</div><span class="muted">labeled, sellable</span></div>
    </div>
    <p class="privacy"><b>Chain of custody rule:</b> a lot adds <b>zero</b> sellable stock until its COA is accepted. Labels unlock only after accept. The label maker does <b>not</b> review COAs.</p>
    <div class="toolbar">
      <div class="filters">
        ${["all", "intake", "coa", "labels", "live"].map((s) => `<button data-stage="${s}" class="${(st.recvStage || "all") === s ? "on" : ""}">${s === "all" ? "All lots" : s === "coa" ? "COA review" : s[0].toUpperCase() + s.slice(1)}</button>`).join("")}
      </div>
    </div>
    <table class="responsive"><thead><tr><th>Lot</th><th>Product</th><th>Received</th><th>Qty</th><th>COA</th><th>Stage</th><th></th></tr></thead><tbody>
    ${lots.map((s) => (s.lots || []).map((l) => {
      const sg = stageOf(l);
      const f = st.recvStage || "all";
      if (f !== "all") {
        if (f === "coa" && l.certificate !== "pending") return "";
        if (f !== "coa" && sg !== f) return "";
      }
      const coaPill = l.certificate === "accepted" ? pill("paid", "Accepted") : l.certificate === "rejected" ? pill("voided", "Rejected") : pill("pending", "Pending");
      const stagePill = sg === "live" ? pill("paid", "Live") : sg === "labels" ? pill("live", "Labels needed") : pill("pending", "Intake");
      return `<tr>
        <td data-l="Lot"><b>${esc(l.lot || "—")}</b></td>
        <td data-l="Product">${esc(s.name)} ${esc(s.size || "")}</td>
        <td data-l="Received">${when(l.receivedAt)}</td>
        <td data-l="Qty">${l.qtyReceived}${l.qtyReleased ? ` <span class="muted">(${l.qtyReleased} sellable)</span>` : ""}</td>
        <td data-l="COA">${coaPill}</td>
        <td data-l="Stage">${stagePill}</td>
        <td style="white-space:nowrap">
          ${l.certificate === "pending" ? `<button class="act sm" data-coa="accept" data-sku="${esc(s.sku)}" data-idx="${l.index}" data-lot="${esc(l.lot)}">Accept COA</button> <button class="act sm" data-coa="reject" data-sku="${esc(s.sku)}" data-idx="${l.index}" data-lot="${esc(l.lot)}">Reject</button>` : ""}
          ${l.certificateFile ? `<a class="act sm" style="text-decoration:none;display:inline-block" href="${esc(l.certificateFile)}" target="_blank" rel="noopener">View PDF</a>` : ""}
          ${sg === "labels" ? `<a class="act sm" style="text-decoration:none;display:inline-block" href="/tools/label?sku=${encodeURIComponent(s.sku)}&lot=${encodeURIComponent(l.lot)}">Make labels →</a>` : ""}
        </td>
      </tr>`;
    }).join("")).join("") || `<tr><td colspan="7" class="muted">No lots yet. Receive inventory through the catalog editor.</td></tr>`}
    </tbody></table>`;
  }
  function mount(view, st) {
    view.querySelectorAll("[data-stage]").forEach((b) => b.addEventListener("click", () => { state.recvStage = b.dataset.stage; draw(); }));
    view.querySelectorAll("[data-coa]").forEach((b) => b.addEventListener("click", async () => {
      const action = b.dataset.coa === "accept" ? "Accept COA" : "Reject COA";
      const ok = await confirmAction({
        title: action, orderId: `${b.dataset.sku} · ${b.dataset.lot}`, action,
        consequence: b.dataset.coa === "accept"
          ? "The lot's units become sellable stock, its COA feeds the Certificates page, and the label maker unlocks for this lot."
          : "The lot stays at zero sellable stock and is flagged rejected. It never reaches the shop.",
        danger: b.dataset.coa === "reject",
      });
      if (!ok) return;
      try {
        await api("/api/ops/lots/save", { method: "POST", body: {
          sku: b.dataset.sku, lotIndex: Number(b.dataset.idx), lot: b.dataset.lot,
          certificate: b.dataset.coa === "accept" ? "accepted" : "rejected",
        }});
        state.lots = (await api("/api/ops/lots")).lots || [];
        await load();
        draw();
        toast(b.dataset.coa === "accept" ? "COA accepted — lot is live." : "COA rejected.");
      } catch { toast("Could not update the lot."); }
    }));
  }
  async function ensureLots(st) {
    if (!st.lots) {
      try { st.lots = (await api("/api/ops/lots")).lots || []; }
      catch { st.lots = []; }
      if (state.tab === "receiving") draw();
    }
  }
  const origRender = render;
  window.HKL_OPS_RECEIVING = {
    render(st) { ensureLots(st); return origRender(st); },
    mount,
  };
})();
