"use strict";

const nodemailer = require("nodemailer");

const FROM = process.env.SMTP_FROM || "orders@helixkinglabs.com";

function resendConfigured() {
  return !!process.env.RESEND_API_KEY;
}

function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function configured() {
  return resendConfigured() || smtpConfigured();
}

// Shared email footer — Telegram + social links + team signature (Ryan 2026-10-08).
// team: "research" (info@) or "orders" (orders@). No phone number.
function emailFooter(team) {
  const teamName = team === "orders" ? "Helix King Orders Team" : "Helix King Research Team";
  return {
    text: `\n\n—\nThanks,\n${teamName}\nhelixkinglabs.com\nTelegram: https://t.me/HKL_RESEARCH\nInstagram: @HelixKingLabs\nWhatsApp: https://wa.me/12026424575`,
    html: `<div style="margin-top:32px;padding-top:20px;border-top:2px solid #1a1a1a;text-align:center;font-family:Arial,sans-serif">
      <p style="margin:0 0 8px;font-size:16px;font-weight:bold;color:#1a1a1a">Helix King Labs</p>
      <p style="margin:0 0 12px;font-size:13px;color:#666">Premium research peptides · Tested lots · Honest prices</p>
      <p style="margin:0;font-size:13px">Thanks,<br><strong>${teamName}</strong><br>
      <a href="https://helixkinglabs.com" style="color:#1a1a1a">helixkinglabs.com</a> ·
      <a href="https://t.me/HKL_RESEARCH" style="color:#1a1a1a">Telegram</a> ·
      <a href="https://instagram.com/HelixKingLabs" style="color:#1a1a1a">Instagram</a> ·
      <a href="https://wa.me/12026424575" style="color:#1a1a1a">WhatsApp</a></p>
      <p style="margin:12px 0 0;font-size:11px;color:#999">Research use only. 18+.</p>
    </div>`,
  };
}

// Resend HTTPS API — works where outbound SMTP is blocked.
async function sendViaResend({ to, subject, text, html }) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.RESEND_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Helix King Labs <" + FROM + ">",
      to: [to],
      subject,
      text,
      ...(html ? { html } : {}),
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    const err = new Error("resend_" + r.status + ": " + String(body).slice(0, 160));
    err.code = "resend_failed";
    throw err;
  }
}

