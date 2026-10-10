/* Helix King Labs — ops Inventory. Green eye = visible on shop, red = hidden.
   Per-vial retail price + box-of-10 wholesale kit price per row.
   Exposes window.HKL_OPS_INVENTORY = { render(state), mount(view,state) }. */
(function () {
  function render(st) {
    const rows = st.desk.inventory || [];
    const low = rows.filter((r) => r.low).length;
    return `<div class="toolbar">
      <span class="muted">${rows.length} SKUs · <span class="warn">${low} low stock</span></span>
      <span class="muted">👁 <span style="color:var(--ok)">green</span> = on shop · <span style="color:var(--bad)">red</span> = hidden</span>
    </div>
    <table class="responsive"><thead><tr>
      <th></th><th>SKU</th><th>Product</th><th>Lot</th><th>On hand</th><th>Vial (retail)</th><th>Box of 10 (WS)</th><th>COA</th>
    </tr></thead><tbody>
    ${rows.map((r) => `<tr>
      <td data-l="Visible"><button class="eye ${r.shopVisible === false ? "off" : "on"}" data-eye="${esc(r.sku)}" title="${r.shopVisible === false ? "Hidden — click to show" : "Visible — click to hide"}">${r.shopVisible === false ? "🔴" : "🟢"}</button></td>
      <td data-l="SKU"><b>${esc(r.sku)}</b></td>
      <td data-l="Product">${esc(r.name)} ${esc(r.size || "")}</td>
      <td data-l="Lot">${esc(r.lot || "—")}</td>
      <td data-l="On hand" class="${r.low ? "warn" : ""}"><b>${r.on_hand}</b></td>
      <td data-l="Vial">${r.price == null ? "—" : money(r.price)}</td>
      <td data-l="Box of 10">${r.wholesalePrice == null ? `<span class="muted">—</span>` : money(r.wholesalePrice)}</td>
      <td data-l="COA">${r.certificate === "accepted" ? pill("paid", "Accepted") : pill("pending", r.certificate || "Pending")}</td>
    </tr>`).join("") || `<tr><td colspan="8" class="muted">No inventory rows.</td></tr>`}
    </tbody></table>
    <p class="muted" style="margin-top:10px">Full lot, cost, and pricing edits stay on the <a href="/ops/catalog">catalog editor</a>. Labels print from <a href="/tools/label">label maker</a>.</p>`;
  }
  function mount(view, st) {
    view.querySelectorAll("[data-eye]").forEach((b) => b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const sku = b.dataset.eye;
      const row = (st.desk.inventory || []).find((r) => r.sku === sku);
      const show = row && row.shopVisible === false;
      const ok = await confirmAction({
        title: show ? "Show on shop" : "Hide from shop", orderId: sku, action: "Visibility",
        consequence: show ? "This SKU becomes buyable on the shop immediately." : "This SKU disappears from the shop immediately. Open orders are unaffected.",
        danger: !show,
      });
      if (!ok) return;
      try {
        await api("/api/ops/pricing", { method: "POST", body: { rows: [{ sku, shopVisible: show }] } });
        await load(); draw();
        toast(show ? `${sku} is live on the shop.` : `${sku} hidden from the shop.`);
      } catch { toast("Could not update visibility."); }
    }));
  }
  window.HKL_OPS_INVENTORY = { render, mount };
})();
