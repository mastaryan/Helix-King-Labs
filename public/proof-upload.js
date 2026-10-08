/* Helix King Labs — payment proof upload on the receipt page.
   For unpaid Venmo / Cash App orders: the customer uploads a screenshot of the
   payment; ops reviews it on the order detail page, then marks the order settled.
   Loaded after app.js; uses window.HKL at runtime. */
(function () {
  function api(path, opts) { return window.HKL.api(path, opts); }
  function toast(m) { return (window.HKL.toast || alert)(m); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function receivedHtml() {
    return `<div class="paybox" style="border-color:#2a7"><h3>Proof received</h3>` +
      `<p>Thanks — your screenshot is in. We'll match it and confirm your order shortly. Nothing else to do.</p></div>`;
  }

  function uploadHtml() {
    return `<div class="paybox" id="proofBox"><h3>Upload proof of payment</h3>` +
      `<p>Screenshot your payment (with the order ID in the note) and upload it here — it's the fastest way to get confirmed.</p>` +
      `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">` +
      `<input type="file" id="proofFile" accept="image/jpeg,image/png,image/webp" />` +
      `<button class="btn" type="button" id="proofSend" disabled>Upload</button>` +
      `</div><p class="hard" id="proofMsg" style="margin:8px 0 0"></p>` +
      `<div id="proofPreview" style="margin-top:8px"></div></div>`;
  }

  async function mount() {
    if (document.getElementById("proofBox") || document.getElementById("proofDone")) return;
    var p = location.pathname;
    if (!p.startsWith("/account/receipt/")) return;
    if (!window.HKL || !window.HKL.state || !window.HKL.state.user) return;
    var id = decodeURIComponent(p.split("/")[3] || "");
    if (!id) return;
    var order;
    try {
      var d = await api("/api/orders");
      order = (d.orders || []).find(function (o) { return o.id === id; });
    } catch (e) { return; }
    if (!order) return;
    if (order.status !== "awaiting_settlement") return;
    if (order.paymentMethod !== "venmo" && order.paymentMethod !== "cashapp") return;
    var paybox = document.querySelector(".paybox");
    if (!paybox) return;
    var wrap = document.createElement("div");
    if (order.paymentProof) {
      wrap.id = "proofDone";
      wrap.innerHTML = receivedHtml();
    } else {
      wrap.innerHTML = uploadHtml();
    }
    paybox.after(wrap);
    if (order.paymentProof) return;
    var fileInput = wrap.querySelector("#proofFile");
    var sendBtn = wrap.querySelector("#proofSend");
    var msg = wrap.querySelector("#proofMsg");
    var preview = wrap.querySelector("#proofPreview");
    var dataUrl = null;
    fileInput.addEventListener("change", function () {
      var f = fileInput.files && fileInput.files[0];
      msg.textContent = "";
      preview.innerHTML = "";
      dataUrl = null;
      sendBtn.disabled = true;
      if (!f) return;
      if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { msg.textContent = "Use a JPG, PNG, or WebP image."; return; }
      if (f.size > 8_000_000) { msg.textContent = "That file is too big — 8 MB max."; return; }
      var r = new FileReader();
      r.onload = function () {
        dataUrl = r.result;
        preview.innerHTML = `<img src="${esc(dataUrl)}" alt="preview" style="max-width:280px;border:1px solid var(--line-2);border-radius:6px" />`;
        sendBtn.disabled = false;
      };
      r.onerror = function () { msg.textContent = "Couldn't read that file."; };
      r.readAsDataURL(f);
    });
    sendBtn.addEventListener("click", async function () {
      if (!dataUrl) return;
      sendBtn.disabled = true;
      msg.textContent = "Uploading…";
      try {
        await api("/api/proof/" + encodeURIComponent(id), {
          method: "POST",
          body: { imageData: dataUrl },
        });
        wrap.id = "proofDone";
        wrap.innerHTML = receivedHtml();
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
  window.addEventListener("hkl:route", mount);
})();
