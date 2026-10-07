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
async function sendViaResend({ to, subject, text }) {
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

async function sendMail({ to, subject, text }) {
  if (resendConfigured()) return sendViaResend({ to, subject, text });
  const tx = transport();
  if (!tx) {
    const err = new Error("smtp_unconfigured");
    err.code = "smtp_unconfigured";
    throw err;
  }
  await tx.sendMail({ from: FROM, to, subject, text });
}

module.exports = { sendMail, configured, resendConfigured, smtpConfigured };
