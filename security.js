// Helix King Labs — security module.
// Factory pattern: createSecurity({deps}) -> security handle.
// Holds the auth-hardening surface: failed-login alerting, ops TOTP
// enrollment, the Content-Security-Policy builder, and the ops-only
// script gate. Extracted from server.js to keep it under the push limit.
"use strict";

function createSecurity(deps) {
  const {
    store,
    saveStore,
    send,
    readBody,
    limited,
    token,
    isOpsUser,
    authx,
    crypto,
    QRCode,
    loadOutbox,
    saveOutbox,
    mailer,
    setSession,
    publicUser,
  } = deps;

  // ---- Ops TOTP setup tokens ----
  // Ops accounts must have TOTP before they can sign in. The setup token is
  // a short-lived, single-purpose credential issued at login time when an
  // ops account has no TOTP yet. It authorizes only the two ops-2fa
  // endpoints below — never a session.
  function issueOpsTotpSetup(userId) {
    const now = Date.now();
    store.opsTotpSetup = (store.opsTotpSetup || []).filter((t) => t.exp > now);
    const row = { token: token(), userId, exp: now + 15 * 60 * 1000 };
    store.opsTotpSetup.push(row);
    saveStore(store);
    return row.token;
  }
  function peekOpsTotpSetup(tok) {
    const now = Date.now();
    store.opsTotpSetup = (store.opsTotpSetup || []).filter((t) => t.exp > now);
    return store.opsTotpSetup.find((t) => t.token === String(tok || "")) || null;
  }
  function takeOpsTotpSetup(tok) {
    const row = peekOpsTotpSetup(tok);
    if (!row) return null;
    store.opsTotpSetup = store.opsTotpSetup.filter((t) => t !== row);
    saveStore(store);
    return row;
  }

  // ---- Ops pending-TOTP tokens ----
  // For sign-in paths that don't collect a TOTP code up front (magic link,
  // passkey): after the primary credential verifies, an ops user with TOTP
  // gets a 5-minute single-use pending token instead of a session. They
  // exchange it + a TOTP code at /api/auth/ops-2fa/verify.
  function issueOpsPendingTotp(userId) {
    const now = Date.now();
    store.opsPendingTotp = (store.opsPendingTotp || []).filter((t) => t.exp > now);
    const row = { token: token(), userId, exp: now + 5 * 60 * 1000 };
    store.opsPendingTotp.push(row);
    saveStore(store);
    return row.token;
  }
  function takeOpsPendingTotp(tok) {
    const now = Date.now();
    store.opsPendingTotp = (store.opsPendingTotp || []).filter((t) => t.exp > now);
    const row = store.opsPendingTotp.find((t) => t.token === String(tok || "")) || null;
    if (!row) return null;
    store.opsPendingTotp = store.opsPendingTotp.filter((t) => t !== row);
    saveStore(store);
    return row;
  }

  // Gate for non-password sign-in paths. Returns null when the caller may
  // proceed to create a session; otherwise returns a response descriptor
  // the caller should send (ops users must pass TOTP).
  function opsTotpGate(u) {
    if (!isOpsUser(u)) return null;
    if (!u.totpSecret) {
      return { status: 401, body: { error: "totp_setup_required", setupToken: issueOpsTotpSetup(u.id) } };
    }
    return { status: 401, body: { error: "totp_required", pendingToken: issueOpsPendingTotp(u.id) } };
  }

  // ---- Failed-auth alerting ----
  // Counts failed login attempts per IP. At 5 failures inside 15 minutes,
  // queues one email alert to the ops inbox (once per window). Uses the
  // same outbox drain as everything else, so a blocked mailer degrades
  // to a queued message, never a dropped alert.
  function noteFailedAuth(ip, email, kind) {
    const now = Date.now();
    const k = `failauth:${ip}`;
    const row = store.rate[k] || { n: 0, t: now, emails: [] };
    if (now - row.t > 15 * 60 * 1000) {
      row.n = 0;
      row.t = now;
      row.emails = [];
    }
    row.n += 1;
    const em = String(email || "").toLowerCase().trim();
    if (em && !row.emails.includes(em) && row.emails.length < 10) row.emails.push(em);
    store.rate[k] = row;
    if (row.n === 5) {
      authx
        .deliver(loadOutbox, saveOutbox, mailer.sendMail, {
          to: "info@helixkinglabs.com",
          subject: `Security alert: repeated failed ${kind} logins`,
          text:
            `Helix King Labs security notice.\n\n` +
            `${row.n} failed ${kind} login attempts in the last 15 minutes from IP ${ip}.\n` +
            `Accounts targeted: ${row.emails.join(", ") || "(none captured)"}\n\n` +
            `No action needed unless you don't recognize this activity.`,
        })
        .catch(() => {});
    }
    return row.n;
  }

  // ---- Ops TOTP enrollment (pre-session) ----
  // Returns true when this request was handled (caller should return).
  async function handleOpsTotp(req, res, method, route, ip) {
    // POST /api/auth/ops-2fa/setup { setupToken } -> { secret, qr, uri }
    if (method === "POST" && route === "/api/auth/ops-2fa/setup") {
      if (limited(ip, "ops2fa", 10, 15 * 60 * 1000)) return send(res, 429, { error: "rate" }), true;
      let body;
      try {
        body = await readBody(req);
      } catch {
        return send(res, 400, { error: "bad_request" }), true;
      }
      const row = peekOpsTotpSetup(body.setupToken);
      const u = row && store.users.find((x) => x.id === row.userId);
      if (!u || !isOpsUser(u) || u.totpEnabled) return send(res, 401, { error: "setup_token" }), true;
      u.totpPending = authx.b32encode(crypto.randomBytes(20));
      saveStore(store);
      const uri = `otpauth://totp/Helix%20King%20Labs:${encodeURIComponent(u.email)}?secret=${u.totpPending}&issuer=Helix%20King%20Labs`;
      let qr = null;
      try {
        qr = await QRCode.toDataURL(uri, { margin: 1, width: 220, color: { dark: "#111111", light: "#ffffff" } });
      } catch {}
      return send(res, 200, { secret: u.totpPending, qr, uri }), true;
    }
    // POST /api/auth/ops-2fa/confirm { setupToken, code } -> { ok, recovery }
    if (method === "POST" && route === "/api/auth/ops-2fa/confirm") {
      if (limited(ip, "ops2fa", 10, 15 * 60 * 1000)) return send(res, 429, { error: "rate" }), true;
      let body;
      try {
        body = await readBody(req);
      } catch {
        return send(res, 400, { error: "bad_request" }), true;
      }
      const row = takeOpsTotpSetup(body.setupToken);
      const u = row && store.users.find((x) => x.id === row.userId);
      if (!u || !isOpsUser(u) || !u.totpPending || !authx.totpOk(u.totpPending, body.code)) {
        return send(res, 401, { error: "code" }), true;
      }
      u.totpSecret = u.totpPending;
      u.totpEnabled = true;
      delete u.totpPending;
      u.totpRecovery = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString("hex").toUpperCase());
      saveStore(store);
      return send(res, 200, { ok: true, recovery: u.totpRecovery }), true;
    }

    // POST /api/auth/ops-2fa/verify { pendingToken, code } -> session
    // Completes a magic-link or passkey sign-in for an ops user after the
    // TOTP code checks out. The pending token is single-use.
    if (method === "POST" && route === "/api/auth/ops-2fa/verify") {
      if (limited(ip, "ops2fav", 10, 15 * 60 * 1000)) return send(res, 429, { error: "rate" }), true;
      let body;
      try {
        body = await readBody(req);
      } catch {
        return send(res, 400, { error: "bad_request" }), true;
      }
      const row = takeOpsPendingTotp(body.pendingToken);
      const u = row && store.users.find((x) => x.id === row.userId);
      if (!u || !isOpsUser(u) || !u.totpSecret) {
        return send(res, 400, { error: "link" }), true;
      }
      const code = String(body.code || "").replace(/\D/g, "");
      let ok = authx.totpOk(u.totpSecret, code);
      if (!ok && Array.isArray(u.totpRecovery)) {
        const idx = u.totpRecovery.indexOf(code.toUpperCase());
        if (idx >= 0) {
          u.totpRecovery.splice(idx, 1);
          ok = true;
        }
      }
      if (!ok) {
        noteFailedAuth(ip, u.email, "totp");
        return send(res, 401, { error: "totp" }), true;
      }
      saveStore(store);
      setSession(res, u.id);
      return send(res, 200, { user: publicUser(u) }), true;
    }

    // POST /api/auth/ops-2fa/reset-request { email }
    // Emergency "forgot my authenticator": emails a 15-min single-use
    // reset link to the ops account's inbox. Consuming it clears TOTP so
    // fresh enrollment can happen. Rate-limited; always returns ok to
    // avoid account enumeration.
    if (method === "POST" && route === "/api/auth/ops-2fa/reset-request") {
      if (limited(ip, "ops2far", 3, 60 * 60 * 1000)) return send(res, 429, { error: "rate" }), true;
      let body;
      try {
        body = await readBody(req);
      } catch {
        return send(res, 400, { error: "bad_request" }), true;
      }
      const email = String(body.email || "").toLowerCase().trim();
      const u = store.users.find((x) => String(x.email || "").toLowerCase() === email);
      if (u && isOpsUser(u)) {
        const now = Date.now();
        store.opsTotpReset = (store.opsTotpReset || []).filter((t) => t.exp > now);
        const row = { token: token(), userId: u.id, exp: now + 15 * 60 * 1000 };
        store.opsTotpReset.push(row);
        saveStore(store);
        const origin = authx.requestOrigin(req);
        authx
          .deliver(loadOutbox, saveOutbox, mailer.sendMail, {
            to: u.email,
            subject: "Reset your Helix King Labs authenticator",
            text:
              `Someone requested an authenticator reset for this ops account.\n\n` +
              `Reset link (15 minutes, one use): ${origin}/reset-2fa?token=${encodeURIComponent(row.token)}\n\n` +
              `If this wasn't you, ignore this email — your authenticator still works.`,
          })
          .catch(() => {});
      }
      return send(res, 200, { ok: true }), true;
    }

    // POST /api/auth/ops-2fa/reset-consume { token } -> { setupToken }
    // Clears TOTP on the ops account and returns a fresh enrollment token.
    if (method === "POST" && route === "/api/auth/ops-2fa/reset-consume") {
      if (limited(ip, "ops2farc", 5, 15 * 60 * 1000)) return send(res, 429, { error: "rate" }), true;
      let body;
      try {
        body = await readBody(req);
      } catch {
        return send(res, 400, { error: "bad_request" }), true;
      }
      const now = Date.now();
      store.opsTotpReset = (store.opsTotpReset || []).filter((t) => t.exp > now);
      const row = store.opsTotpReset.find((t) => t.token === String(body.token || "")) || null;
      if (!row) return send(res, 400, { error: "link" }), true;
      store.opsTotpReset = store.opsTotpReset.filter((t) => t !== row);
      const u = store.users.find((x) => x.id === row.userId);
      if (!u || !isOpsUser(u)) return send(res, 400, { error: "link" }), true;
      delete u.totpSecret;
      delete u.totpEnabled;
      delete u.totpPending;
      delete u.totpRecovery;
      saveStore(store);
      return send(res, 200, { setupToken: issueOpsTotpSetup(u.id) }), true;
    }
    return false;
  }

  // ---- Content-Security-Policy ----
  // Script policy: every <script> in our own HTML carries a per-request
  // nonce. 'strict-dynamic' lets the nonce-trusted loader scripts (GTM,
  // app.js measurement) pull their own dependencies in modern browsers;
  // the host list keeps older browsers working. No 'unsafe-inline', so a
  // missed esc() that injects markup cannot run script.
  function csp(nonce) {
    const script = nonce
      ? "script-src 'nonce-" +
        nonce +
        "' 'strict-dynamic' 'self' https://www.googletagmanager.com https://www.google-analytics.com https://t.contentsquare.net https://connect.facebook.net https://analytics.tiktok.com"
      : "script-src 'self'";
    return [
      script,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: https:",
      "connect-src 'self' https://www.google-analytics.com https://www.googletagmanager.com https://t.contentsquare.net https://www.facebook.com https://analytics.tiktok.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ");
  }

  function htmlHeaders(status, nonce) {
    return {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Strict-Transport-Security": "max-age=15552000; includeSubDomains",
      "Content-Security-Policy": csp(nonce),
    };
  }

  // Scripts that are only ever useful to ops. Served 403 to anyone else,
  // and stripped from the HTML shell non-ops visitors receive.
  const OPS_ONLY_SCRIPTS = new Set([
    "desk.js",
    "ops-email.js",
    "ops-fulfill.js",
    "ops-inventory.js",
    "ops-coupons.js",
    "ops.js",
    "wholesale-ops.js",
  ]);

  return {
    noteFailedAuth,
    issueOpsTotpSetup,
    opsTotpGate,
    handleOpsTotp,
    htmlHeaders,
    OPS_ONLY_SCRIPTS,
  };
}

module.exports = { createSecurity };
