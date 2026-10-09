"use strict";

// Email list: consent-gated capture, one-click unsubscribe, ops broadcast.
// Factory pattern matches ops-catalog.js — dependencies are injected so
// server.js stays under the GitHub push size limit.

const { emailFooter } = require("./mail");
const LIST_FOOTER = emailFooter("research").text;

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
      "Start here: " + base + "/welcome",
      "A one-page tour: featured compounds, how ordering works, and what makes our lots different.",
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
      LIST_FOOTER,
    ].join("\n"),
  };
}

// Welcome drip series (Phase 1 funnel). Day 0 on popup subscribe,
// then day 2 / day 4 / day 7. Research framing only — no dosing,
// no medical claims. Each mail carries the one-click unsubscribe.
var DRIP_STEPS = [2, 2, 3]; // days after the previous mail: day 0, 2, 4, 7
function dripEmail(step, email, origin, unsubToken) {
  var base = (origin || "https://helixkinglabs.com").replace(/\/$/, "");
  var unsubUrl = base + "/unsubscribe?token=" + encodeURIComponent(unsubToken || "");
  var tail = [
    "",
    "Unsubscribe anytime: " + unsubUrl,
    LIST_FOOTER,
  ].join("\n");
  var bodies = {
    1: {
      subject: "Your research starter kit — Helix King Labs",
      text: [
        "Helix King Labs",
        "",
        "Welcome — here's your starter kit.",
        "",
        "Start with the guides library: " + base + "/guides",
        "Three good first reads:",
        "- BPC-157 research guide: " + base + "/guides/bpc-157",
        "- Retatrutide research guide: " + base + "/guides/retatrutide",
        "- Reconstitution calculator: " + base + "/tools/calculator",
        "",
        "Over the next week I'll send three short emails: how our lots",
        "are documented, where most researchers start, and 10% off your",
        "first order.",
        "",
        "Research materials are for laboratory use only.",
        "Not a clinic. Not a pharmacy.",
      ].join("\n") + tail,
    },
    2: {
      subject: "Every vial has a paper trail — here's why it matters",
      text: [
        "Helix King Labs",
        "",
        "Most peptide vials arrive with a purity number and nothing else.",
        "Here's what we attach to every lot before it can sell:",
        "",
        "- Third-party certificate of analysis, published per lot: " + base + "/certificates",
        "- Lot number printed on the label, matched to the COA",
        "- Chain of custody from intake to label — nothing ships",
        "  without an accepted COA",
        "",
        "A purity percentage tells you how uniform the material is.",
        "It doesn't tell you what it is, or how much is in the vial.",
        "Identity and net content complete the picture — that's what",
        "our certificates show.",
        "",
        "Research materials are for laboratory use only.",
      ].join("\n") + tail,
    },
    3: {
      subject: "Where most researchers start",
      text: [
        "Helix King Labs",
        "",
        "The three compounds researchers ask about most:",
        "",
        "- BPC-157 — from $25 — " + base + "/product/bpc-157",
        "- TB-500 — from $39 — " + base + "/product/tb-500",
        "- GHK-Cu — from $25 — " + base + "/product/ghk-cu",
        "",
        "How ordering works: create an account, check out with crypto,",
        "Cash App, or Venmo. Nothing ships until payment is confirmed,",
        "and every order carries its lot number.",
        "",
        "Full catalog: " + base + "/shop",
        "",
        "Research materials are for laboratory use only.",
        "Not a clinic. Not a pharmacy.",
      ].join("\n") + tail,
    },
    4: {
      subject: "10% off your first order — HELIX10",
      text: [
        "Helix King Labs",
        "",
        "Last email in this series — thanks for reading.",
        "",
        "Use code HELIX10 for 10% off your first order: " + base + "/shop",
        "",
        "Two places researchers hang out:",
        "- Telegram: https://t.me/HKL_RESEARCH",
        "- WhatsApp: https://wa.me/12026424575 (order + shipping questions)",
        "",
        "Reply to any email if you need a hand — a human reads them.",
        "",
        "You'll still get lot alerts, restocks, and group-buy notices.",
        "Research materials are for laboratory use only.",
      ].join("\n") + tail,
    },
  };
  var b = bodies[step];
  if (!b) return null;
  return { to: email, subject: b.subject, text: b.text };
}

