/* Helix King Labs — coupons section for /ops/catalog.
   Mounts <div id="coupons"> so the side nav "Coupons" link scrolls to it.
   Full fields: code, $ or % off, max uses, min order total, expiry, note, active.
   Uses POST /api/ops/coupons and the coupon list from /api/ops/desk.
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

  var coupons = [];

  function fmtVal(c) {
    if (c.amount) return money(c.amount) + " off";
    return (c.pct || 0) + "% off";
  }
  function fmtUses(c) {
    var u = Number(c.uses || 0);
    return c.maxUses ? u + " / " + c.maxUses : String(u);
  }
  function fmtExp(c) {
    if (!c.expires) return "—";
    return String(c.expires).slice(0, 10);
  }

  function tableHtml() {
    if (!coupons.length) return `<p class="lede">No coupon codes yet.</p>`;
    return `<div style="overflow:auto"><table class="table"><thead><tr>` +
      `<th>Code</th><th>Discount</th><th>Uses</th><th>Min total</th><th>Expires</th><th>Note</th><th>Status</th><th></th>` +
      `</tr></thead><tbody>` +
      coupons.map(function (c) {
        return `<tr data-code="${esc(c.code)}">` +
          `<td><b>${esc(c.code)}</b></td>` +
          `<td>${esc(fmtVal(c))}</td>` +
          `<td>${esc(fmtUses(c))}</td>` +
          `<td>${c.minTotal ? money(c.minTotal) : "—"}</td>` +
          `<td>${esc(fmtExp(c))}</td>` +
          `<td>${esc(c.note || "—")}</td>` +
          `<td>${c.active === false ? '<span class="pill">off</span>' : '<span class="pill ok">on</span>'}</td>` +
          `<td><button type="button" class="btn ghost cp-toggle">${c.active === false ? "Enable" : "Disable"}</button></td>` +
          `</tr>`;
      }).join("") +
      `</tbody></table></div>`;
  }

  function sectionHtml() {
    return `<h2>Coupons</h2>
      <p class="lede">One discount per order: an affiliate code beats a coupon, a coupon beats HELIX10.</p>
      <div id="couponTable">${tableHtml()}</div>
      <h3 style="margin-top:20px">New code</h3>
      <form id="couponForm" class="tool-form" style="max-width:560px">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input name="code" placeholder="CODE" required minlength="3" maxlength="16" style="text-transform:uppercase;flex:1;min-width:140px" />
          <select name="kind" style="flex:0 0 130px"><option value="pct">% off</option><option value="amt">$ off</option></select>
          <input name="value" type="number" step="0.01" min="0" placeholder="Value" required style="flex:1;min-width:100px" />
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input name="maxUses" type="number" min="0" placeholder="Max uses (blank = unlimited)" style="flex:1;min-width:140px" />
          <input name="minTotal" type="number" step="0.01" min="0" placeholder="Min order $ (blank = none)" style="flex:1;min-width:140px" />
          <input name="expires" type="date" style="flex:1;min-width:140px" />
        </div>
        <input name="note" placeholder="Note (optional, ops only)" maxlength="80" />
        <button class="btn" type="submit">Create code</button>
        <p class="hard" id="couponErr" style="margin:0"></p>
      </form>`;
  }

  function renderTable() {
    var box = document.getElementById("couponTable");
    if (box) box.innerHTML = tableHtml();
  }

  async function toggle(btn) {
    var tr = btn.closest("tr");
    var code = tr.getAttribute("data-code");
    var cur = coupons.find(function (c) { return c.code === code; }) || {};
    btn.disabled = true;
    try {
      var out = await api("/api/ops/coupons", {
        method: "POST",
        body: {
          code: code,
          pct: cur.pct || 0,
          amount: cur.amount || 0,
          maxUses: cur.maxUses || 0,
          minTotal: cur.minTotal || 0,
          expires: cur.expires || null,
          note: cur.note || "",
          active: cur.active === false,
        },
      });
      coupons = out.coupons || coupons;
      renderTable();
      toast("Code " + (cur.active === false ? "enabled." : "disabled."));
    } catch (err) {
      toast("Couldn't update: " + ((err && err.error) || "error"));
      btn.disabled = false;
    }
  }

  async function create(e) {
    e.preventDefault();
    var form = e.target;
    var errBox = document.getElementById("couponErr");
    var fd = new FormData(form);
    var kind = String(fd.get("kind") || "pct");
    var value = Number(fd.get("value"));
    if (!Number.isFinite(value) || value <= 0) { errBox.textContent = "Enter a discount value."; return; }
    if (kind === "pct" && value > 90) { errBox.textContent = "Percent is capped at 90."; return; }
    errBox.textContent = "";
    var body = {
      code: String(fd.get("code") || ""),
      maxUses: fd.get("maxUses") || 0,
      minTotal: fd.get("minTotal") || 0,
      expires: fd.get("expires") || null,
      note: String(fd.get("note") || ""),
      active: true,
    };
    if (kind === "pct") body.pct = value; else body.amount = value;
    try {
      var out = await api("/api/ops/coupons", { method: "POST", body: body });
      coupons = out.coupons || coupons;
      renderTable();
      form.reset();
      toast("Code created.");
    } catch (err) {
      errBox.textContent = err && err.error === "code"
        ? "Code must be 3–16 characters (letters/numbers) and can't be HELIX10."
        : "Couldn't create: " + ((err && err.error) || "error");
    }
  }

  function mount() {
    if (document.getElementById("coupons")) return;
    if (!window.HKL || !window.HKL.state || !window.HKL.state.user || !window.HKL.state.user.isOps) return;
    // Place after the payment channels section if present, else at the end of the ops page.
    var anchor = document.getElementById("channelDesk") || document.getElementById("subList");
    if (!anchor) return;
    var div = document.createElement("div");
    div.id = "coupons";
    div.style.marginTop = "36px";
    div.innerHTML = `<p class="muted">Loading coupons…</p>`;
    anchor.after(div);
    api("/api/ops/desk").then(function (d) {
      coupons = d.coupons || [];
      div.innerHTML = sectionHtml();
      div.querySelector("#couponForm").addEventListener("submit", create);
      div.addEventListener("click", function (e) {
        var btn = e.target.closest(".cp-toggle");
        if (btn) toggle(btn);
      });
    }).catch(function () {
      div.innerHTML = `<h2>Coupons</h2><p class="hard">Couldn't load coupons.</p>`;
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
