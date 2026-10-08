"use strict";

/**
 * Helix King Labs — storefront shell API + static host.
 * Payments, processors, and supply are intentionally absent (playbook scope).
 */

const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");
const authx = require("./auth-extra");
const createOpsCatalog = require("./ops-catalog");
const createEmailList = require("./email-list");
const createFulfillment = require("./fulfillment");
const { createSuggestions } = require("./suggestions");
const { createWholesale } = require("./wholesale");
const { createPayments } = require("./payments");
const QRCode = require("qrcode");
const mailer = require("./mail");

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const BUNDLED = path.join(ROOT, "data");
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : BUNDLED;
fs.mkdirSync(DATA, { recursive: true });
function seedDataDir() {
  if (path.resolve(DATA) === path.resolve(BUNDLED)) return;
  const names = ["products.json", "certificates.json", "copy-deck.json", "catalog-pricing.csv", "inventory.csv", "reviews.json", "channels.json", "group-buy.json", "supplier-cost.json"];
  for (const name of names) {
    const dest = path.join(DATA, name);
    const src = path.join(BUNDLED, name);
    if (!fs.existsSync(dest) && fs.existsSync(src)) fs.copyFileSync(src, dest);
  }
  const inc = path.join(DATA, "coas");
  if (!fs.existsSync(inc) && fs.existsSync(path.join(BUNDLED, "coas"))) {
    fs.cpSync(path.join(BUNDLED, "coas"), inc, { recursive: true });
  }
  // Migrate: import live DB from bundled dir if external dir is empty.
  const destStore = path.join(DATA, "store.json");
  const srcStore = path.join(BUNDLED, "store.json");
  if (!fs.existsSync(destStore) && fs.existsSync(srcStore)) {
    fs.copyFileSync(srcStore, destStore);
    console.log("Migrated store.json to DATA_DIR");
  }
}
seedDataDir();
const STORE = path.join(DATA, "store.json");
const PORT = Number(process.env.PORT || 20011);
const SESSION_HOURS = 14 * 24;
const SECRET = process.env.HKL_SECRET || crypto.randomBytes(32).toString("hex");

