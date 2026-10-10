/* Helix King Labs — customer order receipt page. Loaded after app.js helpers via window.HKL. */
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function orderStatusLabel(status) {
  return { not_paid: "Not paid", paid: "Paid", shipped: "Shipped", delivered: "Delivered", voided: "Cancelled" }[status] || status || "";
}

function trackUrl(carrier, num) {
  if (!num) return null;
  const c = String(carrier || "").toLowerCase();
  const n = encodeURIComponent(String(num).trim());
  if (c.includes("usps")) return "https://tools.usps.com/go/TrackConfirmAction?tLabels=" + n;
  if (c.includes("fedex") || c.includes("fed ex")) return "https://www.fedex.com/fedextrack/?trknbr=" + n;
  if (c.includes("ups")) return "https://www.ups.com/track?tracknum=" + n;
  if (c.includes("dhl")) return "https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=" + n;
  return null;
}

function orderShortDate(at) {
  if (!at) return "";
  try { return new Date(at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }); }
  catch { return String(at).slice(0, 10); }
}

/* Vertical fulfillment timeline for current orders: Order placed -> Payment confirmed -> Shipped. */
function orderTimeline(o) {
  const st = o.status || "";
  if (st === "voided") return `<p class="muted">This order was cancelled. Nothing was charged beyond what was sent.</p>`;
  const events = o.events || [];
  const at = (kind) => { const e = events.find((e) => e.kind === kind); return e ? orderShortDate(e.at) : ""; };
  const steps = [
    { label: "Order placed", date: at("placed") || orderShortDate(o.created) },
    { label: "Payment confirmed", date: at("paid"), waiting: "Waiting on payment" },
    { label: "Shipped", date: at("shipped"), waiting: "Being prepared" },
  ];
  const stateOf = (i) => {
    if (st === "shipped") return "done";
    if (st === "paid") return i <= 1 ? "done" : "now";
    return i === 0 ? "done" : i === 1 ? "now" : "";
  };
  return `<ol class="order-tl">${steps.map((s, i) => {
    const cls = stateOf(i);
    const sub = s.date || (cls === "now" ? s.waiting : "");
    return `<li class="${cls}"><span class="dot"></span><div><b>${s.label}</b>${sub ? `<span>${sub}</span>` : ""}</div></li>`;
  }).join("")}</ol>`;
}

function orderWhen(at) {
  if (!at) return "";
  try { return new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return String(at).slice(0, 10); }
}

function copyText(t, btn) {
  const done = () => { if (btn) { const o = btn.textContent; btn.textContent = "Copied"; setTimeout(() => (btn.textContent = o), 1500); } };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done).catch(done);
  else { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch {} ta.remove(); done(); }
}

