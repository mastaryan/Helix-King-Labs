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

  // ---- Multi-lot inventory ----
  // item.lots: [{lot, qtyReceived, unitCost, certificate, certificateFile, receivedAt}]
  // item.stock stays the single sellable pool (the order flow decrements it directly).
  // currentLots() allocates stock across lots oldest-first (FIFO), so per-lot
  // on-hand, cost, and COA stay honest without touching the order flow.
  // Lot code convention: HKL- prefix (Helix King Labs). Idempotent rename of legacy HK- codes.
  function hklLot(code) {
    const s = String(code || "");
    return s.startsWith("HK-") ? "HKL-" + s.slice(3) : s;
  }

  function getLots(item) {
    if (!Array.isArray(item.lots)) {
      const legacy = [];
      if (item.lot || Number(item.stock || 0) > 0 || item.cost != null) {
        const received = Math.max(0, Number(item.stock || 0));
        legacy.push({
          lot: item.lot || "",
          qtyReceived: received,
          // Preserve the existing stock number exactly: legacy units are already in stock.
          qtyReleased: received,
          unitCost: item.cost != null ? Number(item.cost) : null,
          certificate: item.certificateStatus || "pending",
          certificateFile: item.certificateFile || "",
          receivedAt: new Date().toISOString(),
        });
      }
      item.lots = legacy;
    }
    // Backfill for lots created before qtyReleased existed.
    for (const l of item.lots) {
      if (l.qtyReleased == null) {
        l.qtyReleased = l.certificate === "accepted" ? Math.max(0, Number(l.qtyReceived || 0)) : 0;
      }
      // Rename legacy HK- lot codes to HKL- (idempotent).
      const renamed = hklLot(l.lot);
      if (renamed !== l.lot) l.lot = renamed;
    }
    if (item.lot) {
      const renamed = hklLot(item.lot);
      if (renamed !== item.lot) item.lot = renamed;
    }
    return item.lots;
  }

  function currentLots(item) {
    const lots = getLots(item)
      .slice()
      .sort((a, b) => String(a.receivedAt || "").localeCompare(String(b.receivedAt || "")));
    let remaining = Math.max(0, Number(item.stock || 0));
    // FIFO: oldest lot sells first, so remaining stock is assigned newest-first.
    // Cap by qtyReleased (sellable units), not qtyReceived — pending-COA units
    // are physically here but must not show as sellable on any lot.
    const alloc = new Array(lots.length).fill(0);
    for (let i = lots.length - 1; i >= 0; i--) {
      const take = Math.min(remaining, Math.max(0, Number(lots[i].qtyReleased != null ? lots[i].qtyReleased : lots[i].qtyReceived || 0)));
      alloc[i] = take;
      remaining -= take;
    }
    if (remaining > 0 && lots.length) alloc[lots.length - 1] += remaining;
    return lots.map((l, i) => ({ ...l, onHand: alloc[i], index: i }));
  }

  function blendedUnitCost(item) {
    const lots = currentLots(item).filter((l) => l.onHand > 0 && l.unitCost != null);
    const tot = lots.reduce((a, l) => a + l.onHand, 0);
    if (!tot) return null;
    return lots.reduce((a, l) => a + l.onHand * Number(l.unitCost), 0) / tot;
  }

  // Keep the legacy single-value fields coherent after lot changes.
  function syncLotDerived(item) {
    const lots = currentLots(item);
    const bc = blendedUnitCost(item);
    if (bc != null) item.cost = Math.round(bc * 100) / 100;
    const newest = lots.filter((l) => l.onHand > 0).pop() || lots[lots.length - 1];
    if (newest) {
      if (newest.lot) item.lot = newest.lot;
      if (newest.certificateFile) item.certificateFile = newest.certificateFile;
    }
    item.certificateStatus = lots.some((l) => l.onHand > 0 && l.certificate === "accepted")
      ? "accepted"
      : "pending";
  }

  function lotView(p) {
    const lots = currentLots(p);
    return {
      sku: p.sku,
      name: p.name,
      size: p.size,
      price: p.price,
      wholesalePrice: p.wholesalePrice != null ? Number(p.wholesalePrice) : null,
      rosyBoxCost: p.rosyBoxCost != null ? Number(p.rosyBoxCost) : null,
      stock: Math.max(0, Number(p.stock || 0)),
      blendedCost: blendedUnitCost(p),
      lots: lots.map((l, i) => ({
        index: i,
        lot: l.lot || "",
        qtyReceived: Number(l.qtyReceived || 0),
        onHand: l.onHand,
        unitCost: l.unitCost != null ? Number(l.unitCost) : null,
        certificate: l.certificate || "pending",
        certificateFile: l.certificateFile || "",
        receivedAt: l.receivedAt || "",
      })),
    };
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
      const lots = getLots(item);
      const lotCode = typeof body.lot === "string" ? body.lot.trim().slice(0, 40) : "";
      const qty = body.on_hand !== undefined && body.on_hand !== "" ? Number(body.on_hand) : 0;
      if (!Number.isFinite(qty) || qty < 0) return send(res, 400, { error: "on_hand" });
      // Receiving adds a lot (or tops up a matching lot) — it never overwrites history.
      // COA safety: units from a lot without an accepted certificate are NOT sellable,
      // so they are recorded on the lot but only added to stock once the COA is accepted.
      let lot = lotCode ? lots.find((l) => l.lot === lotCode) : null;
      if (!lot) {
        lot = {
          lot: lotCode,
          qtyReceived: 0,
          qtyReleased: 0,
          unitCost: null,
          certificate: "pending",
          certificateFile: "",
          receivedAt: new Date().toISOString(),
        };
        lots.push(lot);
      }
      lot.qtyReceived = Math.max(0, Number(lot.qtyReceived || 0) + qty);
      if (body.unit_cost !== undefined && body.unit_cost !== "") {
        const n = Number(body.unit_cost);
        if (Number.isFinite(n) && n >= 0) lot.unitCost = n;
      }
      if (lot.certificate === "accepted") {
        item.stock = Math.max(0, Number(item.stock || 0) + qty);
        lot.qtyReleased = Math.max(0, Number(lot.qtyReleased || 0) + qty);
      }
      if (body.price !== undefined && body.price !== "") {
        const n = Number(body.price);
        if (Number.isFinite(n) && n > 0) item.price = Math.round(n * 100) / 100;
      }
      if (Number(item.stock || 0) > 0) item.everStocked = true;
      item.available = Math.max(0, Number(item.stock || 0) - Number(item.reserved || 0));
      syncLotDerived(item);
      // COA safety: restocked item without accepted COA stays hidden.
      const coaMissing = item.certificateStatus !== "accepted";
      if (coaMissing && item.available > 0) item.shopVisible = false;
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
      return send(res, 200, { ok: true, sku: item.sku, available: item.available, live: isLive, waitlistNotified, coaRequired: coaMissing }) || true;
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
      // Attach to the matching lot (or the newest); the SKU-level fields follow it.
      const lots = getLots(item);
      let lotRec = lots.find((l) => l.lot === lot) || lots[lots.length - 1];
      if (!lotRec) {
        lotRec = { lot, qtyReceived: 0, qtyReleased: 0, unitCost: null, certificate: "pending", certificateFile: "", receivedAt: new Date().toISOString() };
        lots.push(lotRec);
      }
      lotRec.certificate = "accepted";
      lotRec.certificateFile = "/docs/" + filename;
      // COA safety release: units received while this lot was pending become sellable now.
      const unreleased = Math.max(0, Number(lotRec.qtyReceived || 0) - Number(lotRec.qtyReleased || 0));
      if (unreleased > 0) {
        item.stock = Math.max(0, Number(item.stock || 0)) + unreleased;
        lotRec.qtyReleased = Math.max(0, Number(lotRec.qtyReleased || 0)) + unreleased;
        item.available = Math.max(0, Number(item.stock || 0) - Number(item.reserved || 0));
        if (Number(item.stock || 0) > 0) item.everStocked = true;
      }
      syncLotDerived(item);
      if (item.shopVisible === false && (item.available || 0) > 0) item.shopVisible = true;
      attachCertificates();
      saveStore(store);
      fs.writeFileSync(path.join(DATA, "products.json"), JSON.stringify(products, null, 2));
      audit(user, "coa", "uploaded " + filename + " for " + item.sku);
      // Newly released stock can satisfy the back-in-stock waitlist.
      let waitlistNotified = 0;
      const elh = getEmailListHandle();
      if (unreleased > 0 && elh && typeof elh.checkWaitlist === "function") {
        try { waitlistNotified = elh.checkWaitlist(item.sku, item.name + " " + (item.size || ""), getRequestOrigin(req)) || 0; } catch {}
      }
      const isLive = shopVisibleOf(item) && (item.available || 0) > 0 && item.releaseState !== "pending_testing";
      return send(res, 200, { ok: true, file: item.certificateFile, live: isLive, waitlistNotified }) || true;
    }

    // Ops order list (also feeds the order detail page).
    if (method === "GET" && route === "/api/ops/orders") {
      if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
      return send(res, 200, { orders: (store.orders || []).slice().reverse() }) || true;
    }

    if (method === "GET" && route === "/api/ops/lots") {
      if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
      const skuFilter = String((url.searchParams && url.searchParams.get("sku")) || "").toUpperCase().trim();
      const items = products.items.filter((p) => !skuFilter || String(p.sku || "").toUpperCase() === skuFilter);
      return send(res, 200, { lots: items.map((p) => lotView(p)) }) || true;
    }

    if (method === "POST" && route === "/api/ops/lots/save") {
      // Update one lot row (lot code, on-hand, unit cost, certificate).
      // On-hand edits adjust the lot's received qty and the SKU pool by the delta.
      if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
      let body;
      try {
        body = await readBody(req);
      } catch {
        return send(res, 400, { error: "bad_request" });
      }
      const item = findProduct(body.sku);
      if (!item) return send(res, 404, { error: "not_found" });
      const lots = getLots(item);
      const isNew = body.lotIndex === "new" || body.lotIndex === null || body.lotIndex === undefined;
      let lot = isNew ? null : lots[Number(body.lotIndex)];
      let idx = isNew ? -1 : Number(body.lotIndex);
      if (!lot) {
        if (!isNew) return send(res, 404, { error: "lot_not_found" });
        lot = {
          lot: "",
          qtyReceived: 0,
          unitCost: null,
          certificate: "pending",
          certificateFile: "",
          receivedAt: new Date().toISOString(),
        };
        lots.push(lot);
        idx = lots.length - 1;
      }
      if (typeof body.lot === "string") lot.lot = body.lot.trim().slice(0, 40);
      if (body.onHand !== undefined && body.onHand !== "") {
        const want = Number(body.onHand);
        if (!Number.isFinite(want) || want < 0) return send(res, 400, { error: "on_hand" });
        const cur = currentLots(item)[idx] ? currentLots(item)[idx].onHand : 0;
        const delta = want - cur;
        lot.qtyReceived = Math.max(0, Number(lot.qtyReceived || 0) + delta);
        item.stock = Math.max(0, Number(item.stock || 0) + delta);
      }
      if (body.unitCost !== undefined && body.unitCost !== "") {
        const n = Number(body.unitCost);
        if (!Number.isFinite(n) || n < 0) return send(res, 400, { error: "unit_cost" });
        lot.unitCost = n;
      }
      if (body.certificate === "accepted" || body.certificate === "pending") lot.certificate = body.certificate;
      if (Number(item.stock || 0) > 0) item.everStocked = true;
      item.available = Math.max(0, Number(item.stock || 0) - Number(item.reserved || 0));
      syncLotDerived(item);
      attachCertificates();
      item.stockStatus = stockStatus(item.available, item.stockThreshold || STOCK_THRESHOLD);
      writeInventoryCsv();
      writePricingCsv();
      fs.writeFileSync(path.join(DATA, "products.json"), JSON.stringify(products, null, 2));
      audit(user, "lot", `${item.sku} lot[${idx}]=${lot.lot || "-"} onHand=${body.onHand}`);
      saveStore(store);
      return send(res, 200, { ok: true, view: lotView(item) }) || true;
    }

    // Customer uploads proof of a manual payment (Venmo / Cash App / manual crypto).
    // NOTE: path is /api/proof/:id (not /api/orders/:id/proof) because server.js
    // has a catch-all on POST /api/orders/* that runs before this module.
    if (method === "POST" && route.startsWith("/api/proof/")) {
      if (!user) return send(res, 401, { error: "account_required" });
      const orderId = route.split("/")[3] || "";
      const order = (store.orders || []).find((o) => o.id === orderId && o.userId === user.id);
      if (!order) return send(res, 404, { error: "not_found" });
      if (order.status !== "awaiting_settlement") return send(res, 400, { error: "not_awaiting_payment" });
      let body;
      try {
        body = await readBody(req, 12_000_000);
      } catch {
        return send(res, 400, { error: "bad_request" });
      }
      const m = String(body.imageData || "").match(/^data:(image\/(jpeg|png|webp));base64,(.+)$/);
      if (!m) return send(res, 400, { error: "image_data" });
      const buf = Buffer.from(m[3], "base64");
      if (!buf.length || buf.length > 8_000_000) return send(res, 400, { error: "image_size" });
      const dir = path.join(DATA, "proofs");
      fs.mkdirSync(dir, { recursive: true });
      const safeId = String(order.id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "order";
      const ext = m[2] === "png" ? "png" : m[2] === "webp" ? "webp" : "jpg";
      for (const e of ["jpg", "png", "webp"]) {
        const fp = path.join(dir, safeId + "." + e);
        if (e !== ext && fs.existsSync(fp)) fs.unlinkSync(fp);
      }
      fs.writeFileSync(path.join(dir, safeId + "." + ext), buf);
      order.paymentProof = { ext, uploadedAt: new Date().toISOString() };
      order.events = order.events || [];
      order.events.push({ at: new Date().toISOString(), kind: "proof_uploaded", by: user.email });
      saveStore(store);
      return send(res, 200, { ok: true }) || true;
    }

    // Ops views a payment proof image.
    if (method === "GET" && route.startsWith("/api/ops/proofs/")) {
      if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
      const orderId = decodeURIComponent(route.split("/")[4] || "");
      const order = (store.orders || []).find((o) => o.id === orderId);
      const ext = order && order.paymentProof && order.paymentProof.ext;
      if (!ext) return send(res, 404, { error: "not_found" });
      const fp = path.join(DATA, "proofs", String(orderId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) + "." + ext);
      if (!fs.existsSync(fp)) return send(res, 404, { error: "not_found" });
      const data = fs.readFileSync(fp);
      res.writeHead(200, {
        "Content-Type": "image/" + (ext === "jpg" ? "jpeg" : ext),
        "Cache-Control": "private, no-store",
      });
      res.end(data);
      return true;
    }

    return false;
  }

  handle.suggestFor = suggestFor;
  handle.deliveredText = deliveredText;
  return handle;
}

module.exports = createFulfillment;
