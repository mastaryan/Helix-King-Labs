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

  // Group progress bar color — red when empty, yellow when one away, green when hit
  function barColor(n, t) { return n >= t ? "#2a7" : n === t - 1 ? "#eab308" : "#dc2626"; }

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

  // Request form for non-wholesale visitors. bare=true skips the
  // heading block for when the form is embedded under another heading.
  function requestForm(bare) {
    const head = bare ? "" :
      `<div class="kicker">Wholesale</div>
      <h1>Wholesale access</h1>
      <p class="lede">Wholesale pricing is available to approved accounts. Request access below — we review every application.</p>\n      `;
    return `${bare ? "<div>" : '<section class="page wrap">'}\n      ${head}<div class="card" style="max-width:560px;padding:28px">
        <form id="wsRequestForm">
          <label>Full name<input name="wname" required maxlength="120" /></label>
          <label>Email<input name="wemail" type="email" required maxlength="120" /></label>
          <label>Business / lab name<input name="wbusiness" maxlength="120" /></label>
          <label>Telegram <span class="muted">(optional)</span><input name="wtelegram" placeholder="@handle" maxlength="80" /></label>
          <label>Note <span class="muted">(optional)</span><input name="wnote" placeholder="What are you looking to stock?" maxlength="500" /></label>
          <button class="btn" type="submit">Request wholesale access</button>
          <p id="wsReqNote" class="hard"></p>
        </form>
      </div>${bare ? "</div>" : "</section>"}`;
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
          ${requestForm(true)}
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
    const items = (cat.items || []).filter((p) => p.wholesaleVisible !== false);
    const committed = cat.committed || {};
    const groupMinDefault = win.groupMinDefault || 5;

    let groupHtml = "";
    const totalCommitted = Object.values(committed).reduce((a, b) => a + b, 0);
    if (win.groupTotalTarget) {
      const pct = Math.min(100, Math.round((totalCommitted / win.groupTotalTarget) * 100));
      groupHtml = `<div class="card" style="padding:20px;margin-bottom:24px">
        <div class="kicker">Group total</div>
        <div style="font-size:24px;font-weight:700">${totalCommitted} / ${win.groupTotalTarget} vials committed</div>
        <div style="background:#eee;border-radius:8px;height:12px;margin-top:8px"><div style="background:${barColor(totalCommitted, win.groupTotalTarget)};width:${pct}%;height:12px;border-radius:8px;transition:width .3s,background .3s"></div></div>
      </div>`;
    }

    // Group items by family for shop-style cards
    const fams = {};
    items.forEach((p) => {
      const fid = p.family || p.sku;
      if (!fams[fid]) fams[fid] = { id: fid, name: p.name, image: p.image, items: [] };
      fams[fid].items.push(p);
    });
    const famList = Object.values(fams);
    // Stash for card interactions
    const itemBySku = {};
    const famBySku = {};
    items.forEach((p) => { itemBySku[p.sku] = p; });
    Object.entries(fams).forEach(([fid, f]) => { famBySku[fid] = f.items.map((v) => v.sku); });
    wsCatalog = { families: famList, itemBySku, famBySku, committed, groupMinDefault };

    return `<section class="page wrap"><div class="kicker">Wholesale</div>
      <h1>Wholesale group order</h1>
      ${win.announce ? `<p class="lede">${escapeHtml(win.announce)}</p>` : ""}
      <p class="lede">Pick a strength to see group progress and commit. Progress bars are live — a cold bar can still fill.</p>
      ${groupHtml}
      ${win.end && windowOpen ? countdownHtml(win.end) : ""}
      ${!windowOpen ? `<div class="card" style="padding:20px;margin-bottom:24px"><b>${win.start && now < win.start ? "The next order window opens " + new Date(win.start).toLocaleString() : "The order window is currently closed."}</b><p class="muted">Check back soon or contact wholesale@helixkinglabs.com.</p></div>` : ""}
      ${windowOpen ? `
      <div class="grid cards" id="wsGrid">
        ${famList.map((f) => `
        <article class="card ws-card" data-fam="${escapeHtml(f.id)}">
          <div class="ph"><img src="${escapeHtml(f.image || "/img/placeholder.jpg")}" alt="${escapeHtml(f.name)}" loading="lazy" /></div>
          <div class="meta">
            <div class="name">${escapeHtml(f.name)}</div>
            <div class="dose-row card-doses" aria-label="Strengths">
              ${f.items.map((v) => `<button type="button" class="dose ws-mg" data-sku="${escapeHtml(v.sku)}" data-fam="${escapeHtml(f.id)}">${escapeHtml(v.size)}</button>`).join("")}
            </div>
            <div class="ws-detail" id="ws-detail-${escapeHtml(f.id)}" hidden></div>
          </div>
        </article>`).join("")}
      </div>
      <div class="card" id="wsSummary" style="margin-top:24px;padding:16px;position:sticky;bottom:16px;background:var(--bg-2);border:2px solid var(--line-2);max-height:40vh;overflow:auto" hidden>
        <h3 style="margin-top:0">Order summary</h3>
        <div id="wsLines"><p class="muted">Select a strength and quantity to commit.</p></div>
        <div style="font-size:20px;margin-top:12px">Total: <b id="wsGrandTotal">$0.00</b></div>
        <form id="wsOrderForm" style="margin-top:12px">
          <div id="wsPayMethods" style="margin:0 0 8px"></div>
          <p class="muted" id="wsPayNote" style="margin:0 0 8px">Crypto only — payment is due immediately on commit.</p>
          <button class="btn" type="submit" style="margin-top:4px">Commit and pay now</button>
          <p id="wsOrderNote" class="hard"></p>
        </form>
      </div>` : ""}
    </section>`;
  }

  // Wholesale card state: sku -> qty
  const wsCart = {};
  let wsCatalog = null;

  function wsRenderDetail(famId, sku) {
    const fam = (wsCatalog.families || []).find((f) => f.id === famId);
    if (!fam) return;
    const item = fam.items.find((v) => v.sku === sku);
    if (!item) return;
    const gmin = item.groupMin != null ? item.groupMin : (wsCatalog.groupMinDefault || 5);
    const got = (wsCatalog.committed || {})[sku] || 0;
    const pct = Math.min(100, Math.round((got / gmin) * 100));
    const met = got >= gmin;
    const qty = wsCart[sku] || 0;
    const box = document.getElementById("ws-detail-" + famId);
    if (!box) return;
    // Mark active mg button
    document.querySelectorAll(`.ws-mg[data-fam="${famId}"]`).forEach((b) => {
      b.classList.toggle("on", b.dataset.sku === sku);
    });
    box.hidden = false;
    box.innerHTML = `
      <div style="margin:12px 0">
        <div style="font-size:13px;margin-bottom:4px">Group progress: <b>${got}/${gmin}</b> ${met ? "✓ filled" : ""}</div>
        <div style="background:#eee;border-radius:6px;height:10px"><div style="background:${barColor(got, gmin)};width:${pct}%;height:10px;border-radius:6px;transition:width .3s,background .3s"></div></div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font-size:18px;font-weight:700">${money(item.price)} <small class="muted">/ box of 10</small></span>
        <div style="display:flex;align-items:center;gap:6px">
          <button type="button" class="btn ghost ws-dec" data-sku="${escapeHtml(sku)}" style="padding:6px 12px">−</button>
          <input type="number" min="0" value="${qty}" data-sku="${escapeHtml(sku)}" class="ws-qty" style="width:64px;text-align:center" aria-label="Quantity" />
          <button type="button" class="btn ghost ws-inc" data-sku="${escapeHtml(sku)}" style="padding:6px 12px">+</button>
        </div>
        <span class="ws-line-total" data-sku="${escapeHtml(sku)}" style="font-size:18px;font-weight:700;margin-left:auto">${money(qty * item.price)}</span>
      </div>`;
    // Wire qty controls
    box.querySelector(".ws-qty").addEventListener("input", (e) => wsSetQty(sku, Math.max(0, Math.floor(Number(e.target.value) || 0))));
    box.querySelector(".ws-dec").addEventListener("click", () => wsSetQty(sku, Math.max(0, (wsCart[sku] || 0) - 1)));
    box.querySelector(".ws-inc").addEventListener("click", () => wsSetQty(sku, (wsCart[sku] || 0) + 1));
  }

  function wsSetQty(sku, qty) {
    if (qty > 0) wsCart[sku] = qty; else delete wsCart[sku];
    // Update the card's qty input + line total
    const famId = Object.keys(wsCatalog.famBySku || {}).find((f) => (wsCatalog.famBySku[f] || []).includes(sku));
    const item = wsCatalog.itemBySku[sku];
    document.querySelectorAll(`.ws-qty[data-sku="${sku}"]`).forEach((inp) => { if (document.activeElement !== inp) inp.value = qty; });
    document.querySelectorAll(`.ws-line-total[data-sku="${sku}"]`).forEach((el) => { el.textContent = money(qty * (item ? item.price : 0)); });
    wsPaintSummary();
  }

  // Wholesale payment methods: cashapp/venmo allowed under $500, crypto only at $500+
  const WS_CASHAPP_LIMIT = 500;
  function wsCartTotal() {
    let grand = 0;
    for (const sku of Object.keys(wsCart)) {
      const item = wsCatalog && wsCatalog.itemBySku[sku];
      grand += (wsCart[sku] || 0) * (item ? item.price : 0);
    }
    return grand;
  }
  function wsPaintPayMethods() {
    const box = document.getElementById("wsPayMethods");
    const note = document.getElementById("wsPayNote");
    if (!box) return;
    const total = wsCartTotal();
    const allowManual = total < WS_CASHAPP_LIMIT;
    const prev = (document.querySelector('input[name="wsPay"]:checked') || {}).value;
    const sel = allowManual ? (["cashapp", "venmo", "crypto"].includes(prev) ? prev : "crypto") : "crypto";
    box.innerHTML = allowManual
      ? `<label style="display:block;margin:4px 0"><input type="radio" name="wsPay" value="crypto" ${sel === "crypto" ? "checked" : ""}> Crypto (NOWPayments)</label>
         <label style="display:block;margin:4px 0"><input type="radio" name="wsPay" value="cashapp" ${sel === "cashapp" ? "checked" : ""}> Cash App</label>
         <label style="display:block;margin:4px 0"><input type="radio" name="wsPay" value="venmo" ${sel === "venmo" ? "checked" : ""}> Venmo</label>`
      : `<p class="muted" style="margin:0">Orders $500+ are crypto only.</p><input type="hidden" name="wsPay" value="crypto">`;
    if (note) note.textContent = allowManual
      ? "Payment is due immediately on commit."
      : "Crypto only on orders $500+ — payment is due immediately on commit.";
  }

  function wsPaintSummary() {
    const linesBox = document.getElementById("wsLines");
    const totalBox = document.getElementById("wsGrandTotal");
    const summary = document.getElementById("wsSummary");
    if (!linesBox || !totalBox) return;
    const skus = Object.keys(wsCart).filter((k) => wsCart[k] > 0);
    if (summary) summary.hidden = !skus.length;
    if (!skus.length) {
      linesBox.innerHTML = `<p class="muted">Select a strength and quantity to commit.</p>`;
      totalBox.textContent = money(0);
      return;
    }
    let grand = 0;
    linesBox.innerHTML = skus.map((sku) => {
      const item = wsCatalog.itemBySku[sku];
      const qty = wsCart[sku];
      const line = qty * (item ? item.price : 0);
      grand += line;
      return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line)">
        <span>${escapeHtml(item ? item.name : sku)} · ${escapeHtml(item ? item.size : "")} <span class="muted">× ${qty} box${qty > 1 ? "es" : ""}</span></span>
        <b>${money(line)}</b>
      </div>`;
    }).join("");
    totalBox.textContent = money(grand);
    wsPaintPayMethods();
  }

  function mountWholesalePage() {
    tickCountdown();
    mountRequestForm();
    // Build catalog lookup for card interactions
    const grid = document.getElementById("wsGrid");
    if (grid) {
      // Reconstruct from rendered cards (wsCatalog set during page render)
      document.querySelectorAll(".ws-mg").forEach((btn) => {
        btn.addEventListener("click", () => wsRenderDetail(btn.dataset.fam, btn.dataset.sku));
      });
      // Auto-select first mg on each card
      document.querySelectorAll(".ws-card").forEach((card) => {
        const first = card.querySelector(".ws-mg");
        if (first) wsRenderDetail(first.dataset.fam, first.dataset.sku);
      });
    }
    wsPaintSummary();
    const form = document.getElementById("wsOrderForm");
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const lines = Object.keys(wsCart).map((sku) => ({ sku, qty: wsCart[sku] })).filter((l) => l.qty > 0);
        if (!lines.length) { toast("Add at least one item."); return; }
        const paySel = document.querySelector('input[name="wsPay"]:checked');
        const paymentMethod = paySel ? paySel.value : "crypto";
        try {
          const r = await api("/api/wholesale/order", { method: "POST", body: { lines, paymentMethod } });
          ga4("wholesale_purchase", { order_id: r.order.id, value: r.order.total, currency: "USD" });
          // Crypto: redirect to NOWPayments invoice. Cash App/Venmo: show payment instructions.
          if (r.order && r.order.invoiceUrl) {
            location.href = r.order.invoiceUrl;
            return;
          }
          if (r.order && r.order.paymentHandle) {
            const label = paymentMethod === "venmo" ? "Venmo" : "Cash App";
            document.getElementById("wsOrderNote").innerHTML =
              `Commitment <b>${escapeHtml(r.order.id)}</b> recorded (${money(r.order.total)}). ` +
              `Send payment via ${label} to <b>${escapeHtml(r.order.paymentHandle)}</b> with note <b>${escapeHtml(r.order.id)}</b>.`;
          } else {
            toast("Committed — " + money(r.order.total));
            document.getElementById("wsOrderNote").textContent = "Commitment " + r.order.id + " recorded. Complete payment to finalize.";
          }
          Object.keys(wsCart).forEach((k) => delete wsCart[k]);
          wsPaintSummary();
          // Reset qty displays
          document.querySelectorAll(".ws-qty").forEach((inp) => { inp.value = 0; });
          document.querySelectorAll(".ws-line-total").forEach((el) => { el.textContent = money(0); });
        } catch (err) {
          const msg = err.error === "below_order_minimum" ? `Order minimum is ${money(err.minimum)} — your total is ${money(err.total)}.`
            : err.error === "crypto_only_over_limit" ? `Orders $500+ are crypto only — your total is ${money(err.total)}.`
            : err.error === "window_closed" ? "The order window is closed."
            : "Commit failed — try again.";
          document.getElementById("wsOrderNote").textContent = msg;
          toast(msg);
        }
      };
    }
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function route() {
    document.getElementById("app").innerHTML = await wholesalePage();
    mountWholesalePage();
  }

  window.WS_ROUTE = route;
  window.HKL_WHOLESALE = { wholesalePage, mountWholesalePage, mountRequestForm, route };
})();
