"use strict";

const crypto = require("node:crypto");
const net = require("node:net");
const tls = require("node:tls");

const FROM = process.env.SMTP_FROM || "orders@helixkinglabs.com";
const ORIGIN = (process.env.HKL_PUBLIC_ORIGIN || "https://helixkinglabs.com").replace(/\/$/, "");

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function queueMail(loadOutbox, saveOutbox, message) {
  const box = loadOutbox();
  box.messages = box.messages || [];
  box.messages.push({ ...message, from: FROM, created: new Date().toISOString(), status: "queued" });
  saveOutbox(box);
}

function smtpSend(message) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return Promise.resolve({ sent: false, reason: "smtp_not_configured" });
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = port === 465;
  return new Promise((resolve) => {
    const sock = secure
      ? tls.connect({ host, port, servername: host })
      : net.connect(port, host);
    let buf = "";
    let step = 0;
    const fail = () => {
      sock.destroy();
      resolve({ sent: false, reason: "smtp_failed" });
    };
    sock.setTimeout(12000, fail);
    const send = (line) => sock.write(line + "\r\n");
    const ehlo = () => send("EHLO helixkinglabs.com");
    sock.on("error", fail);
    sock.on("data", (chunk) => {
      buf += chunk.toString();
      if (!buf.includes("\n")) return;
      const line = buf.trim().split("\n").pop() || "";
      buf = "";
      const code = line.slice(0, 3);
      if (code[0] === "5" || code[0] === "4") return fail();
      if (step === 0 && code === "220") {
        step = 1;
        return ehlo();
      }
      if (step === 1 && code === "250") {
        if (!secure && /STARTTLS/i.test(line + buf)) {
          step = 2;
          return send("STARTTLS");
        }
        step = 3;
        return send("AUTH LOGIN");
      }
      if (step === 2 && code === "220") {
        const next = tls.connect({ socket: sock, servername: host });
        next.on("error", fail);
        next.on("secureConnect", () => {
          step = 1;
          next.write("EHLO helixkinglabs.com\r\n");
        });
        return;
      }
      if (step === 3 && code === "334") {
        step = 4;
        return send(Buffer.from(user).toString("base64"));
      }
      if (step === 4 && code === "334") {
        step = 5;
        return send(Buffer.from(pass).toString("base64"));
      }
      if (step === 5 && code === "235") {
        step = 6;
        return send("MAIL FROM:<" + FROM + ">");
      }
      if (step === 6 && code === "250") {
        step = 7;
        return send("RCPT TO:<" + message.to + ">");
      }
      if (step === 7 && code === "250") {
        step = 8;
        return send("DATA");
      }
      if (step === 8 && code === "354") {
        step = 9;
        const body = [
          "From: Helix King Labs <" + FROM + ">",
          "To: " + message.to,
          "Subject: " + message.subject,
          "Content-Type: text/plain; charset=utf-8",
          "",
          message.text,
          ".",
        ].join("\r\n");
        return send(body);
      }
      if (step === 9 && code === "250") {
        send("QUIT");
        sock.end();
        return resolve({ sent: true });
      }
    });
  });
}

async function deliver(loadOutbox, saveOutbox, message) {
  queueMail(loadOutbox, saveOutbox, message);
  return smtpSend(message);
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
