// Helix King Labs — cart UI helpers: free-shipping progress bar + BAC Water upsell.
(function () {
  function money(n) { return window.HKL.money(n); }

  function shipBar(quote) {
    const freeAt = quote.freeShippingAt || 199, merch = quote.merchandise || 0;
    const pct = Math.min(100, Math.round((merch / freeAt) * 100));
    const done = quote.shipping <= 0;
    return `<div class="ship-bar${done ? " done" : ""}"><p>${done ? "<b>Free shipping unlocked.</b>"
      : `<b>Add ${money(Math.max(0, freeAt - merch))} more</b> for free shipping`}</p>`
      + `<div class="ship-track"><div class="ship-fill" style="width:${done ? 100 : pct}%"></div></div></div>`;
  }

  function upsell(state) {
    const hasBac = state.cart.some((c) => c.id === "BAC10" || c.id === "BAC3");
    if (hasBac || !state.catalog || !state.catalog.items) return "";
    const bac = state.catalog.items.find((x) => (x.id === "BAC10" || x.id === "BAC3") && (x.available == null || x.available > 0));
    if (!bac) return "";
    return `<div class="upsell"><div class="kicker">Pairs well with</div><div class="upsell-row">`
      + `<img loading="lazy" decoding="async" src="${bac.image || ""}" alt="${(bac.name || "Product") + " " + (bac.size || "")}" /><div><b>BAC Water</b>`
      + `<p class="muted">Sterile mixing support for research workflows.</p></div>`
      + `<div><div>${money(bac.price)}</div><button type="button" class="btn ghost" data-upsell-add="${bac.id}">Add</button></div>`
      + `</div></div>`;
  }

  function bindUpsell(state, saveCart, toast, render) {
    document.querySelectorAll("[data-upsell-add]").forEach((btn) => {
      btn.onclick = () => {
        const item = state.catalog.items.find((x) => x.id === btn.getAttribute("data-upsell-add"));
        if (!item) return;
        const line = state.cart.find((l) => l.id === item.id);
        if (line) line.qty += 1; else state.cart.push({ id: item.id, qty: 1 });
        saveCart(); toast("Added BAC Water."); render();
      };
    });
  }

  window.HKL_CART_UI = { shipBar, upsell, bindUpsell };
})();
