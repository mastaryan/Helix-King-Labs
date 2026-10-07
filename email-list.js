"use strict";

// Email list: consent-gated capture, one-click unsubscribe, ops broadcast.
// Factory pattern matches ops-catalog.js — dependencies are injected so
// server.js stays under the GitHub push size limit.

function libraryEmail(email, origin, unsubToken) {
  const base = (origin || "https://helixkinglabs.com").replace(/\/$/, "");
  const unsubUrl = base + "/unsubscribe?token=" + encodeURIComponent(unsubToken || "");
  return {
    to: email,
    subject: "Helix King Labs — you're on the list",
    text: [
      "Helix King Labs",
      "",
      "Thanks for subscribing — you're on the list.",
      "",
      "A taste of the catalog:",
      "",
      "- BPC-157 — from $25 — " + base + "/product/bpc-157",
      "- TB-500 — from $39 — " + base + "/product/tb-500",
      "- GHK-Cu — from $25 — " + base + "/product/ghk-cu",
      "- KPV — from $29 — " + base + "/product/kpv",
      "",
      "Full catalog: " + base + "/shop",
      "Documentation library: " + base + "/library",
      "",
      "Create an account to order: " + base + "/account",
      "",
      "This list is for lot alerts, restocks, and group buys.",
      "Research materials are for laboratory use only.",
      "Not a clinic. Not a pharmacy.",
      "",
      "Unsubscribe anytime: " + unsubUrl,
    ].join("\n"),
  };
}

function createEmailList(deps) {
  const {
    store,
    saveStore,
    send,
    readBody,
    validEmail,
    token,
    requestOrigin,
    loadOutbox,
    saveOutbox,
    writeSubscribersCsv,
    audit,
    isOpsUser,
  } = deps;

  return async function emailListHandle(req, res, url, user) {
    const method = req.method;
    const route = url.pathname;

    if (method === "POST" && route === "/api/capture") {
      let body;
      try {
        body = await readBody(req);
      } catch {
        return send(res, 400, { error: "bad_request" });
      }
      const email = String(body.email || "").toLowerCase().trim();
      if (!validEmail(email)) return send(res, 400, { error: "email" });
      const consent = !!body.consent;
      const source = String(body.source || "unknown").slice(0, 40);
      if (!consent) {
        // Email given without list consent (e.g. gate pass-through): not subscribed.
        return send(res, 200, { ok: true, subscribed: false });
      }
      let row = store.captures.find((c) => c.email === email);
      const origin = requestOrigin(req);
      if (!row) {
        row = {
          email,
          source,
          created: new Date().toISOString(),
          consent: true,
          consentedAt: new Date().toISOString(),
          unsub: token(),
          library: "/library",
        };
        store.captures.push(row);
        // Notify the owner of the new subscriber.
        const box = loadOutbox();
        box.messages.push({
          to: process.env.HKL_NOTIFY_EMAIL || "info@helixkinglabs.com",
          subject: "New email subscriber: " + email,
          text: ["Helix King Labs", "", "New subscriber: " + email, "Source: " + source, "Time: " + row.created].join("\n"),
          source: "capture-notify",
          created: new Date().toISOString(),
          status: "queued",
        });
        saveOutbox(box);
      }
      if (!row.unsub) row.unsub = token();
      const mail = libraryEmail(email, origin, row.unsub);
      const box = loadOutbox();
      box.messages.push({
        ...mail,
        source,
        created: new Date().toISOString(),
        status: "queued",
      });
      saveOutbox(box);
      saveStore(store);
      writeSubscribersCsv();
      return send(res, 200, {
        ok: true,
        subscribed: true,
        library: "/library",
        queued: true,
      });
    }

    if (method === "POST" && route === "/api/unsubscribe") {
      let body;
      try {
        body = await readBody(req);
      } catch {
        return send(res, 400, { error: "bad_request" });
      }
      const t = String(body.token || "").trim();
      const row = (store.captures || []).find((c) => c.unsub && c.unsub === t);
      if (!row) return send(res, 200, { ok: true, removed: false });
      const goneEmail = String(row.email || "").toLowerCase();
      store.captures = (store.captures || []).filter((c) => c !== row);
      // Also clear the marketing opt-in on their account, if any.
      const u = (store.users || []).find((x) => String(x.email || "").toLowerCase() === goneEmail);
      if (u) u.emailOptIn = false;
      saveStore(store);
      writeSubscribersCsv();
      audit(null, "list", "unsubscribed " + goneEmail + " via token");
      return send(res, 200, { ok: true, removed: true });
    }

    if (method === "POST" && route === "/api/ops/broadcast") {
      if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" });
      let body;
      try {
        body = await readBody(req);
      } catch {
        return send(res, 400, { error: "bad_request" });
      }
      const subject = String(body.subject || "").trim().slice(0, 120);
      const text = String(body.text || "").trim().slice(0, 5000);
      if (!subject || !text) return send(res, 400, { error: "subject_text_required" });
      const origin = requestOrigin(req);
      const box = loadOutbox();
      let queued = 0;
      for (const c of store.captures || []) {
        if (!c.unsub) c.unsub = token();
        box.messages.push({
          to: c.email,
          subject: "[Helix King Labs] " + subject,
          text:
            text +
            "\n\n—\nHelix King Labs · lot alerts and promotions\nUnsubscribe anytime: " +
            origin +
            "/unsubscribe?token=" +
            encodeURIComponent(c.unsub),
          source: "broadcast",
          created: new Date().toISOString(),
          status: "queued",
        });
        queued++;
      }
      saveOutbox(box);
      saveStore(store);
      audit(user.id, "broadcast", "queued " + queued + " messages: " + subject.slice(0, 60));
      return send(res, 200, { ok: true, queued });
    }

    return false;
  };
}

module.exports = createEmailList;
