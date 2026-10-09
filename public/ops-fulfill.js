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
      ${o.paymentProof ? `<div class="paybox" style="border-color:#c80"><h3>Payment proof uploaded</h3><p class="muted">Uploaded ${esc((o.paymentProof.uploadedAt || "").slice(0, 16))}. Review it below, then set the status to settled.</p><p><a href="/api/ops/proofs/${encodeURIComponent(o.id)}" target="_blank" rel="noopener"><img src="/api/ops/proofs/${encodeURIComponent(o.id)}" alt="Payment proof" style="max-width:100%;border:1px solid var(--line-2);border-radius:6px" /></a></p></div>` : ""}
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
      <p class="lede">One save: adds a lot with stock, price, cost — history is kept, nothing is overwritten. If the SKU was out of stock, everyone on the notify list is emailed automatically.</p>
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
      var sku = fd.get("sku"), lot = fd.get("lot");
      try {
        var out = await api("/api/ops/intake", {
          method: "POST",
          body: { sku: sku, lot: lot, on_hand: fd.get("on_hand"), price: fd.get("price"), unit_cost: fd.get("unit_cost") },
        });
        var note = `Received ${out.sku}: ${out.available} available.` +
          (out.live ? " Live on the shop." : " Not live (check COA/stock).") +
          (out.waitlistNotified ? ` ${out.waitlistNotified} waitlist email(s) sent.` : "");
        // Chain of custody: prompt the next step (COA upload).
        var next = `<p class="ok">${esc(note)}</p>
          <div class="chain-prompt"><p><b>Next:</b> lot ${esc(lot || "")} needs its COA uploaded before it can go live.</p>
          <p><button class="btn" data-chain="coa">Upload COA now</button>
          <button class="btn ghost" data-chain="later">Later</button></p></div>`;
        if (msg) msg.innerHTML = next;
        toast(note);
        e.target.reset();
        if (msg) msg.querySelector('[data-chain="coa"]').onclick = function () {
          location.hash = "#/ops";
          setTimeout(function () {
            var skuI = document.querySelector('#coaForm input[name="sku"]');
            var lotI = document.querySelector('#coaForm input[name="lot"]');
            if (skuI) skuI.value = sku || "";
            if (lotI) lotI.value = lot || "";
            if (skuI) skuI.scrollIntoView({ block: "center" });
          }, 300);
        };
        if (msg) msg.querySelector('[data-chain="later"]').onclick = function () {
          msg.innerHTML = `<p class="ok">${esc(note)}</p><p class="muted">Lot ${esc(lot || "")} is flagged "COA needed" in inventory.</p>`;
        };
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
        var sku = fd.get("sku"), lot = fd.get("lot");
        // Chain of custody: prompt the next step (label creation).
        var next = `<p class="ok">${esc(note)}</p>
          <div class="chain-prompt"><p><b>Next:</b> lot ${esc(lot || "")} is sellable — create its vial labels.</p>
          <p><button class="btn" data-chain="labels">Create labels now</button>
          <button class="btn ghost" data-chain="later">Later</button></p></div>`;
        if (msg) msg.innerHTML = next;
        toast(note);
        e.target.reset();
        if (msg) {
          var lb = msg.querySelector('[data-chain="labels"]');
          if (lb) lb.onclick = function () {
            location.href = "/tools/label?sku=" + encodeURIComponent(sku || "") + "&lot=" + encodeURIComponent(lot || "");
          };
          var lt = msg.querySelector('[data-chain="later"]');
          if (lt) lt.onclick = function () {
            msg.innerHTML = `<p class="ok">${esc(note)}</p><p class="muted">Lot ${esc(lot || "")} is flagged "Labels needed" in inventory.</p>`;
          };
        }
      } catch (err) {
        var m = "Upload failed: " + (err.message || "error");
        if (msg) msg.innerHTML = `<p class="err">${esc(m)}</p>`;
        else toast(m);
      }
    });
  }

  // ---- Notify-me: single gold button replaces out-of-stock, expands inline form ----
  function trackEvent(name, params) {
    try {
      if (window.gtag) window.gtag("event", name, params || {});
      else if (window.dataLayer) window.dataLayer.push({ event: name, ...(params || {}) });
    } catch (e) {}
  }

  function notifyFormHtml(p, userEmail) {
    return `<form id="notifyForm" data-sku="${esc(p.sku || p.id)}" class="notify-form">
      <p class="notify-title">Get notified when ${esc(p.name)} ${esc(p.size)} is back.</p>
      <input type="email" name="email" placeholder="Email" required value="${esc(userEmail || "")}" />
      <label class="check"><input type="checkbox" name="consent" required /> Email me when it's back in stock. One email, no marketing list.</label>
      <div class="notify-actions">
        <button class="btn" type="submit">Notify me</button>
        <button class="btn ghost" type="button" id="notifyDismiss">No thanks</button>
      </div>
      <p class="muted" id="notifyMsg"></p>
    </form>`;
  }

  (function initNotify() {
    if (document.__hklNotifyBound) return;
    document.__hklNotifyBound = true;

    // Expand form on button click
    document.addEventListener("click", function (e) {
      var btn = e.target && e.target.id === "notifyBtn" ? e.target : null;
      if (!btn) return;
      var wrap = document.getElementById("notifyWrap");
      if (!wrap) return;
      if (wrap.innerHTML) { wrap.innerHTML = ""; return; } // toggle closed
      var HKL = window.HKL || {};
      var sku = btn.getAttribute("data-s") || "";
      // Find product data from HKL state
      var p = null;
      try {
        var items = (HKL.state && HKL.state.catalog && HKL.state.catalog.items) || [];
        p = items.find(function (x) { return x.sku === sku || x.id === sku; }) || { sku: sku, name: sku, size: "" };
      } catch (err) { p = { sku: sku, name: sku, size: "" }; }
      var userEmail = (HKL.state && HKL.state.user && HKL.state.user.email) || "";
      wrap.innerHTML = notifyFormHtml(p, userEmail);
      trackEvent("notify_click", { sku: sku });
    });

    // Dismiss
    document.addEventListener("click", function (e) {
      if (e.target && e.target.id === "notifyDismiss") {
        var wrap = document.getElementById("notifyWrap");
        if (wrap) wrap.innerHTML = "";
        var btn = document.getElementById("notifyBtn");
        trackEvent("notify_dismiss", { sku: btn ? btn.getAttribute("data-s") : "" });
      }
    });

    // Submit
    document.addEventListener("submit", async function (e) {
      var form = e.target && e.target.id === "notifyForm" ? e.target : null;
      if (!form) return;
      e.preventDefault();
      var HKL = window.HKL || {};
      var api = HKL.api;
      var toast = HKL.toast || alert;
      var fd = new FormData(form);
      var msg = document.getElementById("notifyMsg");
      var sku = form.getAttribute("data-s");
      try {
        await api("/api/waitlist", { method: "POST", body: { email: fd.get("email"), sku: sku, consent: !!fd.get("consent") } });
        trackEvent("notify_submit", { sku: sku });
        if (msg) msg.textContent = "You're on the list. We'll email you once when it's back.";
        else toast("You're on the notify list.");
        form.reset();
        setTimeout(function () { var w = document.getElementById("notifyWrap"); if (w) w.innerHTML = ""; }, 3000);
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
        // Delete button (two-step: arm, then type the order ID).
        if (!tr.querySelector(".op-delete")) {
          var del = document.createElement("button");
          del.type = "button";
          del.className = "btn ghost op-delete";
          del.textContent = "Delete";
          del.style.marginLeft = "6px";
          del.style.color = "#f28b8b";
          var armed = null;
          del.onclick = async function () {
            if (!armed) {
              armed = setTimeout(function () { armed = null; del.textContent = "Delete"; }, 10000);
              del.textContent = "Sure?";
              toast("Click Delete again, then type the order ID to confirm.");
              return;
            }
            clearTimeout(armed); armed = null; del.textContent = "Delete";
            var typed = window.prompt("Type " + oid + " to permanently delete this order. Stock will be restored. This cannot be undone.");
            if (typed !== oid) { if (typed !== null) toast("ID didn't match — not deleted."); return; }
            try {
              await api("/api/ops/orders?id=" + encodeURIComponent(oid), { method: "DELETE" });
              toast("Order " + oid + " deleted.");
              location.reload();
            } catch (err) {
              toast(err.message === "use_void" ? "Delivered orders can't be deleted — void it instead." : "Delete failed.");
            }
          };
          var lastCell = tr.querySelector("td:last-child");
          if (lastCell) lastCell.appendChild(del);
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
    // Intake + COA sections (before inventory to match sidebar order)
    var inv = document.getElementById("invDesk");
    if (!inv || document.getElementById("intakeDesk")) return;
    var intake = document.createElement("div");
    intake.id = "intakeDesk";
    intake.style.marginTop = "36px";
    var coa = document.createElement("div");
    coa.id = "coaDesk";
    coa.style.marginTop = "36px";
    inv.before(intake);
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
      ["Payment channels", "channelDesk"],
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

  window.HKL_FULFILL = { mountOrderDetail: mountOrderDetail, mountIntake: mountIntake, mountCoa: mountCoa, routeOpsOrder: routeOpsOrder, mountOpsExtras: mountOpsExtras, mountOpsSidebar: mountOpsSidebar };
})();