function dripDue(row) {
  return row && row.drip && row.drip.nextAt && new Date(row.drip.nextAt).getTime() <= Date.now();
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

  async function emailListHandle(req, res, url, user) {
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
      }
      if (!row.unsub) row.unsub = token();
      const box = loadOutbox();
      const series = String(body.series || "").slice(0, 20);
      if (series === "welcome" && !row.dripDone && !row.drip) {
        // Welcome drip: mail #1 now, #2-4 on the drip schedule.
        const mail = dripEmail(1, email, origin, row.unsub);
        if (mail) {
          box.messages.push({
            ...mail,
            source: source + ":drip1",
            created: new Date().toISOString(),
            status: "queued",
          });
        }
        row.drip = { step: 1, nextAt: new Date(Date.now() + DRIP_STEPS[0] * 864e5).toISOString() };
      } else {
        const mail = libraryEmail(email, origin, row.unsub);
        box.messages.push({
          ...mail,
          source,
          created: new Date().toISOString(),
          status: "queued",
        });
      }
      saveOutbox(box);
      saveStore(store);
      writeSubscribersCsv();
      return send(res, 200, {
        ok: true,
        subscribed: true,
        library: "/library",
        queued: true,
        series: series === "welcome" ? "welcome" : undefined,
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
            encodeURIComponent(c.unsub) +
            LIST_FOOTER,
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

  // Back-in-stock waitlist: notify when a SKU comes back.
  async function waitlistHandle(req, res, url, user) {
    const method = req.method;
    const route = url.pathname;
    const { store, saveStore, send, readBody, validEmail, loadOutbox, saveOutbox, token } = waitlistHandle.deps;

    if (method === "POST" && route === "/api/waitlist") {
      let body;
      try {
        body = await readBody(req);
      } catch {
        return send(res, 400, { error: "bad_request" });
      }
      const email = String(body.email || "").toLowerCase().trim();
      const sku = String(body.sku || "").trim().slice(0, 40);
      if (!validEmail(email)) return send(res, 400, { error: "email" });
      if (!sku) return send(res, 400, { error: "sku" });
      if (!body.consent) return send(res, 400, { error: "consent_required" });
      store.waitlist = store.waitlist || [];
      const exists = store.waitlist.some((w) => w.email === email && w.sku === sku);
      if (!exists) {
        const unsubToken = token().slice(0, 16);
        store.waitlist.push({ email, sku, created: new Date().toISOString(), consent: true, unsubToken });
        saveStore(store);
        // Confirmation email
        const box = loadOutbox();
        box.messages.push({
          to: email,
          subject: `You're on the notify list — Helix King Labs`,
          text: `Helix King Labs\n\nYou're signed up to get one email when ${sku} is back in stock.\n\nNo marketing list — just this one notification.\n\nDon't want it? Unsubscribe here:\nhttps://helixkinglabs.com/api/waitlist/unsubscribe?token=${unsubToken}\n\nResearch use only.${LIST_FOOTER}`,
          source: "waitlist-confirm",
          created: new Date().toISOString(),
          status: "queued",
        });
        saveOutbox(box);
      }
      return send(res, 200, { ok: true, waiting: true });
    }

    if (method === "GET" && route === "/api/waitlist/unsubscribe") {
      const t = String(url.searchParams.get("token") || "");
      store.waitlist = store.waitlist || [];
      const before = store.waitlist.length;
      store.waitlist = store.waitlist.filter((w) => w.unsubToken !== t);
      if (store.waitlist.length < before) saveStore(store);
      return send(res, 200, { ok: true, removed: before > store.waitlist.length });
    }
    return false;
  }

  // Called on intake: if a SKU went from 0 to in-stock, email everyone waiting.
  function checkWaitlist(sku, productName, origin) {
    const { store, saveStore, loadOutbox, saveOutbox } = waitlistHandle.deps;
    store.waitlist = store.waitlist || [];
    const waiting = store.waitlist.filter((w) => w.sku === sku);
    if (!waiting.length) return 0;
    const box = loadOutbox();
    for (const w of waiting) {
      box.messages.push({
        to: w.email,
        subject: `${productName} is back in stock — Helix King Labs`,
        text: [
          "Helix King Labs",
          "",
          `${productName} is back in stock.`,
          "",
          "Shop: " + (origin || "https://helixkinglabs.com") + "/shop",
          "",
          "You asked to be notified. Research use only.",
          LIST_FOOTER,
        ].join("\n"),
        source: "waitlist",
        created: new Date().toISOString(),
        status: "queued",
      });
    }
    saveOutbox(box);
    store.waitlist = store.waitlist.filter((w) => w.sku !== sku);
    saveStore(store);
    return waiting.length;
  }

  // Welcome drip scheduler — call hourly. Queues the next drip mail
  // for every subscriber whose nextAt has passed. Unsubscribed rows are
  // gone from store.captures, so the drip stops with them.
  function dripWelcome() {
    const now = Date.now();
    let queued = 0;
    for (const row of store.captures || []) {
      if (!dripDue(row)) continue;
      const nextStep = row.drip.step + 1;
      const mail = dripEmail(nextStep, row.email, "https://helixkinglabs.com", row.unsub);
      if (!mail) {
        delete row.drip;
        row.dripDone = true;
        continue;
      }
      const box = loadOutbox();
      box.messages.push({
        ...mail,
        source: (row.source || "unknown") + ":drip" + nextStep,
        created: new Date().toISOString(),
        status: "queued",
      });
      saveOutbox(box);
      queued++;
      if (nextStep >= 4) {
        delete row.drip;
        row.dripDone = true;
      } else {
        row.drip = {
          step: nextStep,
          nextAt: new Date(now + DRIP_STEPS[nextStep - 1] * 864e5).toISOString(),
        };
      }
    }
    if (queued) {
      saveStore(store);
      writeSubscribersCsv();
    }
    return queued;
  }

  waitlistHandle.deps = deps;

  // Route both handlers
  async function combined(req, res, url, user) {
    if (await emailListHandle(req, res, url, user)) return true;
    if (await waitlistHandle(req, res, url, user)) return true;
    return false;
  }
  combined.checkWaitlist = checkWaitlist;
  combined.dripWelcome = dripWelcome;
  return combined;
}

module.exports = createEmailList;
