// Wholesale: request/approve flow, gated pricing, order windows, minimums.
function createWholesale(deps) {
  const { store, saveStore, send, readBody, isOpsUser, products } = deps;
  function getRequests() {
    if (!Array.isArray(store.wholesaleRequests)) store.wholesaleRequests = [];
    return store.wholesaleRequests;
  }
  function getConfig() {
    if (!store.wholesaleConfig) {
      store.wholesaleConfig = { windowStart: null, windowEnd: null, orderMinimum: 500, announce: "" };
    }
    return store.wholesaleConfig;
  }
  function isWholesale(user) {
    return !!(user && (user.wholesale === true || user.role === "wholesale"));
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
        minQty: p.wholesaleMin != null ? p.wholesaleMin : 10,
        shopVisible: p.shopVisible !== false,
      }));
      return send(res, 200, {
        ok: true,
        window: { start: cfg.windowStart, end: cfg.windowEnd, orderMinimum: cfg.orderMinimum, announce: cfg.announce },
        items,
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
      // Validate minimums
      const items = products.items || [];
      let total = 0;
      const validated = [];
      for (const l of lines) {
        const p = items.find((x) => x.sku === l.sku);
        if (!p) return send(res, 400, { error: "bad_sku", sku: l.sku });
        const qty = Math.max(0, Math.floor(Number(l.qty) || 0));
        const minQty = p.wholesaleMin != null ? p.wholesaleMin : 10;
        if (qty > 0 && qty < minQty) return send(res, 400, { error: "below_minimum", sku: l.sku, min: minQty });
        if (qty <= 0) continue;
        const price = p.wholesalePrice != null ? p.wholesalePrice : Math.round((p.price || 0) * 0.6 * 100) / 100;
        total += price * qty;
        validated.push({ sku: p.sku, name: p.name, size: p.size, qty, price, line: Math.round(price * qty * 100) / 100 });
      }
      if (!validated.length) return send(res, 400, { error: "empty_order" });
      if (total < (cfg.orderMinimum || 0)) {
        return send(res, 400, { error: "below_order_minimum", minimum: cfg.orderMinimum, total: Math.round(total * 100) / 100 });
      }
      // Create order (reuse store.orders)
      const order = {
        id: "WS-" + Date.now().toString(36).toUpperCase(),
        userId: user.id,
        email: user.email,
        wholesale: true,
        lines: validated,
        total: Math.round(total * 100) / 100,
        status: "awaiting_settlement",
        paymentMethod: body.paymentMethod || "crypto",
        at: now,
      };
      if (!Array.isArray(store.orders)) store.orders = [];
      store.orders.push(order);
      saveStore(store);
      return send(res, 200, { ok: true, order: { id: order.id, total: order.total } });
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
      const p = (products.items || []).find((x) => x.sku === body.sku);
      if (!p) return send(res, 404, { error: "not_found" });
      if ("wholesalePrice" in body) p.wholesalePrice = body.wholesalePrice === null ? null : Math.max(0, Number(body.wholesalePrice) || 0);
      if ("wholesaleMin" in body) p.wholesaleMin = body.wholesaleMin === null ? null : Math.max(1, Math.floor(Number(body.wholesaleMin) || 10));
      if (deps.saveProducts) deps.saveProducts();
      return send(res, 200, { ok: true });
    }

    return null;
  }

  return { handle, isWholesale };
}

module.exports = { createWholesale };
