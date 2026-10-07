/* Helix King Labs — ops fulfillment: order detail, intake, COA upload.
   Loaded before app.js; uses window.HKL at runtime. */
(function () {
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function money(n) {
    var HKL = window.HKL || {};
    return HKL.money ? HKL.money(n) : "$" + Number(n || 0).toFixed(2);
  }

  // ---- Order detail ----
  function orderDetailHtml(o) {
    var q = o.quote || {};
    var ship = o.ship || {};
    var lines = (q.lines || []).map(function (l) {
      return `<tr><td>${esc(l.name)} ${esc(l.size || "")}</td><td>× ${l.qty}</td><td>${money(l.line)}</td></tr>`;
    }).join("");
    var events = (o.events || []).map(function (e) {
      return `<p class="muted">${esc((e.at || "").slice(0, 16))} — ${esc(e.kind)}${e.by ? " by " + esc(e.by) : ""}</p>`;
    }).join("");
    var shipView = ship.line1
      ? `${esc(ship.name || "")}<br>${esc(ship.line1)}${ship.line2 ? "<br>" + esc(ship.line2) : ""}<br>${esc(ship.city)}, ${esc(ship.region)} ${esc(ship.postal)}`
      : "Missing.";
    var statuses = ["awaiting_settlement", "settled", "shipped", "delivered", "voided"];
    return `<div class="ops-order-detail">
      <p><a href="/ops/catalog" data-link>← Back to orders</a></p>
      <h2>Order ${esc(o.id)}</h2>
      <p class="lede">${esc(o.email)}${o.company ? " · " + esc(o.company) : ""} · ${esc(o.paymentMethod || "")} · ${money(q.total)}</p>
      <div class="grid2">
        <div>
          <h3>Line items</h3>
          <table class="table"><tbody>${lines}</tbody></table>
          <h3>Ship to</h3><p>${shipView}</p>
          ${o.tracking ? `<h3>Tracking</h3><p>${esc(o.carrier || "")} ${esc(o.tracking)}</p>` : ""}
        </div>
        <div>
          <h3>Fulfill</h3>
          <form id="fulfillForm" class="tool-form">
            <label>Status
              <select name="status">${statuses.map(function (s) { return `<option value="${s}"${o.status === s ? " selected" : ""}>${s}</option>`; }).join("")}</select>
            </label>
            <input name="tracking" placeholder="Tracking number" value="${esc(o.tracking || "")}" />
            <input name="carrier" placeholder="Carrier" value="${esc(o.carrier || "")}" />
            <button class="btn" type="submit">Update order</button>
          </form>
          <div id="fulfillMsg"></div>
          <h3>Timeline</h3>${events}
        </div>
      </div>
    </div>`;
  }

  async function mountOrderDetail(box, orderId) {
    var HKL = window.HKL || {};
    var api = HKL.api;
    var toast = HKL.toast || alert;
    try {
      var d = await api("/api/ops/orders");
      var order = (d.orders || []).find(function (o) { return o.id === orderId; });
      if (!order) { box.innerHTML = `<p class="muted">Order not found.</p>`; return; }
      box.innerHTML = orderDetailHtml(order);
      var form = box.querySelector("#fulfillForm");
      form.addEventListener("submit", async function (e) {
        e.preventDefault();
        var fd = new FormData(form);
        var msg = box.querySelector("#fulfillMsg");
        try {
          var out = await api("/api/ops/orders", {
            method: "POST",
            body: { id: orderId, status: fd.get("status"), tracking: fd.get("tracking"), carrier: fd.get("carrier") },
          });
          toast("Order updated: " + out.order.status);
          mountOrderDetail(box, orderId);
        } catch (err) {
          var m = err.message === "settle_first" ? "Settle payment before shipping."
            : err.message === "ship_first" ? "Ship before marking delivered."
            : "Update failed: " + (err.message || "error");
          if (msg) msg.innerHTML = `<p class="err">${esc(m)}</p>`;
          else toast(m);
        }
      });
    } catch (err) {
      box.innerHTML = `<p class="muted">Could not load order.</p>`;
    }
  }

  // ---- Intake form ----
  function intakeHtml() {
    return `<div class="ops-intake">
      <h2>Receive lot</h2>
      <p class="lede">One save: stock, lot, price, cost. If the SKU was out of stock, everyone on the notify list is emailed automatically.</p>
      <form id="intakeForm" class="tool-form">
        <label>SKU <input name="sku" placeholder="BPC10" required /></label>
        <label>Lot <input name="lot" placeholder="Lot code" /></label>
        <label>On hand <input name="on_hand" type="number" min="0" step="1" placeholder="0" /></label>
        <label>Price $ <input name="price" type="number" min="0" step="0.01" placeholder="25.00" /></label>
        <label>Unit cost $ <input name="unit_cost" type="number" min="0" step="0.01" placeholder="" /></label>
        <button class="btn" type="submit">Receive lot</button>
      </form>
      <div id="intakeMsg"></div>
    </div>`;
  }

  function mountIntake(box) {
    var HKL = window.HKL || {};
    var api = HKL.api;
    var toast = HKL.toast || alert;
    box.innerHTML = intakeHtml();
    box.querySelector("#intakeForm").addEventListener("submit", async function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var msg = box.querySelector("#intakeMsg");
      try {
        var out = await api("/api/ops/intake", {
          method: "POST",
          body: { sku: fd.get("sku"), lot: fd.get("lot"), on_hand: fd.get("on_hand"), price: fd.get("price"), unit_cost: fd.get("unit_cost") },
        });
        var note = `Received ${out.sku}: ${out.available} available.` +
          (out.live ? " Live on the shop." : " Not live (check COA/stock).") +
          (out.waitlistNotified ? ` ${out.waitlistNotified} waitlist email(s) sent.` : "");
        if (msg) msg.innerHTML = `<p class="ok">${esc(note)}</p>`;
        toast(note);
        e.target.reset();
      } catch (err) {
        var m = "Intake failed: " + (err.message || "error");
        if (msg) msg.innerHTML = `<p class="err">${esc(m)}</p>`;
        else toast(m);
      }
    });
  }

  // ---- COA upload ----
  function coaHtml() {
    return `<div class="ops-coa">
      <h2>Upload COA</h2>
      <p class="lede">Pick the SKU and lot. The PDF attaches to the lot record and the product flips live if stock is in.</p>
      <form id="coaForm" class="tool-form">
        <label>SKU <input name="sku" placeholder="BPC10" required /></label>
        <label>Lot <input name="lot" placeholder="Lot code" required /></label>
        <label>PDF <input name="file" type="file" accept=".pdf,application/pdf" required /></label>
        <button class="btn" type="submit">Upload &amp; attach</button>
      </form>
      <div id="coaMsg"></div>
    </div>`;
  }

  function mountCoa(box) {
    var HKL = window.HKL || {};
    var api = HKL.api;
    var toast = HKL.toast || alert;
    box.innerHTML = coaHtml();
    box.querySelector("#coaForm").addEventListener("submit", async function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var file = fd.get("file");
      var msg = box.querySelector("#coaMsg");
      if (!file || !file.size) { toast("Choose a PDF first."); return; }
      if (msg) msg.innerHTML = `<p class="muted">Uploading…</p>`;
      try {
        var dataUrl = await new Promise(function (resolve, reject) {
          var r = new FileReader();
          r.onload = function () { resolve(r.result); };
          r.onerror = reject;
          r.readAsDataURL(file);
        });
        var out = await api("/api/ops/coa/upload", {
          method: "POST",
          body: { sku: fd.get("sku"), lot: fd.get("lot"), coaData: dataUrl },
        });
        var note = `COA attached: ${out.file}.` + (out.live ? " Product is live." : " Product not live yet (check stock).");
        if (msg) msg.innerHTML = `<p class="ok">${esc(note)}</p>`;
        toast(note);
        e.target.reset();
      } catch (err) {
        var m = "Upload failed: " + (err.message || "error");
        if (msg) msg.innerHTML = `<p class="err">${esc(m)}</p>`;
        else toast(m);
      }
    });
  }

  // ---- Notify-me: delegated submit handler (one-time, works for all product pages) ----
  (function initNotifyDelegation() {
    if (document.__hklNotifyBound) return;
    document.__hklNotifyBound = true;
    document.addEventListener("submit", async function (e) {
      var form = e.target && e.target.id === "notifyForm" ? e.target : null;
      if (!form) return;
      e.preventDefault();
      var HKL = window.HKL || {};
      var api = HKL.api;
      var toast = HKL.toast || alert;
      var fd = new FormData(form);
      var msg = document.getElementById("notifyMsg");
      try {
        await api("/api/waitlist", { method: "POST", body: { email: fd.get("email"), sku: form.getAttribute("data-sku"), consent: !!fd.get("consent") } });
        if (msg) msg.textContent = "You're on the notify list. We'll email you when it's back.";
        else toast("You're on the notify list.");
        form.reset();
      } catch (err) {
        var m = err.message === "consent_required" ? "Check the consent box to get notified." : "Could not join the list: " + (err.message || "error");
        if (msg) msg.textContent = m;
        else toast(m);
      }
    });
  })();

  // ---- Ops order route (called from app.js router) ----
  function routeOpsOrder(p, app, state) {
    if (!state.user || !state.user.isOps) {
      app.innerHTML = `<section class="page wrap"><h1>Not found</h1></section>`;
      return true;
    }
    var orderId = decodeURIComponent(p.split("/")[3] || "");
    app.innerHTML = `<section class="page wrap"><div id="orderDetail"><p class="muted">Loading order…</p></div></section>`;
    mountOrderDetail(document.getElementById("orderDetail"), orderId);
    return true;
  }

  // ---- Notify-me box for out-of-stock products ----
  function notifyHtml(p, userEmail) {
    var out = (p.available != null ? Number(p.available) : Number(p.stock || 0)) <= 0;
    var pending = p && (p.releaseState === "pending_testing" || p.unavailableReason);
    if (!out || pending) return "";
    return `<div class="notify-box">
      <div class="kicker">Back in stock</div>
      <p class="muted">Want an email when ${esc(p.name)} ${esc(p.size)} is back?</p>
      <form id="notifyForm" data-sku="${esc(p.sku || p.id)}" class="row-form">
        <input type="email" name="email" placeholder="Email" required value="${esc(userEmail || "")}" />
        <label class="check"><input type="checkbox" name="consent" /> Email me when it's back in stock.</label>
        <button class="btn" type="submit">Notify me</button>
      </form>
      <p class="muted" id="notifyMsg"></p>
    </div>`;
  }

  // ---- Mount intake + COA sections on the ops page ----
  function mountOpsExtras() {
    var HKL = window.HKL || {};
    var api = HKL.api;
    var toast = HKL.toast || alert;
    // Enhance the orders table: Delivered buttons + clickable order IDs.
    var tables = document.querySelectorAll("table.table");
    tables.forEach(function (tbl) {
      var head = tbl.querySelector("thead");
      if (!head || head.textContent.indexOf("Order") < 0) return;
      if (tbl.dataset.fulfillPatched) return;
      tbl.dataset.fulfillPatched = "1";
      // Order ID -> detail link
      tbl.querySelectorAll("tbody tr[data-oid]").forEach(function (tr) {
        var oid = tr.getAttribute("data-oid");
        var cell = tr.querySelector("td");
        if (cell && oid) {
          var idText = cell.childNodes[0];
          if (idText && idText.nodeType === 3) {
            var a = document.createElement("a");
            a.href = "/ops/orders/" + encodeURIComponent(oid);
            a.setAttribute("data-link", "");
            a.textContent = oid;
            cell.replaceChild(a, idText);
          }
        }
        // Delivered button next to Shipped
        var shipBtn = tr.querySelector('.op-status[data-status="shipped"]');
        if (shipBtn && !tr.querySelector('.op-status[data-status="delivered"]')) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "btn ghost op-status";
          b.setAttribute("data-status", "delivered");
          b.textContent = "Delivered";
          shipBtn.after(b);
        }
      });
      // Delegated handler for the injected Delivered buttons
      tbl.addEventListener("click", async function (e) {
        var btn = e.target.closest && e.target.closest('.op-status[data-status="delivered"]');
        if (!btn) return;
        var tr = btn.closest("tr");
        var oid = tr && tr.getAttribute("data-oid");
        if (!oid) return;
        if (!window.confirm("Mark " + oid + " delivered? The thank-you + affiliate email sends.")) return;
        try {
          await api("/api/ops/orders", { method: "POST", body: { id: oid, status: "delivered" } });
          toast("Marked delivered.");
          location.reload();
        } catch (err) {
          toast(err.message === "ship_first" ? "Ship it first." : "Failed: " + (err.message || "error"));
        }
      });
    });
    // Intake + COA sections
    var inv = document.getElementById("invDesk");
    if (!inv || document.getElementById("intakeDesk")) return;
    var intake = document.createElement("div");
    intake.id = "intakeDesk";
    intake.style.marginTop = "36px";
    var coa = document.createElement("div");
    coa.id = "coaDesk";
    coa.style.marginTop = "36px";
    inv.after(intake);
    intake.after(coa);
    mountIntake(intake);
    mountCoa(coa);
  }

  // ---- Ops sidebar nav (persistent left menu for ops pages) ----
  function mountOpsSidebar() {
    var isOps = location.pathname.startsWith("/ops/");
    document.body.classList.toggle("ops-page", isOps);
    document.body.classList.toggle("has-ops-sidebar", isOps && !!document.getElementById("opsSidebar"));
    if (!isOps) {
      var old = document.getElementById("opsSidebar");
      if (old) old.remove();
      return;
    }
    if (document.getElementById("opsSidebar")) return;
    var links = [
      ["Orders", "orders"],
      ["Receive lot", "intakeDesk"],
      ["Upload COA", "coaDesk"],
      ["Inventory", "invDesk"],
      ["Coupons", "coupons"],
      ["Affiliates", "affiliates"],
      ["Email list", "email"],
    ];
    var aside = document.createElement("aside");
    aside.id = "opsSidebar";
    aside.innerHTML = `<div class="ops-side-head">Seller desk</div>` + links.map(function (l) {
      return `<a href="#" data-target="${l[1]}">${l[0]}</a>`;
    }).join("");
    aside.addEventListener("click", function (e) {
      var a = e.target.closest("a[data-target]");
      if (!a) return;
      e.preventDefault();
      var t = a.getAttribute("data-target");
      if (t === "orders") {
        if (location.pathname !== "/ops/catalog") { location.href = "/ops/catalog"; return; }
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      // Find by ID first, then by h2 text
      var el = document.getElementById(t);
      if (!el) {
        var heads = document.querySelectorAll("h2");
        for (var i = 0; i < heads.length; i++) {
          if (heads[i].textContent.toLowerCase().indexOf(t) === 0) { el = heads[i]; break; }
        }
      }
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      else if (t === "intakeDesk" || t === "coaDesk") { location.href = "/ops/catalog"; }
    });
    document.body.prepend(aside);
    document.body.classList.add("has-ops-sidebar");
  }

  // Auto-mount on route changes
  (function initOpsSidebar() {
    var last = "";
    setInterval(function () {
      if (location.pathname !== last) {
        last = location.pathname;
        setTimeout(mountOpsSidebar, 100);
      }
    }, 500);
  })();

  window.HKL_FULFILL = { mountOrderDetail: mountOrderDetail, mountIntake: mountIntake, mountCoa: mountCoa, routeOpsOrder: routeOpsOrder, notifyHtml: notifyHtml, mountOpsExtras: mountOpsExtras, mountOpsSidebar: mountOpsSidebar };
})();
