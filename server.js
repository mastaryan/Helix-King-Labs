"use strict";

/**
 * Helix King Labs — storefront shell API + static host.
 * Payments, processors, and supply are intentionally absent (playbook scope).
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DATA = path.join(ROOT, "data");
const STORE = path.join(ROOT, "data", "store.json");
const PORT = Number(process.env.PORT || 4173);
const SESSION_HOURS = 14 * 24;
const SECRET = process.env.HKL_SECRET || crypto.randomBytes(32).toString("hex");
const PUBLIC_ORIGIN = String(process.env.HKL_PUBLIC_ORIGIN || "").replace(/\/$/, "");
const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || "").trim();
const APPLE_CLIENT_ID = String(process.env.APPLE_CLIENT_ID || "").trim();
const APPLE_TEAM_ID = String(process.env.APPLE_TEAM_ID || "").trim();
const APPLE_KEY_ID = String(process.env.APPLE_KEY_ID || "").trim();
const APPLE_ENABLED = process.env.HKL_APPLE === "1" && !!APPLE_CLIENT_ID;
const AUTH_DEMO = !GOOGLE_CLIENT_ID && process.env.HKL_AUTH_DEMO !== "0";
const SECURE_COOKIES =
  process.env.HKL_SECURE_COOKIES === "1" ||
  String(PUBLIC_ORIGIN).startsWith("https://");

const jwksCache = { google: null, apple: null };

let products = JSON.parse(fs.readFileSync(path.join(DATA, "products.json"), "utf8"));
const certificates = JSON.parse(fs.readFileSync(path.join(DATA, "certificates.json"), "utf8"));
const copyDeck = JSON.parse(fs.readFileSync(path.join(DATA, "copy-deck.json"), "utf8"));
const PRICING_CSV = path.join(DATA, "catalog-pricing.csv");
const INVENTORY_CSV = path.join(DATA, "inventory.csv");
const STOCK_THRESHOLD = 3;
const REVIEWS = path.join(DATA, "reviews.json");

function loadReviews() {
  try {
    return JSON.parse(fs.readFileSync(REVIEWS, "utf8"));
  } catch {
    return { reviews: [] };
  }
}

function saveReviews(r) {
  fs.writeFileSync(REVIEWS, JSON.stringify(r, null, 2));
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = [];
    let cur = "";
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) {
        cols.push(cur);
        cur = "";
      } else cur += ch;
    }
    cols.push(cur);
    const row = {};
    headers.forEach((h, i) => (row[h] = (cols[i] || "").trim()));
    return row;
  });
}

function applyPricingCsv() {
  if (!fs.existsSync(PRICING_CSV)) return;
  const rows = parseCsv(fs.readFileSync(PRICING_CSV, "utf8"));
  const bySku = Object.fromEntries(rows.map((r) => [r.sku, r]));
  for (const item of products.items) {
    const row = bySku[item.sku];
    if (!row) continue;
    if (row.customer_price !== "") {
      const n = Number(row.customer_price);
      item.price = Number.isFinite(n) ? n : null;
    }
    if (row.unit_cost !== "") {
      const n = Number(row.unit_cost);
      item.cost = Number.isFinite(n) ? n : null;
    }
  }
}

function writePricingCsv() {
  const header = [
    "sku",
    "family",
    "name",
    "size",
    "lot",
    "purity",
    "category",
    "useClass",
    "customer_price",
    "unit_cost",
    "margin_dollars",
    "margin_percent",
    "notes",
  ];
  const lines = [header.join(",")];
  for (const it of products.items) {
    const price = it.price;
    const cost = it.cost;
    let md = "";
    let pct = "";
    if (price != null && cost != null && price !== "") {
      const m = Number(price) - Number(cost);
      md = m.toFixed(2);
      pct = Number(price) ? ((m / Number(price)) * 100).toFixed(1) : "";
    }
    const row = [
      it.sku,
      it.family,
      `"${String(it.name).replace(/"/g, '""')}"`,
      `"${String(it.size).replace(/"/g, '""')}"`,
      it.lot,
      it.purity || "",
      it.category || "",
      it.useClass || "",
      price == null ? "" : price,
      cost == null ? "" : cost,
      md,
      pct,
      "Edit customer_price and unit_cost",
    ];
    lines.push(row.join(","));
  }
  fs.writeFileSync(PRICING_CSV, lines.join("\n") + "\n");
}

function stockStatus(available, threshold = STOCK_THRESHOLD) {
  if (available <= 0) return "out";
  if (available < threshold) return "low";
  return "ok";
}

function applyInventoryCsv() {
  if (!fs.existsSync(INVENTORY_CSV)) return;
  const rows = parseCsv(fs.readFileSync(INVENTORY_CSV, "utf8"));
  const bySku = Object.fromEntries(rows.map((r) => [r.sku, r]));
  for (const item of products.items) {
    const row = bySku[item.sku];
    if (!row) continue;
    const on = Number(row.on_hand);
    const reserved = Number(row.reserved || 0);
    if (Number.isFinite(on)) item.stock = on;
    item.reserved = Number.isFinite(reserved) ? reserved : 0;
    item.available = Math.max(0, (item.stock || 0) - item.reserved);
    item.stockThreshold = Number(row.threshold) || STOCK_THRESHOLD;
    item.stockStatus = stockStatus(item.available, item.stockThreshold);
  }
}

function writeInventoryCsv() {
  const header = [
    "sku",
    "family",
    "name",
    "size",
    "lot",
    "on_hand",
    "reserved",
    "available",
    "threshold",
    "status",
    "notes",
  ];
  const lines = [header.join(",")];
  for (const it of products.items) {
    const on = Number(it.stock || 0);
    const reserved = Number(it.reserved || 0);
    const available = Math.max(0, on - reserved);
    const threshold = it.stockThreshold || STOCK_THRESHOLD;
    const status = stockStatus(available, threshold);
    it.available = available;
    it.stockStatus = status;
    lines.push(
      [
        it.sku,
        it.family,
        `"${String(it.name).replace(/"/g, '""')}"`,
        `"${String(it.size).replace(/"/g, '""')}"`,
        it.lot || "",
        on,
        reserved,
        available,
        threshold,
        status,
        "Edit on_hand. Status recalculates on save / order.",
      ].join(",")
    );
  }
  fs.writeFileSync(INVENTORY_CSV, lines.join("\n") + "\n");
}

const PENDING_FAMILIES = new Set([
  "al-kemi",
  "h7-hair",
  "snake-serum",
  "lights-out",
  "joint-juice",
  "lipo-c",
  "l-carnitine",
  "sleepy-cbd",
  "cbd",
]);
const SHOP_HIDDEN_FAMILIES = new Set([
  "bac-water",
  "al-kemi",
  "h7-hair",
  "snake-serum",
  "t25-tallow",
  "lights-out",
  "joint-juice",
  "lipo-c",
  "l-carnitine",
  "sleepy-cbd",
  "cbd",
]);
const INCOMING_INDEX = path.join(DATA, "coas", "incoming-index.json");
const INCOMING_DIR = path.join(DATA, "coas", "incoming");
const CHANNELS = path.join(DATA, "channels.json");

function loadChannels() {
  try {
    return JSON.parse(fs.readFileSync(CHANNELS, "utf8"));
  } catch {
    return {
      publicNote: "This catalog records the order and the lots. Settlement is off this site.",
      checkoutLabel: "Record order",
      checkoutHint: "No card rail on this catalog.",
      ops: {},
    };
  }
}

function saveChannels(c) {
  fs.writeFileSync(CHANNELS, JSON.stringify(c, null, 2) + "\n");
}

function publicChannels() {
  const c = loadChannels();
  return {
    publicNote: c.publicNote,
    checkoutLabel: c.checkoutLabel || "Record order",
    checkoutHint: c.checkoutHint,
  };
}

function restoreStock(order) {
  for (const line of (order.quote && order.quote.lines) || []) {
    const p = findProduct(line.sku);
    if (!p) continue;
    p.stock = Number(p.stock || 0) + Number(line.qty || 0);
    p.available = Math.max(0, p.stock - Number(p.reserved || 0));
    p.stockStatus = stockStatus(p.available, p.stockThreshold || STOCK_THRESHOLD);
  }
  writeInventoryCsv();
}

function shopVisibleOf(p) {
  if (!p) return false;
  if (p.shopVisible === false) return false;
  const fam = p.family || p.id;
  if (SHOP_HIDDEN_FAMILIES.has(fam)) return false;
  return true;
}
const SUB_CSV = path.join(DATA, "subscribers.csv");
const OUTBOX = path.join(DATA, "outbox.json");

function applyPendingTesting() {
  for (const item of products.items) {
    const pending = item.releaseState === "pending_testing" || PENDING_FAMILIES.has(item.family);
    if (!pending) continue;
    item.releaseState = "pending_testing";
    item.unavailableReason = "Waiting for testing to complete.";
    item.price = null;
    item.available = 0;
    item.stockStatus = "out";
  }
  for (const fam of products.families || []) {
    if (!PENDING_FAMILIES.has(fam.id)) continue;
    fam.releaseState = "pending_testing";
  }
}

applyPricingCsv();
applyInventoryCsv();
applyPendingTesting();

function loadOutbox() {
  try {
    return JSON.parse(fs.readFileSync(OUTBOX, "utf8"));
  } catch {
    return { messages: [] };
  }
}

function saveOutbox(o) {
  fs.writeFileSync(OUTBOX, JSON.stringify(o, null, 2));
}

function writeSubscribersCsv() {
  const lines = ["email,source,created,library"];
  for (const c of store.captures || []) {
    lines.push([c.email, c.source || "", c.created || "", c.library || "/library"].join(","));
  }
  fs.writeFileSync(SUB_CSV, lines.join("\n") + "\n");
}

function libraryEmail(email) {
  return {
    to: email,
    subject: "Helix King Labs — library access",
    text: [
      "Helix King Labs",
      "",
      "You are on the list.",
      "Library: /library",
      "Shop: /shop",
      "",
      "This list is for lot alerts and the documentation library.",
      "Research materials are for laboratory use only.",
      "Not a clinic. Not a pharmacy.",
    ].join("\n"),
  };
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webp": "image/webp",
};

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE, "utf8"));
  } catch {
    return { users: [], sessions: [], captures: [], orders: [], rate: {}, reviews: [] };
  }
}

function saveStore(s) {
  fs.writeFileSync(STORE, JSON.stringify(s, null, 2));
}

let store = loadStore();

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = crypto.scryptSync(password, salt, 32).toString("hex");
  return { salt, derived };
}

function checkPassword(password, salt, derived) {
  const test = crypto.scryptSync(password, salt, 32);
  const known = Buffer.from(derived, "hex");
  if (test.length !== known.length) return false;
  return crypto.timingSafeEqual(test, known);
}

function token() {
  return crypto.randomBytes(24).toString("hex");
}

function cookieOf(req) {
  const raw = req.headers.cookie || "";
  const map = {};
  raw.split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) map[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return map;
}

function sessionUser(req) {
  const sid = cookieOf(req).hkl_sid;
  if (!sid) return null;
  const sess = store.sessions.find((s) => s.id === sid && s.exp > Date.now());
  if (!sess) return null;
  return store.users.find((u) => u.id === sess.userId) || null;
}

const OPS_EMAILS = new Set(
  [
    "ryan@helixkinglabs.test",
    "sizemore.ryan@gmail.com",
    process.env.HKL_OPS_EMAIL || "",
  ]
    .map((e) => e.toLowerCase())
    .filter(Boolean)
);

function isOpsUser(u) {
  if (!u) return false;
  if (u.role === "ops") return true;
  return OPS_EMAILS.has(String(u.email || "").toLowerCase());
}

function hasOrdered(userId) {
  return (store.orders || []).some((o) => o.userId === userId);
}

function affiliateOf(userId) {
  return (store.affiliates || []).find((a) => a.userId === userId) || null;
}

function referredOrders(code) {
  const c = String(code || "").toUpperCase();
  if (!c) return [];
  return (store.orders || []).filter((o) => (o.affiliateCode || (o.quote && o.quote.affiliateCode)) === c);
}

function publicUser(u) {
  if (!u) return null;
  const aff = affiliateOf(u.id);
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    provider: u.provider || "password",
    role: isOpsUser(u) ? "ops" : "customer",
    isOps: isOpsUser(u),
    firstOrderOpen: !u.firstOrderUsed,
    coupon: u.firstOrderUsed ? null : "HELIX10",
    hasOrdered: hasOrdered(u.id),
    affiliate: aff
      ? { code: aff.code, status: aff.status, created: aff.created }
      : null,
    created: u.created,
  };
}

function setSession(res, userId) {
  const id = token();
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  store.sessions = store.sessions.filter((s) => s.exp > Date.now());
  store.sessions.push({ id, userId, exp });
  saveStore(store);
  const secure = SECURE_COOKIES ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `hkl_sid=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}${secure}`
  );
}

function clearSession(req, res) {
  const sid = cookieOf(req).hkl_sid;
  store.sessions = store.sessions.filter((s) => s.id !== sid);
  saveStore(store);
  const secure = SECURE_COOKIES ? "; Secure" : "";
  res.setHeader("Set-Cookie", `hkl_sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

function b64urlJson(part) {
  const padded = part.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((part.length + 3) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

function decodeJwt(raw) {
  const parts = String(raw || "").split(".");
  if (parts.length !== 3) throw new Error("jwt");
  return {
    header: b64urlJson(parts[0]),
    payload: b64urlJson(parts[1]),
    parts,
  };
}

async function fetchJson(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) throw new Error("fetch");
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function getJwks(kind) {
  const now = Date.now();
  const hit = jwksCache[kind];
  if (hit && hit.exp > now) return hit.keys;
  const url =
    kind === "apple"
      ? "https://appleid.apple.com/auth/keys"
      : "https://www.googleapis.com/oauth2/v3/certs";
  const body = await fetchJson(url);
  const keys = body.keys || [];
  jwksCache[kind] = { keys, exp: now + 6 * 3600 * 1000 };
  return keys;
}

function verifyRs256(token, jwk) {
  const parts = String(token).split(".");
  const key = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const sig = Buffer.from(parts[2].replace(/-/g, "+").replace(/_/g, "/") + "===".slice((parts[2].length + 3) % 4), "base64");
  return crypto.verify("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]), key, sig);
}

async function verifyGoogleIdToken(credential) {
  if (!GOOGLE_CLIENT_ID) throw new Error("google_not_configured");
  const token = String(credential || "");
  if (!token || token.length > 4096) throw new Error("token");
  let payload = null;
  try {
    const info = await fetchJson("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(token));
    payload = info;
  } catch {
    const jwt = decodeJwt(token);
    const keys = await getJwks("google");
    const jwk = keys.find((k) => k.kid === jwt.header.kid);
    if (!jwk || !verifyRs256(token, jwk)) throw new Error("token");
    payload = jwt.payload;
  }
  const aud = payload.aud;
  const iss = String(payload.iss || "");
  const email = String(payload.email || "").toLowerCase().trim();
  const verified = payload.email_verified === true || payload.email_verified === "true";
  const exp = Number(payload.exp || 0);
  if (aud !== GOOGLE_CLIENT_ID) throw new Error("audience");
  if (iss !== "accounts.google.com" && iss !== "https://accounts.google.com") throw new Error("issuer");
  if (!exp || exp * 1000 < Date.now() - 30000) throw new Error("expired");
  if (!validEmail(email) || !verified) throw new Error("email");
  return {
    sub: String(payload.sub || ""),
    email,
    name: String(payload.name || email.split("@")[0]).slice(0, 80),
  };
}

async function verifyAppleIdToken(credential) {
  if (!APPLE_CLIENT_ID) throw new Error("apple_not_configured");
  const token = String(credential || "");
  if (!token || token.length > 4096) throw new Error("token");
  const jwt = decodeJwt(token);
  const keys = await getJwks("apple");
  const jwk = keys.find((k) => k.kid === jwt.header.kid);
  if (!jwk || jwt.header.alg !== "RS256" || !verifyRs256(token, jwk)) throw new Error("token");
  const p = jwt.payload;
  const iss = String(p.iss || "");
  const aud = p.aud;
  const exp = Number(p.exp || 0);
  if (iss !== "https://appleid.apple.com") throw new Error("issuer");
  if (aud !== APPLE_CLIENT_ID) throw new Error("audience");
  if (!exp || exp * 1000 < Date.now() - 30000) throw new Error("expired");
  const email = p.email ? String(p.email).toLowerCase().trim() : "";
  if (email && !validEmail(email)) throw new Error("email");
  return {
    sub: String(p.sub || ""),
    email,
    name: email ? email.split("@")[0] : "Apple account",
    emailVerified: p.email_verified === true || p.email_verified === "true",
  };
}

function authProviders() {
  return {
    password: true,
    google: !!GOOGLE_CLIENT_ID,
    apple: APPLE_ENABLED,
    demo: AUTH_DEMO,
    googleClientId: GOOGLE_CLIENT_ID || null,
    appleClientId: APPLE_ENABLED ? APPLE_CLIENT_ID : null,
    appleRedirect: APPLE_ENABLED && PUBLIC_ORIGIN ? PUBLIC_ORIGIN + "/account" : null,
    appleParked: !APPLE_ENABLED,
  };
}

function upsertSocialUser({ email, name, provider, sub, age, terms }) {
  if (!sub) throw new Error("sub");
  const subKey = provider === "apple" ? "appleSub" : "googleSub";
  let u = store.users.find((x) => x[subKey] === sub);
  if (!u && email) u = store.users.find((x) => x.email === email);
  if (!u) {
    if (!age || !terms) throw new Error("confirmations_required");
    if (!validEmail(email)) throw new Error("email");
    u = {
      id: token(),
      email,
      name: name || email.split("@")[0],
      provider,
      providers: [provider],
      [subKey]: sub,
      firstOrderUsed: false,
      age: true,
      terms: true,
      created: new Date().toISOString(),
    };
    store.users.push(u);
  } else {
    u[subKey] = sub;
    u.providers = Array.from(new Set([...(u.providers || [u.provider].filter(Boolean)), provider]));
    if (u.provider === "google-demo") u.provider = provider;
    if (name && !u.name) u.name = name;
    if (email && !u.email) u.email = email;
  }
  saveStore(store);
  return u;
}

function limited(ip, key, max, windowMs) {
  const now = Date.now();
  const k = `${ip}:${key}`;
  const row = store.rate[k] || { n: 0, t: now };
  if (now - row.t > windowMs) {
    row.n = 0;
    row.t = now;
  }
  row.n += 1;
  store.rate[k] = row;
  return row.n > max;
}

function send(res, code, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

function readBody(req, limit = 200000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on("data", (c) => {
      n += c.length;
      if (n > limit) {
        reject(new Error("payload"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("json"));
      }
    });
    req.on("error", reject);
  });
}

function validEmail(e) {
  return typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length < 120;
}

function volumeRate(qty) {
  if (qty >= 10) return 0.15;
  if (qty >= 4) return 0.1;
  if (qty >= 2) return 0.05;
  return 0;
}

function findProduct(key) {
  if (!key) return null;
  const k = String(key);
  return (
    products.items.find((x) => x.id === k || x.sku === k || x.slug === k) ||
    products.items.find((x) => x.familySlug === k || x.family === k) ||
    null
  );
}

function familyOf(p) {
  if (!p) return null;
  const fam = (products.families || []).find((f) => f.id === p.family);
  const variants = products.items.filter((x) => x.family === p.family);
  return { family: fam || null, variants };
}

function cleanAffiliateCode(raw) {
  const code = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 16);
  if (code.length < 3) return null;
  if (code === "HELIX10") return null;
  return code;
}

function quoteCart(items, user, opts) {
  const price = products.pricing || {};
  const shipFee = Number(price.shippingFee != null ? price.shippingFee : 9.95);
  const freeAt = Number(price.freeShippingAt != null ? price.freeShippingAt : 199);
  const affRate = Number(price.affiliateRate != null ? price.affiliateRate : 0.1);
  const firstRate = Number(price.firstOrderRate != null ? price.firstOrderRate : 0.1);
  const lines = [];
  let units = 0;
  let subtotal = 0;
  for (const line of items || []) {
    const p = findProduct(line.id) || findProduct(line.sku);
    if (!p) continue;
    if (p.releaseState === "pending_testing") continue;
    if (!shopVisibleOf(p)) continue;
    const available = p.available != null ? Number(p.available) : Number(p.stock || 0);
    const qty = Math.max(1, Math.min(20, Number(line.qty) || 1));
    const unit = Number(p.price);
    if (!Number.isFinite(unit)) continue;
    units += qty;
    subtotal += unit * qty;
    lines.push({
      id: p.id,
      sku: p.sku,
      slug: p.slug,
      name: p.name,
      size: p.size,
      lot: p.lot,
      qty,
      unit: p.price,
      line: p.price * qty,
      available,
      stockStatus: stockStatus(available, p.stockThreshold || STOCK_THRESHOLD),
      oversold: qty > available,
    });
  }
  const vol = volumeRate(units);
  const volumeOff = Math.round(subtotal * vol * 100) / 100;
  const afterVolume = Math.round((subtotal - volumeOff) * 100) / 100;
  const affiliateCode = cleanAffiliateCode(opts && opts.affiliateCode);
  let coupon = null;
  let couponOff = 0;
  let discountKind = null;
  if (affiliateCode) {
    coupon = affiliateCode;
    couponOff = Math.round(afterVolume * affRate * 100) / 100;
    discountKind = "affiliate";
  } else if (user && !user.firstOrderUsed) {
    coupon = price.firstOrderCoupon || "HELIX10";
    couponOff = Math.round(afterVolume * firstRate * 100) / 100;
    discountKind = "first_order";
  }
  const merchandise = Math.round((afterVolume - couponOff) * 100) / 100;
  const shipping = merchandise >= freeAt || merchandise <= 0 ? 0 : shipFee;
  const shippingLabel = shipping === 0 && merchandise >= freeAt ? "Free" : "Standard";
  const total = Math.round((merchandise + shipping) * 100) / 100;
  const affiliatePayout =
    discountKind === "affiliate" ? Math.round(merchandise * affRate * 100) / 100 : 0;
  return {
    lines,
    units,
    subtotal,
    volumeRate: vol,
    volumeOff,
    coupon,
    couponOff,
    discountKind,
    merchandise,
    shipping,
    shippingFee: shipFee,
    freeShippingAt: freeAt,
    shippingLabel,
    affiliateCode: discountKind === "affiliate" ? affiliateCode : null,
    affiliateRate: affRate,
    affiliatePayout,
    total,
  };
}

function sanitizeProduct(p, authed) {
  const out = { ...p };
  delete out.cost;
  const pending = p.releaseState === "pending_testing";
  if (!authed || pending) {
    out.price = null;
    out.priceHidden = true;
  } else {
    out.priceHidden = out.price == null;
  }
  out.quotedInCart = !!authed && !pending;
  out.stock = pending ? 0 : p.stock;
  out.available = pending ? 0 : p.available != null ? p.available : p.stock;
  out.stockStatus = pending ? "out" : p.stockStatus || stockStatus(out.available || 0);
  out.stockThreshold = p.stockThreshold || STOCK_THRESHOLD;
  out.releaseState = pending ? "pending_testing" : p.releaseState || "live";
  out.unavailableReason = pending ? "Waiting for testing to complete." : p.unavailableReason || null;
  out.shopVisible = shopVisibleOf(p);
  return out;
}

function sanitizeFamily(f) {
  const out = { ...f };
  out.shopVisible = f.shopVisible !== false && !SHOP_HIDDEN_FAMILIES.has(f.id);
  return out;
}

function purchasedSkus(userId) {
  const skus = new Set();
  for (const o of store.orders) {
    if (o.userId !== userId) continue;
    for (const line of (o.quote && o.quote.lines) || []) {
      if (line.sku) skus.add(line.sku);
      if (line.id) skus.add(line.id);
    }
  }
  return skus;
}

async function api(req, res, url) {
  const ip = req.socket.remoteAddress || "0";
  const user = sessionUser(req);
  const method = req.method;
  const route = url.pathname;

  if (method === "GET" && route === "/api/health") {
    return send(res, 200, { ok: true, brand: "Helix King Labs" });
  }

  if (method === "GET" && route === "/api/copy") {
    return send(res, 200, copyDeck);
  }

  if (method === "GET" && route === "/api/site") {
    return send(res, 200, {
      brand: "Helix King Labs",
      slogan: "Rule Your Biology",
      origin: PUBLIC_ORIGIN || null,
      channels: publicChannels(),
      appleParked: !APPLE_ENABLED,
      googleLive: !!GOOGLE_CLIENT_ID,
    });
  }

  if (method === "GET" && route === "/api/catalog") {
    const families = (products.families || [])
      .map(sanitizeFamily)
      .filter((f) => f.shopVisible);
    const familyIds = new Set(families.map((f) => f.id));
    const items = products.items
      .filter((p) => shopVisibleOf(p))
      .map((p) => sanitizeProduct(p, !!user));
    const categories = (products.categories || []).filter((c) =>
      families.some((f) => f.category === c.id)
    );
    return send(res, 200, {
      categories,
      testing: products.testing,
      heroSku: products.heroSku,
      heroFamily: products.heroFamily,
      homeOffers: products.homeOffers || ["pgl-gic1", "pgl-gi1", "bpc-tb", "tesamorelin", "pgl-g1", "bpc-157", "glow", "ghk-cu"],
      pricing: products.pricing,
      families,
      skuIndex: products.skuIndex || {},
      items,
      familyIds: [...familyIds],
      authed: !!user,
    });
  }

  if (method === "GET" && route.startsWith("/api/products/")) {
    const slug = decodeURIComponent(route.slice("/api/products/".length));
    const p = findProduct(slug);
    if (!p) return send(res, 404, { error: "not_found" });
    if (!shopVisibleOf(p)) return send(res, 404, { error: "not_found" });
    const { family, variants } = familyOf(p);
    const lots = certificates.records.filter(
      (c) => c.productId === p.id || c.sku === p.sku
    );
    const related = (p.related || [])
      .map((id) => findProduct(id))
      .filter(Boolean)
      .map((x) => sanitizeProduct(x, !!user));
    const revFile = loadReviews();
    const reviews = (revFile.reviews || []).filter(
      (r) => r.sku === p.sku || r.family === p.family
    );
    return send(res, 200, {
      product: sanitizeProduct(p, !!user),
      family,
      variants: variants.map((x) => sanitizeProduct(x, !!user)),
      lots,
      related,
      reviews,
      canReview: !!(user && purchasedSkus(user.id).has(p.sku)),
      authed: !!user,
    });
  }

  if (method === "GET" && route === "/api/certificates") {
    return send(res, 200, {
      disclaimer: "Lot certificates publish here when testing is complete.",
      labs: [],
      count: 0,
      records: [],
      status: "pending",
    });
  }

  if (method === "GET" && route.startsWith("/api/certificates/")) {
    return send(res, 200, {
      record: null,
      product: null,
      status: "pending",
      message: "Lot certificates publish here when testing is complete.",
    });
  }

  if (method === "GET" && route === "/api/library") {
    return send(res, 200, {
      title: "Documentation library",
      link: "/library",
      items: [
        { t: "Permitted use", href: "/use" },
        { t: "Testing methods", href: "/testing" },
        { t: "Research tools", href: "/tools" },
        { t: "Shop", href: "/shop" },
        { t: "Account", href: "/account" },
      ],
      note: "Certificates attach here when a lot clears the panel.",
    });
  }

  if (method === "GET" && route === "/api/session") {
    return send(res, 200, { user: publicUser(user), auth: authProviders() });
  }

  if (method === "GET" && route === "/api/auth/providers") {
    return send(res, 200, authProviders());
  }

  if (method === "POST" && route === "/api/auth/register") {
    if (limited(ip, "reg", 8, 15 * 60 * 1000)) return send(res, 429, { error: "rate" });
    let body;
    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: "bad_request" });
    }
    const email = String(body.email || "").toLowerCase().trim();
    const password = String(body.password || "");
    const name = String(body.name || "").slice(0, 80);
    const age = !!body.age;
    const terms = !!body.terms;
    if (!age || !terms) return send(res, 400, { error: "confirmations_required" });
    if (!validEmail(email)) return send(res, 400, { error: "email" });
    if (password.length < 8 || password.length > 72) return send(res, 400, { error: "password" });
    if (store.users.some((u) => u.email === email)) return send(res, 409, { error: "exists" });
    const { salt, derived } = hashPassword(password);
    const u = {
      id: token(),
      email,
      name: name || email.split("@")[0],
      salt,
      derived,
      provider: "password",
      providers: ["password"],
      firstOrderUsed: false,
      age: true,
      terms: true,
      created: new Date().toISOString(),
    };
    store.users.push(u);
    saveStore(store);
    setSession(res, u.id);
    return send(res, 200, { user: publicUser(u) });
  }

  if (method === "POST" && route === "/api/auth/login") {
    if (limited(ip, "login", 12, 15 * 60 * 1000)) return send(res, 429, { error: "rate" });
    let body;
    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: "bad_request" });
    }
    const email = String(body.email || "").toLowerCase().trim();
    const password = String(body.password || "");
    const u = store.users.find((x) => x.email === email);
    if (!u || !u.derived || !checkPassword(password, u.salt, u.derived)) {
      return send(res, 401, { error: "credentials" });
    }
    setSession(res, u.id);
    return send(res, 200, { user: publicUser(u) });
  }

  if (method === "POST" && route === "/api/auth/google") {
    if (limited(ip, "google", 16, 15 * 60 * 1000)) return send(res, 429, { error: "rate" });
    let body;
    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: "bad_request" });
    }
    if (GOOGLE_CLIENT_ID) {
      let identity;
      try {
        identity = await verifyGoogleIdToken(body.credential);
      } catch (err) {
        return send(res, 401, { error: err.message === "google_not_configured" ? "google_not_configured" : "google_token" });
      }
      try {
        const u = upsertSocialUser({
          email: identity.email,
          name: identity.name,
          provider: "google",
          sub: identity.sub,
          age: !!body.age,
          terms: !!body.terms,
        });
        setSession(res, u.id);
        return send(res, 200, { user: publicUser(u), provider: "google" });
      } catch (err) {
        return send(res, 400, { error: err.message || "google_failed" });
      }
    }
    if (!AUTH_DEMO) return send(res, 503, { error: "google_not_configured" });
    if (!body.age || !body.terms) return send(res, 400, { error: "confirmations_required" });
    const email = validEmail(body.email)
      ? String(body.email).toLowerCase()
      : `google.${token().slice(0, 8)}@helixkinglabs.demo`;
    let u = store.users.find((x) => x.email === email);
    if (!u) {
      u = {
        id: token(),
        email,
        name: String(body.name || "Google account").slice(0, 80),
        provider: "google-demo",
        providers: ["google-demo"],
        firstOrderUsed: false,
        age: true,
        terms: true,
        created: new Date().toISOString(),
      };
      store.users.push(u);
      saveStore(store);
    }
    setSession(res, u.id);
    return send(res, 200, { user: publicUser(u), demo: true });
  }

  if (method === "POST" && route === "/api/auth/apple") {
    if (limited(ip, "apple", 16, 15 * 60 * 1000)) return send(res, 429, { error: "rate" });
    if (!APPLE_ENABLED) return send(res, 503, { error: "apple_parked" });
    if (!APPLE_CLIENT_ID) return send(res, 503, { error: "apple_not_configured" });
    let body;
    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: "bad_request" });
    }
    let identity;
    try {
      identity = await verifyAppleIdToken(body.credential);
    } catch {
      return send(res, 401, { error: "apple_token" });
    }
    const given = body.fullName && typeof body.fullName === "object"
      ? [body.fullName.givenName, body.fullName.familyName].filter(Boolean).join(" ").slice(0, 80)
      : "";
    try {
      const u = upsertSocialUser({
        email: identity.email,
        name: given || identity.name,
        provider: "apple",
        sub: identity.sub,
        age: !!body.age,
        terms: !!body.terms,
      });
      setSession(res, u.id);
      return send(res, 200, { user: publicUser(u), provider: "apple" });
    } catch (err) {
      return send(res, 400, { error: err.message || "apple_failed" });
    }
  }

  if (method === "POST" && route === "/api/auth/logout") {
    clearSession(req, res);
    return send(res, 200, { ok: true });
  }

  if (method === "POST" && route === "/api/cart/quote") {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: "bad_request" });
    }
    if (!user) return send(res, 401, { error: "account_required" });
    return send(res, 200, quoteCart(body.items, user, { affiliateCode: body.affiliateCode }));
  }

  if (method === "POST" && route === "/api/checkout") {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: "bad_request" });
    }
    if (!user) return send(res, 401, { error: "account_required" });
    applyInventoryCsv();
    const quote = quoteCart(body.items, user, { affiliateCode: body.affiliateCode });
    if (!quote.lines.length) return send(res, 400, { error: "empty" });
    const blocked = quote.lines.filter((l) => l.available <= 0 || l.qty > l.available);
    if (blocked.length) {
      return send(res, 409, {
        error: "insufficient_stock",
        blocked: blocked.map((l) => ({ sku: l.sku, requested: l.qty, available: l.available })),
      });
    }
    const channels = publicChannels();
    const order = {
      id: "HK-" + token().slice(0, 8).toUpperCase(),
      userId: user.id,
      email: user.email,
      quote,
      affiliateCode: quote.affiliateCode,
      affiliatePayout: quote.affiliatePayout,
      status: "awaiting_settlement",
      settlement: "offsite",
      tracking: null,
      note: channels.publicNote,
      created: new Date().toISOString(),
    };
    user.firstOrderUsed = true;
    store.orders.push(order);
    for (const line of quote.lines) {
      const p = findProduct(line.sku);
      if (!p) continue;
      p.stock = Math.max(0, Number(p.stock || 0) - line.qty);
      p.available = Math.max(0, p.stock - Number(p.reserved || 0));
      p.stockStatus = stockStatus(p.available, p.stockThreshold || STOCK_THRESHOLD);
    }
    writeInventoryCsv();
    saveStore(store);
    return send(res, 200, { order });
  }

  if (method === "POST" && route === "/api/capture") {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: "bad_request" });
    }
    const email = String(body.email || "").toLowerCase().trim();
    if (!validEmail(email)) return send(res, 400, { error: "email" });
    const row = store.captures.find((c) => c.email === email);
    if (!row) {
      store.captures.push({
        email,
        source: String(body.source || "unknown").slice(0, 40),
        created: new Date().toISOString(),
        library: "/library",
      });
    }
    const mail = libraryEmail(email);
    const box = loadOutbox();
    box.messages.push({
      ...mail,
      source: String(body.source || "unknown").slice(0, 40),
      created: new Date().toISOString(),
      status: "queued",
    });
    saveOutbox(box);
    saveStore(store);
    writeSubscribersCsv();
    return send(res, 200, {
      ok: true,
      library: "/library",
      queued: true,
      note: "Email is stored. Outbound send waits on SMTP or an ESP.",
    });
  }

  if (method === "GET" && route === "/api/ops/channels") {
    if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
    return send(res, 200, loadChannels());
  }

  if (method === "POST" && route === "/api/ops/channels") {
    if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
    let body;
    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: "bad_request" });
    }
    const cur = loadChannels();
    if (typeof body.publicNote === "string") cur.publicNote = body.publicNote.slice(0, 400);
    if (typeof body.checkoutHint === "string") cur.checkoutHint = body.checkoutHint.slice(0, 240);
    cur.ops = cur.ops || {};
    if (body.telegram && typeof body.telegram === "object") {
      cur.ops.telegram = {
        ...(cur.ops.telegram || {}),
        handle: String(body.telegram.handle || "").slice(0, 120),
        note: String(body.telegram.note || (cur.ops.telegram && cur.ops.telegram.note) || "").slice(0, 240),
        label: "Telegram (off-site)",
      };
    }
    if (body.crypto && typeof body.crypto === "object") {
      cur.ops.crypto = {
        ...(cur.ops.crypto || {}),
        asset: String(body.crypto.asset || "").slice(0, 40),
        address: String(body.crypto.address || "").slice(0, 128),
        note: String(body.crypto.note || (cur.ops.crypto && cur.ops.crypto.note) || "").slice(0, 240),
        label: "Exodus wallet",
      };
    }
    saveChannels(cur);
    return send(res, 200, { ok: true, channels: cur });
  }

  if (method === "POST" && route === "/api/ops/orders") {
    if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
    let body;
    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: "bad_request" });
    }
    const order = (store.orders || []).find((o) => o.id === body.id);
    if (!order) return send(res, 404, { error: "not_found" });
    const next = String(body.status || "").toLowerCase();
    const allowed = new Set(["awaiting_settlement", "settled", "shipped", "voided"]);
    if (!allowed.has(next)) return send(res, 400, { error: "status" });
    if (next === "voided" && order.status !== "voided") restoreStock(order);
    order.status = next;
    if (typeof body.tracking === "string") {
      order.tracking = body.tracking.replace(/[^A-Za-z0-9]/g, "").slice(0, 40) || null;
    }
    if (next === "shipped" && !order.shippedAt) order.shippedAt = new Date().toISOString();
    if (next === "settled" && !order.settledAt) order.settledAt = new Date().toISOString();
    saveStore(store);
    return send(res, 200, { ok: true, order });
  }

  if (method === "GET" && route === "/api/tracking") {
    const q = String(url.searchParams.get("q") || "").trim();
    if (!q || q.length < 6) return send(res, 200, { found: false, message: "Enter the tracking number from the ship note." });
    const needle = q.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const order = (store.orders || []).find((o) => {
      const t = String(o.tracking || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      return t && t === needle;
    });
    if (!order) return send(res, 200, { found: false, message: "No shipment under that number yet. Labels post when ops books the carton." });
    return send(res, 200, {
      found: true,
      orderId: order.id,
      status: order.status,
      tracking: order.tracking,
      shippedAt: order.shippedAt || null,
    });
  }

  if (method === "GET" && route === "/api/ops/incoming-coas") {
    if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
    let index = { lab: "Bioviridian", records: [] };
    try {
      index = JSON.parse(fs.readFileSync(INCOMING_INDEX, "utf8"));
    } catch {
      /* keep empty */
    }
    return send(res, 200, {
      ...index,
      published: false,
      note: index.note || "Supplier-side HPLC-MS certificates. Not published on /testing.",
    });
  }

  if (method === "GET" && route.startsWith("/api/ops/incoming-coas/")) {
    if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
    const code = decodeURIComponent(route.slice("/api/ops/incoming-coas/".length)).replace(/[^A-Za-z0-9_-]/g, "");
    const file = path.join(INCOMING_DIR, `${code}.pdf`);
    if (!file.startsWith(INCOMING_DIR) || !fs.existsSync(file)) return send(res, 404, { error: "not_found" });
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${code}.pdf"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    });
    return fs.createReadStream(file).pipe(res);
  }

  if (method === "GET" && route === "/api/ops/subscribers") {
    if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
    return send(res, 200, {
      captures: store.captures || [],
      outbox: loadOutbox().messages.slice(-50),
    });
  }

  if (method === "GET" && route === "/api/ops/board") {
    if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
    const orders = store.orders || [];
    const merch = orders.reduce((a, o) => a + Number((o.quote && o.quote.merchandise) || (o.quote && o.quote.total) || 0), 0);
    return send(res, 200, {
      orders,
      users: (store.users || []).map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: isOpsUser(u) ? "ops" : "customer",
        created: u.created,
        firstOrderUsed: !!u.firstOrderUsed,
      })),
      affiliates: store.affiliates || [],
      captures: store.captures || [],
      totals: {
        orders: orders.length,
        merchandise: Math.round(merch * 100) / 100,
        accounts: (store.users || []).length,
        list: (store.captures || []).length,
      },
    });
  }

  if (method === "GET" && route === "/api/affiliate") {
    if (!user) return send(res, 401, { error: "account_required" });
    const aff = affiliateOf(user.id);
    if (!aff || aff.status !== "live") {
      return send(res, 200, {
        locked: true,
        hasOrdered: hasOrdered(user.id),
        affiliate: aff,
      });
    }
    const rows = referredOrders(aff.code).map((o) => ({
      id: o.id,
      created: o.created,
      merchandise: o.quote && o.quote.merchandise,
      total: o.quote && o.quote.total,
      payout: o.affiliatePayout || 0,
      email: o.email,
      lines: ((o.quote && o.quote.lines) || []).map((l) => l.sku + " ×" + l.qty),
    }));
    const earned = rows.reduce((a, r) => a + Number(r.payout || 0), 0);
    const paid = Number(aff.paid || 0);
    return send(res, 200, {
      locked: false,
      affiliate: aff,
      link: "/shop?ref=" + aff.code,
      orders: rows,
      earned: Math.round(earned * 100) / 100,
      paid,
      available: Math.round((earned - paid) * 100) / 100,
      payoutFloor: 50,
    });
  }

  if (method === "POST" && route === "/api/affiliate/apply") {
    if (!user) return send(res, 401, { error: "account_required" });
    if (!hasOrdered(user.id)) return send(res, 403, { error: "order_required" });
    let body = {};
    try {
      body = await readBody(req);
    } catch {
      body = {};
    }
    if (!body.agree) return send(res, 400, { error: "agree" });
    store.affiliates = store.affiliates || [];
    let aff = affiliateOf(user.id);
    if (!aff) {
      const base = String(user.name || user.email || "HK")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 8);
      let code = (base || "HK") + token().slice(0, 4).toUpperCase();
      while (store.affiliates.some((a) => a.code === code)) code = "HK" + token().slice(0, 6).toUpperCase();
      aff = {
        userId: user.id,
        email: user.email,
        code,
        status: "live",
        paid: 0,
        created: new Date().toISOString(),
      };
      store.affiliates.push(aff);
      saveStore(store);
    }
    return send(res, 200, { affiliate: aff });
  }

  if (method === "GET" && route === "/api/orders") {
    if (!user) return send(res, 401, { error: "account_required" });
    const mine = store.orders.filter((o) => o.userId === user.id);
    return send(res, 200, { orders: mine });
  }

  if (method === "GET" && route === "/api/reviews") {
    const sku = url.searchParams.get("sku") || "";
    const family = url.searchParams.get("family") || "";
    const all = loadReviews().reviews || [];
    const rows = all.filter((r) => (sku && r.sku === sku) || (family && r.family === family));
    return send(res, 200, { reviews: rows });
  }

  if (method === "POST" && route === "/api/reviews") {
    if (!user) return send(res, 401, { error: "account_required" });
    let body;
    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: "bad_request" });
    }
    const sku = String(body.sku || "");
    const item = findProduct(sku);
    if (!item) return send(res, 404, { error: "not_found" });
    if (!purchasedSkus(user.id).has(item.sku)) {
      return send(res, 403, { error: "verified_purchase_required" });
    }
    const rating = Math.max(1, Math.min(5, Number(body.rating) || 5));
    const text = String(body.text || "").slice(0, 600).trim();
    if (text.length < 8) return send(res, 400, { error: "text" });
    const file = loadReviews();
    if ((file.reviews || []).some((r) => r.userId === user.id && r.sku === item.sku)) {
      return send(res, 409, { error: "already_reviewed" });
    }
    const rec = {
      id: token().slice(0, 10),
      sku: item.sku,
      family: item.family,
      name: item.name,
      size: item.size,
      rating,
      text,
      userId: user.id,
      by: (user.name || user.email || "Account").slice(0, 24),
      verified: true,
      created: new Date().toISOString(),
    };
    file.reviews = file.reviews || [];
    file.reviews.unshift(rec);
    saveReviews(file);
    return send(res, 200, { review: rec });
  }

  if (method === "GET" && route === "/api/ops/pricing") {
    if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
    const rows = products.items.map((it) => {
      const price = it.price;
      const cost = it.cost;
      const margin = price != null && cost != null ? Number(price) - Number(cost) : null;
      const pct =
        margin != null && Number(price) ? Math.round((margin / Number(price)) * 1000) / 10 : null;
      return {
        sku: it.sku,
        family: it.family,
        name: it.name,
        size: it.size,
        lot: it.lot,
        customer_price: price,
        unit_cost: cost,
        margin_dollars: margin,
        margin_percent: pct,
      };
    });
    return send(res, 200, { rows });
  }

  if (method === "POST" && route === "/api/ops/pricing") {
    if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
    let body;
    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: "bad_request" });
    }
    const updates = Array.isArray(body.rows) ? body.rows : [];
    for (const row of updates) {
      const item = products.items.find((x) => x.sku === row.sku);
      if (!item) continue;
      if (row.customer_price !== undefined && row.customer_price !== "") {
        const n = Number(row.customer_price);
        item.price = Number.isFinite(n) ? n : null;
      }
      if (row.unit_cost !== undefined && row.unit_cost !== "") {
        const n = Number(row.unit_cost);
        item.cost = Number.isFinite(n) ? n : null;
      }
    }
    writePricingCsv();
    fs.writeFileSync(path.join(DATA, "products.json"), JSON.stringify(products, null, 2));
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: "not_found" });
}

function safePublic(rel) {
  const resolved = path.resolve(PUBLIC, rel);
  if (!resolved.startsWith(PUBLIC)) return null;
  return resolved;
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === "/") rel = "/index.html";
  const file = safePublic(rel.replace(/^\/+/, ""));
  if (!file) {
    res.writeHead(403);
    return res.end();
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      const index = path.join(PUBLIC, "index.html");
      return fs.readFile(index, (e2, buf) => {
        if (e2) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "strict-origin-when-cross-origin",
          "X-Frame-Options": "DENY",
        });
        res.end(buf);
      });
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=86400",
    });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        });
        return res.end();
      }
      return await api(req, res, url);
    }
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: "server" });
  }
});

server.listen(PORT, () => {
  console.log(`Helix King Labs storefront shell → http://localhost:${PORT}`);
});