function receiptView(o) {
  const isWs = !!o.wholesale;
  const q = o.quote || (isWs ? { lines: o.lines || [], total: o.total, merchandise: o.total, shipping: 0 } : {});
  const pay = o.payment || {};
  const st = o.status || "";
  const ship = o.ship || {};
  const unpaid = st === "not_paid" || (isWs && st === "committed" && !pay.invoiceUrl);
  const voided = st === "voided";
  const steps = ["Placed", "Paid", "Shipped", "Delivered"];
  const stepDone = (n) => (n === 0 ? true : n === 1 ? ["paid", "shipped", "delivered"].includes(st) : n === 2 ? ["shipped", "delivered"].includes(st) : st === "delivered");
  const timeline = voided
    ? `<div class="paybox"><h3>Did you miss something?</h3>
      <p>This order was released before payment was confirmed, so the items went back on the shelf. Nothing was charged beyond what you sent.</p>
      <p><button class="btn" type="button" id="restoreCart">Restore my cart</button></p>
      <p class="muted" id="restoreMsg"></p></div>`
    : `<ol class="steps">${steps.map((label, i) => `<li class="${stepDone(i) ? "done" : ""}">${label}</li>`).join("")}</ol>`;
  let payBox = "";
  const underpaid = pay.paymentStatus === "partially_paid" && unpaid;
  if (underpaid) {
    const shortBy = Number(pay.shortBy || 0).toFixed(2);
    const paidAmt = Number(pay.actuallyPaid || 0).toFixed(2);
    payBox = `<div class="paybox" style="border-color:#c80"><h3>Payment short by $${shortBy}</h3>
      <p>We received $${paidAmt} but the order total is ${HKL.money(q.total)}. Send the remaining <b>$${shortBy}</b> to the same address within 120 minutes or the order will be cancelled.</p>
      <p class="muted">This usually happens when a wallet deducts the network fee from the payment. Network fees are always on the buyer — add a little extra to cover it.</p></div>`;
  } else if (unpaid && o.paymentMethod === "crypto" && pay.payAddress) {
    payBox = `<div class="paybox"><h3>Complete your payment</h3>
      <p>Send <b>${esc(pay.payAmount)} ${esc(pay.payCurrency)}</b>${pay.network ? " on " + esc(pay.network) : ""} to:</p>
      <p class="codeaddr">${esc(pay.payAddress)} <button class="btn ghost" type="button" id="copyAddr">Copy</button></p>
      <p class="muted">Send the exact amount on the exact network. Payment confirms automatically, usually within minutes of the network.</p></div>`;
  } else if (unpaid && (o.paymentMethod === "venmo" || o.paymentMethod === "cashapp")) {
    const handle = o.paymentMethod === "venmo" ? "@fibkingpeps" : "$FibKingPep";
    const app = o.paymentMethod === "venmo" ? "Venmo" : "Cash App";
    payBox = `<div class="paybox"><h3>Complete your payment</h3>
      <p>Send <b>${HKL.money(q.total)}</b> on ${app} to <b>${handle}</b> and put <b>${esc(o.id)}</b> in the note.</p>
      <p class="muted">Mark the note exactly — it is how the payment is matched. Nothing ships until it is confirmed.</p></div>`;
  } else if (st === "paid") {
    payBox = `<div class="paybox" style="border-color:#2a7"><h3>✓ Thank you — payment received!</h3>
      <p>Order <b>${esc(o.id)}</b> is confirmed and being prepared. A receipt has been emailed to you.</p>
      <p><button class="btn ghost" type="button" onclick="window.print()">Print receipt</button>
      <a class="btn" href="/account" data-link>Track in my account</a></p>
      <p class="muted">Tracking posts here when the label is booked.</p></div>`;
  } else if (st === "payment_failed") {
    payBox = `<div class="paybox" style="border-color:#c00"><h3>Payment didn't go through</h3>
      <p>Something went wrong with the payment for order <b>${esc(o.id)}</b>. Your items are still reserved — try again below.</p>
      <p><button class="btn" type="button" id="retryPay">Try payment again</button></p>
      <p class="muted" id="retryMsg"></p>
      <p class="muted">Questions? Contact support@helixkinglabs.com with order ${esc(o.id)}.</p></div>`;
  }
  const shipView = isWs
    ? `<span class="muted">Ships to your account address on file. Update it in <a href="/account" data-link>My account</a> if needed.</span>`
    : ship.line1
    ? `${esc(ship.name || "")}<br>${esc(ship.line1)}${ship.line2 ? "<br>" + esc(ship.line2) : ""}<br>${esc(ship.city)}, ${esc(ship.region)} ${esc(ship.postal)}`
    : "Missing — the order cannot ship without it.";
  const tUrl = typeof trackUrl === "function" ? trackUrl(o.carrier, o.tracking) : null;
  const trackBox = st === "shipped"
    ? `<div class="paybox"><h3>Shipped${o.carrier ? " · " + esc(o.carrier) : ""}</h3>
      <p class="codeaddr">${tUrl ? `<a href="${tUrl}" target="_blank" rel="noopener">${esc(o.tracking || "")}</a>` : esc(o.tracking || "")} <button class="btn ghost" type="button" id="copyTrack">Copy</button></p></div>`
    : "";
  const eventLabel = { placed: "Order placed", paid: "Payment confirmed", shipped: "Shipped", delivered: "Delivered", voided: "Order cancelled", address: "Shipping address updated", note: "Note" };
  const feed = (o.events || []).map((e) => `<p class="muted">${orderWhen(e.at)} — ${eventLabel[e.kind] || e.kind}</p>`).join("");
  const lines = (q.lines || []).map((l) => `<tr><td>${esc(l.name)} ${esc(l.size)}</td><td>× ${l.qty}</td><td>${HKL.money(l.line)}</td></tr>`).join("");
  return `<section class="page wrap">
    <div class="kicker">Order</div>
    <h1>${esc(o.id)}</h1>
    <p class="lede">${orderWhen(o.created || o.at)} · ${orderStatusLabel(st)} · ${HKL.money(q.total)}</p>
    ${timeline}
    ${payBox}
    ${trackBox}
    <div class="grid2">
      <div><h3>Ship to</h3><p>${shipView}</p>
        ${unpaid ? `<button class="btn ghost" type="button" id="editAddr">Edit address</button>
        <form id="addrForm" class="tool-form hidden" style="margin-top:12px">
          <input name="name" placeholder="Name" value="${esc(ship.name || "")}" />
          <input name="phone" placeholder="Phone" value="${esc(ship.phone || "")}" />
          <input name="line1" placeholder="Street" required value="${esc(ship.line1 || "")}" />
          <input name="line2" placeholder="Apt / unit" value="${esc(ship.line2 || "")}" />
          <input name="city" placeholder="City" required value="${esc(ship.city || "")}" />
          <input name="region" placeholder="State" required value="${esc(ship.region || "")}" />
          <input name="postal" placeholder="Postal code" required value="${esc(ship.postal || "")}" />
          <button class="btn" type="submit">Save address</button>
          <div class="err" id="addrErr"></div>
        </form>` : ""}
      </div>
      <div><h3>Items</h3><table class="table"><tbody>${lines}</tbody></table>
        <p>Merchandise ${HKL.money(q.merchandise)} · Shipping ${HKL.money(q.shipping)}${q.surcharge ? " · Surcharge " + HKL.money(q.surcharge) : ""}<br><b>Total ${HKL.money(q.total)}</b></p>
      </div>
    </div>
    ${feed ? `<h3>Updates</h3>${feed}<p class="muted">Email updates are sent as each step completes.</p>` : ""}
    ${!unpaid && !voided ? `<div id="suggestBox" style="margin-top:24px"></div>` : ""}
    ${!unpaid && !voided ? `<p style="margin-top:20px"><button class="btn" type="button" id="reorderBtn">Reorder these items</button> <span class="muted" id="reorderMsg"></span></p>` : ""}
    ${unpaid ? `<p style="margin-top:20px"><button class="btn ghost" type="button" id="cancelOrder">Cancel this order</button></p>` : ""}
    <p style="margin-top:16px"><a href="/account" data-link>Back to account</a></p>
  </section>`;
}

