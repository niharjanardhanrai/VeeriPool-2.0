const crypto = require('crypto');

const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES || 10);
const OTP_RESEND_COOLDOWN_SECONDS = 30;
const MAX_OTP_ATTEMPTS = 5;

function generateOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function hashOtp(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function newOtpFields() {
  const code = generateOtp();
  return {
    plaintext: code,
    record: {
      codeHash: hashOtp(code),
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
      attempts: 0,
      lastSentAt: new Date(),
    },
  };
}

module.exports = { generateOtp, hashOtp, newOtpFields, OTP_EXPIRY_MINUTES, OTP_RESEND_COOLDOWN_SECONDS, MAX_OTP_ATTEMPTS };
