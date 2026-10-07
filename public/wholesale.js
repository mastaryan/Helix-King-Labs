// Wholesale page: gated catalog, countdown, order form with minimums.
(function () {
  function api(path, opts) { return window.HKL.api(path, opts); }
  function toast(m) { return window.HKL.toast(m); }
  function money(n) { return window.HKL.money(n); }
  function ga4(event, params) {
    try {
      if (window.dataLayer) window.dataLayer.push(Object.assign({ event }, params || {}));
      if (window.gtag) window.gtag("event", event, params || {});
    } catch (e) {}
  }

  function countdownHtml(endIso) {
    if (!endIso) return "";
    return `<div class="card" style="text-align:center;padding:20px;margin-bottom:24px">
      <div class="kicker">Order window closes in</div>
      <div id="wsCountdown" style="font-size:32px;font-weight:700" data-end="${endIso}">—</div>
    </div>`;
  }

  function tickCountdown() {
    const el = document.getElementById("wsCountdown");
    if (!el) return;
    const end = new Date(el.dataset.end).getTime();
    const tick = () => {
      const left = end - Date.now();
      if (left <= 0) { el.textContent = "Closed"; return; }
      const d = Math.floor(left / 86400000);
      const h = Math.floor((left % 86400000) / 3600000);
      const m = Math.floor((left % 3600000) / 60000);
      const s = Math.floor((left % 60000) / 1000);
      el.textContent = `${d}d ${h}h ${m}m ${s}s`;
    };
    tick();
    setInterval(tick, 1000);
  }

  // Request form for non-wholesale visitors
  function requestForm() {
    return `<section class="page wrap"><div class="kicker">Wholesale</div>
      <h1>Wholesale access</h1>
      <p class="lede">Wholesale pricing is available to approved accounts. Request access below — we review every application.</p>
      <div class="card" style="max-width:560px;padding:28px">
        <form id="wsRequestForm">
          <label>Full name<input name="wname" required maxlength="120" /></label>
          <label>Email<input name="wemail" type="email" required maxlength="120" /></label>
          <label>Business / lab name<input name="wbusiness" maxlength="120" /></label>
          <label>Telegram <span class="muted">(optional)</span><input name="wtelegram" placeholder="@handle" maxlength="80" /></label>
          <label>Note <span class="muted">(optional)</span><input name="wnote" placeholder="What are you looking to stock?" maxlength="500" /></label>
          <button class="btn" type="submit">Request wholesale access</button>
          <p id="wsReqNote" class="hard"></p>
        </form>
      </div></section>`;
  }

  function mountRequestForm() {
    const form = document.getElementById("wsRequestForm");
    if (!form) return;
    ga4("wholesale_view_request");
    const note = document.getElementById("wsReqNote");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        const r = await api("/api/wholesale/request", { method: "POST", body: {
          name: fd.get("wname"), email: fd.get("wemail"), business: fd.get("wbusiness"),
          telegram: fd.get("wtelegram"), note: fd.get("wnote"),
        }});
        ga4("wholesale_request_submit");
        note.textContent = r.duplicate ? "You've already requested access — status: " + (r.status || "pending") + "." : "Request received. We'll review and notify you.";
        if (!r.duplicate) form.reset();
      } catch (err) {
        note.textContent = "Couldn't submit — try again.";
      }
      toast(note.textContent);
    };
  }

  // Wholesale catalog + order form for approved users
  async function wholesalePage() {
    let status;
    try { status = await api("/api/wholesale/status"); }
    catch (e) { status = { wholesale: false }; }

    if (!status.wholesale) {
      // Check if logged in
      const user = window.HKL.state.user;
      if (!user) {
        return `<section class="page wrap"><div class="kicker">Wholesale</div>
          <h1>Wholesale access</h1>
          <p class="lede">Wholesale pricing is for approved accounts. <a href="/account" data-link>Sign in</a> or create an account, then request access below.</p>
          ${requestForm().replace('<section class="page wrap">', "<div>").replace("</section>", "</div>")}
        </section>`;
      }
      if (status.requested) {
        return `<section class="page wrap"><div class="kicker">Wholesale</div>
          <h1>Request ${status.requestStatus || "pending"}</h1>
          <p class="lede">${status.requestStatus === "approved" ? "Your access was approved — sign out and back in to refresh." : status.requestStatus === "denied" ? "Your request wasn't approved. Contact wholesale@helixkinglabs.com with questions." : "We're reviewing your application. You'll be notified when it's approved."}</p>
        </section>`;
      }
      return requestForm();
    }

    // Approved: load catalog
    let cat;
    try { cat = await api("/api/wholesale/catalog"); }
    catch (e) { return `<section class="page wrap"><h1>Wholesale</h1><p class="hard">Couldn't load the wholesale catalog.</p></section>`; }

    ga4("wholesale_view_catalog");
    const win = cat.window || {};
    const now = new Date().toISOString();
    const windowOpen = (!win.start || now >= win.start) && (!win.end || now <= win.end);
    const items = (cat.items || []).filter((p) => p.shopVisible !== false);

    return `<section class="page wrap"><div class="kicker">Wholesale</div>
      <h1>Wholesale order form</h1>
      ${win.announce ? `<p class="lede">${escapeHtml(win.announce)}</p>` : ""}
      ${win.end && windowOpen ? countdownHtml(win.end) : ""}
      ${!windowOpen ? `<div class="card" style="padding:20px;margin-bottom:24px"><b>${win.start && now < win.start ? "The next order window opens " + new Date(win.start).toLocaleString() : "The order window is currently closed."}</b><p class="muted">Check back soon or contact wholesale@helixkinglabs.com.</p></div>` : ""}
      ${windowOpen ? `
      <p class="lede">Minimum order: <b>${money(win.orderMinimum || 0)}</b> · Per-SKU minimums shown below.</p>
      <form id="wsOrderForm">
        <table class="tbl"><thead><tr><th>Product</th><th>Size</th><th>Price</th><th>Min</th><th>Qty</th><th>Line</th></tr></thead><tbody>
          ${items.map((p) => `<tr>
            <td><b>${escapeHtml(p.name)}</b></td>
            <td>${escapeHtml(p.size || "")}</td>
            <td>${money(p.price)}</td>
            <td>${p.minQty}</td>
            <td><input type="number" min="0" value="0" data-sku="${p.sku}" data-price="${p.price}" data-min="${p.minQty}" class="wsQty" style="width:72px" ${p.stock <= 0 ? "disabled" : ""} /></td>
            <td class="wsLine" data-sku="${p.sku}">—</td>
          </tr>`).join("")}
        </tbody></table>
        <div style="margin-top:16px;text-align:right">
          <div style="font-size:20px">Total: <b id="wsTotal">$0.00</b></div>
          <p class="muted" id="wsMinNote"></p>
          <label>Payment method <select name="wspay"><option value="crypto">Crypto (NOWPayments)</option><option value="wire">Wire / ACH</option></select></label>
          <button class="btn" type="submit" style="margin-top:12px">Place wholesale order</button>
          <p id="wsOrderNote" class="hard"></p>
        </div>
      </form>` : ""}
    </section>`;
  }

  function mountWholesalePage() {
    tickCountdown();
    mountRequestForm();
    document.querySelectorAll(".wsQty").forEach((inp) => {
      inp.addEventListener("input", paintWholesaleTotal);
    });
    paintWholesaleTotal();
    const form = document.getElementById("wsOrderForm");
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const lines = [];
        document.querySelectorAll(".wsQty").forEach((inp) => {
          const qty = Math.floor(Number(inp.value) || 0);
          if (qty > 0) lines.push({ sku: inp.dataset.sku, qty });
        });
        if (!lines.length) { toast("Add at least one item."); return; }
        const fd = new FormData(form);
        try {
          const r = await api("/api/wholesale/order", { method: "POST", body: { lines, paymentMethod: fd.get("wspay") } });
          ga4("wholesale_purchase", { order_id: r.order.id, value: r.order.total, currency: "USD" });
          toast("Order " + r.order.id + " placed — " + money(r.order.total));
          document.getElementById("wsOrderNote").textContent = "Order " + r.order.id + " recorded. We'll confirm payment details.";
          form.reset();
          paintWholesaleTotal();
        } catch (err) {
          const msg = err.error === "below_minimum" ? `Minimum ${err.min} vials for ${err.sku}.`
            : err.error === "below_order_minimum" ? `Order minimum is ${money(err.minimum)} — your total is ${money(err.total)}.`
            : err.error === "window_closed" ? "The order window is closed."
            : "Order failed — try again.";
          document.getElementById("wsOrderNote").textContent = msg;
          toast(msg);
        }
      };
    }
  }

  function paintWholesaleTotal() {
    let total = 0;
    document.querySelectorAll(".wsQty").forEach((inp) => {
      const qty = Math.floor(Number(inp.value) || 0);
      const price = Number(inp.dataset.price) || 0;
      const line = qty * price;
      total += line;
      const cell = document.querySelector(`.wsLine[data-sku="${inp.dataset.sku}"]`);
      if (cell) cell.textContent = qty ? money(line) : "—";
      // Warn below minimum
      const min = Number(inp.dataset.min) || 0;
      inp.style.borderColor = qty > 0 && qty < min ? "#c00" : "";
    });
    const totalEl = document.getElementById("wsTotal");
    if (totalEl) totalEl.textContent = money(total);
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function route() {
    document.getElementById("app").innerHTML = await wholesalePage();
    mountWholesalePage();
  }

  window.HKL_WHOLESALE = { wholesalePage, mountWholesalePage, mountRequestForm, route };
})();
