/* Helix King Labs — legacy /ops/catalog desk (extracted from app.js).
   The old inline seller-desk UI. Called from app.js router via
   window.HKL_OPS_LEGACY.routeOpsCatalog(ctx). */
(function () {
  async function routeOpsCatalog(ctx) {
    const { p, app, state, api, $, money, orderStatusLabel, trackUrl, orderTimeline, receiptView, bindReceipt, hx, render, toast } = ctx;
    if (!state.user || !state.user.isOps) {
      app.innerHTML = `<section class="page wrap"><h1>Not found</h1><p class="lede">This address is not a catalog page.</p><a class="btn" href="/shop" data-link>Open catalog</a></section>`;
    } else {
      const ops = await api("/api/ops/pricing");
      const board = await api("/api/ops/board").catch(() => ({ totals: {}, orders: [], affiliates: [] }));
      const t = board.totals || {};
      app.innerHTML = `<section class="page wrap">
        <div class="kicker">Seller desk</div>
        <h1>Orders, lots, and payment hold.</h1>
        <p class="lede">Customers do not see this page. ${t.orders || 0} orders · ${money(t.merchandise || 0)} merch · ${t.accounts || 0} accounts · ${t.list || 0} on the list. Nothing ships until you mark the order settled.</p>
        <p class="desk-links"><a href="/api/ops/export?kind=orders">Export orders</a> · <a href="/api/ops/export?kind=inventory">Export inventory</a> · <a href="/tools/label" data-link>Label maker</a></p>
        <div id="deskCatalog"></div>
        <h2>Orders</h2>
        <p class="lede">Settled means you confirmed Venmo or crypto finished. Shipped is refused until then. Void restores stock.</p>
        ${
          (board.orders || []).length
            ? `<table class="table"><thead><tr><th>Order</th><th>Buyer</th><th>Rail</th><th>Total</th><th>Hold</th><th>Track</th><th></th></tr></thead><tbody>${(board.orders || [])
                .map((o) => `<tr data-oid="${o.id}">
                  <td>${o.id}<div class="sub">${(o.created || "").slice(0, 10)}</div></td>
                  <td>${o.email || ""}<div class="sub">${o.company || "—"} · ${o.researchField || "—"} · ${o.researchAck ? "ack" : "no ack"}</div></td>
                  <td>${o.paymentMethod || "—"}${o.dispute ? " · dispute" : ""}</td>
                  <td>${money((o.quote && o.quote.total) || 0)}</td>
                  <td>${o.fulfillment || o.status || ""}</td>
                  <td><input class="op-track" type="text" value="${o.tracking || ""}" placeholder="Tracking" /></td>
                  <td>
                    <button type="button" class="btn ghost op-status" data-status="paid">Settled</button>
                    <button type="button" class="btn ghost op-status" data-status="shipped">Shipped</button>
                    <button type="button" class="btn ghost op-status" data-status="voided">Void</button>
                    <button type="button" class="btn ghost op-dispute">Dispute</button>
                  </td>
                </tr>`)
                .join("")}</tbody></table>`
            : `<p class="lede">No recorded orders yet.</p>`
        }
        <div id="invDesk" style="margin-top:36px"></div>
        <div id="custDesk" style="margin-top:36px"></div>
        <div id="channelDesk" style="margin-top:28px"></div>
        <h2>Affiliates</h2>
        ${
          (board.affiliates || []).length
            ? `<table class="table"><thead><tr><th>Code</th><th>Email</th><th>Status</th></tr></thead><tbody>${(board.affiliates || [])
                .map((a) => `<tr><td>${a.code}</td><td>${a.email || ""}</td><td>${a.status}</td></tr>`)
                .join("")}</tbody></table>`
            : `<p class="lede">No desks open.</p>`
        }
        <h2>Pricing and margin</h2>
        <p class="lede">Customers see customer_price only. Unit cost stays here. Saving writes data/catalog-pricing.csv.</p>
        <div style="overflow:auto">
          <table class="table" id="opsTable">
            <thead><tr><th>SKU</th><th>Name</th><th>Size</th><th>Customer price</th><th>Unit cost</th><th>Margin</th></tr></thead>
            <tbody>
              ${ops.rows
                .map(
                  (r) => `<tr data-sku="${r.sku}">
                    <td>${r.sku}</td><td>${r.name}</td><td>${r.size}</td>
                    <td><input class="op-price" type="number" step="0.01" value="${r.customer_price ?? ""}" /></td>
                    <td><input class="op-cost" type="number" step="0.01" value="${r.unit_cost ?? ""}" /></td>
                    <td>${r.margin_dollars == null ? "—" : money(r.margin_dollars) + " (" + r.margin_percent + "%)"}</td>
                  </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
        <button class="btn" id="opsSave" style="margin-top:16px">Save prices</button>
        <div id="incomingList" style="margin-top:40px"></div>
        <div id="subList" style="margin-top:40px"></div>
      </section>`;
      window.HKL = Object.assign(window.HKL || {}, { api });
      if (window.HKL_DESK) window.HKL_DESK.mountDesk();
      api("/api/ops/channels").then((ch) => {
        const box = $("#channelDesk");
        if (!box) return;
        const tg = (ch.ops && ch.ops.telegram) || {};
        const cr = (ch.ops && ch.ops.crypto) || {};
        box.innerHTML = `<h2>Off-site settlement</h2>
          <p class="lede">Telegram group and Exodus stay off the shop. Paste the handle and receive address here only. Domain SMTP waits until helixkinglabs.com is live.</p>
          <div class="row-form" style="flex-direction:column;align-items:stretch;max-width:520px">
            <label>Public checkout note<textarea id="chNote" rows="3">${ch.publicNote || ""}</textarea></label>
            <label>Telegram handle (ops only)<input id="chTg" type="text" value="${tg.handle || ""}" placeholder="@group or invite — not published" /></label>
            <label>Exodus asset<input id="chAsset" type="text" value="${cr.asset || ""}" placeholder="USDT / BTC" /></label>
            <label>Exodus receive address (ops only)<input id="chAddr" type="text" value="${cr.address || ""}" placeholder="Paste when the wallet exists" /></label>
            <button class="btn" type="button" id="chSave">Save channels</button>
          </div>`;
        const save = $("#chSave");
        if (save) {
          save.onclick = async () => {
            try {
              await api("/api/ops/channels", {
                method: "POST",
                body: {
                  publicNote: ($("#chNote") && $("#chNote").value) || "",
                  telegram: { handle: ($("#chTg") && $("#chTg").value) || "" },
                  crypto: {
                    asset: ($("#chAsset") && $("#chAsset").value) || "",
                    address: ($("#chAddr") && $("#chAddr").value) || "",
                  },
                },
              });
              toast("Channels saved. Nothing from this form prints on the shop except the public note.");
            } catch {
              toast("Could not save channels.");
            }
          };
        }
      }).catch(() => {});
      app.querySelectorAll(".op-status").forEach((btn) => {
        btn.onclick = async () => {
          const row = btn.closest("tr");
          if (!row) return;
          try {
            await api("/api/ops/orders", {
              method: "POST",
              body: {
                id: row.getAttribute("data-oid"),
                status: btn.getAttribute("data-status"),
                tracking: (row.querySelector(".op-track") && row.querySelector(".op-track").value) || "",
              },
            });
            toast("Order updated.");
            render();
          } catch (err) {
            toast(err.message === "settle_first" ? "Mark settled before shipped." : "Order update failed.");
          }
        };
      });
      app.querySelectorAll(".op-dispute").forEach((btn) => {
        btn.onclick = async () => {
          const row = btn.closest("tr");
          const note = window.prompt("Dispute note") || "";
          if (!note.trim()) return;
          try {
            await api("/api/ops/disputes", { method: "POST", body: { orderId: row.getAttribute("data-oid"), note } });
            toast("Dispute logged.");
            render();
          } catch {
            toast("Could not log dispute.");
          }
        };
      });
      api("/api/ops/desk").then((d) => {
        const inv = $("#invDesk");
        if (inv) {
          const rows = d.inventory || [];
          inv.innerHTML = `<h2>Inventory and lots</h2>
            <p class="lede">${(d.summary && d.summary.low) || 0} fills under 3 on hand. Cost can move up or down. Save writes that row. Certificate pending does not publish a file.</p>
            <div style="overflow:auto"><table class="table" id="invTable"><thead><tr><th>SKU</th><th>Name</th><th>Lot</th><th>On hand</th><th>Cost</th><th>Certificate</th><th></th></tr></thead><tbody>
            ${rows.map((r) => `<tr data-sku="${r.sku}">
              <td>${r.sku}</td><td>${r.name} ${r.size}${r.low ? " · low" : ""}</td>
              <td><input class="inv-lot" value="${r.lot || ""}" /></td>
              <td><input class="inv-hand" type="number" min="0" value="${r.on_hand}" /></td>
              <td><input class="inv-cost" type="number" step="0.01" value="${r.unit_cost ?? ""}" /></td>
              <td><select class="inv-cert"><option ${r.certificate !== "accepted" ? "selected" : ""}>pending</option><option ${r.certificate === "accepted" ? "selected" : ""}>accepted</option></select></td>
              <td><button type="button" class="btn ghost inv-save">Save</button></td>
            </tr>`).join("")}
            </tbody></table></div>`;
          inv.querySelectorAll(".inv-save").forEach((btn) => {
            btn.onclick = async () => {
              const row = btn.closest("tr");
              try {
                await api("/api/ops/inventory", { method: "POST", body: {
                  sku: row.getAttribute("data-sku"),
                  lot: row.querySelector(".inv-lot").value,
                  on_hand: row.querySelector(".inv-hand").value,
                  unit_cost: row.querySelector(".inv-cost").value,
                  certificate: row.querySelector(".inv-cert").value,
                }});
                toast("Lot saved.");
              } catch {
                toast("Could not save lot.");
              }
            };
          });
        }
       HKL_FULFILL.mountOpsExtras();const cust=$("#custDesk")
        if (cust) {
          const rows = d.customers || [];
          cust.innerHTML = `<h2>Accounts</h2>` + (rows.length
            ? `<table class="table"><thead><tr><th>Email</th><th>Company</th><th>Field</th><th>Orders</th><th></th></tr></thead><tbody>${rows.map((c) => `<tr data-uid="${hx(c.id || "")}"><td>${hx(c.email)}</td><td>${hx(c.company || "—")}</td><td>${hx(c.researchField || "—")}</td><td>${c.orders}</td><td><button type="button" class="btn ghost op-user-del">Delete</button></td></tr>`).join("")}</tbody></table>`
            : `<p class="lede">No accounts yet.</p>`);
          cust.querySelectorAll(".op-user-del").forEach((btn) => {
            btn.onclick = async () => {
              const row = btn.closest("tr");
              const email = row ? row.querySelector("td").textContent : "this account";
              if (!window.confirm(`Delete ${email}? Their sessions end and any affiliate link is closed. Accounts with orders cannot be deleted.`)) return;
              try {
                await api("/api/ops/users/delete", { method: "POST", body: { id: row.getAttribute("data-uid") } });
                toast("Account deleted.");
                render();
              } catch (err) {
                toast(err.message === "has_orders" ? "That account has orders — void them first." : err.message === "cannot_delete_ops" ? "Ops accounts cannot be deleted." : "Delete failed.");
              }
            };
          });
        }
      }).catch(() => {});
      api("/api/ops/incoming-coas").then((d) => {
        const box = $("#incomingList");
        if (!box) return;
        const rows = d.records || [];
        box.innerHTML = `<h2>Incoming supplier COAs</h2>
          <p class="lede">${d.lab || "Bioviridian"} · ${rows.length} files in data/coas/incoming. Not published on /testing. DSIP 5mg is non-conforming. TSM20 certificate is filed even though TSM20 is off the catalog. Glutathione 1500 and DSIP stay off the shop.</p>` +
          (rows.length
            ? `<table class="table"><thead><tr><th>Code</th><th>Sample</th><th>Lot</th><th>Purity</th><th>Status</th><th>Hint</th><th>File</th></tr></thead><tbody>${rows.map((r)=>`<tr><td>${r.webCode||""}</td><td>${r.sample||""}</td><td>${r.lot||""}</td><td>${r.purity==null?"—":r.purity+"%"}</td><td>${r.status||""}</td><td>${r.helixSkuHint||"—"}</td><td><a href="/api/ops/incoming-coas/${r.webCode}" target="_blank" rel="noopener">PDF</a></td></tr>`).join("")}</tbody></table>`
            : `<p class="muted">No incoming files indexed.</p>`);
      }).catch(()=>{});
      api("/api/ops/subscribers").then((d) => {
        const box = $("#subList");
        if (!box) return;
        if (window.HKL_EMAIL) window.HKL_EMAIL.render(box, d);
      }).catch(()=>{});
    }
  }
  window.HKL_OPS_LEGACY = { routeOpsCatalog };
})();
