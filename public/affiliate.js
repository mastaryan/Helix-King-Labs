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
      <p>10% cash on merchandise after discounts. Shipping is not commissioned. Cash out at $50, any time, in crypto or Cash App. Balances of $50+ auto-pay on Dec 31. A code unused for 2 years expires. An affiliate code replaces HELIX10. Full rules: <a href="/affiliate-terms" data-link>Affiliate Program Terms</a>.</p>
      <h2>Tax information</h2>
      <p class="lede">Required before a code is issued. We report payouts of $600+ per year on Form 1099-NEC.</p>
      <form id="affApply">
        <input name="legalName" placeholder="Legal name (as on tax return)" required maxlength="80" />
        <input name="businessName" placeholder="Business name (optional)" maxlength="80" />
        <input name="address" placeholder="Street address" required maxlength="120" />
        <input name="city" placeholder="City" required maxlength="60" />
        <input name="state" placeholder="State" required maxlength="40" />
        <input name="zip" placeholder="ZIP" required maxlength="12" />
        <label class="check"><input type="radio" name="taxIdType" value="ssn" checked /> SSN</label>
        <label class="check"><input type="radio" name="taxIdType" value="ein" /> EIN</label>
        <input name="taxId" placeholder="SSN or EIN" required maxlength="14" inputmode="numeric" />
        <label class="check"><input type="checkbox" name="agree" required /> I want a Helix affiliate code. I accept the <a href="/affiliate-terms" data-link>Affiliate Program Terms</a>.</label>
        <label class="check"><input type="checkbox" name="certify" required /> Under penalties of perjury, I certify that the Tax ID above is correct and that I am a U.S. person (or will file the appropriate foreign form on request).</label>
        <button class="btn" type="submit" style="margin-top:16px">Open the desk</button>
        <div class="err" id="affApplyErr"></div>
      </form>
    </section>`;
  }

function affiliateClosed(data) {
    const reason = data.closeReason === "removed"
      ? "This affiliate code was removed."
      : "This affiliate code expired after 2 years without a referred order.";
    return `<section class="page wrap prose">
      <div class="kicker">Affiliate desk</div>
      <h1>${data.affiliate.code}</h1>
      <p class="lede">${reason} The code no longer gives discounts or earns commission.</p>
      <div class="totals">
        <div><span>Earned</span><span>${window.HKL.money(data.earned)}</span></div>
        <div><span>Paid</span><span>${window.HKL.money(data.paid)}</span></div>
        <div class="grand"><span>Available</span><span>${window.HKL.money(data.available)}</span></div>
      </div>
      ${data.pendingRequest
        ? `<p class="lede"><b>Payout requested:</b> ${window.HKL.money(data.pendingRequest.amount)} — it lands once it is sent.</p>`
        : data.available >= (data.payoutFloor || 50)
          ? `<p class="lede">You can still cash out your remaining balance.</p>
             <form id="payoutReq" style="margin-top:12px">
              <label class="check"><input type="radio" name="method" value="crypto" checked /> Crypto</label>
              <label class="check"><input type="radio" name="method" value="cashapp" /> Cash App</label>
              <input name="detail" placeholder="Wallet address (with network) or $CashApp handle" required maxlength="120" style="margin-top:8px" />
              <p><button class="btn" type="submit">Request payout of ${window.HKL.money(data.available)}</button></p>
              <div class="err" id="payoutErr"></div>
            </form>`
          : `<p class="lede">Balance is under the $${data.payoutFloor} payout floor.</p>`}
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
      <p class="lede">Leave your balance in as long as you like. Cash out at $${data.payoutFloor}+, paid in crypto or Cash App — your choice.</p>
      ${(() => {
        const floor = data.payoutFloor || 50;
        const pct = Math.min(100, Math.round((data.available / floor) * 100));
        const bar = `<div style="background:#1c231c;border:1px solid #2c362c;border-radius:8px;height:14px;overflow:hidden;margin:8px 0"><div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#2e9e4f,#4ade80);transition:width .4s"></div></div>
        <p class="lede">${window.HKL.money(data.available)} of ${window.HKL.money(floor)} to cash out</p>`;
        if (data.pendingRequest) return bar + `<p class="lede"><b>Payout requested:</b> ${window.HKL.money(data.pendingRequest.amount)} via ${data.pendingRequest.method === "cashapp" ? "Cash App" : "crypto"} on ${(data.pendingRequest.requested || "").slice(0, 10)}. It lands once it is sent.</p>`;
        if (data.available < floor) return bar;
        const pm = data.payoutMethod === "cashapp" ? "cashapp" : "crypto";
        return bar + `<form id="payoutReq" style="margin-top:12px">
          <p class="lede"><b>Cash out ${window.HKL.money(data.available)}</b></p>
          <label class="check"><input type="radio" name="method" value="crypto" ${pm === "crypto" ? "checked" : ""} /> Crypto</label>
          <label class="check"><input type="radio" name="method" value="cashapp" ${pm === "cashapp" ? "checked" : ""} /> Cash App</label>
          <input name="detail" id="payoutDetail" placeholder="Wallet address (with network) or $CashApp handle" required maxlength="120" style="margin-top:8px" value="${(data.payoutDetail || "").replace(/"/g, "&quot;")}" />
          <p><button class="btn" type="submit">Request payout</button></p>
          <div class="err" id="payoutErr"></div>
        </form>`;
      })()}
      <h2>Payout destination</h2>
      <p class="lede">Where cash-outs go — including the automatic Dec 31 payout of any balance $50+. Keep it current.</p>
      <form id="payoutMethodForm" class="tool-form">
        <label class="check"><input type="radio" name="method" value="crypto" ${(data.payoutMethod || "crypto") === "crypto" ? "checked" : ""} /> Crypto</label>
        <label class="check"><input type="radio" name="method" value="cashapp" ${data.payoutMethod === "cashapp" ? "checked" : ""} /> Cash App</label>
        <input name="detail" placeholder="Wallet address (with network) or $CashApp handle" required maxlength="120" value="${(data.payoutDetail || "").replace(/"/g, "&quot;")}" />
        <button class="btn" type="submit">Save destination</button>
        <div class="err" id="payoutMethodErr"></div>
      </form>
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
    var c = window.HKL_CONSENT && window.HKL_CONSENT.get();
    try {
      if (c && c.marketing) localStorage.setItem("hkl_aff", code);
      else sessionStorage.setItem("hkl_aff", code);
    } catch (e) {}
  }