// Tax ID encryption at rest (AES-256-GCM). Key from HKL_TAX_KEY (32-byte hex)
// or derived from HKL_SECRET. Plaintext tax IDs are never stored.
function taxKey() {
  const hex = process.env.HKL_TAX_KEY;
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex.trim())) return Buffer.from(hex.trim(), "hex");
  if (process.env.HKL_SECRET) return crypto.scryptSync(process.env.HKL_SECRET, "helix-tax-v1", 32);
  return null;
}
function encTaxId(plain) {
  const key = taxKey();
  if (!key || !plain) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return [iv.toString("hex"), ct.toString("hex"), c.getAuthTag().toString("hex")].join(":");
}
function decTaxId(enc) {
  try {
    const key = taxKey();
    if (!key || !enc) return null;
    const parts = String(enc).split(":");
    if (parts.length !== 3) return null;
    const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parts[0], "hex"));
    d.setAuthTag(Buffer.from(parts[2], "hex"));
    return Buffer.concat([d.update(Buffer.from(parts[1], "hex")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
const PUBLIC_ORIGIN = String(process.env.HKL_PUBLIC_ORIGIN || "").replace(/\/$/, "");
const GOOGLE_CLIENT_ID = String(
  process.env.GOOGLE_CLIENT_ID ||
    "264747327954-jeukts6o6ekf8ibepsc5215vcj0pbmg5.apps.googleusercontent.com"
).trim();
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
const STOCK_THRESHOLD = 5;
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
    const prior = String(row.ever_stocked || "") === "1" || item.everStocked === true;
    item.everStocked = prior || (Number.isFinite(on) && on > 0);
  }
  attachCertificates();
}

const CERT_FILES = {
  RT20: "/docs/rt20-freedom-2607310981.jpg",
};

function attachCertificates() {
  for (const item of products.items) {
    const rel = String(item.certificateFile || CERT_FILES[item.sku] || "").split("?")[0];
    const onDisk = rel && fs.existsSync(path.join(PUBLIC, rel.replace(/^\//, "")));
    item.certificateFile = onDisk ? rel : (item.certificateFile || "");
    if (!onDisk && !item.certificateFile) item.certificateFile = "";
    item.certificatePublic = !!(onDisk && item.everStocked);
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
    "ever_stocked",
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
        it.everStocked || on > 0 ? "1" : "0",
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
  "selank-ns",
  "semax-ns",
]);
const SHOP_VISIBLE_FAMILIES = new Set([
  "pgl-gic1",    // Retatrutide
  "pgl-gi1",     // Tirzepatide
  "bpc-157",     // BPC-157
  "tb-500",      // TB-500
  "bpc-tb",      // Wolverine blend
  "ghk-cu",      // GHK-Cu
  "glow",        // GLOW
  "klow",        // KLOW
  "tesamorelin", // Tesamorelin
  "mots-c",      // MOTS-c
  "nad",         // NAD+
  "kpv",         // KPV
  "ss-31",       // SS-31
  "pgl-el1",     // Eloralintide
  "pgl-g1",      // Semaglutide
  "cgl-1",       // Cagrilintide
]);
// IPs excluded from visitor tracking (owner devices)
const TRACKING_IP_BLOCKLIST = new Set([
  "12.75.226.77", // Ryan mobile
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
    checkoutLabel: c.checkoutLabel || "Checkout not open",
    checkoutHint: c.checkoutHint,
    telegramInvite: c.telegramInvite || "https://t.me/+gk0d_zGjGORkNDc5",
    checkoutOpen: Boolean(process.env.NOWPAYMENTS_API_KEY),
  };
}

function restoreStock(order) {
  if (!order.stockDecremented) return;
  for (const line of (order.quote && order.quote.lines) || []) {
    const p = findProduct(line.sku);
    if (!p) continue;
    const give = line.kind === "kit" || line.unit === "kit" ? Number(line.qty || 0) * 10 : Number(line.qty || 0);
    p.stock = Number(p.stock || 0) + give;
    p.available = Math.max(0, p.stock - Number(p.reserved || 0));
    p.stockStatus = stockStatus(p.available, p.stockThreshold || STOCK_THRESHOLD);
  }
  writeInventoryCsv();
}

function shopVisibleOf(p) {
  if (!p) return false;
  if (p.shopVisible === false) return false;
  const fam = p.family || p.id;
  // Allowlisted families always show. Others appear automatically once
  // intake gives them stock.
  if (SHOP_VISIBLE_FAMILIES.has(fam)) return true;
  if (Number(p.available || 0) > 0) return true;
  return false;
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
let opsCatalogHandle;
let emailListHandle;
let fulfillHandle;
let suggestHandle;
let wholesaleHandle,paymentsHandle;

function loadOutbox() {
  try {
    return JSON.parse(fs.readFileSync(OUTBOX, "utf8"));
  } catch {
    return { messages: [] };
  }
}

function saveOutbox(o) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(OUTBOX, JSON.stringify(o, null, 2));
  try { writeBackup("outbox", o); } catch (err) { console.error("outbox backup", err.message); }
}

function writeSubscribersCsv() {
  const lines = ["email,source,created,library"];
  for (const c of store.captures || []) {
    lines.push([c.email, c.source || "", c.created || "", c.library || "/library"].join(","));
  }
  fs.writeFileSync(SUB_CSV, lines.join("\n") + "\n");
}

// libraryEmail moved to email-list.js

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

function backupStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}
function writeBackup(kind, value) {
  const dir = path.join(DATA, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(kind + "-")).sort();
  const newest = files.length ? files[files.length - 1] : null;
  if (newest) {
    try {
      const ageMs = Date.now() - fs.statSync(path.join(dir, newest)).mtimeMs;
      if (ageMs < 5 * 60 * 1000) return;
    } catch {}
  }
  fs.writeFileSync(path.join(dir, kind + "-" + backupStamp() + ".json"), JSON.stringify(value));
  const after = fs.readdirSync(dir).filter((f) => f.startsWith(kind + "-")).sort();
  while (after.length > 48) fs.unlinkSync(path.join(dir, after.shift()));
}
function saveStore(s) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(s, null, 2));
  try { writeBackup("store", s); } catch (err) { console.error("store backup", err.message); }
}

let store = loadStore();

opsCatalogHandle = createOpsCatalog({ products, store, saveStore, send, readBody, isOpsUser, findProduct, writeInventoryCsv, writePricingCsv, attachCertificates, audit, PUBLIC, DATA, QRCode, sessionOf });
emailListHandle = createEmailList({ store, saveStore, send, readBody, validEmail, token, requestOrigin: authx.requestOrigin, loadOutbox, saveOutbox, writeSubscribersCsv, audit, isOpsUser });
fulfillHandle = createFulfillment({ products, store, saveStore, send, readBody, isOpsUser, findProduct, attachCertificates, writeInventoryCsv, writePricingCsv, audit, PUBLIC, DATA, SHOP_VISIBLE_FAMILIES, affiliateOf, stockStatus, STOCK_THRESHOLD, getPublicOrigin: () => (typeof PUBLIC_ORIGIN !== "undefined" && PUBLIC_ORIGIN) || "https://helixkinglabs.com", getRequestOrigin: (req) => authx.requestOrigin(req), getEmailListHandle: () => emailListHandle });
suggestHandle = createSuggestions({ store, saveStore, send, readBody, isOpsUser });
wholesaleHandle = createWholesale({
  store, saveStore, send, readBody, isOpsUser, products,
  saveProducts: () => { fs.writeFileSync(path.join(DATA, "products.json"), JSON.stringify(products, null, 2)); },
});
paymentsHandle=createPayments({store,saveStore,send,readBody,queueMail,orderMail:(o,k)=>mailer.orderMail(o,k),audit,getPublicOrigin:()=>PUBLIC_ORIGIN||"https://helixkinglabs.com"});

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

function sessionOf(req) {
  const sid = cookieOf(req).hkl_sid;
  if (!sid) return null;
  return store.sessions.find((s) => s.id === sid && s.exp > Date.now()) || null;
}

function sessionUser(req) {
  const sess = sessionOf(req);
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
    wholesale: !!u.wholesale,
    firstOrderOpen: !u.firstOrderUsed,
    coupon: u.firstOrderUsed ? null : "HELIX10",
    company: u.company || "",
    researchField: u.researchField || "",
    hasOrdered: hasOrdered(u.id),
    phone: u.phone || "",
    address: u.address || { line1: "", city: "", region: "", postal: "" },
    emailOptIn: !!u.emailOptIn,
    passkey: !!(u.passkeys && u.passkeys.length),
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

function upsertSocialUser({ email, name, provider, sub, age, terms, company, researchField }) {
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
      company: company || "",
      researchField: researchField || "Independent Researcher",
      researchAck: true,
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

function volumeRate() {
  return 0;
}

function findProduct(key) {
  if (!key) return null;
  const k = String(key);
  const exact = products.items.find((x) => x.id === k || x.sku === k || x.slug === k);
  if (exact) return exact;
  const famHits = products.items.filter((x) => x.familySlug === k || x.family === k);
  return famHits.find((x) => shopVisibleOf(x)) || famHits[0] || null;
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
function liveAffiliate(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return null;
  return (store.affiliates || []).find((a) => a.code === c && a.status === "live") || null;
}
function liveCoupon(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return null;
  const found = (store.coupons || []).find((x) => x.code === c && x.active !== false);
  if (!found) return null;
  if (found.expires && new Date(found.expires).getTime() < Date.now()) return null;
  if (found.maxUses > 0 && Number(found.uses || 0) >= found.maxUses) return null;
  return found;
}

function useCoupon(code) {
  const c = liveCoupon(code);
  if (!c) return;
  c.uses = Number(c.uses || 0) + 1;
  saveStore(store);
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
    const kit = line.kind === 'kit';
    const kitMax = available >= 15 ? Math.floor(available / 10) : 0;
    if (kit && kitMax < 1) continue;
    const qty = Math.max(1, Math.min(kit ? kitMax : Math.min(9, available), Number(line.qty) || 1));
    const unit = Number(kit ? p.kitPrice : p.price);
    if (!Number.isFinite(unit)) continue;
    const vials = kit ? qty * 10 : qty;
    units += qty;
    subtotal += unit * qty;
    lines.push({
      id: p.id,
      sku: p.sku,
      slug: p.slug,
      name: p.name,
      size: kit ? p.size + ' kit of 10' : p.size,
      kind: kit ? 'kit' : 'single',
      lot: p.lot,
      qty,
      vials,
      unit,
      line: Math.round(unit * qty * 100) / 100,
      available,
      stockStatus: stockStatus(available, p.stockThreshold || STOCK_THRESHOLD),
      oversold: vials > available,
      image:p.image||"",
    });
  }
  const vol = volumeRate(units);
  const volumeOff = Math.round(subtotal * vol * 100) / 100;
  const afterVolume = Math.round((subtotal - volumeOff) * 100) / 100;
  const affiliateCode = cleanAffiliateCode(opts && opts.affiliateCode);
  const aff = liveAffiliate(affiliateCode);
  const cpn = !aff ? liveCoupon(affiliateCode) : null;
  let coupon = null;
  let couponOff = 0;
  let discountKind = null;
  if (aff) {
    coupon = affiliateCode;
    couponOff = Math.round(afterVolume * affRate * 100) / 100;
    discountKind = "affiliate";
  } else if (cpn && afterVolume >= Number(cpn.minTotal || 0)) {
    coupon = cpn.code;
    if (Number(cpn.amount) > 0) {
      couponOff = Math.min(afterVolume, Math.round(Number(cpn.amount) * 100) / 100);
    } else {
      couponOff = Math.round(afterVolume * (Number(cpn.pct) / 100) * 100) / 100;
    }
    discountKind = "coupon";
  } else if (user && !user.firstOrderUsed && afterVolume > 99) {
    coupon = price.firstOrderCoupon || "HELIX10";
    couponOff = Math.round(afterVolume * firstRate * 100) / 100;
    discountKind = "first_order";
  }
  const merchandise = Math.round((afterVolume - couponOff) * 100) / 100;
  const shipping = merchandise >= freeAt || merchandise <= 0 ? 0 : shipFee;
  const shippingLabel = shipping === 0 && merchandise >= freeAt ? "Free" : "Standard";
  const paymentMethod = ["venmo", "cashapp", "crypto"].includes(opts && opts.paymentMethod) ? opts.paymentMethod : "crypto";
  const surchargeRate = 0;
  const surcharge = Math.round(merchandise * surchargeRate * 100) / 100;
  const total = Math.round((merchandise + surcharge + shipping) * 100) / 100;
  const selfOrder = !!(aff && user && aff.userId && user.id && aff.userId === user.id);
  const affiliatePayout =
    discountKind === "affiliate" && !selfOrder ? Math.round(merchandise * affRate * 100) / 100 : 0;
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
    paymentMethod,
    surchargeRate,
    surcharge,
    total,
  };
}

const SCI_NAMES={BB10:["BPC-157 + TB-500 Blend","Wolverine"],BB20:["BPC-157 + TB-500 Blend","Wolverine"],GLOW:["GHK-Cu + TB-500 + BPC-157 Blend","GLOW"],KLOW:["GHK-Cu + TB-500 + BPC-157 + KPV Blend","KLOW"]};
function sanitizeProduct(p, authed) {
  const out = { ...p };
  delete out.cost;
  const sci = SCI_NAMES[p.sku];
  if (sci) { out.name = sci[0]; out.aka = sci[1]; out.image = String(p.image || "").replace(/\?v=\d+/, "?v=70"); }
  const pending = p.releaseState === "pending_testing";
  if (pending) {
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
  out.everStocked = !!p.everStocked;
  out.certificateFile = p.certificatePublic ? p.certificateFile : "";
  out.certificatePublic = !!p.certificatePublic;
  return out;
}

function familyVisibleOf(f) {
  if (!f) return false;
  if (f.shopVisible === false) return false;
  if (SHOP_VISIBLE_FAMILIES.has(f.id)) return true;
  // Auto-reveal: family appears once intake gives any of its items stock
  return (products.items || []).some((it) => it.family === f.id && Number(it.available || 0) > 0);
}

function sanitizeFamily(f) {
  const out = { ...f };
  out.shopVisible = familyVisibleOf(f);
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

function publicOrder(o) {
  if (!o) return o;
  const { internalNote, ...rest } = o;
  rest.events = (o.events || []).map((e) => ({ at: e.at, kind: e.kind }));
  return rest;
}

async function api(req, res, url) {
  const ip=req.headers["cf-connecting-ip"]||req.socket.remoteAddress||"0";
  const user = sessionUser(req);
  const method = req.method;
  const route = url.pathname;

  // Redirect www to apex for SEO (avoid duplicate content)
  const host = req.headers.host || "";
  if (host.startsWith("www.")) {
    const apex = host.slice(4);
    res.writeHead(301, { Location: "https://" + apex + req.url });
    return res.end();
  }

  if (method === "GET" && route === "/api/health") {
    return send(res, 200, { ok: true, brand: "Helix King Labs" });
  }

  if (method === "GET" && route === "/api/config") {
    return send(res, 200, { placesKey: process.env.GOOGLE_PLACES_KEY || "", trackingExcluded: TRACKING_IP_BLOCKLIST.has(ip) });
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
    const reviews = (revFile.reviews || [])
      .filter((r) => r.sku === p.sku || r.family === p.family)
      .map(({ text, by, userId, ...rest }) => rest);
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
    const records = [];
    for (const p of products.items || []) {
      if (!p.certificateFile || !p.certificatePublic) continue;
      const fam = (products.families || []).find((f) => f.id === (p.family || p.id));
      records.push({
        sku: p.sku,
        name: p.name,
        size: p.size,
        lot: p.lot || "",
        file: p.certificateFile,
        family: fam ? fam.name : "",
        slug: fam ? (fam.slug || fam.id) : "",
      });
    }
    return send(res, 200, {
      disclaimer: "Lot certificates publish here when testing is complete.",
      labs: [],
      count: records.length,
      records,
      status: records.length ? "live" : "pending",
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
      title: "Research library",
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
    const company = String(body.company || "Independent research").trim().slice(0, 80);
    const researchField = String(body.researchField || "");
    const researchAck = !!body.researchAck;
    if (!age || !terms || !researchAck) return send(res, 400, { error: "confirmations_required" });
    if (!RESEARCH_FIELDS.includes(researchField)) return send(res, 400, { error: "research_field" });
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
      company,
      researchField,
      researchAck,
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
    // 2FA: if enabled, require TOTP code (or recovery code) before session
    if (u.totpEnabled && u.totpSecret) {
      const code = String(body.totp || "").replace(/\s/g, "");
      const rec = (u.totpRecovery || []).indexOf(code.toUpperCase());
      const ok = /^\d{6}$/.test(code) && authx.totpOk(u.totpSecret, code);
      if (!ok && rec < 0) {
        return send(res, 401, { error: "totp_required" });
      }
      if (rec >= 0) {
        u.totpRecovery.splice(rec, 1);
        saveStore(store);
      }
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
        const researchField = String(body.researchField || "");
        if (researchField && !RESEARCH_FIELDS.includes(researchField)) return send(res, 400, { error: "research_field" });
        const u = upsertSocialUser({
          email: identity.email,
          name: identity.name,
          provider: "google",
          sub: identity.sub,
          age: !!body.age,
          terms: !!body.terms,
          company: String(body.company || "").slice(0, 80),
          researchField,
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
        company: String(body.company || "").slice(0, 80),
        researchField: RESEARCH_FIELDS.includes(String(body.researchField || "")) ? String(body.researchField) : "Independent Researcher",
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
      const researchField = String(body.researchField || "");
      if (researchField && !RESEARCH_FIELDS.includes(researchField)) return send(res, 400, { error: "research_field" });
      const u = upsertSocialUser({
        email: identity.email,
        name: given || identity.name,
        provider: "apple",
        sub: identity.sub,
        age: !!body.age,
        terms: !!body.terms,
        company: String(body.company || "").slice(0, 80),
        researchField,
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

  if (method === "POST" && route === "/api/auth/magic") {
    if (limited(ip, "magic", 6, 15 * 60 * 1000)) return send(res, 429, { error: "rate" });
    let body;
    try { body = await readBody(req); } catch { return send(res, 400, { error: "bad_request" }); }
    const email = String(body.email || "").toLowerCase().trim();
    if (!validEmail(email)) return send(res, 400, { error: "email" });
    const token = authx.issueMagic(store, email);
    saveStore(store);
    const link = authx.requestOrigin(req) + "/magic?token=" + encodeURIComponent(token);
    const sent = await authx.deliver(loadOutbox, saveOutbox, mailer.sendMail, {
      to: email,
      subject: "Helix King Labs sign-in link",
      text: "Sign in to Helix King Labs.\n\n" + link + "\n\nThis link expires in 20 minutes. Research use only.",
    });
    return send(res, 200, { ok: true, sent: !!sent.sent });
  }

  if(await authx.pwReset(req,res,url,{store,saveStore,setSession,publicUser,validEmail,hashPassword,loadOutbox,saveOutbox,mailer,limited,ip}))return;
  if (method === "POST" && route === "/api/auth/magic/consume") {
    let body;
    try { body = await readBody(req); } catch { return send(res, 400, { error: "bad_request" }); }
    const row = authx.takeMagic(store, body.token);
    if (!row) return send(res, 400, { error: "link" });
    let u = store.users.find((x) => x.email === row.email);
    if (!u) {
      u = {
        id: token(),
        email: row.email,
        name: row.email.split("@")[0],
        provider: "magic",
        providers: ["magic"],
        firstOrderUsed: false,
        age: true,
        terms: true,
        company: "Independent research",
        researchField: "",
        created: new Date().toISOString(),
      };
      store.users.push(u);
    }
    u.providers = Array.from(new Set([...(u.providers || []), "magic"]));
    saveStore(store);
    setSession(res, u.id);
    return send(res, 200, { user: publicUser(u) });
  }

  if (method === "POST" && route === "/api/auth/passkey/register/options") {
    if (!user) return send(res, 401, { error: "account_required" });
    const origin = authx.requestOrigin(req);
    const challenge = authx.issueChallenge(store, "reg:" + user.id);
    saveStore(store);
    return send(res, 200, {
      challenge,
      rp: { name: "Helix King Labs", id: authx.rpId(origin) },
      user: { id: user.id, name: user.email, displayName: user.name || user.email },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      timeout: 60000,
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    });
  }

  if (method === "POST" && route === "/api/auth/passkey/register") {
    if (!user) return send(res, 401, { error: "account_required" });
    let body;
    try { body = await readBody(req); } catch { return send(res, 400, { error: "bad_request" }); }
    const challenge = authx.takeChallenge(store, "reg:" + user.id);
    if (!challenge || !authx.verifyClient(body.clientDataJSON, "webauthn.create", challenge, authx.requestOrigin(req))) {
      return send(res, 400, { error: "challenge" });
    }
    if (!body.id || !body.publicKey) return send(res, 400, { error: "key" });
    user.passkeys = user.passkeys || [];
    user.passkeys = user.passkeys.filter((k) => k.id !== body.id);
    user.passkeys.push({ id: String(body.id).slice(0, 256), publicKey: String(body.publicKey).slice(0, 2000), created: new Date().toISOString() });
    user.providers = Array.from(new Set([...(user.providers || []), "passkey"]));
    saveStore(store);
    return send(res, 200, { user: publicUser(user) });
  }

  if (method === "POST" && route === "/api/auth/passkey/login/options") {
    const challenge = authx.issueChallenge(store, "login:" + ip);
    saveStore(store);
    return send(res, 200, {
      challenge,
      timeout: 60000,
      rpId: authx.rpId(authx.requestOrigin(req)),
      userVerification: "preferred",
    });
  }

  if (method === "POST" && route === "/api/auth/passkey/login") {
    let body;
    try { body = await readBody(req); } catch { return send(res, 400, { error: "bad_request" }); }
    const challenge = authx.takeChallenge(store, "login:" + ip);
    if (!challenge || !authx.verifyClient(body.clientDataJSON, "webauthn.get", challenge, authx.requestOrigin(req))) {
      return send(res, 400, { error: "challenge" });
    }
    const u = store.users.find((x) => (x.passkeys || []).some((k) => k.id === body.id));
    const key = u && u.passkeys.find((k) => k.id === body.id);
    if (!key || !authx.verifyAssertion(key.publicKey, body.authenticatorData, body.clientDataJSON, body.signature)) {
      return send(res, 401, { error: "passkey" });
    }
    saveStore(store);
    setSession(res, u.id);
    return send(res, 200, { user: publicUser(u) });
  }

  if (method === "POST" && route === "/api/account") {
    if (!user) return send(res, 401, { error: "account_required" });
    let body;
    try { body = await readBody(req); } catch { return send(res, 400, { error: "bad_request" }); }
    const clean = (s, n) => String(s || "").replace(/[<>"']/g, "").slice(0, n);
    if (typeof body.name === "string") user.name = clean(body.name, 80);
    if (typeof body.company === "string") user.company = clean(body.company, 80) || "Independent research";
    if (typeof body.researchField === "string" && RESEARCH_FIELDS.includes(body.researchField)) user.researchField = body.researchField;
    if (typeof body.phone === "string") user.phone = body.phone.replace(/[^0-9+() .-]/g, "").slice(0, 24);
    if (body.address && typeof body.address === "object") {
      user.address = {
        line1: clean(body.address.line1, 80),
        city: clean(body.address.city, 40),
        region: clean(body.address.region, 40),
        postal: clean(body.address.postal, 16),
      };
    }
    if (typeof body.emailOptIn === "boolean") {
      user.emailOptIn = body.emailOptIn;
      if (!body.emailOptIn) store.captures = (store.captures || []).filter((c) => c.email !== user.email);
    }
    if (typeof body.email === "string") {
      const email = body.email.toLowerCase().trim();
      if (!validEmail(email)) return send(res, 400, { error: "email" });
      if (email !== user.email && store.users.some((x) => x.email === email)) return send(res, 409, { error: "exists" });
      user.email = email;
    }
    saveStore(store);
    return send(res, 200, { user: publicUser(user) });
  }

  if (method === "POST" && route === "/api/cart/quote") {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: "bad_request" });
    }
    if (!user) return send(res, 401, { error: "account_required" });
    return send(res, 200, quoteCart(body.items, user, {
      affiliateCode: body.affiliateCode,
      paymentMethod: body.paymentMethod,
    }));
  }

  if (method === "POST" && route === "/api/checkout") {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: "bad_request" });
    }
    if (!user) return send(res, 401, { error: "account_required" });
    const company = String(body.company || user.company || "").trim().slice(0, 80);
    const researchField = String(body.researchField || user.researchField || "");
    if (!RESEARCH_FIELDS.includes(researchField)) return send(res, 400, { error: "research_field" });
    if (!body.researchAck) return send(res, 400, { error: "research_ack" });
    if (!company) return send(res, 400, { error: "company_required" });
    if (!body.termsAck) return send(res, 400, { error: "terms_ack" });
    const paymentMethod = ["venmo", "cashapp", "crypto"].includes(body.paymentMethod) ? body.paymentMethod : "crypto";
    user.company = company;
    user.researchField = researchField;
    user.researchAck = true;
    applyInventoryCsv();
    const quote = quoteCart(body.items, user, { affiliateCode: body.affiliateCode, paymentMethod });
    if (!quote.lines.length) return send(res, 400, { error: "empty" });
    const need = {};
    for (const l of quote.lines) need[l.sku] = (need[l.sku] || 0) + (l.kind === "kit" ? l.qty * 10 : l.qty);
    const blocked = quote.lines.filter((l) => l.available <= 0 || need[l.sku] > l.available || (l.kind === "kit" && l.available < 15));
    if (blocked.length) {
      return send(res, 409, {
        error: "insufficient_stock",
        blocked: blocked.map((l) => ({ sku: l.sku, requested: l.qty, available: l.available })),
      });
    }
    const channels = publicChannels();
    const src = body.ship && typeof body.ship === "object" ? body.ship : (user.address || {});
    const ship = {
      name: String(body.shipName || user.name || "").slice(0, 80),
      phone: String(body.phone || user.phone || "").replace(/[^0-9+() .-]/g, "").slice(0, 24),
      line1: String(src.line1 || "").slice(0, 80),
      line2: String(src.line2 || "").slice(0, 80),
      city: String(src.city || "").slice(0, 40),
      region: String(src.region || "").slice(0, 40),
      postal: String(src.postal || "").slice(0, 16),
      country: String(src.country || "US").slice(0, 8),
    };
    if (!ship.line1 || !ship.city || !ship.region || !ship.postal) {
      return send(res, 400, { error: "ship_to", message: "Ship-to needs a street, city, state, and postal code." });
    }
    user.address = { line1: ship.line1, line2: ship.line2, city: ship.city, region: ship.region, postal: ship.postal };
    if (ship.phone) user.phone = ship.phone;
    if (ship.name) user.name = ship.name;
    const order = {
      id: "HK-" + token().slice(0, 8).toUpperCase(),
      channel: "shop",
      userId: user.id,
      email: user.email,
      name: ship.name,
      phone: ship.phone,
      company: company || "",
      researchField: researchField || "Independent Researcher",
      researchAck: true,
      ship,
      quote,
      affiliateCode: quote.affiliateCode,
      affiliatePayout: quote.affiliatePayout,
      paymentMethod,
      status: "awaiting_settlement",
      fulfillment: "hold",
      settlement: paymentMethod,
      tracking: null,
      carrier: "",
      internalNote: "",
      note: channels.publicNote,
      created: new Date().toISOString(),
      events: [{ at: new Date().toISOString(), kind: "placed", by: user.email }],
    };
    if (paymentMethod === "venmo" || paymentMethod === "cashapp") {
      order.payment = {
        provider: paymentMethod,
        handle: paymentMethod === "venmo" ? "fibkingpeps" : "FibKingPep",
        status: "awaiting_confirmation",
        surcharge: 0,
        amount: quote.total,
        note: order.id,
      };
    } else {
      order.payment = await paymentsHandle.createNowPayment(order, body.network);
    }
    if (paymentMethod === "crypto" && order.payment && ["payment_failed", "key_missing", "invoice_pending"].includes(order.payment.status)) {
      return send(res, 400, { error: "payment_unavailable", message: order.payment.message || "Crypto payment is not available. Use Venmo or Cash App." });
    }
    for (const line of quote.lines) {
      const p = findProduct(line.sku);
      if (!p) continue;
      const take = line.kind === "kit" ? line.qty * 10 : line.qty;
      p.stock = Math.max(0, Number(p.stock || 0) - take);
      p.available = Math.max(0, p.stock - Number(p.reserved || 0));
      p.stockStatus = stockStatus(p.available, p.stockThreshold || STOCK_THRESHOLD);
    }
    writeInventoryCsv();
    order.stockDecremented = true;
    if (quote.discountKind === "first_order") user.firstOrderUsed = true;
    if (quote.discountKind === "coupon" && quote.coupon) useCoupon(quote.coupon);
    store.orders.push(order);
    saveStore(store);
    queueMail(mailer.orderMail(order, "placed", {origin: (typeof PUBLIC_ORIGIN !== "undefined" && PUBLIC_ORIGIN) || "https://helixkinglabs.com", deliveredText: fulfillHandle.deliveredText}));
    return send(res, 200, { order });
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
    const next = String(body.status || order.status || "").toLowerCase();
    const allowed = new Set(["awaiting_settlement", "settled", "shipped", "delivered", "voided"]);
    if (!allowed.has(next)) return send(res, 400, { error: "status" });
    if (next === "shipped" && order.status !== "settled" && order.status !== "shipped") {
      return send(res, 400, { error: "settle_first" });
    }
    if (next === "delivered" && order.status !== "shipped" && order.status !== "delivered") {
      return send(res, 400, { error: "ship_first" });
    }
    if (next === "voided" && order.status !== "voided") restoreStock(order);
    const prev = order.status;
    order.status = next;
    if (typeof body.tracking === "string") {
      order.tracking = body.tracking.replace(/[^A-Za-z0-9 -]/g, "").slice(0, 40) || null;
    }
    if (typeof body.carrier === "string") order.carrier = body.carrier.slice(0, 40);
    if (typeof body.internalNote === "string") order.internalNote = body.internalNote.slice(0, 500);
    if (body.ship && typeof body.ship === "object") {
      order.ship = order.ship || {};
      for (const k of ["name", "phone", "line1", "line2", "city", "region", "postal", "country"]) {
        if (typeof body.ship[k] === "string") order.ship[k] = body.ship[k].slice(0, 80);
      }
    }
    if (next === "shipped" && !order.shippedAt) order.shippedAt = new Date().toISOString();
    if (next === "settled" && !order.settledAt) order.settledAt = new Date().toISOString();
    if (next === "voided" && !order.voidedAt) order.voidedAt = new Date().toISOString();
    if (next === "delivered" && !order.deliveredAt) order.deliveredAt = new Date().toISOString();
    if (next === "settled") order.fulfillment = order.fulfillment === "shipped" ? "shipped" : "ready";
    if (next === "shipped") order.fulfillment = "shipped";
    if (next === "delivered") order.fulfillment = "delivered";
    if (next === "voided") order.fulfillment = "void";
    order.events = order.events || [];
    order.events.push({ at: new Date().toISOString(), kind: prev === next ? "note" : next, by: user.email });
    audit(user, "order", order.id + " " + next);
    saveStore(store);
    if (prev !== next && (next === "settled" || next === "shipped" || next === "delivered" || next === "voided")) queueMail(mailer.orderMail(order, next, {origin: (typeof PUBLIC_ORIGIN !== "undefined" && PUBLIC_ORIGIN) || "https://helixkinglabs.com", deliveredText: fulfillHandle.deliveredText}));
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

  if (method === "POST" && route === "/api/ops/users/delete") {
    if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
    let body;
    try { body = await readBody(req); } catch { return send(res, 400, { error: "bad_request" }); }
    const id = String(body.id || "").trim();
    const email = String(body.email || "").toLowerCase().trim();
    const target = (store.users || []).find((u) => (id && u.id === id) || (email && String(u.email || "").toLowerCase() === email));
    if (!target) return send(res, 404, { error: "not_found" });
    if (target.id === user.id) return send(res, 400, { error: "cannot_delete_self" });
    if (isOpsUser(target)) return send(res, 400, { error: "cannot_delete_ops" });
    const orderCount = (store.orders || []).filter((o) => o.userId === target.id).length;
    if (orderCount) return send(res, 400, { error: "has_orders", orders: orderCount });
    store.users = (store.users || []).filter((u) => u.id !== target.id);
    store.sessions = (store.sessions || []).filter((s) => s.userId !== target.id);
    for (const aff of store.affiliates || []) {
      if (aff.userId === target.id) { aff.userId = null; aff.status = "closed"; aff.closedAt = new Date().toISOString(); }
    }
    saveStore(store);
    audit(user.id, "user", "deleted user " + (target.email || target.id));
    return send(res, 200, { ok: true });
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
    let aff = affiliateOf(user.id);
    if (!aff && user.email) {
      const manual = (store.affiliates || []).find(
        (a) => !a.userId && String(a.email || "").toLowerCase() === String(user.email).toLowerCase()
      );
      if (manual) { manual.userId = user.id; aff = manual; saveStore(store); }
    }
    if (!aff) {
      return send(res, 200, {
        locked: true,
        hasOrdered: hasOrdered(user.id),
        affiliate: aff,
      });
    }
    if (aff.status === "expired" || aff.status === "removed") {
      const bal = affiliateBalance(aff);
      const pendingRequest = (store.payoutRequests || []).find((r) => r.code === aff.code && r.status === "pending") || null;
      return send(res, 200, {
        locked: false,
        closed: true,
        closeReason: aff.status,
        affiliate: { code: aff.code, email: aff.email },
        earned: Math.round(bal.earned * 100) / 100,
        paid: bal.paid,
        available: bal.available,
        payoutFloor: 50,
        pendingRequest,
      });
    }
    if (aff.status !== "live") {
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
    const pendingRequest = (store.payoutRequests || []).find((r) => r.code === aff.code && r.status === "pending") || null;
    const pendingTotal = (store.payoutRequests || [])
      .filter((r) => r.code === aff.code && r.status === "pending")
      .reduce((sum, r) => sum + Number(r.amount || 0), 0);
    return send(res, 200, {
      locked: false,
      affiliate: aff,
      link: "/shop?ref=" + aff.code,
      orders: rows,
      earned: Math.round(earned * 100) / 100,
      paid,
      available: Math.round((earned - paid - pendingTotal) * 100) / 100,
      payoutFloor: 50,
      pendingRequest,
      payoutMethod: aff.payoutMethod || null,
      payoutDetail: aff.payoutDetail || null,
    });
  }

  if (method === "POST" && route === "/api/affiliate/payout-request") {
    if (!user) return send(res, 401, { error: "account_required" });
    const aff = affiliateOf(user.id);
    if (!aff || (aff.status !== "live" && aff.status !== "expired" && aff.status !== "removed")) return send(res, 403, { error: "not_affiliate" });
    let body;
    try { body = await readBody(req); } catch { body = {}; }
    const payMethod = String((body && body.method) || "").toLowerCase();
    if (payMethod !== "crypto" && payMethod !== "cashapp") return send(res, 400, { error: "method" });
    const detail = String((body && body.detail) || "").trim().slice(0, 120);
    if (detail.length < 3) return send(res, 400, { error: "detail" });
    const earned = referredOrders(aff.code).reduce((sum, o) => sum + Number(o.affiliatePayout || 0), 0);
    const pending = (store.payoutRequests || [])
      .filter((r) => r.code === aff.code && r.status === "pending")
      .reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const available = Math.round((earned - Number(aff.paid || 0) - pending) * 100) / 100;
    if (available < 50) return send(res, 400, { error: "floor" });
    store.payoutRequests = store.payoutRequests || [];
    const pr = {
      id: "PR" + Date.now().toString(36).toUpperCase(),
      code: aff.code,
      email: aff.email || user.email || "",
      amount: available,
      method: payMethod,
      detail,
      requested: new Date().toISOString(),
      status: "pending",
    };
    store.payoutRequests.push(pr);
    audit(user, "affiliate", aff.code + " requested payout $" + available.toFixed(2));
    saveStore(store);
    return send(res, 200, { ok: true, request: pr });
  }

  if (method === "POST" && route === "/api/affiliate/payout-method") {
    if (!user) return send(res, 401, { error: "account_required" });
    const aff = affiliateOf(user.id);
    if (!aff || aff.status !== "live") return send(res, 403, { error: "not_affiliate" });
    let body;
    try { body = await readBody(req); } catch { body = {}; }
    const payMethod = String((body && body.method) || "").toLowerCase();
    if (payMethod !== "crypto" && payMethod !== "cashapp") return send(res, 400, { error: "method" });
    const detail = String((body && body.detail) || "").trim().slice(0, 120);
    if (detail.length < 3) return send(res, 400, { error: "detail" });
    aff.payoutMethod = payMethod;
    aff.payoutDetail = detail;
    saveStore(store);
    return send(res, 200, { ok: true });
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
    if (!body.certify) return send(res, 400, { error: "certify" });
    const taxIdDigits = String(body.taxId || "").replace(/[^0-9]/g, "").slice(0, 9);
    if (taxIdDigits.length !== 9) return send(res, 400, { error: "tax_id" });
    const taxIdEnc = encTaxId(taxIdDigits);
    if (!taxIdEnc) return send(res, 500, { error: "tax_unavailable" });
    const tax = {
      legalName: String(body.legalName || "").trim().slice(0, 80),
      businessName: String(body.businessName || "").trim().slice(0, 80),
      address: String(body.address || "").trim().slice(0, 120),
      city: String(body.city || "").trim().slice(0, 60),
      state: String(body.state || "").trim().slice(0, 40),
      zip: String(body.zip || "").trim().slice(0, 12),
      taxIdType: String(body.taxIdType || "").toLowerCase() === "ein" ? "ein" : "ssn",
      taxIdEnc,
      taxIdLast4: taxIdDigits.slice(-4),
      certifiedAt: new Date().toISOString(),
    };
    if (!tax.legalName || !tax.address || !tax.city || !tax.state || !tax.zip) {
      return send(res, 400, { error: "tax_address" });
    }
    store.affiliates = store.affiliates || [];
    let aff = affiliateOf(user.id);
    if (!aff && user.email) {
      aff = store.affiliates.find(
        (a) => !a.userId && String(a.email || "").toLowerCase() === String(user.email).toLowerCase()
      ) || null;
      if (aff) { aff.userId = user.id; aff.status = "live"; aff.tax = tax; }
    }
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
        tax,
        created: new Date().toISOString(),
      };
      store.affiliates.push(aff);
      saveStore(store);
    }
    return send(res, 200, { affiliate: aff });
  }

  if (method === "GET" && route === "/api/orders") {
    if (!user) return send(res, 401, { error: "account_required" });
    const mine = store.orders.filter((o) => o.userId === user.id).map(publicOrder);
    return send(res, 200, { orders: mine });
  }

  if (method === "POST" && route.startsWith("/api/orders/")) {
    if (!user) return send(res, 401, { error: "account_required" });
    const parts = route.split("/");
    const id = decodeURIComponent(parts[3] || "");
    const action = parts[4] || "";
    const order = store.orders.find((o) => o.id === id && o.userId === user.id);
    if (!order) return send(res, 404, { error: "not_found" });
    let body;
    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: "bad_request" });
    }
    if (action === "address") {
      if (order.status !== "awaiting_settlement") {
        return send(res, 409, { error: "locked", message: "The address can only change before payment is confirmed." });
      }
      const ship = {
        name: String(body.name || "").slice(0, 80),
        phone: String(body.phone || "").replace(/[^0-9+() .-]/g, "").slice(0, 24),
        line1: String(body.line1 || "").slice(0, 80),
        line2: String(body.line2 || "").slice(0, 80),
        city: String(body.city || "").slice(0, 40),
        region: String(body.region || "").slice(0, 40),
        postal: String(body.postal || "").slice(0, 16),
        country: String(body.country || "US").slice(0, 8),
      };
      if (!ship.line1 || !ship.city || !ship.region || !ship.postal) {
        return send(res, 400, { error: "ship_to", message: "Street, city, state, and postal code are required." });
      }
      order.ship = ship;
      if (ship.name) order.name = ship.name;
      if (ship.phone) order.phone = ship.phone;
      order.events = order.events || [];
      order.events.push({ at: new Date().toISOString(), kind: "address", by: user.email });
      audit(user, "order", order.id + " address");
      saveStore(store);
      return send(res, 200, { ok: true, order: publicOrder(order) });
    }
    if (action === "restore") {
      if (order.status !== "voided") {
        return send(res, 409, { error: "locked", message: "Only cancelled orders can be restored." });
      }
      const lines = [];
      for (const l of ((order.quote && order.quote.lines) || [])) {
        const qty = Math.max(1, Math.floor(Number(l.qty || 0)));
        let id = l.id || "";
        if (!id && l.sku) {
          const prod = findProduct(l.sku);
          if (prod) id = prod.id;
        }
        if (!id) continue;
        lines.push({ id, qty, kind: l.kind === "kit" || l.unit === "kit" ? "kit" : "single" });
      }
      return send(res, 200, { ok: true, lines });
    }
    if (action === "cancel") {
      if (order.status !== "awaiting_settlement") {
        return send(res, 409, { error: "locked", message: "Only unpaid orders can be cancelled." });
      }
      restoreStock(order);
      order.stockDecremented = false;
      order.status = "voided";
      order.fulfillment = "void";
      order.voidedAt = new Date().toISOString();
      order.events = order.events || [];
      order.events.push({ at: new Date().toISOString(), kind: "voided", by: user.email });
      audit(user, "order", order.id + " customer void");
      saveStore(store);
      queueMail(mailer.orderMail(order, "voided", {origin: (typeof PUBLIC_ORIGIN !== "undefined" && PUBLIC_ORIGIN) || "https://helixkinglabs.com", deliveredText: fulfillHandle.deliveredText}));
      return send(res, 200, { ok: true, order: publicOrder(order) });
    }
    return send(res, 404, { error: "not_found" });
  }

  if (method === "GET" && route === "/api/reviews") {
    const sku = url.searchParams.get("sku") || "";
    const family = url.searchParams.get("family") || "";
    const all = loadReviews().reviews || [];
    const rows = all
      .filter((r) => (sku && r.sku === sku) || (family && r.family === family))
      .map(({ text, ...rest }) => rest);
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
    const rating = Math.max(1, Math.min(5, Number(body.rating) || 0));
    if (![1, 2, 3, 4, 5].includes(rating)) return send(res, 400, { error: "rating" });
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
      userId: user.id,
      verified: true,
      created: new Date().toISOString(),
    };
    file.reviews = file.reviews || [];
    file.reviews.unshift(rec);
    saveReviews(file);
    return send(res, 200, { review: rec });
  }

  if (method === "GET" && route === "/api/ops/label-qr") {
    if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
    const lot = String(url.searchParams.get("lot") || "").trim().slice(0, 40);
    if (!lot) return send(res, 400, { error: "lot" });
    const target = "https://helixkinglabs.com/testing?lot=" + encodeURIComponent(lot);
    const qr = await QRCode.create(target, { errorCorrectionLevel: "M" });
    return send(res, 200, {
      url: target,
      size: qr.modules.size,
      modules: Array.from(qr.modules.data, (bit) => (bit ? 1 : 0)),
    });
  }

  if (method === "GET" && route === "/api/ops/desk") {
    if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
    return send(res, 200, deskPayload());
  }

  if (method === "GET" && route === "/api/ops/backup") {
    if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"store.json\"",
      "Cache-Control": "private, no-store",
    });
    return res.end(fs.readFileSync(STORE));
  }

  if (method === "POST" && route === "/api/ops/sweep") {
    if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
    const released = sweepStaleOrders();
    return send(res, 200, { ok: true, released });
  }

  if (method === "POST" && route === "/api/ops/orders/recheck") {
    if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
    let body;
    try { body = await readBody(req); } catch { return send(res, 400, { error: "bad_request" }); }
    const order = (store.orders || []).find((o) => o.id === body.id);
    if (!order) return send(res, 404, { error: "not_found" });
    const paymentId = order.payment && order.payment.paymentId;
    if (!paymentId) return send(res, 400, { error: "no_payment" });
    if (!process.env.NOWPAYMENTS_API_KEY) return send(res, 503, { error: "key_missing" });
    let data;
    try { data = await fetchNowPayment(paymentId); } catch { return send(res, 502, { error: "recheck_failed" }); }
    const result = applyPaymentStatus(order, String(data.payment_status || ""), data);
    return send(res, 200, { ok: true, status: result.status, paymentStatus: data.payment_status || "" });
  }

  if (method === "POST" && route === "/api/ops/coupons") {
    if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
    let body;
    try { body = await readBody(req); } catch { return send(res, 400, { error: "bad_request" }); }
    const code = String(body.code || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 16);
    if (code.length < 3 || code === "HELIX10") return send(res, 400, { error: "code" });
    const pct = Math.max(0, Math.min(90, Number(body.pct) || 0));
    const amount = Math.max(0, Number(body.amount) || 0);
    if (!pct && !amount) return send(res, 400, { error: "discount" });
    const maxUses = Math.max(0, Math.floor(Number(body.maxUses) || 0));
    store.coupons = store.coupons || [];
    const cur = store.coupons.find((x) => x.code === code);
    const rec = {
      code,
      pct,
      amount: Math.round(amount * 100) / 100,
      maxUses,
      uses: (cur && Number(cur.uses) || 0),
      minTotal: Math.max(0, Number(body.minTotal) || 0),
      expires: body.expires ? new Date(body.expires).toISOString() : null,
      active: body.active === false ? false : true,
      note: String(body.note || "").slice(0, 80),
      created: (cur && cur.created) || new Date().toISOString(),
    };
    if (cur) Object.assign(cur, rec); else store.coupons.push(rec);
    audit(user, "coupon", code + " " + (pct ? pct + "%" : "$" + rec.amount) + (maxUses ? " x" + maxUses : ""));
    saveStore(store);
    return send(res, 200, { ok: true, coupons: store.coupons });
  }

  if (method === "POST" && route === "/api/ops/affiliates") {
    if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
    let body;
    try { body = await readBody(req); } catch { return send(res, 400, { error: "bad_request" }); }
    const code = String(body.code || "").trim().toUpperCase();
    const aff = (store.affiliates || []).find((a) => a.code === code);
    if (!aff) return send(res, 404, { error: "not_found" });
    const status = String(body.status || "");
    if (status !== "live" && status !== "suspended" && status !== "removed") return send(res, 400, { error: "status" });
    aff.status = status;
    audit(user, "affiliate", code + " " + status);
    saveStore(store);
    return send(res, 200, { ok: true });
  }

  if (method === "POST" && route === "/api/ops/affiliates/create") {
    if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
    let body;
    try { body = await readBody(req); } catch { return send(res, 400, { error: "bad_request" }); }
    const email = String(body.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) return send(res, 400, { error: "email" });
    store.affiliates = store.affiliates || [];
    let code = String(body.code || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 16);
    if (!code) {
      const base = email.split("@")[0].toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "HK";
      code = base + token().slice(0, 4).toUpperCase();
    }
    if (code.length < 3 || code === "HELIX10") return send(res, 400, { error: "code" });
    if (store.affiliates.some((a) => a.code === code)) return send(res, 400, { error: "code_taken" });
    const linked = (store.users || []).find((u) => String(u.email || "").toLowerCase() === email);
    const aff = {
      userId: linked ? linked.id : null,
      email,
      code,
      status: "live",
      paid: 0,
      manual: true,
      created: new Date().toISOString(),
    };
    store.affiliates.push(aff);
    audit(user, "affiliate", "created " + code + " for " + email);
    saveStore(store);
    return send(res, 200, { ok: true, affiliate: aff });
  }

  if (method === "POST" && route === "/api/ops/affiliates/payout") {
    if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
    let body;
    try { body = await readBody(req); } catch { return send(res, 400, { error: "bad_request" }); }
    const code = String(body.code || "").trim().toUpperCase();
    const aff = (store.affiliates || []).find((a) => a.code === code);
    if (!aff) return send(res, 404, { error: "not_found" });
    const amount = Math.round(Number(body.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) return send(res, 400, { error: "amount" });
    aff.paid = Math.round((Number(aff.paid || 0) + amount) * 100) / 100;
    for (const r of store.payoutRequests || []) {
      if (r.code === code && r.status === "pending") { r.status = "paid"; r.paidAt = new Date().toISOString(); }
    }
    audit(user, "affiliate", code + " paid $" + amount.toFixed(2));
    saveStore(store);
    return send(res, 200, { ok: true, paid: aff.paid });
  }

  if (method === "GET" && route === "/api/ops/export") {
    if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
    const kind = url.searchParams.get("kind") || "orders";
    const csv = kind === "inventory" ? inventoryCsvExport() : ordersCsvExport();
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="helix-${kind}.csv"`,
    });
    return res.end(csv);
  }

  if (method === "POST" && route === "/api/ops/inventory") {
    if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
    let body;
    try { body = await readBody(req); } catch { return send(res, 400, { error: "bad_request" }); }
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
      item.cost = Number.isFinite(n) ? n : item.cost;
    }
    if (body.certificate === "accepted" || body.certificate === "pending") item.certificateStatus = body.certificate;
    if (Number(item.stock || 0) > 0) item.everStocked = true;
    item.available = Math.max(0, Number(item.stock || 0) - Number(item.reserved || 0));
    attachCertificates();
    item.stockStatus = stockStatus(item.available, item.stockThreshold || STOCK_THRESHOLD);
    writeInventoryCsv();
    writePricingCsv();
    fs.writeFileSync(path.join(DATA, "products.json"), JSON.stringify(products, null, 2));
    audit(user, "inventory", item.sku);
    saveStore(store);
    // Restock: if this SKU went from 0 to available, notify the waitlist.
    let waitlistNotified = 0;
    if (wasAvailable <= 0 && item.available > 0 && typeof emailListHandle.checkWaitlist === "function") {
      const origin = authx.requestOrigin(req);
      waitlistNotified = emailListHandle.checkWaitlist(item.sku, item.name + " " + (item.size || ""), origin) || 0;
    }
    return send(res, 200, { ok: true, waitlistNotified });
  }

  if (method === "POST" && route === "/api/ops/disputes") {
    if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
    let body;
    try { body = await readBody(req); } catch { return send(res, 400, { error: "bad_request" }); }
    const order = (store.orders || []).find((o) => o.id === body.orderId);
    if (!order) return send(res, 404, { error: "not_found" });
    store.disputes = store.disputes || [];
    store.disputes.unshift({
      id: "DP-" + token().slice(0, 6).toUpperCase(),
      orderId: order.id,
      rail: String(body.rail || order.paymentMethod || "").slice(0, 24),
      note: String(body.note || "").slice(0, 400),
      status: "open",
      created: new Date().toISOString(),
    });
    order.dispute = "open";
    audit(user, "dispute", order.id);
    saveStore(store);
    return send(res, 200, { ok: true });
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

  if (method === "POST" && route === "/api/wholesale") {
    let body;
    try { body = await readBody(req); } catch { return send(res, 400, { error: "bad_request" }); }
    const email = String(body.email || "").toLowerCase().trim();
    const name = String(body.name || "").trim().slice(0, 80);
    if (!validEmail(email) || !name) return send(res, 400, { error: "contact" });
    store.wholesale = store.wholesale || [];
    const request = {
      id: "WH-" + token().slice(0, 8).toUpperCase(),
      name,
      email,
      organization: String(body.organization || "").slice(0, 120),
      volume: String(body.volume || "").slice(0, 160),
      interest: String(body.interest || "").slice(0, 500),
      note: String(body.note || "").slice(0, 500),
      status: "pending_review",
      created: new Date().toISOString(),
    };
    store.wholesale.push(request);
    saveStore(store);
    const box = loadOutbox();
    box.messages.push({
      to: "wholesale@helixkinglabs.com",
      subject: "Wholesale request " + request.id,
      text: [request.id, name, email, request.organization, request.volume, request.interest, request.note].join("\n"),
      created: new Date().toISOString(),
    });
    saveOutbox(box);
    return send(res, 200, { request, mailto: "wholesale@helixkinglabs.com" });
  }

  if (method === "GET" && route === "/api/group-buy") {
    const file = path.join(DATA, "group-buy.json");
    const raw = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { items: [] };
    const closed = raw.closes && Date.now() > new Date(raw.closes).getTime();
    raw.status = closed ? "closed" : "open";
    if (closed) {
      raw.archive = raw.archive || [];
      if (!raw.archive.some((a) => a.id === raw.id && a.status === "closed")) {
        raw.archive = raw.archive.filter((a) => a.id !== raw.id);
        raw.archive.unshift({ id: raw.id, date: String(raw.closes).slice(0, 10), title: raw.title, status: "closed", coa: "pending", items: raw.items });
      }
      fs.writeFileSync(file, JSON.stringify(raw, null, 2));
    }
    const pub = { ...raw };
    delete pub.password;
    return send(res, 200, pub);
  }

  if (method === "POST" && route === "/api/group-buy/order") {
    let body;
    try { body = await readBody(req); } catch { return send(res, 400, { error: "bad_request" }); }
    if (String(body.password || "") !== "HELIXGB") return send(res, 401, { error: "password" });
    if (!user) return send(res, 401, { error: "account_required" });
    const file = path.join(DATA, "group-buy.json");
    const gb = JSON.parse(fs.readFileSync(file, "utf8"));
    if (gb.closes && Date.now() > new Date(gb.closes).getTime()) return send(res, 409, { error: "closed" });
    const lines = [];
    for (const item of body.items || []) {
      const sku = gb.items.find((x) => x.sku === item.sku);
      const qty = Math.max(0, Math.floor(Number(item.qty) || 0));
      if (!sku || !qty) continue;
      const shopSku = String(sku.sku || "").replace(/-KIT$/i, "");
      const stockItem = findProduct(shopSku);
      const onHand = stockItem ? Number(stockItem.available != null ? stockItem.available : stockItem.stock || 0) : 0;
      const kitMax = onHand >= 15 ? Math.floor(onHand / 10) : 0;
      if (qty > kitMax) return send(res, 409, { error: "insufficient_stock", sku: shopSku, requested: qty, availableKits: kitMax });
      lines.push({ sku: sku.sku, name: sku.name, size: sku.size, qty, unit: "kit", vials: qty * 10, price: sku.price, line: Math.round(sku.price * qty * 100) / 100 });
    }
    if (!lines.length) return send(res, 400, { error: "empty" });
    const merchandise = Math.round(lines.reduce((a, l) => a + l.line, 0) * 100) / 100;
    const order = {
      id: "GB-" + token().slice(0, 8).toUpperCase(),
      channel: "group_buy",
      buyId: gb.id,
      userId: user.id,
      email: user.email,
      telegram: String(body.telegram || "").slice(0, 40),
      lines,
      shipping: 25,
      surcharge: 0,
      total: Math.round((merchandise + 25) * 100) / 100,
      paymentMethod: ["venmo", "cashapp", "crypto"].includes(body.paymentMethod) ? body.paymentMethod : "crypto",
      status: "awaiting_settlement",
      fulfillment: "hold_until_minimum",
      created: new Date().toISOString(),
    };
    gb.orders = gb.orders || [];
    gb.orders.push(order);
    for (const line of lines) {
      const row = gb.items.find((x) => x.sku === line.sku);
      row.kitsSold = (row.kitsSold || 0) + line.qty;
      const shopSku = String(line.sku || "").replace(/-KIT$/i, "");
      const stockItem = findProduct(shopSku);
      if (stockItem) {
        stockItem.stock = Math.max(0, Number(stockItem.stock || 0) - line.qty * 10);
        stockItem.available = Math.max(0, stockItem.stock - Number(stockItem.reserved || 0));
        stockItem.stockStatus = stockStatus(stockItem.available, stockItem.stockThreshold || STOCK_THRESHOLD);
      }
    }
    writeInventoryCsv();
    const stored = { ...order, stockDecremented: true, quote: { lines, total: order.total, shipping: 25, surcharge: 0 }, company: "", researchField: user.researchField || "" };
    if (order.paymentMethod === "crypto") stored.payment = await paymentsHandle.createNowPayment(stored, body.network);
    else stored.payment = { provider: order.paymentMethod, handle: order.paymentMethod === "venmo" ? "fibkingpeps" : "FibKingPep", status: "awaiting_confirmation", amount: order.total, note: order.id };
    if (order.paymentMethod === "crypto" && stored.payment && ["payment_failed", "key_missing", "invoice_pending"].includes(stored.payment.status)) {
      return send(res, 400, { error: "payment_unavailable", message: stored.payment.message || "Crypto payment is not available." });
    }
    order.payment = stored.payment;
    fs.writeFileSync(file, JSON.stringify(gb, null, 2));
    store.orders.push(stored);
    saveStore(store);
    queueMail(orderMail(stored, "placed"));
    return send(res, 200, { order: stored });
  }


  if (await paymentsHandle(req, res, url)) return;
  if (await opsCatalogHandle(req, res, url, user)) return;
  if (await emailListHandle(req, res, url, user)) return;
  if (await fulfillHandle(req, res, url, user)) return;
  if (await suggestHandle(req, res, url, user)) return;
  if (await wholesaleHandle(req, res, url, user)) return;

  return send(res, 404, { error: "not_found" });
}

const RESEARCH_FIELDS = [
  "Independent Researcher",
  "Molecular Biology",
  "Biochemistry",
  "Peptide Chemistry",
  "Chemical Biology",
  "Biotechnology Research",
  "Academic Research",
  "Pharmacology",
];

function audit(user, action, detail) {
  store.audit = store.audit || [];
  store.audit.unshift({
    at: new Date().toISOString(),
    by: user && user.email,
    action,
    detail: String(detail || "").slice(0, 80),
  });
  store.audit = store.audit.slice(0, 200);
}

function deskPayload() {
  const orders = (store.orders || []).slice().reverse();
  const awaiting = orders.filter((o) => o.status === "awaiting_settlement").length;
  const holds = orders.filter((o) => o.fulfillment === "hold" || o.status === "awaiting_settlement").length;
  const inventory = products.items.filter(shopVisibleOf).map((it) => {
    const price = it.price;
    const cost = it.cost;
    const margin = price != null && cost != null ? Math.round((Number(price) - Number(cost)) * 100) / 100 : null;
    return {
      sku: it.sku,
      name: it.name,
      size: it.size,
      lot: it.lot || "",
      on_hand: Number(it.stock || 0),
      available: Number(it.available != null ? it.available : it.stock || 0),
      unit_cost: cost,
      price,
      margin,
      certificate: it.certificateStatus || "pending",
      low: Number(it.available != null ? it.available : it.stock || 0) < 3,
    };
  });
  return {
    summary: {
      orders: orders.length,
      awaiting,
      holds,
      low: inventory.filter((r) => r.low).length,
      accounts: (store.users || []).length,
      list: (store.captures || []).length,
      stale: (store.orders || []).filter((o) => o.status === "awaiting_settlement" && staleAge(o)).length,
    },
    orders: orders.map((o) => ({
      id: o.id,
      channel: o.channel || "shop",
      email: o.email,
      name: o.name || (o.ship && o.ship.name) || "",
      phone: o.phone || (o.ship && o.ship.phone) || "",
      company: o.company || "",
      researchField: o.researchField || "",
      researchAck: !!o.researchAck,
      telegram: o.telegram || "",
      ship: o.ship || null,
      paymentMethod: o.paymentMethod || o.settlement || "",
      payment: o.payment || null,
      paymentStatus: (o.payment && o.payment.status) || "",
      status: o.status,
      fulfillment: o.fulfillment || "hold",
      total: o.quote && o.quote.total,
      merchandise: o.quote && o.quote.merchandise,
      shipping: o.quote && o.quote.shipping,
      surcharge: o.quote && o.quote.surcharge,
      coupon: o.quote && o.quote.coupon,
      couponOff: o.quote && o.quote.couponOff,
      affiliateCode: o.affiliateCode || "",
      affiliatePayout: o.affiliatePayout || 0,
      tracking: o.tracking || "",
      carrier: o.carrier || "",
      internalNote: o.internalNote || "",
      dispute: o.dispute || "",
      created: o.created,
      settledAt: o.settledAt || "",
      shippedAt: o.shippedAt || "",
      voidedAt: o.voidedAt || "",
      events: o.events || [],
      lines: ((o.quote && o.quote.lines) || []).map((l) => ({
        sku: l.sku || "",
        name: l.name || "",
        size: l.size || "",
        qty: l.qty,
        kind: l.kind || "vial",
        lot: l.lot || "",
        unit: l.unit,
        line: l.line,
      })),
    })),
    captures: (store.captures || []).slice().reverse(),
    opsEmails: [...OPS_EMAILS],
    inventory,
    customers: (store.users || []).map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      company: u.company || "",
      researchField: u.researchField || "",
      orders: (store.orders || []).filter((o) => o.userId === u.id).length,
    })),
    disputes: store.disputes || [],
    affiliates: (store.affiliates || []).map((a) => ({
      code: a.code || "",
      email: a.email || "",
      userId: a.userId || "",
      status: a.status || "",
      paid: Number(a.paid || 0),
      created: a.created || "",
      earned: Math.round(referredOrders(a.code).reduce((sum, o) => sum + Number(o.affiliatePayout || 0), 0) * 100) / 100,
      tax: a.tax ? { ...a.tax, taxId: decTaxId(a.tax.taxIdEnc) || "unavailable", taxIdEnc: undefined } : null,
      payoutMethod: a.payoutMethod || null,
      payoutDetail: a.payoutDetail || null,
    })),
    coupons: store.coupons || [],
    payoutRequests: (store.payoutRequests || []).filter((r) => r.status === "pending"),
    audit: (store.audit || []).slice(0, 12),
  };
}

function ordersCsvExport() {
  const lines = ["id,email,company,field,rail,status,fulfillment,total,tracking,created"];
  for (const o of store.orders || []) {
    lines.push([o.id, o.email, o.company || "", o.researchField || "", o.paymentMethod || "", o.status, o.fulfillment || "", (o.quote && o.quote.total) || "", o.tracking || "", o.created || ""].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  }
  return lines.join("\n");
}

function inventoryCsvExport() {
  const lines = ["sku,name,size,lot,on_hand,cost,price,certificate"];
  for (const it of products.items.filter(shopVisibleOf)) {
    lines.push([it.sku, it.name, it.size, it.lot || "", it.stock || 0, it.cost == null ? "" : it.cost, it.price == null ? "" : it.price, it.certificateStatus || "pending"].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  }
  return lines.join("\n");
}

function escHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "\u0026amp;")
    .replace(/</g, "\u0026lt;")
    .replace(/>/g, "\u0026gt;")
    .replace(/"/g, "\u0026quot;");
}

function shopFamilies() {
  return (products.families || []).filter((f) => familyVisibleOf(f));
}

function familyItems(f) {
  return products.items.filter((it) => it.family === f.id && shopVisibleOf(it));
}

function knownPaths() {
  const paths = new Set([
    "/",
    "/shop",
    "/about",
    "/certificates",
    "/testing",
    "/tools",
    "/tools/calculator",
    "/terms",
    "/privacy",
    "/do-not-sell",
    "/do-not-sell-or-share",
    "/shipping",
    "/refunds",
    "/returns",
    "/chargebacks",
    "/chargeback",
    "/use",
    "/wholesale",
    "/group-buy",
    "/group-buys",
    "/account",
    "/cart",
    "/ops",
    "/ops/catalog",
    "/unsubscribe",
    "/welcome",
    "/library",
  ]);
  for (const f of shopFamilies()) paths.add("/product/" + (f.slug || f.id));
  return paths;
}

function pageModel(pathname) {
  const origin = "https://helixkinglabs.com";
  if (pathname === "/") {
    return {
      title: "Helix King Labs — Premium research peptides",
      description: "Premium research peptides with a lot on the vial. Research use only. Not a clinic. Not a pharmacy.",
      canonical: origin + "/",
      h1: "Premium research peptides.",
      body: "<p>Research-use materials only. Not for human or animal consumption.</p>",
      schema: {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: (copyDeck.faq || []).map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    };
  }
  if (pathname === "/shop") {
    const GLP_ORDER = ["pgl-gic1", "pgl-gi1", "pgl-g1", "pgl-el1", "cgl-1", "pgl-el1-pair", "pgl-sr1"];
    const glpRank = (f) => {
      const i = GLP_ORDER.indexOf(f.id);
      return i < 0 ? 999 : i;
    };
    const cards = shopFamilies()
      .sort((a, b) => glpRank(a) - glpRank(b))
      .map((f) => {
        const items = familyItems(f).filter((it) => it.price != null && it.releaseState !== "pending_testing");
        const from = items.length ? Math.min(...items.map((it) => Number(it.price))) : null;
        const price = from != null ? "From $" + from : "Certificate pending";
        return `<li><a href="/product/${escHtml(f.slug || f.id)}">${escHtml(f.name)}</a> — ${escHtml(price)}</li>`;
      })
      .join("");
    return {
      title: "Research peptide catalog — Helix King Labs",
      description: "Premium research peptides. List prices after the age gate. Account required to purchase. Research use only.",
      canonical: origin + "/shop",
      h1: "Research catalog",
      body: `<ul>${cards}</ul>`,
    };
  }
  if (pathname.startsWith("/product/")) {
    const slug = pathname.split("/")[2];
    const fam = shopFamilies().find((f) => f.slug === slug || f.id === slug);
    if (!fam) return null;
    const items = familyItems(fam);
    const live = items.filter((it) => it.price != null && it.releaseState !== "pending_testing");
    const offers = live.map((it) => ({
      "@type": "Offer",
      sku: it.sku,
      price: Number(it.price),
      priceCurrency: "USD",
      availability: Number(it.available || it.stock || 0) > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: origin + "/product/" + (fam.slug || fam.id),
    }));
    const sizes = items.map((it) => `${escHtml(it.size)} · $${escHtml(it.price)}`).join("</li><li>");
    const desc = String(fam.blurb || fam.name + " research material.").replace(/\s+/g, " ").trim();
    return {
      title: fam.name + " | Helix King Labs",
      description: desc.slice(0, 160),
      canonical: origin + "/product/" + (fam.slug || fam.id),
      h1: fam.name,
      body: `<p>${escHtml(desc)}</p><p>All products listed on this site are for research purposes only.</p><ul><li>${sizes}</li></ul>`,
      schema: {
        "@context": "https://schema.org",
        "@type": "Product",
        name: fam.name,
        brand: { "@type": "Brand", name: "Helix King Labs" },
        description: desc,
        offers: offers,
      },
    };
  }
  const legal = {
    "/terms": ["Terms and conditions — Helix King Labs", "Terms and Conditions of Use and Purchase"],
    "/privacy": ["Privacy notice — Helix King Labs", "Privacy Notice"],
    "/do-not-sell": ["Do not sell or share — Helix King Labs", "Do Not Sell or Share My Personal Information"],
    "/do-not-sell-or-share": ["Do not sell or share — Helix King Labs", "Do Not Sell or Share My Personal Information"],
    "/shipping": ["Shipping policy — Helix King Labs", "Shipping Policy"],
    "/refunds": ["Refund and returns — Helix King Labs", "Refund and Returns Policy"],
    "/returns": ["Refund and returns — Helix King Labs", "Refund and Returns Policy"],
    "/chargebacks": ["Chargeback policy — Helix King Labs", "Chargeback and Payment Dispute Policy"],
    "/chargeback": ["Chargeback policy — Helix King Labs", "Chargeback and Payment Dispute Policy"],
    "/use": ["Permitted use — Helix King Labs", "Permitted Use"],
    "/about": ["About Helix King Labs", "A research catalog with a lot on the vial."],
    "/certificates": ["Certificates of analysis — Helix King Labs", "Certificates"],
    "/testing": ["Peptide testing methods — Helix King Labs", "Testing methods"],
    "/tools": ["Research calculator — Helix King Labs", "Research calculator"],
    "/tools/calculator": ["Research calculator — Helix King Labs", "Research calculator"],
  };
  if (legal[pathname]) {
    return {
      title: legal[pathname][0],
      description: legal[pathname][1] + ". Helix King Labs. Research use only.",
      canonical: origin + pathname.replace("/returns", "/refunds").replace("/chargeback", "/chargebacks").replace("/do-not-sell-or-share", "/do-not-sell"),
      h1: legal[pathname][1],
      body: "<p>All products listed on this site are for research purposes only. Not for human dosing, injection, or ingestion.</p>",
    };
  }
  return {
    title: "Helix King Labs",
    description: "Premium research peptides. Research use only.",
    canonical: origin + pathname,
    h1: "Helix King Labs",
    body: "",
  };
}

function injectDocument(buf, pathname, status) {
  const model = pageModel(pathname) || {
    title: "Not found — Helix King Labs",
    description: "This page is not on the Helix King Labs catalog.",
    canonical: "https://helixkinglabs.com" + pathname,
    h1: "Not found",
    body: "<p>This address is not a catalog page.</p>",
  };
  let html = buf.toString("utf8");
  html = html.replace(/<title>[^<]*<\/title>/, "<title>" + escHtml(model.title) + "</title>");
  html = html.replace(
    /(<meta name="description" content=")[^"]*(")/,
    "$1" + escHtml(model.description) + "$2"
  );
  html = html.replace(
    /(<link rel="canonical" href=")[^"]*(")/,
    "$1" + escHtml(model.canonical) + "$2"
  );
  const schema = model.schema
    ? `<script type="application/ld+json" id="hkl-schema">${JSON.stringify(model.schema).replace(/</g, "\\u003c")}</script>`
    : "";
  const block = `${schema}<main id="app"><article class="page wrap"><h1>${escHtml(model.h1)}</h1>${model.body}</article></main>`;
  html = html.replace('<main id="app"></main>', block);
  if (status === 404 || pathname === "/group-buy" || pathname === "/group-buys") html = html.replace('content="index,follow', 'content="noindex,follow');
  return html;
}

function sitemapXml() {
  const origin = "https://helixkinglabs.com";
  const urls = ["/", "/shop", "/about", "/certificates", "/testing", "/tools/calculator", "/terms", "/privacy", "/do-not-sell", "/shipping", "/refunds", "/chargebacks", "/use"]
    .concat(shopFamilies().map((f) => "/product/" + (f.slug || f.id)));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${origin}${u}</loc></url>`)
    .join("\n")}\n</urlset>\n`;
}

function safePublic(rel) {
  const resolved = path.resolve(PUBLIC, rel);
  if (!resolved.startsWith(PUBLIC)) return null;
  return resolved;
}

function htmlHeaders(status) {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Strict-Transport-Security": "max-age=15552000; includeSubDomains",
    "Content-Security-Policy": "frame-ancestors 'none'",
  };
}

function serveStatic(req, res, urlPath) {
  const pathname = decodeURIComponent(urlPath.split("?")[0] || "/");
  const rel = pathname === "/" ? "/index.html" : pathname;
  const file = safePublic(rel.replace(/^\/+/, ""));
  const isAsset = file && fs.existsSync(file) && fs.statSync(file).isFile() && !rel.endsWith(".html");
  if (isAsset) {
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=86400",
    });
    return fs.createReadStream(file).pipe(res);
  }
  if (!file && pathname.includes("..")) {
    res.writeHead(403);
    return res.end();
  }
  const status = knownPaths().has(pathname) || pathname.startsWith("/account") || pathname.startsWith("/ops/orders/") || pathname === "/magic" ? 200 : 404;
  const opsDesk = pathname === "/ops";
  const index = path.join(PUBLIC, opsDesk ? "ops.html" : "index.html");
  fs.readFile(index, (e2, buf) => {
    if (e2) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(status, htmlHeaders(status));
    res.end(opsDesk ? buf : injectDocument(buf, pathname, status));
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/sitemap.xml") {
      res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" });
      return res.end(sitemapXml());
    }
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


function queueMail(msg) {
  if (!msg || !msg.to) return;
  const box = loadOutbox();
  box.messages.push(msg);
  saveOutbox(box);
  drainOutbox().catch(() => {});
}
async function drainOutbox() {
  if (!mailer.configured()) return;
  const box = loadOutbox();
  let changed = false;
  for (const msg of box.messages || []) {
    if (msg.status === "sent") continue;
    if (msg.status === "failed" && Number(msg.attempts || 0) >= 3) continue;
    try {
      await mailer.sendMail(msg);
      msg.status = "sent";
      msg.sentAt = new Date().toISOString();
    } catch (err) {
      msg.status = "failed";
      msg.attempts = Number(msg.attempts || 0) + 1;
      msg.error = String(err.message || err).slice(0, 160);
    }
    changed = true;
  }
  if (changed) saveOutbox(box);
}
function staleAge(order) {
  const age = Date.now() - new Date(order.created || 0).getTime();
  const cutoff = order.paymentMethod === "crypto" ? 60 * 60 * 1000 : 4 * 60 * 60 * 1000;
  return Number.isFinite(age) && age >= cutoff;
}
function affiliateBalance(aff) {
  const earned = referredOrders(aff.code).reduce((sum, o) => sum + Number(o.affiliatePayout || 0), 0);
  const paid = Number(aff.paid || 0);
  const pending = (store.payoutRequests || [])
    .filter((r) => r.code === aff.code && r.status === "pending")
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);
  return { earned, paid, available: Math.round((earned - paid - pending) * 100) / 100 };
}

function expireStaleAffiliates() {
  const TWO_YEARS = 2 * 365 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  let changed = 0;
  for (const aff of store.affiliates || []) {
    if (aff.status !== "live") continue;
    const orders = referredOrders(aff.code);
    const lastUse = orders.length
      ? Math.max(...orders.map((o) => new Date(o.created || 0).getTime()))
      : new Date(aff.created || 0).getTime();
    if (now - lastUse > TWO_YEARS) {
      aff.status = "expired";
      aff.expiredAt = new Date().toISOString();
      audit(null, "affiliate", aff.code + " expired after 2 years unused");
      changed++;
    }
  }
  if (changed) saveStore(store);
  return changed;
}

function sweepYearEndPayouts() {
  const now = new Date();
  if (now.getMonth() !== 11 || now.getDate() !== 31) return 0;
  const year = now.getFullYear();
  store.payoutRequests = store.payoutRequests || [];
  let created = 0;
  for (const aff of store.affiliates || []) {
    if (aff.status !== "live") continue;
    const { available } = affiliateBalance(aff);
    if (available < 50) continue;
    const method = aff.payoutMethod, detail = aff.payoutDetail;
    if ((method !== "crypto" && method !== "cashapp") || !detail) continue;
    if (store.payoutRequests.some((r) => r.code === aff.code && r.status === "pending")) continue;
    store.payoutRequests.push({
      id: "PR" + Date.now().toString(36).toUpperCase() + created,
      code: aff.code,
      email: aff.email || "",
      amount: available,
      method,
      detail,
      requested: now.toISOString(),
      status: "pending",
      auto: "year-end-" + year,
    });
    created++;
  }
  if (created) {
    audit(null, "affiliate", created + " year-end auto-payouts created");
    saveStore(store);
  }
  return created;
}

function dailyAffiliateMaintenance() {
  try {
    expireStaleAffiliates();
    sweepYearEndPayouts();
  } catch (err) {
    console.error("affiliate maintenance:", err.message);
  }
}

function sweepStaleOrders() {
  let released = 0;
  for (const order of store.orders || []) {
    if (order.status !== "awaiting_settlement" || !staleAge(order)) continue;
    if (order.wholesale) continue;
    if (order.payment && order.payment.underpaidAt && Date.now() - new Date(order.payment.underpaidAt).getTime() < 7200000) continue;
    restoreStock(order);
    order.stockDecremented = false;
    order.status = "voided";
    order.fulfillment = "void";
    order.voidedAt = new Date().toISOString();
    order.events = order.events || [];
    order.events.push({ at: new Date().toISOString(), kind: "voided", by: "sweep" });
    audit({ email: "sweep" }, "order", order.id + " stale void");
    queueMail(mailer.abandonmentMail(order, {origin: PUBLIC_ORIGIN || "https://helixkinglabs.com"}, !hasOrdered(order.userId)));
    released += 1;
  }
  if (released) saveStore(store);
  return released;
}let rechecking = false;sweepStaleOrders();
dailyAffiliateMaintenance();
drainOutbox().catch(() => {});
setInterval(() => sweepStaleOrders(), 5 * 60 * 1000);
setInterval(() => dailyAffiliateMaintenance(), 24 * 60 * 60 * 1000);
setInterval(() => drainOutbox().catch(() => {}), 5 * 60 * 1000);
setInterval(() => paymentsHandle.recheckPendingCrypto().catch(() => {}), 3 * 60 * 1000);
setTimeout(() => paymentsHandle.recheckPendingCrypto().catch(() => {}), 60 * 1000);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Helix King Labs storefront shell → http://0.0.0.0:${PORT}`);
});
