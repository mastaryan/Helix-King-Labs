/* Helix King Labs — affiliate desk page. Loaded before app.js; uses window.HKL at runtime. */
function affiliatesLocked(data) {
    if (!window.HKL.state.user) {
      return `<section class="page wrap prose">
        <div class="kicker">Affiliates</div>
        <h1>Account first. Then an order. Then a desk.</h1>
        <p>This page is not public. Sign in, place an order, then apply from your account.</p>
        <p><a class="btn" href="/account" data-link>Sign in</a></p>
      </section>`;
    }
    if (!data || !data.hasOrdered) {
      return `<section class="page wrap prose">
        <div class="kicker">Affiliates</div>
        <h1>Order first</h1>
        <p>The desk opens after this account has a recorded order.</p>
        <p><a class="btn" href="/shop" data-link>Open catalog</a></p>
      </section>`;
    }
    return `<section class="page wrap prose">
      <div class="kicker">Affiliates</div>
      <h1>Open a desk</h1>
      <p>10% cash on merchandise after discounts. Shipping is not commissioned. Payout on request at $50. Year-end sweep 31 Dec. No store credit. An affiliate code replaces HELIX10.</p>
      <form id="affApply">
        <label class="check"><input type="checkbox" name="agree" required /> I want a Helix affiliate code. I accept the settlement rules.</label>
        <button class="btn" type="submit" style="margin-top:16px">Open the desk</button>
      </form>
    </section>`;
  }

function affiliatesDesk(data) {
    const rows = (data.orders || [])
      .map(
        (o) => `<tr><td>${o.id}</td><td>${(o.created || "").slice(0, 10)}</td><td>${(o.lines || []).join(", ")}</td><td>${window.HKL.money(o.merchandise)}</td><td>${window.HKL.money(o.payout)}</td></tr>`
      )
      .join("");
    return `<section class="page wrap">
      <div class="kicker">Affiliate desk</div>
      <h1>${data.affiliate.code}</h1>
      <p class="lede">Share <span class="sku-line">${location.origin}${data.link}</span>. Commission is 10% of merchandise after discounts. Shipping is not paid.</p>
      <div class="totals">
        <div><span>Earned</span><span>${window.HKL.money(data.earned)}</span></div>
        <div><span>Paid</span><span>${window.HKL.money(data.paid)}</span></div>
        <div class="grand"><span>Available</span><span>${window.HKL.money(data.available)}</span></div>
      </div>
      <p class="lede">Cash out at $${data.payoutFloor}+. Leftover sweeps 31 Dec.</p>
      ${data.pendingRequest
        ? `<p class="lede"><b>Payout requested:</b> ${window.HKL.money(data.pendingRequest.amount)} on ${(data.pendingRequest.requested || "").slice(0, 10)}. It lands once it is approved.</p>`
        : data.available >= (data.payoutFloor || 50)
          ? `<p><button class="btn" id="payoutReq">Request payout of ${window.HKL.money(data.available)}</button></p><div class="err" id="payoutErr"></div>`
          : ``}
      <h2>Referred orders</h2>
      ${
        rows
          ? `<table class="table"><thead><tr><th>Order</th><th>Date</th><th>Lines</th><th>Merch</th><th>10%</th></tr></thead><tbody>${rows}</tbody></table>`
          : `<p class="lede">No referred orders yet.</p>`
      }
    </section>`;
  }

function captureAffFromUrl() {
    const ref = new URLSearchParams(location.search).get("ref") || new URLSearchParams(location.search).get("aff");
    if (!ref) return;
    const code = String(ref).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 16);
    if (code.length < 3 || code === "HELIX10") return;
    window.HKL.state.aff = code;
    localStorage.setItem("hkl_aff", code);
  }
