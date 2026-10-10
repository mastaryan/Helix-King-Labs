// Helix King Labs — request-level defenses (trimmed from Grok Patch 2).
// Contains ONLY: Cloudflare-aware client IP, session id hashing + idle/absolute
// timeouts, Origin/CSRF check, and throttled security alerts.
// Turnstile, COOP headers, ops IP allowlisting, and the new in-memory rate
// limiter were intentionally NOT carried over (see Grok Patch 2 notes).
"use strict";
const net = require("node:net");
const crypto = require("node:crypto");

// Cloudflare published ranges (https://www.cloudflare.com/ips/). Refresh occasionally.
const CF_V4 = ["173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22"];
const CF_V6 = ["2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32"];

const blockList = new net.BlockList();
for (const c of CF_V4) { const [a, p] = c.split("/"); blockList.addSubnet(a, Number(p), "ipv4"); }
for (const c of CF_V6) { const [a, p] = c.split("/"); blockList.addSubnet(a, Number(p), "ipv6"); }

function normIp(ip) {
  ip = String(ip || "").trim();
  if (ip.startsWith("::ffff:") && net.isIPv4(ip.slice(7))) return ip.slice(7);
  return ip;
}
function isCloudflare(ip) {
  ip = normIp(ip);
  const fam = net.isIPv4(ip) ? "ipv4" : net.isIPv6(ip) ? "ipv6" : null;
  return !!fam && blockList.check(ip, fam);
}
function isLoopback(ip) {
  ip = normIp(ip);
  return ip === "127.0.0.1" || ip === "::1";
}
// CF-Connecting-IP is honored only when the TCP peer is a Cloudflare edge, or a
// local reverse proxy (HKL_BEHIND_LOCAL_PROXY=1) that itself only accepts Cloudflare.
// Otherwise the spoofable header is ignored and the real peer IP is used.
function clientIp(req) {
  const peer = normIp(req.socket && req.socket.remoteAddress);
  const cf = normIp(req.headers["cf-connecting-ip"]);
  if (cf && net.isIP(cf) && (isCloudflare(peer) || (isLoopback(peer) && process.env.HKL_BEHIND_LOCAL_PROXY === "1"))) return cf;
  return peer || "0";
}

// ---- Sessions: ids are stored hashed; idle + absolute timeouts ----
function sidHash(sid) {
  return crypto.createHash("sha256").update(String(sid || "")).digest("hex");
}
function sessionLimits(isOps) {
  const h = (v, d) => (Number(v) > 0 ? Number(v) : d) * 3600 * 1000;
  return isOps
    ? { idle: h(process.env.HKL_OPS_SESSION_IDLE_HOURS, 4), absolute: h(process.env.HKL_OPS_SESSION_MAX_HOURS, 24) }
    : { idle: h(process.env.HKL_SESSION_IDLE_HOURS, 72), absolute: h(process.env.HKL_SESSION_MAX_HOURS, 14 * 24) };
}
// isOpsUserId(userId) -> bool lets ops get the shorter limits.
// Legacy plaintext-id sessions (pre-hash) never match and are effectively logged out.
function findSession(store, sid, isOpsUserId) {
  if (!sid || typeof sid !== "string" || sid.length > 200) return null;
  const h = sidHash(sid);
  const now = Date.now();
  const s = (store.sessions || []).find((x) => x.h === h);
  if (!s || !(s.exp > now)) return null;
  const lim = sessionLimits(isOpsUserId ? isOpsUserId(s.userId) : false);
  const created = s.created || now;
  const lastSeen = s.last || created;
  if (now - lastSeen > lim.idle || now - created > lim.absolute) {
    store.sessions = store.sessions.filter((x) => x !== s);
    return null;
  }
  if (now - lastSeen > 5 * 60e3) s.last = now; // persisted on next save
  return s;
}

// ---- CSRF: Origin / Sec-Fetch-Site check on state-changing requests ----
const CSRF_EXEMPT = new Set(["/api/payments/nowpayments", "/api/pay/nowpayments"]);
function allowedOrigins(req) {
  const out = new Set();
  const pub = process.env.HKL_PUBLIC_ORIGIN;
  if (pub) { try { out.add(new URL(pub).origin); out.add(new URL(pub).origin.replace("://", "://www.")); } catch {} }
  const host = req.headers.host;
  if (host) { out.add("https://" + host); out.add("http://" + host); }
  return out;
}
function csrfBlocked(req, route) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return false;
  if (CSRF_EXEMPT.has(route)) return false;
  const origin = req.headers.origin;
  if (origin && origin !== "null") return !allowedOrigins(req).has(origin);
  if (origin === "null") return true;
  const sfs = req.headers["sec-fetch-site"];
  if (sfs && sfs !== "same-origin" && sfs !== "none") return true;
  // No Origin and no Sec-Fetch-Site: not a modern browser cross-site request; the
  // SameSite=Lax cookie already keeps cross-site form posts unauthenticated.
  return false;
}

// ---- Audit log + throttled alert emails ----
function createAlerts({ store, saveStore, queueMail }) {
  const last = new Map();
  function to() {
    return process.env.HKL_ALERT_EMAIL || process.env.HKL_OPS_EMAIL || "info@helixkinglabs.com";
  }
  function alert(kind, detail, opts) {
    const at = new Date().toISOString();
    store.securityLog = store.securityLog || [];
    store.securityLog.unshift({ at, kind, detail: String(detail || "").slice(0, 300) });
    store.securityLog = store.securityLog.slice(0, 500);
    try { saveStore(store); } catch {}
    console.warn("[security]", kind, String(detail || "").slice(0, 300));
    const key = kind + ":" + ((opts && opts.key) || "");
    const now = Date.now();
    if (last.has(key) && now - last.get(key) < 10 * 60e3) return; // 1 mail / 10 min / kind+key
    last.set(key, now);
    try {
      queueMail({
        to: to(),
        subject: "[HKL security] " + kind.replace(/[\r\n]/g, " "),
        text: `Helix King Labs security event\n\nKind: ${kind}\nWhen: ${at}\n\n${detail}\n\nRecent events are on the ops desk (security log) and in store.json securityLog.`,
        created: at,
      });
    } catch {}
  }
  return alert;
}

module.exports = {
  clientIp, isCloudflare, normIp,
  sidHash, sessionLimits, findSession,
  csrfBlocked, CSRF_EXEMPT, allowedOrigins,
  createAlerts,
};
