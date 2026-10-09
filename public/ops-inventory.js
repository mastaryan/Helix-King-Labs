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
      var badge = l.status === "complete" ? '<span class="badge ok">Complete</span>'
        : l.status === "labels_needed" ? '<span class="badge warn">Labels needed</span>'
        : '<span class="badge err">COA needed</span>';
      return `<tr data-sku="${esc(s.sku)}" data-lotindex="${l.index}">` +
        (first ? `<td rowspan="${lots.length}"><b>${esc(s.sku)}</b></td><td rowspan="${lots.length}">${esc(s.name)} ${esc(s.size || "")}</td>` : "") +
        `<td><input class="m-lot" value="${esc(l.lot)}" placeholder="Lot code" style="width:110px" /></td>` +
        `<td><input class="m-hand" type="number" min="0" value="${l.onHand}" style="width:70px" />${low}</td>` +
        `<td><select class="m-cert"><option value="pending"${l.certificate !== "accepted" ? " selected" : ""}>pending</option><option value="accepted"${l.certificate === "accepted" ? " selected" : ""}>accepted</option></select><br/>${badge}</td>` +
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

  function alertStrip() {
    var coa = 0, labels = 0;
    skus.forEach(function (s) {
      (s.lots || []).forEach(function (l) {
        if (!l.lot) return;
        if (l.status === "coa_needed") coa++;
        else if (l.status === "labels_needed") labels++;
      });
    });
    if (!coa && !labels) return "";
    var parts = [];
    if (coa) parts.push(`<b>${coa}</b> lot${coa === 1 ? "" : "s"} need COAs`);
    if (labels) parts.push(`<b>${labels}</b> lot${labels === 1 ? "" : "s"} need labels`);
    return `<div class="chain-alert"><p>⚠ Chain of custody: ${parts.join(" · ")}.</p></div>`;
  }

  function tableHtml() {
    return `<h2>Inventory, lots &amp; margins</h2>
      <p class="lede">One table: lot, stock, and cost per lot; retail and wholesale pricing per SKU. Retail is per vial, wholesale is per box. Margins compute per lot — multi-lot SKUs show a blended row. Save writes the lot row and any changed SKU prices. <button type="button" class="btn" id="mSaveAll" style="margin-left:8px">Save all</button></p>
      ${alertStrip()}
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
    // Snapshot every other row's unsaved inputs so the reload doesn't wipe them.
    var snap = snapshotEdits(tr);
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      var changes = await saveRowData(tr);
      var sku = tr.getAttribute("data-sku");
      toast("Saved " + sku + (changes.length ? ": " + changes.join(", ") + "." : " (no changes)."));
      await load();
      restoreEdits(snap);
      refreshMargins();
    } catch (err) {
      toast("Save failed: " + ((err && err.error) || "error"));
    }
    btn.disabled = false;
    btn.textContent = "Save";
  }

  // Capture all row inputs except the one being saved.
  function snapshotEdits(exceptTr) {
    var snap = {};
    document.querySelectorAll("#mergedTable tbody tr[data-sku]").forEach(function (tr) {
      if (tr === exceptTr) return;
      snap[rowKey(tr)] = readRowInputs(tr);
    });
    return snap;
  }
  function rowKey(tr) {
    return tr.getAttribute("data-sku") + "|" + tr.getAttribute("data-lotindex");
  }
  function readRowInputs(tr) {
    var v = function (sel) { var el = tr.querySelector(sel); return el ? el.value : ""; };
    return { lot: v(".m-lot"), onHand: v(".m-hand"), cost: v(".m-cost"), cert: v(".m-cert"), retail: v(".m-retail"), wholesale: v(".m-wholesale") };
  }
  function restoreEdits(snap) {
    document.querySelectorAll("#mergedTable tbody tr[data-sku]").forEach(function (tr) {
      var s = snap[rowKey(tr)];
      if (!s) return;
      var set = function (sel, val) { var el = tr.querySelector(sel); if (el) el.value = val; };
      set(".m-lot", s.lot); set(".m-hand", s.onHand); set(".m-cost", s.cost);
      set(".m-cert", s.cert); set(".m-retail", s.retail); set(".m-wholesale", s.wholesale);
      // Re-sync price state so a later save picks up the restored values.
      var sku = tr.getAttribute("data-sku");
      var st = prices[sku];
      if (st) {
        if (s.retail !== "" && String(st.retail) !== String(s.retail)) { st.retail = num(s.retail); st.retailChanged = true; }
        if (s.wholesale !== "" && String(st.wholesale) !== String(s.wholesale)) { st.wholesale = num(s.wholesale); st.wholesaleChanged = true; }
      }
    });
  }

  // True if the row's inputs differ from loaded state.
  function rowDirty(tr) {
    var sku = tr.getAttribute("data-sku");
    var lotIndex = tr.getAttribute("data-lotindex");
    var s = skus.find(function (x) { return x.sku === sku; });
    var st = prices[sku];
    if (!s || !st) return false;
    var vals = readRowInputs(tr);
    var origLot = lotIndex === "new" ? null : (s.lots || []).find(function (l) { return String(l.index) === String(lotIndex); });
    if (String(vals.lot || "") !== String(origLot ? origLot.lot || "" : "")) return true;
    if (String(vals.onHand) !== String(origLot ? origLot.onHand : 0)) return true;
    if (String(vals.cost || "") !== String(origLot && origLot.unitCost != null ? origLot.unitCost : "")) return true;
    if (vals.cert !== (origLot ? origLot.certificate || "pending" : "pending")) return true;
    if (st.retailChanged || st.wholesaleChanged) return true;
    return false;
  }

  async function saveAll(btn) {
    var rows = Array.prototype.filter.call(
      document.querySelectorAll("#mergedTable tbody tr[data-sku]"),
      function (tr) { return rowDirty(tr); }
    );
    if (!rows.length) { toast("No changes to save."); return; }
    btn.disabled = true;
    btn.textContent = "Saving " + rows.length + "…";
    var ok = 0, failed = [];
    for (var i = 0; i < rows.length; i++) {
      try { await saveRowData(rows[i]); ok++; }
      catch (err) { failed.push(rows[i].getAttribute("data-sku")); }
    }
    await load();
    refreshMargins();
    btn.disabled = false;
    btn.textContent = "Save all";
    toast("Saved " + ok + " row" + (ok === 1 ? "" : "s") + (failed.length ? ". Failed: " + failed.join(", ") : "."));
  }

  // Core save: API calls + change list. No reload, no toast.
  async function saveRowData(tr) {
    var sku = tr.getAttribute("data-sku");
    var lotIndex = tr.getAttribute("data-lotindex");
    var s = skus.find(function (x) { return x.sku === sku; });
    var st = prices[sku];
    // Snapshot originals so the confirmation can say what changed.
    var origLot = lotIndex === "new" ? null : (s.lots || []).find(function (l) { return String(l.index) === String(lotIndex); });
    var orig = {
      lot: origLot ? origLot.lot : "",
      onHand: origLot ? origLot.onHand : 0,
      cost: origLot ? origLot.unitCost : null,
      cert: origLot ? origLot.certificate : "pending",
      retail: st.retail,
      wholesale: st.wholesale,
    };
    var vals = {
      lot: tr.querySelector(".m-lot").value,
      onHand: tr.querySelector(".m-hand").value,
      cost: tr.querySelector(".m-cost").value,
      cert: tr.querySelector(".m-cert").value,
      retail: (tr.querySelector(".m-retail") || {}).value,
      wholesale: (tr.querySelector(".m-wholesale") || {}).value,
    };
    await api("/api/ops/lots/save", {
      method: "POST",
      body: {
        sku: sku,
        lotIndex: lotIndex === "new" ? "new" : Number(lotIndex),
        lot: vals.lot,
        onHand: vals.onHand,
        unitCost: vals.cost,
        certificate: vals.cert,
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
    var changes = [];
    if (String(vals.lot || "") !== String(orig.lot || "")) changes.push("lot " + (orig.lot || "—") + "→" + (vals.lot || "—"));
    if (String(vals.onHand) !== String(orig.onHand)) changes.push("on-hand " + orig.onHand + "→" + vals.onHand);
    if (String(vals.cost || "") !== String(orig.cost == null ? "" : orig.cost)) changes.push("cost " + fmt(orig.cost) + "→" + fmt(num(vals.cost)));
    if (vals.cert !== orig.cert) changes.push("COA " + orig.cert + "→" + vals.cert);
    if (String(vals.retail || "") !== String(orig.retail == null ? "" : orig.retail)) changes.push("retail " + fmt(orig.retail) + "→" + fmt(num(vals.retail)));
    if (String(vals.wholesale || "") !== String(orig.wholesale == null ? "" : orig.wholesale)) changes.push("wholesale " + fmt(orig.wholesale) + "→" + fmt(num(vals.wholesale)));
    return changes;
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
    var saveAllBtn = document.getElementById("mSaveAll");
    if (saveAllBtn) saveAllBtn.onclick = function () { saveAll(saveAllBtn); };
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
    if (window.HKL && window.HKL.api) {
      mount();
      if (document.getElementById("mergedTable")) clearInterval(timer);
    }
    renameChannels();
    if (tries > 40) clearInterval(timer);
  }, 700);
  window.addEventListener("hkl:route", mount);
})();
