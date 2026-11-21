const nodemailer = require('nodemailer');

// Sends real email from veripool2026@gmail.com via Gmail SMTP with an App
// Password (GMAIL_APP_PASSWORD in .env). When that isn't configured yet,
// every send falls back to a console log instead of throwing — the same
// "runs with zero config, upgrades the moment a free credential is added"
// pattern as ORS routing (see backend/src/utils/geo.js).
let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return null;
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
  return transporter;
}

async function sendMail({ to, subject, text, html }) {
  const t = getTransporter();
  if (!t) {
    console.log(`[email:fallback — GMAIL_APP_PASSWORD not set] To: ${to}\nSubject: ${subject}\n${text}`);
    return { sent: false, reason: 'no_credentials' };
  }
  try {
    await t.sendMail({ from: `VeriPool <${process.env.GMAIL_USER}>`, to, subject, text, html });
    return { sent: true };
  } catch (err) {
    console.error(`[email:failed] To: ${to} — ${err.message}`);
    console.log(`[email:fallback content] Subject: ${subject}\n${text}`);
    return { sent: false, reason: err.message };
  }
}

function sendOtpEmail(to, firstName, code) {
  return sendMail({
    to,
    subject: `Your VeriPool verification code: ${code}`,
    text: `Hi ${firstName},\n\nYour VeriPool verification code is: ${code}\n\nIt expires in ${process.env.OTP_EXPIRY_MINUTES || 10} minutes. If you didn't request this, you can ignore this email.\n\n— VeriPool`,
    html: `<p>Hi ${firstName},</p><p>Your VeriPool verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px;">${code}</p><p>It expires in ${process.env.OTP_EXPIRY_MINUTES || 10} minutes. If you didn't request this, you can ignore this email.</p><p>— VeriPool</p>`,
  });
}

function sendAccountDecisionEmail(to, firstName, decision, reason) {
  const subject =
    decision === 'accepted' ? 'Your VeriPool account is approved' : 'Update on your VeriPool registration';
  const body =
    decision === 'accepted'
      ? `Hi ${firstName},\n\nYou're approved — you can log in to VeriPool now.\n\n— VeriPool`
      : `Hi ${firstName},\n\nWe weren't able to approve your VeriPool registration.${reason ? ` Reason: ${reason}` : ''}\n\nYou're welcome to register again with corrected details.\n\n— VeriPool`;
  return sendMail({ to, subject, text: body });
}

module.exports = { sendMail, sendOtpEmail, sendAccountDecisionEmail };
