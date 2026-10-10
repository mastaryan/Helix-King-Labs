/* Helix King Labs — ops Certificates. Clean cards auto-fed from accepted COAs.
   Exposes window.HKL_OPS_CERTS = { render(state) }. */
(function () {
  function render(st) {
    const recs = ((st.certs && st.certs.records) || []).filter((r) => r.status === "Released");
    const byLot = {};
    (st.lots || []).forEach((s) => (s.lots || []).forEach((l) => {
      if (l.certificate === "accepted") byLot[l.lot] = { sku: s.sku, name: s.name, size: s.size };
    }));
    return `<p class="muted">Accepted COAs land here automatically from Receiving. ${recs.length} released certificate${recs.length === 1 ? "" : "s"}.</p>
    <div class="cert-grid">
      ${recs.map((r) => {
        const lot = byLot[r.lot];
        return `<div class="cert-card">
          <h4>${esc(r.product || r.sku || "")}</h4>
          <div class="meta">Lot <b>${esc(r.lot)}</b> · tested ${esc(r.tested || "—")} · released ${esc(r.released || "—")}</div>
          <div class="kv">
            <span>Purity</span><div>${r.purity != null ? r.purity + "%" : "—"}</div>
            <span>Identity</span><div>${esc(r.identity || "—")}</div>
            <span>Endotoxin</span><div>${esc(r.endotoxin || "—")}</div>
            <span>Sterility</span><div>${esc(r.sterility || "—")}</div>
          </div>
          <div style="margin-top:10px;display:flex;gap:8px">
            ${r.file ? `<a class="act sm" style="text-decoration:none" href="${esc(r.file)}" target="_blank" rel="noopener">View PDF</a>` : ""}
            ${lot ? `<span class="pill ok">Lot accepted</span>` : `<span class="pill dim">Record only</span>`}
          </div>
        </div>`;
      }).join("") || `<div class="panel"><p class="muted">No released certificates yet. Accept a COA in Receiving and it appears here.</p></div>`}
    </div>`;
  }
  window.HKL_OPS_CERTS = { render };
})();
