const Tesseract = require('tesseract.js');

// Automated driver-license plausibility check, run once per driver right
// after they verify their email OTP. This is deliberately NOT a claim of
// official verification: there is no free, legitimate API for a student
// project to query a real government license database (that needs a paid
// KYC provider — Setu/IDfy/Signzy/DigiLocker partnership — and business
// registration). What this does instead, for free, with Tesseract.js OCR:
//
//   readable        — OCR could extract any meaningful text at all
//   nameMatch       — the registrant's first & last name both appear in
//                      the OCR'd text (loose, case-insensitive substring)
//   numberPlausible — a token that *looks like* a license number
//                      (mixed letters+digits, 8–20 chars) was found
//   notExpired      — a date was found on the card and it's in the future
//
// All four passing => auto-approve. Any failing => held for a human admin,
// with the reason shown, never blindly rejected outright.

const DATE_PATTERNS = [
  /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/g, // DD/MM/YYYY or DD-MM-YYYY
  /(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/g, // YYYY-MM-DD
];

function extractDates(text) {
  const dates = [];
  for (const pattern of DATE_PATTERNS) {
    let match;
    // eslint-disable-next-line no-cond-assign
    while ((match = pattern.exec(text)) !== null) {
      const nums = match.slice(1, 4).map(Number);
      const year = nums.find((n) => n > 1900);
      if (!year) continue;
      const rest = nums.filter((n) => n !== year);
      const [a, b] = rest;
      // Try day/month in either order; keep whichever parses as a real date.
      for (const [day, month] of [[a, b], [b, a]]) {
        const d = new Date(year, (month || 1) - 1, day || 1);
        if (!Number.isNaN(d.getTime())) dates.push(d);
      }
    }
  }
  return dates;
}

function extractLicenseNumber(text) {
  const tokens = text.split(/[\s:,;|]+/).filter(Boolean);
  const candidates = tokens.filter((t) => {
    const cleaned = t.replace(/[^A-Za-z0-9]/g, '');
    if (cleaned.length < 8 || cleaned.length > 20) return false;
    return /[A-Za-z]/.test(cleaned) && /[0-9]/.test(cleaned);
  });
  return candidates.sort((a, b) => b.length - a.length)[0] || null;
}

function normalizeName(name) {
  return name.toUpperCase().replace(/[^A-Z\s]/g, ' ').split(/\s+/).filter(Boolean);
}

async function checkLicense(imagePath, { firstName, lastName }) {
  let rawText = '';
  // Tesseract.recognize()'s convenience wrapper doesn't set an
  // errorHandler, so a genuinely unreadable image (corrupt file, bad
  // encoding) makes the worker both reject the promise AND synchronously
  // throw inside a message-port callback — the second one bypasses any
  // try/catch here and crashes the whole Node process. createWorker() with
  // an explicit no-op errorHandler avoids that throw; the try/catch below
  // still handles the (normal) promise rejection path.
  let worker;
  try {
    worker = await Tesseract.createWorker('eng', 1, { errorHandler: () => {} });
    const result = await worker.recognize(imagePath);
    rawText = result.data.text || '';
  } catch (err) {
    console.warn('License OCR failed:', err?.message || err);
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch {
        /* already gone */
      }
    }
  }

  const upper = rawText.toUpperCase();
  const readable = rawText.trim().length > 10;

  const nameTokens = [...normalizeName(firstName), ...normalizeName(lastName)];
  const nameMatch = readable && nameTokens.length > 0 && nameTokens.every((t) => upper.includes(t));

  const extractedNumber = readable ? extractLicenseNumber(rawText) : null;
  const numberPlausible = Boolean(extractedNumber);

  const dates = readable ? extractDates(rawText) : [];
  const futureDates = dates.filter((d) => d.getTime() > Date.now());
  const extractedExpiry = futureDates.sort((a, b) => b - a)[0] || null;
  const notExpired = Boolean(extractedExpiry);

  const checks = { readable, nameMatch, numberPlausible, notExpired };
  const allPassed = Object.values(checks).every(Boolean);

  return {
    rawText,
    extractedName: readable ? rawText.split('\n').find((l) => l.trim().length > 3)?.trim() || null : null,
    extractedNumber,
    extractedExpiry,
    checks,
    allPassed,
  };
}

module.exports = { checkLicense };
