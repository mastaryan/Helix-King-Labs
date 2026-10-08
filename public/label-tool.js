/* Helix King Labs — vial label maker (front/back).
   Standalone module that upgrades the /tools/label page without touching app.js.
   - Front: branding (logo, name, amount, RESEARCH USE ONLY) — matches website photos.
   - Back: QR (→ lot COA page), lot code, helixkinglabs.com.
   - 3mL (20×40mm) / 10mL (30×50mm) size selector.
   - COA gate: labels require an accepted COA for the lot.
   - Pre-population from ?sku= &lot= (intake -> COA -> label chain).
   - Download marks the lot's labels as created (chain of custody). */
(function () {
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function dims() {
    var v = document.querySelector("#lbVial");
    v = (v && v.value) || "3";
    return v === "10" ? { w: 360, h: 600, label: "30 × 50 mm" } : { w: 240, h: 480, label: "20 × 40 mm" };
  }

  var mark = new Image();
  mark.src = "/img/logo-personal.jpg";

  function val(id) {
    var el = document.querySelector("#" + id);
    return (el && el.value.trim()) || "";
  }

  function paintFront() {
    var c = document.querySelector("#lbCanvasFront");
    if (!c) return;
    var d = dims();
    c.width = d.w; c.height = d.h;
    var ctx = c.getContext("2d");
    var name = val("lbName") || "RESEARCH";
    var size = val("lbSize");
    var long = name.length > 18;
    var logoS = long ? Math.round(d.w * 0.42) : Math.round(d.w * 0.62);
    var cx = d.w / 2;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, d.w, d.h);
    if (mark.complete && mark.naturalWidth) {
      ctx.drawImage(mark, cx - logoS / 2, Math.round(d.h * 0.10), logoS, logoS);
    }
    ctx.fillStyle = "#e8e8e8";
    ctx.textAlign = "center";
    ctx.font = "700 " + Math.round(d.w * 0.075) + "px 'IBM Plex Sans', sans-serif";
    var lines = name.length > 22 ? [name.slice(0, 22), name.slice(22, 40)] : [name.slice(0, 28)];
    var ny = d.h * 0.52;
    lines.forEach(function (ln, i) { ctx.fillText(ln, cx, ny + i * Math.round(d.w * 0.085)); });
    ctx.font = Math.round(d.w * 0.058) + "px 'IBM Plex Mono', monospace";
    ctx.fillStyle = "#cccccc";
    ctx.fillText(size, cx, ny + lines.length * Math.round(d.w * 0.085) + Math.round(d.h * 0.02));
    ctx.font = Math.round(d.w * 0.042) + "px 'IBM Plex Sans', sans-serif";
    ctx.fillStyle = "#aaaaaa";
    ctx.fillText("RESEARCH USE ONLY", cx, d.h * 0.94);
  }

  function paintBack(modules, sizeN) {
    var c = document.querySelector("#lbCanvasBack");
    if (!c) return;
    var d = dims();
    c.width = d.w; c.height = d.h;
    var ctx = c.getContext("2d");
    var lot = val("lbLot") || "PENDING";
    var cx = d.w / 2;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, d.w, d.h);
    ctx.fillStyle = "#e8e8e8";
    ctx.textAlign = "center";
    if (modules && sizeN) {
      var qrS = Math.round(d.w * 0.52);
      var cell = qrS / sizeN;
      var qx = cx - qrS / 2, qy = Math.round(d.h * 0.12);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(qx - 4, qy - 4, qrS + 8, qrS + 8);
      ctx.fillStyle = "#111111";
      for (var r = 0; r < sizeN; r++) {
        for (var cc = 0; cc < sizeN; cc++) {
          if (modules[r * sizeN + cc]) ctx.fillRect(qx + cc * cell, qy + r * cell, cell, cell);
        }
      }
      var ty = qy + qrS + Math.round(d.h * 0.06);
      ctx.fillStyle = "#999999";
      ctx.font = Math.round(d.w * 0.038) + "px 'IBM Plex Sans', sans-serif";
      ctx.fillText("SCAN FOR COA", cx, ty);
      ctx.fillStyle = "#dddddd";
      ctx.font = Math.round(d.w * 0.05) + "px 'IBM Plex Mono', monospace";
      ctx.fillText("LOT " + lot, cx, ty + Math.round(d.h * 0.055));
      ctx.fillStyle = "#999999";
      ctx.font = Math.round(d.w * 0.038) + "px 'IBM Plex Sans', sans-serif";
      ctx.fillText("helixkinglabs.com", cx, ty + Math.round(d.h * 0.105));
    } else {
      ctx.fillStyle = "#777777";
      ctx.font = Math.round(d.w * 0.045) + "px 'IBM Plex Sans', sans-serif";
      ctx.fillText("Enter a lot with an", cx, d.h * 0.4);
      ctx.fillText("accepted COA to build the QR.", cx, d.h * 0.46);
    }
    ctx.fillStyle = "#666666";
    ctx.font = Math.round(d.w * 0.034) + "px 'IBM Plex Sans', sans-serif";
    ctx.fillText("Research use only · 18+", cx, d.h * 0.94);
  }

  async function draw() {
    var HKL = window.HKL || {};
    var api = HKL.api;
    if (!api) return;
    var lot = val("lbLot");
    var urlBox = document.querySelector("#lbUrl");
    var warnBox = document.querySelector("#lbCoaWarn");
    paintFront();
    if (!lot) {
      paintBack(null, 0);
      if (urlBox) urlBox.textContent = "Enter a lot to build the QR.";
      if (warnBox) warnBox.innerHTML = "";
      return;
    }
    var lotInfo = null;
    try {
      var sku = val("lbSkuText");
      if (sku) {
        var lv = await api("/api/ops/lots?sku=" + encodeURIComponent(sku));
        var rec = (((lv.lots || [])[0] || {}).lots || []);
        lotInfo = rec.find(function (l) { return l.lot === lot; }) || null;
      }
    } catch (e) {}
    if (!lotInfo || lotInfo.certificate !== "accepted") {
      paintBack(null, 0);
      if (urlBox) urlBox.textContent = "";
      if (warnBox) warnBox.innerHTML = '<p class="hard">No accepted COA for lot ' + esc(lot) + ' — upload and accept the COA before creating labels. The QR would point at nothing.</p>';
      return;
    }
    if (warnBox) warnBox.innerHTML = "";
    try {
      var data = await api("/api/ops/label-qr?lot=" + encodeURIComponent(lot));
      if (urlBox) urlBox.textContent = data.url;
      paintBack(data.modules, data.size);
    } catch (e) {
      paintBack(null, 0);
    }
  }

  function upgrade() {
    // Only on the label tool page, and only once per render.
    var form = document.querySelector("#labelForm");
    if (!form || form.dataset.hklLabel === "1") return;
    form.dataset.hklLabel = "1";

    // Add vial size selector.
    var vialLabel = document.createElement("label");
    vialLabel.innerHTML = 'Vial size<select id="lbVial"><option value="3">3 mL vial · 20 × 40 mm</option><option value="10">10 mL vial · 30 × 50 mm</option></select>';
    var goBtn = form.querySelector("#lbGo");
    if (goBtn) form.insertBefore(vialLabel, goBtn);
    else form.appendChild(vialLabel);

    // COA warning box.
    var warn = document.createElement("div");
    warn.id = "lbCoaWarn";
    form.after(warn);

    // Replace the single canvas with front/back.
    var stage = form.parentElement.querySelector(".label-stage");
    if (stage) {
      stage.innerHTML =
        '<div style="display:flex;gap:24px;flex-wrap:wrap;">' +
        '<div><p class="muted">Front</p><canvas id="lbCanvasFront" width="240" height="480"></canvas></div>' +
        '<div><p class="muted">Back</p><canvas id="lbCanvasBack" width="240" height="480"></canvas></div>' +
        "</div>" +
        '<p style="margin-top:12px"><button class="btn ghost" id="lbDl2" type="button">Download JPEG (front + back)</button></p>';
      // Hide the old download button (old canvas is gone; old bind skips).
      var oldDl = document.querySelector("#lbDl");
      if (oldDl) oldDl.style.display = "none";
    }

    // Pre-population from ?sku= &lot=.
    try {
      var qp = new URLSearchParams(location.search);
      var qSku = qp.get("sku"), qLot = qp.get("lot");
      var skuSel = document.querySelector("#lbSku");
      if (qSku && skuSel) {
        var opt = Array.from(skuSel.options).find(function (o) { return o.value === qSku; });
        if (opt) {
          skuSel.value = qSku;
          skuSel.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
      var lotInput = document.querySelector("#lbLot");
      if (qLot && lotInput) lotInput.value = qLot;
    } catch (e) {}

    // Wire events.
    ["lbName", "lbSize", "lbLot", "lbVial"].forEach(function (id) {
      var el = document.querySelector("#" + id);
      if (el) el.addEventListener("change", draw);
    });
    var skuS = document.querySelector("#lbSku");
    if (skuS) skuS.addEventListener("change", function () {
      var o = skuS.selectedOptions[0];
      if (!o) return;
      var n = document.querySelector("#lbName"); if (n) n.value = o.getAttribute("data-name") || "";
      var s = document.querySelector("#lbSize"); if (s) s.value = o.getAttribute("data-size") || "";
      var t = document.querySelector("#lbSkuText"); if (t) t.value = o.value;
      var l = document.querySelector("#lbLot"); if (l) l.value = o.getAttribute("data-lot") || "";
      draw();
    });
    var go = document.querySelector("#lbGo");
    if (go) go.onclick = draw;
    var dl = document.querySelector("#lbDl2");
    if (dl) dl.onclick = async function () {
      var HKL = window.HKL || {};
      var d = dims();
      var cf = document.querySelector("#lbCanvasFront");
      var cb = document.querySelector("#lbCanvasBack");
      if (!cf || !cb) return;
      var combo = document.createElement("canvas");
      combo.width = d.w * 2 + 24; combo.height = d.h;
      var cctx = combo.getContext("2d");
      cctx.fillStyle = "#000000";
      cctx.fillRect(0, 0, combo.width, combo.height);
      cctx.drawImage(cf, 0, 0);
      cctx.drawImage(cb, d.w + 24, 0);
      var a = document.createElement("a");
      var lot = val("lbLot") || "label";
      var sku = val("lbSkuText") || "hkl";
      a.download = sku + "-" + lot + "-label.jpg";
      a.href = combo.toDataURL("image/jpeg", 0.95);
      a.click();
      try {
        if (HKL.api) await HKL.api("/api/ops/lots/labels", { method: "POST", body: { sku: sku, lot: lot } });
        if (HKL.toast) HKL.toast("Labels marked as created for lot " + lot);
      } catch (e) {}
    };

    draw();
  }

  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (window.HKL && window.HKL.api) upgrade();
    if (tries > 120) clearInterval(timer);
  }, 700);
  new MutationObserver(function () {
    if (window.HKL && window.HKL.api) upgrade();
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("hkl:route", function () {
    var f = document.querySelector("#labelForm");
    if (f) delete f.dataset.hklLabel;
    setTimeout(upgrade, 200);
  });
})();
