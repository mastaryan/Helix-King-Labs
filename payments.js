// Helix King Labs — NOWPayments integration.
// Factory pattern: createPayments({deps}) -> handler.
// Handles the IPN callback, invoice creation, status updates, and the recheck poller.
const crypto = require("crypto");
const https = require("https");

// Order statuses that can still be settled by a crypto payment.
const AWAITING = new Set(["not_paid", "committed"]);

function createPayments(deps) {
  const { store, saveStore, send, readBody, queueMail, orderMail, audit, getPublicOrigin } = deps;
  const alert = deps.alert || (() => {});

  function sortForIpn(value) {
    if (Array.isArray(value)) return value.map(sortForIpn);
    if (!value || typeof value !== "object") return value;
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = sortForIpn(value[key]);
      return out;
    }, {});
  }

  function createNowPayment(order, network) {
    const key = process.env.NOWPAYMENTS_API_KEY;
    if (!key) {
      return Promise.resolve({ provider: "nowpayments", status: "key_missing", message: "Payment key is not on the server." });
    }
    const origin = (getPublicOrigin && getPublicOrigin()) || "https://helixkinglabs.com";
    const payload = JSON.stringify({
      price_amount: order.quote.total,
      price_currency: "usd",
      order_id: order.id,
      order_description: "Helix King Labs research order " + order.id,
      ipn_callback_url: origin + "/api/payments/nowpayments",
      success_url: origin + "/account/receipt/" + order.id,
      cancel_url: origin + "/cart",
    });
    return new Promise((resolve) => {
      const req = https.request(
        {
          hostname: "api.nowpayments.io",
          path: "/v1/invoice",
          method: "POST",
          headers: {
            "x-api-key": key,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () => {
            try {
              const data = JSON.parse(raw);
              resolve({
                provider: "nowpayments",
                status: data.invoice_url ? "awaiting_payment" : "payment_failed",
                paymentId: data.id || null,
                invoiceUrl: data.invoice_url || null,
                payAmount: data.price_amount || null,
                payCurrency: "USD",
                network: network === "solana" ? "Solana" : "Ethereum",
                message: data.message || data.code || null,
                invoiceId: data.id || null,
              });
            } catch {
              resolve({ provider: "nowpayments", status: "invoice_pending" });
            }
          });
        }
      );
      req.setTimeout(8000, () => {
        req.destroy();
        resolve({ provider: "nowpayments", status: "invoice_pending" });
      });
      req.on("error", () => resolve({ provider: "nowpayments", status: "invoice_pending" }));
      req.write(payload);
      req.end();
    });
  }

  // Direct payment API (no hosted invoice) — returns pay address for on-site deposit screen.
  // payCurrency: "usdc" (ERC-20) for Ethereum, "usdcsol" for Solana.
  function createNowPaymentDirect(order, network) {
    const key = process.env.NOWPAYMENTS_API_KEY;
    if (!key) {
      return Promise.resolve({ provider: "nowpayments", status: "key_missing", message: "Payment key is not on the server." });
    }
    const origin = (getPublicOrigin && getPublicOrigin()) || "https://helixkinglabs.com";
    const payCurrency = network === "solana" ? "usdcsol" : "usdc";
    const payload = JSON.stringify({
      price_amount: order.quote.total,
      price_currency: "usd",
      pay_currency: payCurrency,
      order_id: order.id,
      order_description: "Helix King Labs research order " + order.id,
      ipn_callback_url: origin + "/api/payments/nowpayments",
    });
    return new Promise((resolve) => {
      const req = https.request(
        {
          hostname: "api.nowpayments.io",
          path: "/v1/payment",
          method: "POST",
          headers: {
            "x-api-key": key,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () => {
            try {
              const data = JSON.parse(raw);
              if (data.pay_address) {
                resolve({
                  provider: "nowpayments",
                  status: "awaiting_payment",
                  paymentId: data.payment_id || null,
                  payAddress: data.pay_address,
                  payAmount: data.pay_amount,
                  payCurrency: (data.pay_currency || payCurrency).toUpperCase(),
                  expectedPayCurrency: payCurrency,
                  priceAmount: data.price_amount,
                  expectedAmount: Number(order.quote.total),
                  priceCurrency: "USD",
                  network: network === "solana" ? "Solana" : "Ethereum",
                  createdAt: new Date().toISOString(),
                  expiresAt: data.expiration_estimate_date || null,
                });
              } else {
                resolve({
                  provider: "nowpayments",
                  status: "payment_failed",
                  message: data.message || "Payment creation failed.",
                });
              }
            } catch {
              resolve({ provider: "nowpayments", status: "payment_failed", message: "Payment service error." });
            }
          });
        }
      );
      req.setTimeout(10000, () => {
        req.destroy();
        resolve({ provider: "nowpayments", status: "payment_failed", message: "Payment service timeout." });
      });
      req.on("error", () => resolve({ provider: "nowpayments", status: "payment_failed", message: "Payment service unavailable." }));
      req.write(payload);
      req.end();
    });
  }

  // Validate a NOWPayments payment record (from GET /v1/payment/{id}) against our order.
  // Returns null when it matches, or a reason string.
  function mismatch(order, data) {
    const p = order.payment || {};
    if (String(data.order_id || "") !== String(order.id)) return "order_id";
    if (p.paymentId && String(data.payment_id || "") !== String(p.paymentId)) return "payment_id";
    if (String(data.price_currency || "").toLowerCase() !== "usd") return "price_currency";
    const expected = Number(p.expectedAmount != null ? p.expectedAmount : (order.quote && order.quote.total) || order.total);
    if (!(Number(data.price_amount) + 0.005 >= expected)) return "price_amount";
    const want = String(p.expectedPayCurrency || "").toLowerCase();
    if (want && String(data.pay_currency || "").toLowerCase() !== want) return "pay_currency";
    if (data.parent_payment_id) return "redeposit";
    return null;
  }

  // Single entry point for every status change. `data` MUST come from the
  // NOWPayments API (GET /v1/payment/{id}), never from the IPN body alone.
  function applyPaymentStatus(order, status, data) {
    data = data || {};
    const prevStatus = order.payment && order.payment.paymentStatus;
    order.payment = Object.assign({}, order.payment, {
      provider: "nowpayments",
      paymentStatus: status,
      payCurrency: data.pay_currency ? String(data.pay_currency).toUpperCase() : (order.payment && order.payment.payCurrency) || null,
      actuallyPaid: data.actually_paid != null ? Number(data.actually_paid) : order.payment && order.payment.actuallyPaid,
      lastCheckedAt: new Date().toISOString(),
    });
    if (order.status === "voided") { saveStore(store); return { ok: true, skipped: "voided", status: order.status }; }
    // Idempotent: already settled orders never change here.
    if (!AWAITING.has(order.status)) { saveStore(store); return { ok: true, status: order.status, skipped: "settled" }; }

    const bad = mismatch(order, data);
    if (bad) {
      order.payment.flag = bad;
      order.events = order.events || [];
      if (order.payment.flagLogged !== bad) {
        alert("payment_mismatch", "Order " + order.id + " NOWPayments payment " + (data.payment_id || "?") + " status " + status + " failed check: " + bad + " (price " + data.price_amount + " " + data.price_currency + ", pay " + data.pay_currency + ")", { key: order.id });
        order.events.push({ at: new Date().toISOString(), kind: "payment_flag_" + bad, by: "nowpayments" });
        order.payment.flagLogged = bad;
      }
      saveStore(store);
      return { ok: true, status: order.status, skipped: "mismatch:" + bad };
    }

    if (status === "partially_paid") {
      const p = order.payment;
      p.underpaidAt = p.underpaidAt || new Date().toISOString();
      const fiat = Number(data.actually_paid_at_fiat);
      const expected = Number(p.expectedAmount || (order.quote && order.quote.total) || 0);
      p.shortBy = Number.isFinite(fiat) && fiat > 0 ? Math.max(0, Math.round((expected - fiat) * 100) / 100) : null;
      saveStore(store);
      return { ok: true, status: order.status, partial: true };
    }

    // Only "finished" means the funds are actually in the merchant wallet.
    // "confirmed" = blockchain confirmed but not yet delivered — do NOT mark paid.
    if (status === "finished") {
      order.status = "paid";
      order.fulfillment = "ready";
      order.settledAt = new Date().toISOString();
      order.events = order.events || [];
      order.events.push({ at: order.settledAt, kind: "paid", by: "nowpayments:finished" });
      if (audit) audit({ email: "nowpayments" }, "order", order.id + " paid finished");
      saveStore(store);
      try { queueMail(orderMail(order, "paid")); } catch (err) { console.error("paid mail", order.id, err.message); }
      return { ok: true, status: order.status };
    }
    if (status !== prevStatus) {
      order.events = order.events || [];
      order.events.push({ at: new Date().toISOString(), kind: "crypto_" + status, by: "nowpayments" });
    }
    saveStore(store);
    return { ok: true, status: order.status };
  }

  function fetchNowPayment(paymentId) {
    const key = process.env.NOWPAYMENTS_API_KEY;
    if (!key) return Promise.reject(new Error("key_missing"));
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: "api.nowpayments.io",
          path: "/v1/payment/" + encodeURIComponent(paymentId),
          method: "GET",
          headers: { "x-api-key": key },
        },
        (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () => {
            if (res.statusCode !== 200) return reject(new Error("http_" + res.statusCode));
            try { resolve(JSON.parse(raw)); } catch (err) { reject(err); }
          });
        }
      );
      req.setTimeout(10000, () => req.destroy(new Error("timeout")));
      req.on("error", reject);
      req.end();
    });
  }

  // Authoritative re-check for one order: asks NOWPayments directly.
  async function recheckOrder(order) {
    const pid = order.payment && order.payment.paymentId;
    if (!pid) return { ok: false, error: "no_payment" };
    const data = await fetchNowPayment(pid);
    return Object.assign({ paymentStatus: String(data.payment_status || "") }, applyPaymentStatus(order, String(data.payment_status || ""), data));
  }

  let rechecking = false;
  async function recheckPendingCrypto() {
    if (rechecking || !process.env.NOWPAYMENTS_API_KEY) return;
    rechecking = true;
    try {
      const now = Date.now();
      for (const order of store.orders || []) {
        if (!AWAITING.has(order.status) || order.paymentMethod !== "crypto") continue;
        if (!(order.payment && order.payment.paymentId)) continue;
        const age = now - new Date(order.created || 0).getTime();
        if (!Number.isFinite(age) || age > 25 * 60 * 60 * 1000) continue;
        try { await recheckOrder(order); } catch (err) { console.error("auto recheck", order.id, err.message); }
      }
    } finally {
      rechecking = false;
    }
  }

  function verifySig(body, given, secret) {
    const expect = crypto.createHmac("sha512", secret).update(JSON.stringify(sortForIpn(body))).digest("hex");
    const a = Buffer.from(String(given || "").toLowerCase());
    const b = Buffer.from(expect);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  // IPN callback. Signature is required, then the payment is re-fetched from the
  // NOWPayments API with our key; only that response can settle an order.
  async function handle(req, res, url) {
    const method = req.method;
    const route = url.pathname;
    if (method === "POST" && (route === "/api/payments/nowpayments" || route === "/api/pay/nowpayments")) {
      let body;
      try {
        body = await readBody(req);
      } catch {
        return send(res, 400, { error: "bad_request" });
      }
      const secret = process.env.NOWPAYMENTS_IPN_SECRET;
      if (!secret) return send(res, 503, { error: "ipn_secret_missing" });
      if (!body || typeof body !== "object" || !verifySig(body, req.headers["x-nowpayments-sig"], secret)) {
        alert("webhook_bad_signature", "NOWPayments IPN with bad/missing signature for order " + String((body && body.order_id) || "?").slice(0, 40) + " from " + String(req.headers["cf-connecting-ip"] || (req.socket && req.socket.remoteAddress) || "?"), { key: "ipn" });
        return send(res, 401, { error: "bad_signature" });
      }
      const orderId = String(body.order_id || "");
      const pid = String(body.payment_id || "");
      const order = (store.orders || []).find((o) => o.id === orderId && o.paymentMethod === "crypto");
      if (!order) return send(res, 200, { ok: true, matched: false });
      // Only the payment we created for this order (re-deposits carry parent_payment_id and are flagged).
      if (order.payment && order.payment.paymentId && String(order.payment.paymentId) !== pid && String(order.payment.paymentId) !== String(body.parent_payment_id || "")) {
        return send(res, 200, { ok: true, matched: false });
      }
      try {
        const data = await fetchNowPayment(pid);
        const result = applyPaymentStatus(order, String(data.payment_status || ""), data);
        return send(res, 200, { ok: true, status: result.status, skipped: result.skipped || null });
      } catch (err) {
        console.error("ipn recheck failed", orderId, err.message);
        // Non-200 makes NOWPayments retry (recurrent notifications); the poller also covers it.
        return send(res, 502, { error: "recheck_failed" });
      }
    }
    return null;
  }

  // Expose for checkout flow and scheduled recheck
  handle.createNowPayment = createNowPayment;
  handle.createNowPaymentDirect = createNowPaymentDirect;
  handle.applyPaymentStatus = applyPaymentStatus;
  handle.fetchNowPayment = fetchNowPayment;
  handle.recheckOrder = recheckOrder;
  handle.recheckPendingCrypto = recheckPendingCrypto;
  handle.verifySig = verifySig;
  return handle;
}

module.exports = { createPayments };
