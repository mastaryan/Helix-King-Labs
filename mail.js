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

module.exports = { sendMail, configured, resendConfigured, smtpConfigured, orderHtml };
