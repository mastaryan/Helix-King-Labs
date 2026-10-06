"use strict";

const nodemailer = require("nodemailer");

function configured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function transport() {
  if (!configured()) return null;
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
  const tx = transport();
  if (!tx) {
    const err = new Error("smtp_unconfigured");
    err.code = "smtp_unconfigured";
    throw err;
  }
  await tx.sendMail({
    from: process.env.SMTP_FROM || "orders@helixkinglabs.com",
    to,
    subject,
    text,
  });
}

module.exports = { sendMail, configured };
