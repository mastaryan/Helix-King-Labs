"use strict";

const crypto = require("node:crypto");

const FROM = process.env.SMTP_FROM || "orders@helixkinglabs.com";
const ORIGIN = (process.env.HKL_PUBLIC_ORIGIN || "https://helixkinglabs.com").replace(/\/$/, "");

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

// ---- Customer TOTP (2FA) helpers — same algorithm as ops 2FA ----
function b32encode(buf) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5) {
    out += alphabet[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  }
  return out;
}
function b32decode(s) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of String(s).toUpperCase().replace(/=+$/, "")) {
    const i = alphabet.indexOf(ch);
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

// Queue the message, then attempt an immediate send through the shared
// mailer (Resend HTTPS API when RESEND_API_KEY is set, else SMTP).
// The queued copy is marked sent on success so the 5-minute drain
// does not send a duplicate; on failure it stays queued for retry.
async function deliver(loadOutbox, saveOutbox, sendNow, message) {
  const box = loadOutbox();
  box.messages = box.messages || [];
  const entry = {
    ...message,
    from: FROM,
    created: new Date().toISOString(),
    status: "queued",
    attempts: 0,
  };
  box.messages.push(entry);
  saveOutbox(box);
  if (typeof sendNow === "function") {
    try {
      await sendNow(message);
      entry.status = "sent";
      entry.sentAt = new Date().toISOString();
    } catch (err) {
      entry.status = "failed";
      entry.attempts = 1;
      entry.error = String((err && err.message) || err).slice(0, 160);
    }
    saveOutbox(box);
  }
  return { ok: true, sent: entry.status === "sent" };
}

function issueMagic(store, email) {
  const token = crypto.randomBytes(32).toString("base64url");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  store.magic = (store.magic || []).filter((m) => m.exp > Date.now());
  store.magic.push({ hash, email, exp: Date.now() + 20 * 60 * 1000 });
  return token;
}

function takeMagic(store, token) {
  const hash = crypto.createHash("sha256").update(String(token || "")).digest("hex");
  const row = (store.magic || []).find((m) => m.hash === hash && m.exp > Date.now());
  store.magic = (store.magic || []).filter((m) => m.hash !== hash);
  return row || null;
}

function issueChallenge(store, key) {
  const challenge = b64url(crypto.randomBytes(32));
  store.challenges = store.challenges || {};
  store.challenges[key] = { challenge, exp: Date.now() + 5 * 60 * 1000 };
  return challenge;
}

function takeChallenge(store, key) {
  const row = store.challenges && store.challenges[key];
  if (!row || row.exp < Date.now()) return null;
  delete store.challenges[key];
  return row.challenge;
}

// Resolve the logged-in user from the hkl_sid session cookie.
// Self-contained so auth routes don't need server.js changes.
function sessionUserFromCookie(req, store) {
  const jar = {};
  for (const part of String((req.headers && req.headers.cookie) || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) { try { jar[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch (_) {} }
  }
  const sid = jar.hkl_sid;
  const sess = sid && (store.sessions || []).find((s) => s.id === sid && s.exp > Date.now());
  return (sess && (store.users || []).find((x) => x.id === sess.userId)) || null;
}

function checkPasswordLocal(password, salt, derived) {
  try {
    const test = crypto.scryptSync(String(password), String(salt), 32);
    const known = Buffer.from(String(derived), "hex");
    if (test.length !== known.length) return false;
    return crypto.timingSafeEqual(test, known);
  } catch (_) { return false; }
}

function verifyClient(clientDataJSON, expectedType, challenge, origin) {
  let data;
  try {
    data = JSON.parse(Buffer.from(clientDataJSON, "base64url").toString("utf8"));
  } catch {
    return false;
  }
  return data.type === expectedType && data.challenge === challenge && String(data.origin || "") === origin;
}

function verifyAssertion(publicKey, authenticatorData, clientDataJSON, signature) {
  const hash = crypto.createHash("sha256").update(Buffer.from(clientDataJSON, "base64url")).digest();
  const signed = Buffer.concat([Buffer.from(authenticatorData, "base64url"), hash]);
  const sig = Buffer.from(signature, "base64url");
  const key = crypto.createPublicKey({ key: Buffer.from(publicKey, "base64url"), format: "der", type: "spki" });
  return crypto.verify(null, signed, key, sig);
}

function requestOrigin(req) {
  const host = req.headers.host || "localhost";
  const proto = req.headers["x-forwarded-proto"] || (String(host).includes("localhost") ? "http" : "https");
  return proto + "://" + host;
}

function rpId(origin) {
  try {
    return new URL(origin).hostname;
  } catch {
    return "helixkinglabs.com";
  }
}


async function pwReset(req, res, url, ctx) {
  const { method } = req;
  const route = url.pathname;
  const { store, saveStore, setSession, publicUser, validEmail, hashPassword, loadOutbox, saveOutbox, mailer, limited, ip } = ctx;
  const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); return true; };
  const readBody = () => new Promise((resolve, reject) => {
    let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { reject(new Error("bad")); } }); req.on("error", reject);
  });
  if (method === "POST" && route === "/api/auth/password/forgot") {
    if (limited(ip, "forgot", 6, 15 * 60 * 1000)) return send(429, { error: "rate" });
    let body; try { body = await readBody(); } catch { return send(400, { error: "bad_request" }); }
    const email = String(body.email || "").toLowerCase().trim();
    if (!validEmail(email)) return send(400, { error: "email" });
    const u = store.users.find((x) => x.email === email);
    if (u) {
      const token = issueMagic(store, email + "|reset");
      saveStore(store);
      const link = requestOrigin(req) + "/reset?token=" + encodeURIComponent(token);
      await deliver(loadOutbox, saveOutbox, mailer.sendMail, {
        to: email, subject: "Reset your Helix King Labs password",
        text: "Reset your password:\n\n" + link + "\n\nThis link expires in 20 minutes. If you did not request it, ignore this email.",
      });
    }
    return send(200, { ok: true });
  }
  if (method === "POST" && route === "/api/auth/password/reset") {
    let body; try { body = await readBody(); } catch { return send(400, { error: "bad_request" }); }
    const row = takeMagic(store, body.token);
    if (!row || !String(row.email || "").endsWith("|reset")) return send(400, { error: "token" });
    const email = String(row.email).slice(0, -6);
    const pw = String(body.password || "");
    if (pw.length < 8) return send(400, { error: "password_length" });
    const u = store.users.find((x) => x.email === email);
    if (!u) return send(400, { error: "token" });
    const h = hashPassword(pw);
    u.salt = h.salt; u.derived = h.derived;
    saveStore(store);
    setSession(res, u.id);
    return send(200, { user: publicUser(u) });
  }
  // Set (or change) a password for the currently logged-in user.
  // No email round-trip: the session cookie proves identity.
  if (method === "POST" && route === "/api/auth/password/set") {
    if (limited(ip, "pwset", 10, 15 * 60 * 1000)) return send(429, { error: "rate" });
    const u = sessionUserFromCookie(req, store);
    if (!u) return send(401, { error: "auth" });
    let body; try { body = await readBody(); } catch { return send(400, { error: "bad_request" }); }
    const pw = String(body.password || "");
    if (pw.length < 8 || pw.length > 72) return send(400, { error: "password_length" });
    const h = hashPassword(pw);
    u.salt = h.salt; u.derived = h.derived;
    if (u.provider === "magic") u.provider = "password";
    u.providers = Array.from(new Set([].concat(u.providers || [], ["password"])));
    u.mustChangePassword = false;
    saveStore(store);
    return send(200, { ok: true, user: publicUser(u) });
  }
  // Ops: reset a customer's password to a one-time temporary password.
  // The customer is logged out everywhere and must choose a new password on next sign-in.
  // The temp password is returned once — share it with the customer, it is never shown again.
  if (method === "POST" && route === "/api/ops/users/password-reset") {
    if (limited(ip, "ops-pwreset", 10, 15 * 60 * 1000)) return send(429, { error: "rate" });
    const me = sessionUserFromCookie(req, store);
    if (!me || !publicUser(me).isOps) return send(403, { error: "ops_only" });
    let body; try { body = await readBody(); } catch { return send(400, { error: "bad_request" }); }
    const id = String(body.id || "").trim();
    const email = String(body.email || "").toLowerCase().trim();
    const target = (store.users || []).find((u) => (id && u.id === id) || (email && String(u.email || "").toLowerCase() === email));
    if (!target) return send(404, { error: "not_found" });
    if (target.id === me.id) return send(400, { error: "cannot_reset_self" });
    if (publicUser(target).isOps) return send(400, { error: "cannot_reset_ops" });
    const temp = crypto.randomBytes(9).toString("base64url");
    const h = hashPassword(temp);
    target.salt = h.salt; target.derived = h.derived;
    if (target.provider === "magic") target.provider = "password";
    target.providers = Array.from(new Set([].concat(target.providers || [], ["password"])));
    target.mustChangePassword = true;
    store.sessions = (store.sessions || []).filter((s) => s.userId !== target.id);
    saveStore(store);
    return send(200, { ok: true, email: target.email, tempPassword: temp });
  }
  // Logged-in: security flags for the frontend (password set? forced change pending?).
  if (method === "GET" && route === "/api/auth/security") {
    const me = sessionUserFromCookie(req, store);
    if (!me) return send(401, { error: "auth" });
    return send(200, { ok: true, hasPassword: !!(me.salt && me.derived), mustChangePassword: !!me.mustChangePassword });
  }
  // Logged-in: change password. Forced resets (mustChangePassword) don't need the
  // current password — the fresh login with the temp password already proved identity.
  // Voluntary changes require the current password.
  if (method === "POST" && route === "/api/auth/password/change") {
    if (limited(ip, "pwchange", 10, 15 * 60 * 1000)) return send(429, { error: "rate" });
    const me = sessionUserFromCookie(req, store);
    if (!me) return send(401, { error: "auth" });
    let body; try { body = await readBody(); } catch { return send(400, { error: "bad_request" }); }
    const pw = String(body.password || "");
    if (pw.length < 8 || pw.length > 72) return send(400, { error: "password_length" });
    if (!me.mustChangePassword) {
      if (!checkPasswordLocal(body.currentPassword, me.salt, me.derived)) return send(401, { error: "credentials" });
    }
    const h = hashPassword(pw);
    me.salt = h.salt; me.derived = h.derived;
    me.mustChangePassword = false;
    if (me.provider === "magic") me.provider = "password";
    me.providers = Array.from(new Set([].concat(me.providers || [], ["password"])));
    saveStore(store);
    return send(200, { ok: true });
  }
  // ---- Customer 2FA (TOTP) ----
  // GET /api/auth/2fa/status -> { enabled }
  if (method === "GET" && route === "/api/auth/2fa/status") {
    const me = sessionUserFromCookie(req, store);
    if (!me) return send(401, { error: "auth" });
    return send(200, { enabled: !!me.totpEnabled });
  }
  // POST /api/auth/2fa/setup -> { secret, qr, uri } (does not enable yet)
  if (method === "POST" && route === "/api/auth/2fa/setup") {
    if (limited(ip, "2fa", 10, 15 * 60 * 1000)) return send(429, { error: "rate" });
    const me = sessionUserFromCookie(req, store);
    if (!me) return send(401, { error: "auth" });
    me.totpPending = b32encode(crypto.randomBytes(20));
    saveStore(store);
    const uri = `otpauth://totp/Helix%20King%20Labs:${encodeURIComponent(me.email)}?secret=${me.totpPending}&issuer=Helix%20King%20Labs`;
    let qr = null;
    try {
      const QRCode = require("qrcode");
      qr = await QRCode.toDataURL(uri, { margin: 1, width: 220, color: { dark: "#111111", light: "#ffffff" } });
    } catch {}
    return send(200, { secret: me.totpPending, qr, uri });
  }
  // POST /api/auth/2fa/confirm { code } -> enables 2FA
  if (method === "POST" && route === "/api/auth/2fa/confirm") {
    if (limited(ip, "2fa", 10, 15 * 60 * 1000)) return send(429, { error: "rate" });
    const me = sessionUserFromCookie(req, store);
    if (!me) return send(401, { error: "auth" });
    let body; try { body = await readBody(); } catch { return send(400, { error: "bad_request" }); }
    if (!me.totpPending || !totpOk(me.totpPending, body.code)) return send(401, { error: "code" });
    me.totpSecret = me.totpPending;
    me.totpEnabled = true;
    delete me.totpPending;
    // Recovery codes: 8 single-use, shown once
    me.totpRecovery = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString("hex").toUpperCase());
    saveStore(store);
    return send(200, { ok: true, recovery: me.totpRecovery });
  }
  // POST /api/auth/2fa/disable { password } -> disables 2FA
  if (method === "POST" && route === "/api/auth/2fa/disable") {
    if (limited(ip, "2fa", 10, 15 * 60 * 1000)) return send(429, { error: "rate" });
    const me = sessionUserFromCookie(req, store);
    if (!me) return send(401, { error: "auth" });
    let body; try { body = await readBody(); } catch { return send(400, { error: "bad_request" }); }
    if (me.derived && !checkPasswordLocal(body.password, me.salt, me.derived)) return send(401, { error: "credentials" });
    delete me.totpSecret; delete me.totpEnabled; delete me.totpPending; delete me.totpRecovery;
    saveStore(store);
    return send(200, { ok: true });
  }
  return false;
}

module.exports = {
  FROM,
  ORIGIN,
  deliver,
  issueMagic,
  takeMagic,
  issueChallenge,
  takeChallenge,
  verifyClient,
  verifyAssertion,
  requestOrigin,
  rpId,
  b64url,
  pwReset,
  totpOk,
};
