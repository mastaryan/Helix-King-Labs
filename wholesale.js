// Wholesale: request/approve flow, gated pricing, order windows, minimums.
function createWholesale(deps) {
  const { store, saveStore, send, readBody, isOpsUser, products, getPayments, verifyCaptcha, loadOutbox, saveOutbox, queueMail } = deps;
  // Blocked email TLDs (Ryan 2026-10-10): all African nations, Middle East, Russia.
  // Checked against the domain's TLD so subdomains (mail.example.ng) are caught too.
  const BLOCKED_TLDS = new Set([
    // Africa
    "dz","ao","bj","bw","bf","bi","cm","cv","cf","td","km","cg","cd","dj","eg","gq",
    "er","et","ga","gm","gh","gn","gw","ci","ke","ls","lr","ly","mg","mw","ml","mr",
    "mu","ma","mz","na","ne","ng","rw","st","sn","sc","sl","so","za","ss","sd","sz",
    "tz","tg","tn","ug","zm","zw",
    // Middle East
    "sa","ae","qa","kw","bh","om","ye","iq","ir","sy","jo","lb","il","ps","tr","cy",
    // Russia
    "ru","su","xn--p1ai",
  ]);
  function emailTldBlocked(email) {
    const domain = String(email || "").split("@")[1] || "";
    const tld = domain.split(".").pop().toLowerCase();
    return BLOCKED_TLDS.has(tld);
  }
  // SKUs excluded from wholesale (non-peptide / topical / CBD lines) — Ryan 2026-10-08
  const WHOLESALE_HIDDEN_SKUS = new Set(["ALK30","H7","FSS30","SEL10","SMX10","T25","LO25","JJ1","LC30","CRN30","SCBD","CBD30"]);
  // Wholesale payment rules (Ryan 2026-10-08): orders under $500 can use
  // Cash App, Venmo, or crypto. Orders $500+ are crypto only.
  const WHOLESALE_CASHAPP_LIMIT = 500;
  function getRequests() {
    if (!Array.isArray(store.wholesaleRequests)) store.wholesaleRequests = [];
    return store.wholesaleRequests;
  }
  function getConfig() {
    if (!store.wholesaleConfig) {
      store.wholesaleConfig = { windowStart: null, windowEnd: null, orderMinimum: 0, groupMinDefault: 5, groupTotalTarget: null, announce: "" };
    }
    const c = store.wholesaleConfig;
    if (c.groupMinDefault == null) c.groupMinDefault = 5;
    return c;
  }
  function isWholesale(user) {
    return !!(user && (user.wholesale === true || user.role === "wholesale" || isOpsUser(user)));
  }

  // Total committed qty per SKU across all wholesale orders in the current window
  function groupCommitments() {
    const cfg = getConfig();
    const totals = {};
    for (const o of (store.orders || [])) {
      if (!o.wholesale) continue;
      if (cfg.windowStart && o.at < cfg.windowStart) continue;
      if (cfg.windowEnd && o.at > cfg.windowEnd) continue;
      for (const l of (o.lines || [])) {
        totals[l.sku] = (totals[l.sku] || 0) + (l.qty || 0);
      }
    }
    return totals;
  }

  async function handle(req, res, url, user) {
    const route = url.pathname;
    const method = req.method;

    // Public: request wholesale access
    if (method === "POST" && route === "/api/wholesale/request") {
      const body = await readBody(req).catch(() => ({}));
      const name = String(body.name || "").trim().slice(0, 120);
      const email = String(body.email || "").trim().slice(0, 120).toLowerCase();
      const business = String(body.business || "").trim().slice(0, 120);
      const telegram = String(body.telegram || "").trim().slice(0, 80);
      const note = String(body.note || "").trim().slice(0, 500);
      if (!name || !email || !/^\S+@\S+\.\S+$/.test(email)) {
        return send(res, 400, { error: "name_email_required" });
      }
      if (verifyCaptcha && !verifyCaptcha(body)) {
        return send(res, 400, { error: "captcha", message: "Wrong answer — try again." });
      }
      // Block African, Middle Eastern, and Russian email domains (Ryan 2026-10-10).
      if (emailTldBlocked(email)) {
        return send(res, 400, { error: "domain_blocked", message: "We can't approve wholesale accounts from that email domain." });
      }
      const requests = getRequests();
      const existing = requests.find((r) => r.email === email);
      if (existing) {
        return send(res, 200, { ok: true, status: existing.status, duplicate: true });
      }
      requests.push({
        name, email, business: business || null, telegram: telegram || null,
        note: note || null, status: "pending", at: new Date().toISOString(),
      });
      saveStore(store);
      // Branded 48-hour confirmation email.
      try {
        const mail = {
          to: email,
          subject: "Wholesale request received — Helix King Labs",
          text: `Helix King Labs\n\nHi ${name},\n\nYour wholesale access request is in. We review every application by hand — expect a decision within 48 hours.\n\nWhat happens next:\n• We verify your business details\n• You'll get an approval email with wholesale pricing access\n• Questions? Reply to this email or reach us at wholesale@helixkinglabs.com\n\nThanks for your interest in Helix King Labs.\n\n— The Helix King Labs Team\nhelixkinglabs.com\n\nResearch use only.`,
          source: "wholesale-request-confirm",
          created: new Date().toISOString(),
          status: "queued",
        };
        if (queueMail) queueMail(mail);
        else if (loadOutbox && saveOutbox) { const box = loadOutbox(); box.messages.push(mail); saveOutbox(box); }
      } catch {}
      return send(res, 200, { ok: true, status: "pending" });
    }

    // Logged in: check my wholesale status
    if (method === "GET" && route === "/api/wholesale/status") {
      if (!user) return send(res, 200, { ok: true, wholesale: false, requested: false });
      const req2 = getRequests().find((r) => r.email === String(user.email || "").toLowerCase());
      return send(res, 200, {
        ok: true,
        wholesale: isWholesale(user),
        requested: !!req2,
        requestStatus: req2 ? req2.status : null,
      });
    }

    // Wholesale user: get wholesale catalog (prices + minimums + window)
    if (method === "GET" && route === "/api/wholesale/catalog") {
      if (!user || !isWholesale(user)) return send(res, 403, { error: "wholesale_only" });
      const cfg = getConfig();
      const items = (products.items || []).map((p) => ({
        sku: p.sku,
        name: p.name,
        size: p.size,
        family: p.family,
        image: p.image,
        stock: p.stock || 0,
        // Wholesale price: use wholesalePrice if set, else 60% of retail
        price: p.wholesalePrice != null ? p.wholesalePrice : Math.round((p.price || 0) * 0.6 * 100) / 100,
        // Group minimum: how many the GROUP must commit before this SKU is ordered
        groupMin: p.wholesaleGroupMin != null ? p.wholesaleGroupMin : null,
        wholesaleVisible: p.wholesaleVisible !== false && !WHOLESALE_HIDDEN_SKUS.has(p.sku),
      }));
      // Group commitments so far (this window)
      const committed = groupCommitments();
      return send(res, 200, {
        ok: true,
        window: { start: cfg.windowStart, end: cfg.windowEnd, orderMinimum: cfg.orderMinimum, groupMinDefault: cfg.groupMinDefault, groupTotalTarget: cfg.groupTotalTarget, announce: cfg.announce },
        items,
        committed,
      });
    }

    // Wholesale user: place wholesale order
    if (method === "POST" && route === "/api/wholesale/order") {
      if (!user || !isWholesale(user)) return send(res, 403, { error: "wholesale_only" });
      const cfg = getConfig();
      const now = new Date().toISOString();
      // Check window
      if (cfg.windowStart && now < cfg.windowStart) return send(res, 400, { error: "window_not_open" });
      if (cfg.windowEnd && now > cfg.windowEnd) return send(res, 400, { error: "window_closed" });
      const body = await readBody(req).catch(() => ({}));
      const lines = Array.isArray(body.lines) ? body.lines : [];
      if (!lines.length) return send(res, 400, { error: "empty_order" });
      // No per-person minimums — this is a group commit model.
      // Each line just needs qty >= 1. Group minimums are met collectively.
      const items = products.items || [];
      let total = 0;
      const validated = [];
      for (const l of lines) {
        const p = items.find((x) => x.sku === l.sku);
        if (!p) return send(res, 400, { error: "bad_sku", sku: l.sku });
        if (WHOLESALE_HIDDEN_SKUS.has(p.sku)) return send(res, 400, { error: "not_wholesale", sku: l.sku });
        const qty = Math.max(0, Math.floor(Number(l.qty) || 0));
        if (qty <= 0) continue;
        const price = p.wholesalePrice != null ? p.wholesalePrice : Math.round((p.price || 0) * 0.6 * 100) / 100;
        total += price * qty;
        validated.push({ sku: p.sku, name: p.name, size: p.size, qty, price, line: Math.round(price * qty * 100) / 100 });
      }
      if (!validated.length) return send(res, 400, { error: "empty_order" });
      // Optional per-person order minimum (0 = disabled)
      if ((cfg.orderMinimum || 0) > 0 && total < cfg.orderMinimum) {
        return send(res, 400, { error: "below_order_minimum", minimum: cfg.orderMinimum, total: Math.round(total * 100) / 100 });
      }
      // Payment method: cashapp/venmo only allowed under $500; $500+ is crypto only
      const paymentMethod = ["venmo", "cashapp", "crypto"].includes(body.paymentMethod) ? body.paymentMethod : "crypto";
      if (total >= WHOLESALE_CASHAPP_LIMIT && paymentMethod !== "crypto") {
        return send(res, 400, { error: "crypto_only_over_limit", limit: WHOLESALE_CASHAPP_LIMIT, total: Math.round(total * 100) / 100 });
      }
      // Create commitment (group buy style)
      const orderTotal = Math.round(total * 100) / 100;
      const order = {
        id: "HKL-WS-" + Date.now().toString(36).toUpperCase(),
        userId: user.id,
        email: user.email,
        wholesale: true,
        lines: validated,
        total: orderTotal,
        quote: {
          lines: validated,
          merchandise: orderTotal,
          shipping: 0,
          total: orderTotal,
        },
        status: "committed",
        paymentMethod,
        at: now,
        created: now,
      };
      if (paymentMethod === "venmo" || paymentMethod === "cashapp") {
        order.payment = {
          provider: paymentMethod,
          handle: paymentMethod === "venmo" ? "fibkingpeps" : "FibKingPep",
          status: "awaiting_confirmation",
          surcharge: 0,
          amount: order.total,
          note: order.id,
        };
      } else {
        // Crypto: create NOWPayments invoice immediately
        try {
          const payments = getPayments ? getPayments() : null;
          if (payments && payments.createNowPaymentDirect) {
            const inv = await payments.createNowPaymentDirect({ id: order.id, quote: { total: order.total } }, body.network);
            order.payment = inv;
            if (["payment_failed", "key_missing"].includes(inv.status)) {
              return send(res, 400, { error: "payment_unavailable", message: inv.message || "Crypto payment is not available right now." });
            }
          }
        } catch (err) {
          return send(res, 400, { error: "payment_unavailable", message: "Crypto payment is not available right now." });
        }
      }
      if (!Array.isArray(store.orders)) store.orders = [];
      store.orders.push(order);
      saveStore(store);
      const out = { id: order.id, total: order.total, paymentMethod };
      if (order.payment && order.payment.invoiceUrl) out.invoiceUrl = order.payment.invoiceUrl;
      if (order.payment && order.payment.handle) out.paymentHandle = order.payment.handle;
      // Crypto: pass the full deposit details so the frontend can render the deposit screen.
      if (paymentMethod === "crypto" && order.payment && order.payment.payAddress) {
        out.deposit = {
          payAddress: order.payment.payAddress,
          payAmount: order.payment.payAmount,
          payCurrency: order.payment.payCurrency,
          network: order.payment.network,
          expiresAt: order.payment.expiresAt || null,
          paymentId: order.payment.paymentId || null,
        };
      }
      return send(res, 200, { ok: true, order: out });
    }

    // Ops: list wholesale requests
    if (method === "GET" && route === "/api/ops/wholesale/requests") {
      if (!user || !isOpsUser(user)) return send(res, 403, { error: "forbidden" });
      return send(res, 200, { ok: true, requests: getRequests(), config: getConfig() });
    }

    // Ops: approve/deny a request (sets user wholesale flag)
    if (method === "POST" && route === "/api/ops/wholesale/review") {
      if (!user || !isOpsUser(user)) return send(res, 403, { error: "forbidden" });
      const body = await readBody(req).catch(() => ({}));
      const email = String(body.email || "").toLowerCase();
      const approve = body.approve === true;
      const req3 = getRequests().find((r) => r.email === email);
      if (!req3) return send(res, 404, { error: "not_found" });
      req3.status = approve ? "approved" : "denied";
      req3.reviewedAt = new Date().toISOString();
      // Flip the user's wholesale flag
      if (approve && Array.isArray(store.users)) {
        const u = store.users.find((x) => String(x.email || "").toLowerCase() === email);
        if (u) u.wholesale = true;
      } else if (!approve && Array.isArray(store.users)) {
        const u = store.users.find((x) => String(x.email || "").toLowerCase() === email);
        if (u) u.wholesale = false;
      }
      saveStore(store);
      return send(res, 200, { ok: true, status: req3.status });
    }

    // Ops: toggle wholesale flag directly on a user
    if (method === "POST" && route === "/api/ops/wholesale/toggle") {
      if (!user || !isOpsUser(user)) return send(res, 403, { error: "forbidden" });
      const body = await readBody(req).catch(() => ({}));
      const email = String(body.email || "").toLowerCase();
      if (!email || !Array.isArray(store.users)) return send(res, 400, { error: "bad_request" });
      const u = store.users.find((x) => String(x.email || "").toLowerCase() === email);
      if (!u) return send(res, 404, { error: "user_not_found" });
      u.wholesale = body.wholesale === true;
      saveStore(store);
      return send(res, 200, { ok: true, wholesale: u.wholesale });
    }

    // Ops: update wholesale config (window, minimums)
    if (method === "POST" && route === "/api/ops/wholesale/config") {
      if (!user || !isOpsUser(user)) return send(res, 403, { error: "forbidden" });
      const body = await readBody(req).catch(() => ({}));
      const cfg = getConfig();
      if ("windowStart" in body) cfg.windowStart = body.windowStart || null;
      if ("windowEnd" in body) cfg.windowEnd = body.windowEnd || null;
      if ("orderMinimum" in body) cfg.orderMinimum = Math.max(0, Number(body.orderMinimum) || 0);
      if ("groupMinDefault" in body) cfg.groupMinDefault = Math.max(1, Math.floor(Number(body.groupMinDefault) || 5));
      if ("groupTotalTarget" in body) cfg.groupTotalTarget = body.groupTotalTarget === null || body.groupTotalTarget === "" ? null : Math.max(1, Math.floor(Number(body.groupTotalTarget) || 0)) || null;
      if ("announce" in body) cfg.announce = String(body.announce || "").slice(0, 500);
      saveStore(store);
      return send(res, 200, { ok: true, config: cfg });
    }

    // Ops: list products with wholesale fields
    if (method === "GET" && route === "/api/ops/wholesale/products") {
      if (!user || !isOpsUser(user)) return send(res, 403, { error: "forbidden" });
      return send(res, 200, { ok: true, items: products.items || [] });
    }

    // Ops: set per-SKU wholesale price/minimum
    if (method === "POST" && route === "/api/ops/wholesale/pricing") {
      if (!user || !isOpsUser(user)) return send(res, 403, { error: "forbidden" });
      const body = await readBody(req).catch(() => ({}));
      if (!body.sku) return send(res, 400, { error: "sku_required" });
      const items = (products && products.items) || [];
      const p = items.find((x) => x.sku === body.sku);
      if (!p) return send(res, 404, { error: "not_found", sku: body.sku });
      if ("wholesalePrice" in body) p.wholesalePrice = body.wholesalePrice === null ? null : Math.max(0, Number(body.wholesalePrice) || 0);
      if ("rosyBoxCost" in body && body.rosyBoxCost !== "" && body.rosyBoxCost != null) {
        const rc = Number(body.rosyBoxCost);
        if (Number.isFinite(rc) && rc >= 0) p.rosyBoxCost = Math.round(rc * 100) / 100;
      }
      // First wholesale price set bootstraps the Rosy box cost (model: wholesale = Rosy + $10).
      if (p.rosyBoxCost == null && p.wholesalePrice != null) {
        p.rosyBoxCost = Math.round((Number(p.wholesalePrice) - 10) * 100) / 100;
      }
      if ("wholesaleGroupMin" in body) p.wholesaleGroupMin = body.wholesaleGroupMin === null ? null : Math.max(1, Math.floor(Number(body.wholesaleGroupMin) || 5));
      if ("wholesaleVisible" in body) p.wholesaleVisible = body.wholesaleVisible === true;
      try {
        if (deps.saveProducts) deps.saveProducts();
      } catch (e) {
        console.error("saveProducts failed:", e.message);
      }
      return send(res, 200, { ok: true });
    }

    return null;
  }

  return handle;
}

module.exports = { createWholesale };
