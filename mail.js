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
  const total = "$" + Number(q.total || 0).toFixed(2);
  const lines = ((q.lines || []).map((l) => `${l.name || ""} ${l.size || ""} × ${l.qty}`).join("\n")) || "See the desk for lines.";
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
  const text = {
    placed: `Order ${order.id} is recorded.\nTotal ${total}\n\n${lines}\n\n${payText}\n\nNothing ships until payment is confirmed. Research use only.`,
    settled: `Payment received for ${order.id}. The order is being prepared. Nothing has shipped yet.`,
    shipped: `${order.id} is booked${order.carrier ? " with " + order.carrier : ""}. Tracking ${order.tracking || "posts on the next note"}.`,
    delivered: deliveredText,
    voided: `Did you miss something? Your order ${order.id} was released before payment was confirmed, so the items are back on the shelf.\n\nRestore your cart in one tap:\n${origin + "/account/receipt/" + order.id}\n\nNothing ships until payment is confirmed. Research use only.`,
  };

  return {
    to: order.email,
    subject: subjects[kind] || `Helix King Labs ${order.id}`,
    text: text[kind] || text.placed,
    html: orderHtml(order),
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
  return {
    to: order.email,
    subject: `Action needed: $${shortBy} short on order ${order.id} — Helix King Labs`,
    text: `Hi there,\n\nWe received $${paid} of the $${expected} owed for order ${order.id} — you're $${shortBy} short.\n\nThis usually happens when a wallet deducts the network (gas) fee from the payment instead of adding it on top. The network fee is always on the buyer.\n\nTo fix it, send $${shortBy} to the same payment address within 120 minutes:\n${origin}/account/receipt/${order.id}\n\nIf we don't receive the rest within 120 minutes, the order will be cancelled and the items released. Any partial payment can be refunded — just reply to this email (refunds may differ by network fees).\n\n— Helix King Labs`,
    html: `<p>Hi there,</p><p>We received <b>$${paid}</b> of the <b>$${expected}</b> owed for order <b>${order.id}</b> — you're <b>$${shortBy}</b> short.</p><p>This usually happens when a wallet deducts the network (gas) fee from the payment instead of adding it on top. The network fee is always on the buyer.</p><p>To fix it, send <b>$${shortBy}</b> to the same payment address within <b>120 minutes</b>:<br><a href="${origin}/account/receipt/${order.id}">${origin}/account/receipt/${order.id}</a></p><p>If we don't receive the rest in time, the order will be cancelled and the items released. Any partial payment can be refunded — just reply to this email (refunds may differ by network fees).</p><p>— Helix King Labs</p>`,
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
  return {
    to: order.email,
    subject: `Still thinking it over? Your cart is waiting — Helix King Labs`,
    text: `Hi there,\n\nYou started checkout for ${order.id} (${total}) but didn't finish. Your items are still in your cart:\n${origin}/cart${couponLine}\n\nStock is held for 60 minutes after checkout starts — after that, items go back on the shelf.\n\n— Helix King Labs`,
    html: `<p>Hi there,</p><p>You started checkout for <b>${order.id}</b> (${total}) but didn't finish. Your items are still waiting:</p><p><a href="${origin}/cart">Return to your cart</a>${isFirstOrder ? `</p><p>Psst — as a first-time customer, use code <b>HELIX10</b> for 10% off your first order.` : ""}</p><p><small>Stock is held for 60 minutes after checkout starts — after that, items go back on the shelf.</small></p><p>— Helix King Labs</p>`,
    kind: "abandonment",
    orderId: order.id,
    created: new Date().toISOString(),
    status: "queued",
    attempts: 0,
  };
}
module.exports = { sendMail, configured, resendConfigured, smtpConfigured, orderHtml, orderMail, underpaymentMail, abandonmentMail };
