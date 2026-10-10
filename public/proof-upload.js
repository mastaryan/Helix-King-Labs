/* Helix King Labs — payment proof upload on the receipt page.
   For unpaid Venmo / Cash App / crypto orders: the customer uploads screenshots
   of the payment; ops reviews them on the order detail page, then marks PAID.
   Images only (JPG/PNG/WebP/HEIC) — no PDFs. Loaded after app.js; uses window.HKL. */
(function () {
  function api(path, opts) { return window.HKL.api(path, opts); }
  function toast(m) { return (window.HKL.toast || alert)(m); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var mountedFor = null; // order id we've already mounted for (prevents duplicates)

  function receivedHtml(count) {
    return `<div class="paybox" style="border-color:#2a7"><h3>Proof received</h3>` +
      `<p>Thanks — your ${count > 1 ? count + " screenshots are" : "screenshot is"} in. We'll match ${count > 1 ? "them" : "it"} and confirm your order shortly. Nothing else to do.</p></div>`;
  }

  function uploadHtml() {
    return `<div class="paybox" id="proofBox"><h3>Upload proof of payment</h3>` +
      `<p>Screenshot your payment (with the order ID in the note) and upload it here — it's the fastest way to get confirmed. You can attach up to 5 images.</p>` +
      `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">` +
      `<input type="file" id="proofFile" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple />` +
      `<button class="btn" type="button" id="proofSend" disabled>Upload</button>` +
      `</div><p class="hard" id="proofMsg" style="margin:8px 0 0"></p>` +
      `<div id="proofPreview" style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"></div></div>`;
  }

  async function mount() {
    var p = location.pathname;
    if (!p.startsWith("/account/receipt/")) { mountedFor = null; return; }
    if (!window.HKL || !window.HKL.state || !window.HKL.state.user) return;
    var id = decodeURIComponent(p.split("/")[3] || "");
    if (!id) return;
    if (mountedFor === id && document.getElementById("proofBox")) return;
    if (document.getElementById("proofBox") || document.getElementById("proofDone")) { mountedFor = id; return; }
    var order;
    try {
      var d = await api("/api/orders");
      order = (d.orders || []).find(function (o) { return o.id === id; });
    } catch (e) { return; }
    if (!order) return;
    const isUnpaid = order.status === "not_paid" || (order.wholesale && order.status === "committed");
    if (!isUnpaid) return;
    var paybox = document.querySelector(".paybox");
    if (!paybox) return;
    // Don't double-mount if a previous wrap is still in the DOM
    if (paybox.nextElementSibling && (paybox.nextElementSibling.id === "proofBox" || paybox.nextElementSibling.id === "proofDone")) {
      mountedFor = id;
      return;
    }
    var wrap = document.createElement("div");
    var proofCount = order.paymentProof && order.paymentProof.files ? order.paymentProof.files.length : 1;
    if (order.paymentProof) {
      wrap.id = "proofDone";
      wrap.innerHTML = receivedHtml(proofCount);
    } else {
      wrap.innerHTML = uploadHtml();
    }
    paybox.after(wrap);
    mountedFor = id;
    if (order.paymentProof) return;
    var fileInput = wrap.querySelector("#proofFile");
    var sendBtn = wrap.querySelector("#proofSend");
    var msg = wrap.querySelector("#proofMsg");
    var preview = wrap.querySelector("#proofPreview");
    var dataUrls = [];
    var okTypes = /^(image\/(jpeg|png|webp|heic|heif))$/i;
    fileInput.addEventListener("change", function () {
      var files = Array.prototype.slice.call(fileInput.files || []).slice(0, 5);
      msg.textContent = "";
      preview.innerHTML = "";
      dataUrls = [];
      sendBtn.disabled = true;
      if (!files.length) return;
      var pending = files.length;
      files.forEach(function (f) {
        if (!okTypes.test(f.type || "")) { msg.textContent = "Use JPG, PNG, WebP, or HEIC images — no PDFs."; pending--; return; }
        if (f.size > 8_000_000) { msg.textContent = f.name + " is too big — 8 MB max each."; pending--; return; }
        var r = new FileReader();
        r.onload = function () {
          dataUrls.push(r.result);
          // HEIC may not preview in-browser; show a placeholder label instead
          if (/heic|heif/i.test(f.type)) {
            preview.innerHTML += `<div style="width:120px;height:120px;border:1px solid var(--line-2);border-radius:6px;display:grid;place-items:center;font-size:12px" class="muted">HEIC image<br>ready</div>`;
          } else {
            preview.innerHTML += `<img src="${esc(r.result)}" alt="preview" style="max-width:120px;border:1px solid var(--line-2);border-radius:6px" />`;
          }
          if (--pending === 0 && dataUrls.length) sendBtn.disabled = false;
        };
        r.onerror = function () { msg.textContent = "Couldn't read " + f.name + "."; if (--pending === 0 && dataUrls.length) sendBtn.disabled = false; };
        r.readAsDataURL(f);
      });
    });
    sendBtn.addEventListener("click", async function () {
      if (!dataUrls.length) return;
      sendBtn.disabled = true;
      msg.textContent = "Uploading…";
      try {
        await api("/api/proof/" + encodeURIComponent(id), {
          method: "POST",
          body: { images: dataUrls },
        });
        wrap.id = "proofDone";
        wrap.innerHTML = receivedHtml(dataUrls.length);
        toast("Proof uploaded.");
      } catch (err) {
        msg.textContent = "Upload failed — try again.";
        sendBtn.disabled = false;
      }
    });
  }

  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (window.HKL && window.HKL.api) mount();
    if (tries > 120) clearInterval(timer);
  }, 700);
  new MutationObserver(function () {
    if (window.HKL && window.HKL.api) mount();
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("hkl:route", function () { mountedFor = null; mount(); });
})();