function receiptSuggestions(o) {
  // Client-side suggestions: in-stock families not in this order, same category first.
  try {
    var HKL = window.HKL || {};
    var catalog = (HKL.state && HKL.state.catalog) || {};
    var fams = catalog.families || [];
    var items = catalog.items || [];
    var orderedFams = {};
    (o.quote.lines || []).forEach(function (l) {
      var it = items.find(function (x) { return x.id === l.id || x.sku === l.sku; });
      if (it) orderedFams[it.family || it.id] = true;
    });
    var out = [];
    fams.forEach(function (f) {
      if (orderedFams[f.id] || f.shopVisible === false) return;
      var variants = (f.variantIds || []).map(function (vid) { return items.find(function (x) { return x.id === vid; }); })
        .filter(function (p) { return p && (p.available || 0) > 0; });
      if (!variants.length) return;
      var low = Math.min.apply(null, variants.map(function (p) { return Number(p.price || 0); }).filter(function (x) { return x > 0; }));
      out.push({ name: f.name, slug: f.slug || f.id, price: low === Infinity ? null : low, cat: f.category });
    });
    var orderedCats = {};
    Object.keys(orderedFams).forEach(function (fid) {
      var f = fams.find(function (x) { return x.id === fid; });
      if (f) orderedCats[f.category] = true;
    });
    out.sort(function (a, b) { return ((orderedCats[b.cat] ? 1 : 0) - (orderedCats[a.cat] ? 1 : 0)) || ((a.price || 9999) - (b.price || 9999)); });
    return out.slice(0, 3);
  } catch (e) { return []; }
}

