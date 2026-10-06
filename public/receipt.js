/* Helix King Labs — customer order receipt page. Loaded after app.js helpers via window.HKL. */
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function orderStatusLabel(status) {
  return { awaiting_settlement: "Awaiting payment", settled: "Paid", shipped: "Shipped", voided: "Cancelled" }[status] || status || "";
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
  const q = o.quote || {};
  const pay = o.payment || {};
  const st = o.status || "";
  const ship = o.ship || {};
  const unpaid = st === "awaiting_settlement";
  const voided = st === "voided";
  const stepDone = (n) => (n === 0 ? true : n === 1 ? st === "settled" || st === "shipped" : st === "shipped");
  const steps = ["Placed", "Paid", "Shipped"];
  const timeline = voided
    ? `<div class="paybox"><h3>Did you miss something?</h3>
      <p>This order was released before payment was confirmed, so the items went back on the shelf. Nothing was charged beyond what you sent.</p>
      <p><button class="btn" type="button" id="restoreCart">Restore my cart</button></p>
      <p class="muted" id="restoreMsg"></p></div>`
    : `<ol class="steps">${steps.map((label, i) => `<li class="${stepDone(i) ? "done" : ""}">${label}</li>`).join("")}</ol>`;
  let payBox = "";
  if (unpaid && o.paymentMethod === "crypto" && pay.payAddress) {
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
  } else if (st === "settled") {
    payBox = `<div class="paybox"><h3>Payment received</h3><p class="muted">The order is being prepared. Tracking posts here when the label is booked.</p></div>`;
  }
  const shipView = ship.line1
    ? `${esc(ship.name || "")}<br>${esc(ship.line1)}${ship.line2 ? "<br>" + esc(ship.line2) : ""}<br>${esc(ship.city)}, ${esc(ship.region)} ${esc(ship.postal)}`
    : "Missing — the order cannot ship without it.";
  const trackBox = st === "shipped"
    ? `<div class="paybox"><h3>Shipped${o.carrier ? " · " + esc(o.carrier) : ""}</h3>
      <p class="codeaddr">${esc(o.tracking || "")} <button class="btn ghost" type="button" id="copyTrack">Copy</button></p></div>`
    : "";
  const eventLabel = { placed: "Order placed", settled: "Payment confirmed", shipped: "Shipped", voided: "Order cancelled", address: "Shipping address updated", note: "Note" };
  const feed = (o.events || []).map((e) => `<p class="muted">${orderWhen(e.at)} — ${eventLabel[e.kind] || e.kind}</p>`).join("");
  const lines = (q.lines || []).map((l) => `<tr><td>${esc(l.name)} ${esc(l.size)}</td><td>× ${l.qty}</td><td>${HKL.money(l.line)}</td></tr>`).join("");
  return `<section class="page wrap">
    <div class="kicker">Order</div>
    <h1>${esc(o.id)}</h1>
    <p class="lede">${orderWhen(o.created)} · ${orderStatusLabel(st)} · ${HKL.money(q.total)}</p>
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
    ${unpaid ? `<p style="margin-top:20px"><button class="btn ghost" type="button" id="cancelOrder">Cancel this order</button></p>` : ""}
    <p style="margin-top:16px"><a href="/account" data-link>Back to account</a></p>
  </section>`;
}

function bindReceipt(o) {
  const id = o.id;
  const reload = () => location.reload();
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

