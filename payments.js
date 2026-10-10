// Helix King Labs — NOWPayments integration.
// Factory pattern: createPayments({deps}) -> handler.
// Handles the IPN callback, invoice creation, status updates, and the recheck poller.
const crypto = require("crypto");
const https = require("https");

function createPayments(deps) {
  const { store, saveStore, send, readBody, queueMail, orderMail, audit, getPublicOrigin } = deps;

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
                  priceAmount: data.price_amount,
                  priceCurrency: "USD",
                  network: network === "solana" ? "Solana" : "Ethereum",
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

  function applyPaymentStatus(order, status, body) {
    body = body || {};
    order.payment = Object.assign({}, order.payment, {
      provider: "nowpayments",
      paymentId: body.payment_id || body.invoice_id || (order.payment && order.payment.paymentId) || null,
      invoiceId: body.invoice_id || (order.payment && order.payment.invoiceId) || null,
      paymentStatus: status,
      status: status || (order.payment && order.payment.status) || "",
      payCurrency: body.pay_currency || (order.payment && order.payment.payCurrency) || null,
      actuallyPaid: body.actually_paid != null ? body.actually_paid : order.payment && order.payment.actuallyPaid,
      expectedAmount: body.price_amount != null ? body.price_amount : order.payment && order.payment.expectedAmount,
    });
    if (order.status === "voided") return { ok: true, skipped: "voided", status: order.status };
    // Only "finished" means the funds are actually in the merchant wallet.
    // "confirmed" = blockchain confirmed but not yet delivered — do NOT mark paid.
    // Never auto-fulfill re-deposits or wrong-asset deposits (parent_payment_id set).
    if (body.parent_payment_id) {
      saveStore(store);
      return { ok: true, status: order.status, skipped: "redeposit" };
    }
    const paid = status === "finished";
    const partial = status === "partially_paid";

    if (partial && !paid) {
      const p = order.payment;
      p.underpaidAt = p.underpaidAt || new Date().toISOString();
      p.shortBy = Math.max(0, (p.expectedAmount || order.quote.total) - (Number(body.actually_paid) || 0));
      saveStore(store);
      return { ok: true, status: order.status, partial: true };
    }

    if (paid && order.status !== "paid" && order.status !== "shipped") {
      order.status = "paid";
      order.fulfillment = "ready";
      order.settledAt = new Date().toISOString();
      order.events = order.events || [];
      order.events.push({ at: new Date().toISOString(), kind: "paid", by: "nowpayments" });
      queueMail(orderMail(order, "paid"));
    }
    saveStore(store);
    return { ok: true, status: order.status };
  }

  function fetchNowPayment(paymentId) {
    const key = process.env.NOWPAYMENTS_API_KEY;
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
            try { resolve(JSON.parse(raw)); } catch (err) { reject(err); }
          });
        }
      );
      req.on("error", reject);
      req.end();
    });
  }

  let rechecking = false;
  async function recheckPendingCrypto() {
    if (rechecking || !process.env.NOWPAYMENTS_API_KEY) return;
    rechecking = true;
    try {
      const now = Date.now();
      for (const order of store.orders || []) {
        if (order.status !== "not_paid" || order.paymentMethod !== "crypto") continue;
        const pid = order.payment && order.payment.paymentId;
        if (!pid) continue;
        const age = now - new Date(order.created || 0).getTime();
        if (!Number.isFinite(age) || age > 25 * 60 * 60 * 1000) continue;
        try {
          const data = await fetchNowPayment(pid);
          const status = String(data.payment_status || "");
          const known = order.payment && order.payment.paymentStatus;
          if (status && status !== known) applyPaymentStatus(order, status, data);
        } catch (err) {
          console.error("auto recheck", order.id, err.message);
        }
      }
    } finally {
      rechecking = false;
    }
  }

  // IPN callback route handler
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
      const given = String(req.headers["x-nowpayments-sig"] || "");
      const sorted = sortForIpn(body);
      const expect = crypto.createHmac("sha512", secret).update(JSON.stringify(sorted)).digest("hex");
      const a = Buffer.from(given);
      const b = Buffer.from(expect);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return send(res, 401, { error: "bad_signature" });
      let order = null;
      for (const id of [String(body.order_id || ""), String(body.invoice_id || ""), String(body.payment_id || "")].filter(Boolean)) {
        order = (store.orders || []).find((o) => o.id === id || (o.payment && (o.payment.invoiceId === id || o.payment.paymentId === id)));
        if (order) break;
      }
      if (!order) return send(res, 200, { ok: true, matched: false });
      const invId = String(body.invoice_id || "");
      if (invId && order.payment && !order.payment.invoiceId) order.payment.invoiceId = invId;
      const result = applyPaymentStatus(order, String(body.payment_status || ""), body);
      return send(res, 200, { ok: true, status: result.status, skipped: result.skipped || null });
    }
    return null;
  }

  // Expose for checkout flow and scheduled recheck
  handle.createNowPayment = createNowPayment;
  handle.createNowPaymentDirect = createNowPaymentDirect;
  handle.applyPaymentStatus = applyPaymentStatus;
  handle.recheckPendingCrypto = recheckPendingCrypto;
  return handle;
}

module.exports = { createPayments };