function transport() {
  if (!smtpConfigured()) return null;
  const port = Number(process.env.SMTP_PORT || 465);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendMail({ to, subject, text, html }) {
  if (resendConfigured()) return sendViaResend({ to, subject, text, html });
  const tx = transport();
  if (!tx) {
    const err = new Error("smtp_unconfigured");
    err.code = "smtp_unconfigured";
    throw err;
  }
  await tx.sendMail({ from: FROM, to, subject, text, ...(html ? { html } : {}) });
}


function orderHtml(order) {
  const q = order.quote || {};
  const total = "$" + Number(q.total || 0).toFixed(2);
  const origin = "https://helixkinglabs.com";
  const lines = (q.lines || []).map((l) => {
    const img = l.image ? origin + l.image : "";
    return "<tr><td>" + (img ? '<img src="' + img + '" width="48" style="vertical-align:middle"/>' : "") + "</td><td>" + (l.name || "") + " " + (l.size || "") + " × " + l.qty + "</td></tr>";
  }).join("");
  return '<div style="font-family:Arial,sans-serif;max-width:600px"><h2>Helix King Labs</h2><p>Order ' + order.id + ' · Total <strong>' + total + '</strong></p><table cellpadding="6">' + lines + '</table><p style="color:#888;font-size:12px">Research use only.</p></div>';
}

function orderMail(order, kind, deps) {
  const q = order.quote || {};
  const pay = order.payment || {};
  const total = "$" + Number(q.total != null ? q.total : order.total || 0).toFixed(2);
  const qLines = q.lines || order.lines || [];
  const lines = (qLines.map((l) => `${l.name || ""} ${l.size || ""} × ${l.qty}`).join("\n")) || "See the desk for lines.";
  let payText = "Payment instructions are on the order.";
  if (pay.payAddress) payText = `Pay ${pay.payAmount} ${pay.payCurrency} on ${pay.network || "the stated network"} to ${pay.payAddress}. Do not send a different coin or network.`;
  else if (order.paymentMethod === "venmo") payText = `Venmo @fibkingpeps ${total}. Put ${order.id} in the note.`;
  else if (order.paymentMethod === "cashapp") payText = `Cash App $FibKingPep ${total}. Put ${order.id} in the note.`;
  const subjects = {
    placed: `Order ${order.id} — Helix King Labs`,
    settled: `Payment received ${order.id} — Helix King Labs`,
    shipped: `Shipped ${order.id} — Helix King Labs`,
    delivered: `Delivered ${order.id} — thank you — Helix King Labs`,
    voided: `Did you miss something? ${order.id} — Helix King Labs`,
  };
  const origin = (deps && deps.origin) || "https://helixkinglabs.com";
  const deliveredText = (deps && deps.deliveredText) ? deps.deliveredText(order) : `${order.id} is delivered. Thank you for ordering with Helix King Labs.`;
  const footer = emailFooter("orders");
  const text = {
    placed: `Order ${order.id} is recorded.\nTotal ${total}\n\n${lines}\n\n${payText}\n\nNothing ships until payment is confirmed. Research use only.${footer.text}`,
    settled: `Payment received for ${order.id}. The order is being prepared. Nothing has shipped yet.${footer.text}`,
    shipped: `${order.id} is booked${order.carrier ? " with " + order.carrier : ""}. Tracking ${order.tracking || "posts on the next note"}.${footer.text}`,
    delivered: deliveredText + footer.text,
    voided: `Did you miss something? Your order ${order.id} was released before payment was confirmed, so the items are back on the shelf.\n\nRestore your cart in one tap:\n${origin + "/account/receipt/" + order.id}\n\nNothing ships until payment is confirmed. Research use only.${footer.text}`,
  };

  return {
    to: order.email,
    subject: subjects[kind] || `Helix King Labs ${order.id}`,
    text: text[kind] || text.placed,
    html: orderHtml(order) + footer.html,
    kind,
    orderId: order.id,
    created: new Date().toISOString(),
    status: "queued",
    attempts: 0,
  };
}
function underpaymentMail(order, deps) {
  const origin = (deps && deps.origin) || "https://helixkinglabs.com";
  const shortBy = Number(order.payment && order.payment.shortBy || 0).toFixed(2);
  const paid = Number(order.payment && order.payment.actuallyPaid || 0).toFixed(2);
  const expected = Number(order.payment && order.payment.expectedAmount || order.quote && order.quote.total || 0).toFixed(2);
  const footer = emailFooter("orders");
  return {
    to: order.email,
    subject: `Action needed: $${shortBy} short on order ${order.id} — Helix King Labs`,
    text: `Hi there,\n\nWe received $${paid} of the $${expected} owed for order ${order.id} — you're $${shortBy} short.\n\nThis usually happens when a wallet deducts the network (gas) fee from the payment instead of adding it on top. The network fee is always on the buyer.\n\nTo fix it, send $${shortBy} to the same payment address within 120 minutes:\n${origin}/account/receipt/${order.id}\n\nIf we don't receive the rest within 120 minutes, the order will be cancelled and the items released. Any partial payment can be refunded — just reply to this email (refunds may differ by network fees).\n\n— Helix King Labs${footer.text}`,
    html: `<p>Hi there,</p><p>We received <b>$${paid}</b> of the <b>$${expected}</b> owed for order <b>${order.id}</b> — you're <b>$${shortBy}</b> short.</p><p>This usually happens when a wallet deducts the network (gas) fee from the payment instead of adding it on top. The network fee is always on the buyer.</p><p>To fix it, send <b>$${shortBy}</b> to the same payment address within <b>120 minutes</b>:<br><a href="${origin}/account/receipt/${order.id}">${origin}/account/receipt/${order.id}</a></p><p>If we don't receive the rest in time, the order will be cancelled and the items released. Any partial payment can be refunded — just reply to this email (refunds may differ by network fees).</p><p>— Helix King Labs</p>${footer.html}`,
    kind: "underpayment",
    orderId: order.id,
    created: new Date().toISOString(),
    status: "queued",
    attempts: 0,
  };
}

function abandonmentMail(order, deps, isFirstOrder) {
  const origin = (deps && deps.origin) || "https://helixkinglabs.com";
  const total = "$" + Number(order.quote && order.quote.total || 0).toFixed(2);
  const couponLine = isFirstOrder ? `\n\nPsst — as a first-time customer, use code HELIX10 for 10% off your first order.` : "";
  const footer = emailFooter("orders");
  const lines = (order.quote && order.quote.lines) || order.lines || [];
  const productGrid = lines.map((l) => {
    const img = l.image ? origin + l.image : "";
    const name = (l.name || "") + " " + (l.size || "");
    return `<div style="display:inline-block;width:140px;margin:8px;text-align:center;vertical-align:top">
      ${img ? `<img src="${img}" width="120" style="border-radius:8px" alt="${name}" />` : ""}
      <p style="margin:8px 0 0;font-size:13px;font-weight:bold">${name}</p>
      <p style="margin:4px 0 0;font-size:12px;color:#666">× ${l.qty}</p>
    </div>`;
  }).join("");
  return {
    to: order.email,
    subject: `Still thinking it over? Your cart is waiting — Helix King Labs`,
    text: `Hi there,\n\nYou started checkout for ${order.id} (${total}) but didn't finish. Your items are still in your cart:\n${origin}/cart${couponLine}\n\nStock is held for 60 minutes after checkout starts — after that, items go back on the shelf.\n\n— Helix King Labs${footer.text}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <p style="font-size:16px">Hi there,</p>
      <p>You started checkout for <b>${order.id}</b> (${total}) but didn't finish. Your items are still waiting:</p>
      <div style="text-align:center;margin:20px 0">${productGrid}</div>
      <p style="text-align:center"><a href="${origin}/cart" style="display:inline-block;padding:12px 28px;background:#1a1a1a;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">Return to your cart</a></p>
      ${isFirstOrder ? `<p style="text-align:center;background:#f5f5f5;padding:12px;border-radius:6px">Psst — as a first-time customer, use code <b>HELIX10</b> for 10% off your first order.</p>` : ""}
      <p><small style="color:#888">Stock is held for 60 minutes after checkout starts — after that, items go back on the shelf.</small></p>
      ${footer.html}
    </div>`,
    kind: "abandonment",
    orderId: order.id,
    created: new Date().toISOString(),
    status: "queued",
    attempts: 0,
  };
}
function expiryNudgeMail(order, deps) {
  const origin = (deps && deps.origin) || "https://helixkinglabs.com";
  const total = "$" + Number(order.quote && order.quote.total || 0).toFixed(2);
  const footer = emailFooter("orders");
  const pay = order.payment || {};
  const addrLine = pay.payAddress ? `\n\nSend ${pay.payAmount} ${pay.payCurrency} to:\n${pay.payAddress}` : "";
  return {
    to: order.email,
    subject: `Your payment window closes soon — ${order.id}`,
    text: `Hi there,\n\nYour order ${order.id} (${total}) is still NOT PAID and the crypto payment window closes in about 15 minutes. After that, your items go back on the shelf.${addrLine}\n\nComplete it here:\n${origin}/account/receipt/${order.id}\n\n— Helix King Labs${footer.text}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <p style="font-size:16px">Hi there,</p>
      <p>Your order <b>${order.id}</b> (${total}) is still <b>NOT PAID</b> and the crypto payment window closes in about <b>15 minutes</b>. After that, your items go back on the shelf.</p>
      ${pay.payAddress ? `<p style="background:#f5f5f5;padding:12px;border-radius:6px;font-family:monospace;font-size:13px;word-break:break-all">Send ${pay.payAmount} ${pay.payCurrency} to:<br><b>${pay.payAddress}</b></p>` : ""}
      <p style="text-align:center"><a href="${origin}/account/receipt/${order.id}" style="display:inline-block;padding:12px 28px;background:#1a1a1a;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">Complete my payment</a></p>
      ${footer.html}
    </div>`,
    kind: "expiry_nudge",
    orderId: order.id,
    created: new Date().toISOString(),
    status: "queued",
    attempts: 0,
  };
}
module.exports = { sendMail, configured, resendConfigured, smtpConfigured, orderHtml, orderMail, underpaymentMail, abandonmentMail, expiryNudgeMail, emailFooter };
