"use strict";

const crypto = require("node:crypto");

const FROM = process.env.SMTP_FROM || "orders@helixkinglabs.com";
const ORIGIN = (process.env.HKL_PUBLIC_ORIGIN || "https://helixkinglabs.com").replace(/\/$/, "");

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
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
    const jar = {};
    for (const part of String(req.headers.cookie || "").split(";")) {
      const i = part.indexOf("=");
      if (i > 0) { try { jar[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch {} }
    }
    const sid = jar.hkl_sid;
    const sess = sid && (store.sessions || []).find((s) => s.id === sid && s.exp > Date.now());
    const u = sess && store.users.find((x) => x.id === sess.userId);
    if (!u) return send(401, { error: "auth" });
    let body; try { body = await readBody(); } catch { return send(400, { error: "bad_request" }); }
    const pw = String(body.password || "");
    if (pw.length < 8 || pw.length > 72) return send(400, { error: "password_length" });
    const h = hashPassword(pw);
    u.salt = h.salt; u.derived = h.derived;
    if (u.provider === "magic") u.provider = "password";
    u.providers = Array.from(new Set([].concat(u.providers || [], ["password"])));
    saveStore(store);
    return send(200, { ok: true, user: publicUser(u) });
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
};
