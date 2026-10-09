"use strict";

// Auth session layer: password hashing, sessions, JWT/social verification.
// Factory pattern matches email-list.js — dependencies are injected so
// server.js stays under the GitHub push size limit.

const crypto = require("node:crypto");
const https = require("node:https");

function createAuthSession({ store, saveStore, validEmail, SESSION_HOURS, SECURE_COOKIES, GOOGLE_CLIENT_ID, APPLE_CLIENT_ID, APPLE_ENABLED, AUTH_DEMO, PUBLIC_ORIGIN }) {
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

  return {
    hashPassword, checkPassword, token, cookieOf, sessionOf, sessionUser,
    isOpsUser, hasOrdered, affiliateOf, referredOrders, publicUser,
    setSession, clearSession, b64urlJson, decodeJwt,
    verifyGoogleIdToken, verifyAppleIdToken, authProviders, upsertSocialUser,
  };
}

module.exports = { createAuthSession };
