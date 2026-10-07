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
};
