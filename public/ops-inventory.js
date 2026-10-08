/* Helix King Labs — merged inventory/lots/margins table for /ops/catalog.
   Replaces the old "Inventory and lots" + "Pricing and margin" tables with one.
   Columns: SKU | Name | Lot | On hand | Certificate | Cost | Retail Price | Retail Margin | Wholesale Price | Wholesale Margin
   Retail is per-vial, wholesale is per-box (grouped headers say so).
   Lots are per-row; margins compute per lot; multi-lot SKUs get a blended row.
   Loaded after app.js; uses window.HKL at runtime. */
(function () {
  function api(path, opts) { return window.HKL.api(path, opts); }
  function toast(m) { return (window.HKL.toast || alert)(m); }
  function money(n) { return window.HKL.money(n); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function num(v) {
    if (v === "" || v == null) return null;
    var n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }
  function fmt(n) { return n == null ? "—" : money(n); }

  var skus = []; // lotView array from /api/ops/lots
  var prices = {}; // sku -> {retail, wholesale, retailChanged, wholesaleChanged}

  function rosyOf(s) {
    if (s.rosyBoxCost != null) return s.rosyBoxCost;
    if (s.wholesalePrice != null) return Math.round((s.wholesalePrice - 10) * 100) / 100;
    return null;
  }
  function wsMarginOf(s) {
    var st = prices[s.sku] || {};
    var w = st.wholesale != null ? st.wholesale : s.wholesalePrice;
    var r = rosyOf(s);
    if (w == null || r == null) return null;
    return Math.round((w - r) * 100) / 100;
  }

  function lotRows(s) {
    var lots = s.lots && s.lots.length ? s.lots : [{ index: "new", lot: "", qtyReceived: 0, onHand: 0, unitCost: null, certificate: "pending" }];
    return lots.map(function (l, i) {
      var st = prices[s.sku];
      var cost = l.unitCost;
      var rMargin = st.retail != null && cost != null ? Math.round((st.retail - cost) * 100) / 100 : null;
      var first = i === 0;
      var low = l.onHand > 0 && l.onHand < 3 ? ' <span class="warn">· low</span>' : "";
      return `<tr data-sku="${esc(s.sku)}" data-lotindex="${l.index}">` +
        (first ? `<td rowspan="${lots.length}"><b>${esc(s.sku)}</b></td><td rowspan="${lots.length}">${esc(s.name)} ${esc(s.size || "")}</td>` : "") +
        `<td><input class="m-lot" value="${esc(l.lot)}" placeholder="Lot code" style="width:110px" /></td>` +
        `<td><input class="m-hand" type="number" min="0" value="${l.onHand}" style="width:70px" />${low}</td>` +
        `<td><select class="m-cert"><option value="pending"${l.certificate !== "accepted" ? " selected" : ""}>pending</option><option value="accepted"${l.certificate === "accepted" ? " selected" : ""}>accepted</option></select></td>` +
        `<td><input class="m-cost" type="number" step="0.01" min="0" value="${cost != null ? cost : ""}" placeholder="$/vial" style="width:80px" /></td>` +
        (first ? `<td rowspan="${lots.length}"><input class="m-retail" type="number" step="0.01" min="0" value="${st.retail != null ? st.retail : ""}" style="width:80px" /></td>` : "") +
        `<td class="m-rmargin">${fmt(rMargin)}</td>` +
        (first ? `<td rowspan="${lots.length}"><input class="m-wholesale" type="number" step="0.01" min="0" value="${st.wholesale != null ? st.wholesale : ""}" style="width:80px" /></td><td rowspan="${lots.length}" class="m-wmargin">${fmt(wsMarginOf(s))}</td>` : "") +
        `<td><button type="button" class="btn ghost m-save">Save</button></td>` +
        `</tr>`;
    }).join("");
  }

  function blendedRow(s) {
    var act = (s.lots || []).filter(function (l) { return l.onHand > 0; });
    if (act.length < 2) return "";
    var st = prices[s.sku];
    var bm = st.retail != null && s.blendedCost != null ? Math.round((st.retail - s.blendedCost) * 100) / 100 : null;
    return `<tr class="blended">` +
      `<td colspan="5" style="text-align:right"><span class="muted">Blended across ${act.length} lots</span></td>` +
      `<td><b>${fmt(s.blendedCost)}</b></td><td></td><td><b>${fmt(bm)}</b></td>` +
      `<td></td><td>${fmt(wsMarginOf(s))}</td><td></td></tr>`;
  }

  function tableHtml() {
    return `<h2>Inventory, lots &amp; margins</h2>
      <p class="lede">One table: lot, stock, and cost per lot; retail and wholesale pricing per SKU. Retail is per vial, wholesale is per box. Margins compute per lot — multi-lot SKUs show a blended row. Save writes the lot row and any changed SKU prices.</p>
      <div style="overflow:auto"><table class="table" id="mergedTable"><thead>
        <tr><th colspan="5"></th><th colspan="3" style="text-align:center;border-bottom:1px solid var(--line-2)">Retail — per vial</th><th colspan="2" style="text-align:center;border-bottom:1px solid var(--line-2)">Wholesale — per box</th><th></th></tr>
        <tr><th>SKU</th><th>Name</th><th>Lot</th><th>On hand</th><th>Certificate</th><th>Cost</th><th>Price</th><th>Margin</th><th>Price</th><th>Margin</th><th></th></tr>
      </thead><tbody>` +
      skus.map(function (s) { return lotRows(s) + blendedRow(s); }).join("") +
      `</tbody></table></div>`;
  }

  function refreshMargins() {
    document.querySelectorAll("#mergedTable tbody tr[data-sku]").forEach(function (tr) {
      var sku = tr.getAttribute("data-sku");
      var s = skus.find(function (x) { return x.sku === sku; });
      if (!s) return;
      var st = prices[sku];
      var cost = num(tr.querySelector(".m-cost").value);
      var rm = tr.querySelector(".m-rmargin");
      if (rm) rm.textContent = st.retail != null && cost != null ? money(Math.round((st.retail - cost) * 100) / 100) : "—";
      var wm = tr.querySelector(".m-wmargin");
      if (wm) wm.textContent = fmt(wsMarginOf(s));
    });
    // blended rows
    document.querySelectorAll("#mergedTable tr.blended").forEach(function (tr) {
      var prev = tr.previousElementSibling;
      var sku = prev && prev.getAttribute("data-sku");
      var s = skus.find(function (x) { return x.sku === sku; });
      if (!s) return;
      var st = prices[sku];
      var cells = tr.querySelectorAll("td");
      // cells: [label, blendedCost, empty, blendedMargin, empty, wsMargin, empty]
      if (cells[1]) cells[1].innerHTML = "<b>" + fmt(s.blendedCost) + "</b>";
      if (cells[3]) {
        var bm = st.retail != null && s.blendedCost != null ? Math.round((st.retail - s.blendedCost) * 100) / 100 : null;
        cells[3].innerHTML = "<b>" + fmt(bm) + "</b>";
      }
      if (cells[5]) cells[5].textContent = fmt(wsMarginOf(s));
    });
  }

  async function saveRow(btn) {
    var tr = btn.closest("tr");
    var sku = tr.getAttribute("data-sku");
    var lotIndex = tr.getAttribute("data-lotindex");
    var s = skus.find(function (x) { return x.sku === sku; });
    var st = prices[sku];
    btn.disabled = true;
    try {
      await api("/api/ops/lots/save", {
        method: "POST",
        body: {
          sku: sku,
          lotIndex: lotIndex === "new" ? "new" : Number(lotIndex),
          lot: tr.querySelector(".m-lot").value,
          onHand: tr.querySelector(".m-hand").value,
          unitCost: tr.querySelector(".m-cost").value,
          certificate: tr.querySelector(".m-cert").value,
        },
      });
      if (st.retailChanged) {
        await api("/api/ops/pricing", { method: "POST", body: { rows: [{ sku: sku, customer_price: st.retail }] } });
        st.retailChanged = false;
      }
      if (st.wholesaleChanged) {
        await api("/api/ops/wholesale/pricing", { method: "POST", body: { sku: sku, wholesalePrice: st.wholesale } });
        st.wholesaleChanged = false;
      }
      toast("Saved " + sku + ".");
      await load();
    } catch (err) {
      toast("Save failed: " + ((err && err.error) || "error"));
      btn.disabled = false;
    }
  }

  async function load() {
    var d = await api("/api/ops/lots");
    skus = d.lots || [];
    skus.forEach(function (s) {
      prices[s.sku] = {
        retail: s.price != null ? Number(s.price) : null,
        wholesale: s.wholesalePrice != null ? Number(s.wholesalePrice) : null,
        retailChanged: false,
        wholesaleChanged: false,
      };
    });
    var tb = document.querySelector("#mergedTable tbody");
    if (tb) {
      var tmp = document.createElement("tbody");
      tmp.innerHTML = skus.map(function (s) { return lotRows(s) + blendedRow(s); }).join("");
      tb.replaceWith(tmp);
      wireRows();
    }
  }

  function wireRows() {
    var tbl = document.getElementById("mergedTable");
    if (!tbl || tbl.dataset.wired) return;
    tbl.dataset.wired = "1";
    tbl.addEventListener("input", function (e) {
      var tr = e.target.closest("tr[data-sku]");
      if (!tr) return;
      var sku = tr.getAttribute("data-sku");
      var st = prices[sku];
      if (e.target.classList.contains("m-retail")) { st.retail = num(e.target.value); st.retailChanged = true; }
      if (e.target.classList.contains("m-wholesale")) { st.wholesale = num(e.target.value); st.wholesaleChanged = true; }
      refreshMargins();
    });
    tbl.addEventListener("click", function (e) {
      var btn = e.target.closest(".m-save");
      if (btn) saveRow(btn);
    });
  }

  function hideOldPricing() {
    // Remove the legacy "Pricing and margin" section — replaced by the merged table.
    var t = document.getElementById("opsTable");
    if (!t || t.dataset.retired) return;
    t.dataset.retired = "1";
    var wrap = t.closest("div[style]");
    if (wrap) wrap.style.display = "none";
    t.style.display = "none";
    var h2s = document.querySelectorAll("h2");
    h2s.forEach(function (h) {
      if (h.textContent.trim() === "Pricing and margin") {
        h.style.display = "none";
        var p = h.nextElementSibling;
        if (p && p.classList.contains("lede")) p.style.display = "none";
      }
    });
    var save = document.getElementById("opsSave");
    if (save) save.style.display = "none";
  }

  function renameChannels() {
    var desk = document.getElementById("channelDesk");
    if (!desk || desk.dataset.renamed) return;
    desk.dataset.renamed = "1";
    var h = desk.querySelector("h2");
    if (h && /off-site settlement/i.test(h.textContent)) h.textContent = "Payment channels";
  }

  function mount() {
    var inv = document.getElementById("invDesk");
    if (!inv || document.getElementById("mergedTable")) return;
    if (!window.HKL || !window.HKL.state || !window.HKL.state.user || !window.HKL.state.user.isOps) return;
    hideOldPricing();
    inv.innerHTML = `<p class="muted">Loading inventory…</p>`;
    load().then(function () {
      inv.innerHTML = tableHtml();
      wireRows();
      renameChannels();
    }).catch(function () {
      inv.innerHTML = `<p class="hard">Couldn't load inventory.</p>`;
    });
  }

  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (window.HKL && window.HKL.api) mount();
    renameChannels();
    if (tries > 120) clearInterval(timer);
  }, 700);
  new MutationObserver(function () {
    if (window.HKL && window.HKL.api) mount();
    renameChannels();
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("hkl:route", mount);
})();
