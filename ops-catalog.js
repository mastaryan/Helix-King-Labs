"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function b32encode(buf) {
  let bits = "";
  for (const byte of buf) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5) {
    out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  }
  return out;
}

function b32decode(str) {
  const clean = String(str || "").toUpperCase().replace(/=+$/g, "").replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) continue;
    bits += i.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totpAt(secret, when) {
  const counter = Math.floor(when / 30000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac("sha1", b32decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return String(code).padStart(6, "0");
}

function totpOk(secret, code) {
  const want = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(want)) return false;
  const now = Date.now();
  return [-1, 0, 1].some((w) => totpAt(secret, now + w * 30000) === want);
}

function slugFile(sku) {
  return String(sku || "vial").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "vial";
}

module.exports = function createOpsCatalog(ctx) {
  const { products, store, saveStore, send, readBody, isOpsUser, findProduct, writeInventoryCsv, writePricingCsv, attachCertificates, audit, PUBLIC, DATA, QRCode, sessionOf } = ctx;

  function persist() {
    attachCertificates();
    writeInventoryCsv();
    writePricingCsv();
    fs.writeFileSync(path.join(DATA, "products.json"), JSON.stringify(products, null, 2));
    saveStore(store);
  }

  function row(it) {
    return {
      sku: it.sku,
      id: it.id,
      family: it.family,
      familySlug: it.familySlug,
      name: it.name,
      size: it.size,
      price: it.price,
      kitPrice: it.kitPrice,
      cost: it.cost,
      lot: it.lot,
      stock: it.stock,
      purity: it.purity,
      form: it.form,
      shopVisible: it.shopVisible !== false,
      image: it.image,
      everStocked: !!it.everStocked,
      certificateFile: it.certificateFile || "",
      certificatePublic: !!it.certificatePublic,
      coa: it.coa || {},
    };
  }

  function applyFields(item, body) {
    const text = (key, n) => {
      if (typeof body[key] === "string") item[key] = body[key].trim().slice(0, n);
    };
    text("name", 80);
    text("size", 40);
    text("lot", 40);
    text("purity", 24);
    text("form", 80);
    if (body.price !== undefined && body.price !== "") item.price = Number(body.price);
    if (body.kitPrice !== undefined && body.kitPrice !== "") item.kitPrice = Number(body.kitPrice);
    if (body.cost !== undefined && body.cost !== "") item.cost = Number(body.cost);
    if (body.stock !== undefined && body.stock !== "") {
      const n = Number(body.stock);
      if (Number.isFinite(n) && n >= 0) item.stock = n;
    }
    if (body.shopVisible === false || body.shopVisible === "false") item.shopVisible = false;
    if (body.shopVisible === true || body.shopVisible === "true") item.shopVisible = true;
    if (Number(item.stock || 0) > 0) item.everStocked = true;
    item.available = Math.max(0, Number(item.stock || 0) - Number(item.reserved || 0));
    item.coa = item.coa || {};
    const coa = body.coa || {};
    ["lab", "reportId", "received", "reported", "purity", "net", "identity", "fentanyl", "appearance"].forEach((k) => {
      if (typeof coa[k] === "string") item.coa[k] = coa[k].trim().slice(0, 80);
    });
    if (item.coa.purity) item.purity = item.coa.purity;
  }

  function saveUpload(relDir, filename, dataUrl) {
    const m = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return "";
    const buf = Buffer.from(m[2], "base64");
    if (!buf.length || buf.length > 8_000_000) return "";
    const dir = path.join(PUBLIC, relDir);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, filename);
    fs.writeFileSync(file, buf);
    return "/" + relDir + "/" + filename;
  }

  return async function handle(req, res, url, user) {
    const method = req.method;
    const route = url.pathname;
    if (!route.startsWith("/api/ops/catalog") && !route.startsWith("/api/ops/security")) return false;
    if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" }) || true;

    const sess = sessionOf(req);
    const locked = !!(user.totpEnabled && sess && !sess.totpOk);

    if (method === "GET" && route === "/api/ops/security") {
      return send(res, 200, { totpEnabled: !!user.totpEnabled, totpOk: !!(sess && sess.totpOk) }) || true;
    }
    if (method === "POST" && route === "/api/ops/security/setup") {
      user.totpPending = b32encode(crypto.randomBytes(20));
      saveStore(store);
      const uri = `otpauth://totp/Helix%20King%20Labs:${encodeURIComponent(user.email)}?secret=${user.totpPending}&issuer=Helix%20King%20Labs`;
      const qr = await QRCode.toDataURL(uri, { margin: 1, width: 240, color: { dark: "#111111", light: "#ffffff" } });
      return send(res, 200, { secret: user.totpPending, qr, uri }) || true;
    }
    if (method === "POST" && route === "/api/ops/security/confirm") {
      let body;
      try { body = await readBody(req); } catch { return send(res, 400, { error: "bad_request" }) || true; }
      if (!user.totpPending || !totpOk(user.totpPending, body.code)) return send(res, 401, { error: "code" }) || true;
      user.totpSecret = user.totpPending;
      user.totpEnabled = true;
      delete user.totpPending;
      if (sess) sess.totpOk = true;
      saveStore(store);
      return send(res, 200, { ok: true }) || true;
    }
    if (method === "POST" && route === "/api/ops/security/verify") {
      let body;
      try { body = await readBody(req); } catch { return send(res, 400, { error: "bad_request" }) || true; }
      if (!user.totpSecret || !totpOk(user.totpSecret, body.code)) return send(res, 401, { error: "code" }) || true;
      if (sess) sess.totpOk = true;
      saveStore(store);
      return send(res, 200, { ok: true }) || true;
    }

    if (locked) return send(res, 401, { error: "totp_required" }) || true;

    if (method === "GET" && route === "/api/ops/catalog") {
      const families = (products.families || []).map((f) => ({ id: f.id, slug: f.slug, name: f.name }));
      return send(res, 200, { items: products.items.map(row), families }) || true;
    }

    if (method === "POST" && route === "/api/ops/catalog/save") {
      let body;
      try { body = await readBody(req, 12_000_000); } catch { return send(res, 400, { error: "bad_request" }) || true; }
      let item = findProduct(body.sku);
      if (!item && body.create) {
        const fam = (products.families || []).find((f) => f.id === body.family);
        if (!fam || !body.sku) return send(res, 400, { error: "family" }) || true;
        const sku = String(body.sku).trim().slice(0, 24);
        if (findProduct(sku)) return send(res, 409, { error: "exists" }) || true;
        item = {
          id: sku,
          sku,
          family: fam.id,
          familySlug: fam.slug,
          slug: fam.slug,
          name: fam.name,
          size: body.size || "",
          form: "Dried research material in a clear glass vial",
          category: fam.category || "compounds",
          purity: "",
          lot: "",
          image: fam.image || "",
          price: null,
          kitPrice: null,
          stock: 0,
          shopVisible: true,
          useClass: "research",
          specs: [["Use", "Research use only. Not for diagnostic or therapeutic use."]],
          coa: {},
        };
        products.items.push(item);
      }
      if (!item) return send(res, 404, { error: "not_found" }) || true;
      applyFields(item, body);
      if (body.imageData) {
        const rel = saveUpload("img", slugFile(item.sku) + ".jpg", body.imageData);
        if (rel) item.image = rel + "?v=" + Date.now();
      }
      if (body.coaData) {
        const ext = /pdf/i.test(body.coaData.slice(0, 40)) ? "pdf" : "jpg";
        const rel = saveUpload("docs", slugFile(item.sku) + "-" + slugFile(item.lot || "lot") + "." + ext, body.coaData);
        if (rel) item.certificateFile = rel;
      }
      if (body.clearCertificate) item.certificateFile = "";
      persist();
      audit(user, "catalog", item.sku);
      return send(res, 200, { ok: true, item: row(item) }) || true;
    }

    if (method === "POST" && route === "/api/ops/catalog/remove") {
      let body;
      try { body = await readBody(req); } catch { return send(res, 400, { error: "bad_request" }) || true; }
      const item = findProduct(body.sku);
      if (!item) return send(res, 404, { error: "not_found" }) || true;
      item.shopVisible = false;
      item.stock = 0;
      persist();
      audit(user, "catalog-hide", item.sku);
      return send(res, 200, { ok: true }) || true;
    }
    return false;
  };
};

module.exports.totpOk = totpOk;