function bindReceipt(o) {
  const id = o.id;
  const reload = () => location.reload();
  const HKL = window.HKL || {};
  // Suggestions
  const sbox = document.getElementById("suggestBox");
  if (sbox) {
    const sug = receiptSuggestions(o);
    if (sug.length) {
      sbox.innerHTML = `<h3>Pairs well with your order</h3><div class="welcome-grid">` + sug.map(function (s) {
        return `<a class="welcome-card" href="/product/${esc(s.slug)}" data-link><div class="welcome-card-body"><h3>${esc(s.name)}</h3><p class="welcome-price">${s.price ? "from $" + s.price : "See price"}</p></div></a>`;
      }).join("") + `</div>`;
    }
  }
  // Reorder
  const rbo = document.getElementById("reorderBtn");
  if (rbo) rbo.onclick = async () => {
    const msg = document.getElementById("reorderMsg");
    try {
      const out = await HKL.api("/api/orders/reorder", { method: "POST", body: { id } });
      let added = 0, skipped = 0;
      for (const l of out.lines || []) {
        if (!l.inStock) { skipped++; continue; }
        const line = HKL.state.cart.find((c) => c.id === l.id && c.kind !== "kit");
        if (line) line.qty = Math.min(9, line.qty + l.qty);
        else HKL.state.cart.push({ id: l.id, qty: Math.min(9, l.qty), kind: "single" });
        added++;
      }
      if (HKL.saveCart) HKL.saveCart(); else try { localStorage.setItem("hkl_cart", JSON.stringify(HKL.state.cart)); } catch (e) {}
      if (msg) msg.textContent = added ? `Added ${added} item(s) to cart.${skipped ? " " + skipped + " out of stock." : ""}` : "Nothing available to reorder right now.";
      if (added && HKL.paintCartCount) HKL.paintCartCount();
    } catch (err) {
      if (msg) msg.textContent = "Reorder failed: " + (err.message || "error");
    }
  };
  const ca = document.getElementById("copyAddr");
  if (ca) ca.onclick = () => copyText((o.payment || {}).payAddress || "", ca);
  const ct = document.getElementById("copyTrack");
  if (ct) ct.onclick = () => copyText(o.tracking || "", ct);
  const eb = document.getElementById("editAddr");
  const form = document.getElementById("addrForm");
  if (eb && form) eb.onclick = () => form.classList.toggle("hidden");
  if (form) form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = {};
    for (const k of ["name", "phone", "line1", "line2", "city", "region", "postal"]) body[k] = String(fd.get(k) || "");
    try {
      await HKL.api("/api/orders/" + encodeURIComponent(id) + "/address", { method: "POST", body });
      reload();
    } catch (err) { document.getElementById("addrErr").textContent = err.message || "Could not save the address."; }
  };
  const rb = document.getElementById("restoreCart");
  if (rb) rb.onclick = async () => {
    const msg = document.getElementById("restoreMsg");
    try {
      const out = await HKL.api("/api/orders/" + encodeURIComponent(id) + "/restore", { method: "POST", body: {} });
      HKL.restoreCart(out.lines);
      location.href = "/cart";
    } catch (err) { if (msg) msg.textContent = err.message || "Could not restore the cart."; }
  };
  const cb = document.getElementById("cancelOrder");
  if (cb) cb.onclick = async () => {
    if (!confirm("Cancel order " + id + "? Stock is released and the payment hold is cleared.")) return;
    try { await HKL.api("/api/orders/" + encodeURIComponent(id) + "/cancel", { method: "POST", body: {} }); reload(); }
    catch (err) { alert(err.message || "Could not cancel the order."); }
  };
}

