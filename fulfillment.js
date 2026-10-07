// Helix King Labs — fulfillment module: post-delivery email helpers, reorder,
// lot intake, COA upload. Factory pattern: createFulfillment({deps}) -> handler.
const fs = require("fs");
const path = require("path");

function createFulfillment(deps) {
  const {
    products, store, saveStore, send, readBody, isOpsUser, findProduct,
    attachCertificates, writeInventoryCsv, writePricingCsv, audit,
    PUBLIC, DATA, SHOP_HIDDEN_FAMILIES, affiliateOf, stockStatus, STOCK_THRESHOLD,
    getPublicOrigin, getRequestOrigin, getEmailListHandle,
  } = deps;

  function shopVisibleOf(p) {
    if (!p) return false;
    if (p.shopVisible === false) return false;
    const fam = p.family || p.id;
    if (SHOP_HIDDEN_FAMILIES.has(fam)) return false;
    return true;
  }

  // Pick in-stock, visible products not in this order. Prefer same category.
  function suggestFor(order, count) {
    const n = count || 3;
    const orderedSkus = new Set(((order.quote || {}).lines || []).map((l) => l.sku));
    const orderedFamilies = new Set();
    for (const sku of orderedSkus) {
      const p = findProduct(sku);
      if (p) orderedFamilies.add(p.family || p.id);
    }
    const fams = (products.families || []).filter(
      (f) => f.shopVisible !== false && !SHOP_HIDDEN_FAMILIES.has(f.id) && !orderedFamilies.has(f.id)
    );
    const orderedCats = new Set();
    for (const fid of orderedFamilies) {
      const f = (products.families || []).find((x) => x.id === fid);
      if (f && f.category) orderedCats.add(f.category);
    }
    const scored = fams
      .map((f) => {
        const variants = (f.variantIds || []).map(findProduct).filter((p) => p && (p.available || 0) > 0 && shopVisibleOf(p));
        if (!variants.length) return null;
        const low = Math.min(...variants.map((p) => Number(p.price || 0)).filter((x) => x > 0));
        return { f, low: low === Infinity ? null : low, sameCat: orderedCats.has(f.category), featured: !!f.featured };
      })
      .filter(Boolean)
      .sort((a, b) => (b.sameCat - a.sameCat) || (b.featured - a.featured) || (a.low - b.low));
    const origin = getPublicOrigin();
    return scored.slice(0, n).map((s) => ({
      name: s.f.name,
      price: s.low,
      url: origin + "/product/" + (s.f.slug || s.f.id),
    }));
  }

  // Delivered-email body: thank-you + order summary + affiliate invite + suggestions.
  function deliveredText(order) {
    const q = order.quote || {};
    const total = "$" + Number(q.total || 0).toFixed(2);
    const lines = ((q.lines || []).map((l) => `${l.name || ""} ${l.size || ""} × ${l.qty}`).join("\n")) || "See the desk for lines.";
    const origin = getPublicOrigin();
    let text = `${order.id} is delivered. Thank you for ordering with Helix King Labs.\n\nYour order:\n${lines}\nTotal ${total}\n\nWe hope the research goes well.`;
    const alreadyAff = order.userId && affiliateOf(order.userId);
    if (!alreadyAff) {
      text += `\n\n—\nShare Helix King Labs and earn.\nGive friends 10% off their first order with your code. You earn 10% on every order they place.\nApply in one minute (account + prior order required):\n${origin}/affiliates`;
    }
    const suggestions = suggestFor(order, 3);
    if (suggestions.length) {
      text += `\n\n—\nPairs well with your order:\n` + suggestions.map((s) => `- ${s.name}${s.price ? " — from $" + s.price : ""} — ${s.url}`).join("\n");
    }
    text += `\n\nReorder in one tap from your account:\n${origin}/account\n\nResearch use only. Not a clinic. Not a pharmacy.`;
    return text;
  }

  async function handle(req, res, url, user) {
    const method = req.method;
    const route = url.pathname;

    if (method === "POST" && route === "/api/orders/reorder") {
      if (!user) return send(res, 401, { error: "account_required" });
      let body;
      try {
        body = await readBody(req);
      } catch {
        return send(res, 400, { error: "bad_request" });
      }
      const order = (store.orders || []).find((o) => o.id === body.id && o.userId === user.id);
      if (!order) return send(res, 404, { error: "not_found" });
      if (order.status === "voided") return send(res, 400, { error: "order_voided" });
      const lines = [];
      for (const l of (order.quote || {}).lines || []) {
        const p = findProduct(l.id || l.sku);
        if (!p) continue;
        const available = Math.max(0, Number(p.available || 0));
        lines.push({ id: p.id, sku: p.sku, name: p.name, size: p.size, qty: l.qty, available, inStock: available > 0 });
      }
      audit(user.id, "reorder", order.id + " -> " + lines.length + " lines");
      return send(res, 200, { ok: true, lines }) || true;
    }

    if (method === "POST" && route === "/api/ops/intake") {
      // One-save lot intake: stock + lot + price + cost, waitlist check, live status.
      if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
      let body;
      try {
        body = await readBody(req);
      } catch {
        return send(res, 400, { error: "bad_request" });
      }
      const item = findProduct(body.sku);
      if (!item) return send(res, 404, { error: "not_found" });
      const wasAvailable = Math.max(0, Number(item.stock || 0) - Number(item.reserved || 0));
      if (body.on_hand !== undefined && body.on_hand !== "") {
        const n = Number(body.on_hand);
        if (!Number.isFinite(n) || n < 0) return send(res, 400, { error: "on_hand" });
        item.stock = n;
      }
      if (typeof body.lot === "string" && body.lot.trim()) item.lot = body.lot.trim().slice(0, 40);
      if (body.unit_cost !== undefined && body.unit_cost !== "") {
        const n = Number(body.unit_cost);
        if (Number.isFinite(n) && n >= 0) item.cost = n;
      }
      if (body.price !== undefined && body.price !== "") {
        const n = Number(body.price);
        if (Number.isFinite(n) && n > 0) item.price = Math.round(n * 100) / 100;
      }
      if (Number(item.stock || 0) > 0) item.everStocked = true;
      item.available = Math.max(0, Number(item.stock || 0) - Number(item.reserved || 0));
      attachCertificates();
      item.stockStatus = stockStatus(item.available, item.stockThreshold || STOCK_THRESHOLD);
      writeInventoryCsv();
      writePricingCsv();
      fs.writeFileSync(path.join(DATA, "products.json"), JSON.stringify(products, null, 2));
      audit(user, "intake", `${item.sku} lot=${item.lot || "-"} stock=${item.stock} price=${item.price}`);
      saveStore(store);
      let waitlistNotified = 0;
      const elh = getEmailListHandle();
      if (wasAvailable <= 0 && item.available > 0 && elh && typeof elh.checkWaitlist === "function") {
        waitlistNotified = elh.checkWaitlist(item.sku, item.name + " " + (item.size || ""), getRequestOrigin(req)) || 0;
      }
      const isLive = shopVisibleOf(item) && item.available > 0 && item.releaseState !== "pending_testing";
      return send(res, 200, { ok: true, sku: item.sku, available: item.available, live: isLive, waitlistNotified }) || true;
    }

    if (method === "POST" && route === "/api/ops/coa/upload") {
      if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
      let body;
      try {
        body = await readBody(req, 12_000_000);
      } catch {
        return send(res, 400, { error: "bad_request" });
      }
      const item = findProduct(body.sku);
      if (!item) return send(res, 404, { error: "not_found" });
      const lot = String(body.lot || item.lot || "lot").trim().slice(0, 40) || "lot";
      const m = String(body.coaData || "").match(/^data:([^;]+);base64,(.+)$/);
      if (!m) return send(res, 400, { error: "coa_data" });
      const buf = Buffer.from(m[2], "base64");
      if (!buf.length || buf.length > 8_000_000) return send(res, 400, { error: "coa_size" });
      const safe = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "file";
      const ext = /pdf/i.test(m[1]) ? "pdf" : "jpg";
      const filename = safe(item.sku) + "-" + safe(lot) + "." + ext;
      const dir = path.join(PUBLIC, "docs");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename), buf);
      item.certificateFile = "/docs/" + filename;
      item.certificateStatus = "accepted";
      if (lot !== "lot") item.lot = lot;
      attachCertificates();
      saveStore(store);
      fs.writeFileSync(path.join(DATA, "products.json"), JSON.stringify(products, null, 2));
      audit(user, "coa", "uploaded " + filename + " for " + item.sku);
      const isLive = shopVisibleOf(item) && (item.available || 0) > 0 && item.releaseState !== "pending_testing";
      return send(res, 200, { ok: true, file: item.certificateFile, live: isLive }) || true;
    }

    return false;
  }

  handle.suggestFor = suggestFor;
  handle.deliveredText = deliveredText;
  return handle;
}

module.exports = createFulfillment;
