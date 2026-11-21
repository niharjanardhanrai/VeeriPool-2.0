const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const { generateUsername } = require('../utils/username');
const { newOtpFields, hashOtp, MAX_OTP_ATTEMPTS, OTP_RESEND_COOLDOWN_SECONDS } = require('../utils/otp');
const { sendOtpEmail, sendAccountDecisionEmail } = require('../services/mailer');
const { checkLicense } = require('../services/licenseCheck');

function toPublicUser(user) {
  return {
    id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    universityId: user.universityId,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    emailVerified: user.emailVerified,
    vehicle: user.vehicle,
    isAvailable: user.isAvailable,
    license: user.license
      ? {
          photoUrl: user.license.photoUrl,
          extractedName: user.license.extractedName,
          extractedNumber: user.license.extractedNumber,
          extractedExpiry: user.license.extractedExpiry,
          checks: user.license.checks,
        }
      : undefined,
    createdAt: user.createdAt,
  };
}

// Sec. II-B.1.a "Registration process" — automated version: the account is
// created as "pending_otp" and a 6-digit code is emailed immediately. No
// admin step happens yet; that only kicks in for drivers who fail the
// automated license check (see verifyOtp below).
async function register(req, res, next) {
  try {
    const { firstName, lastName, universityId, email, phone, password, role } = req.body;
    const isDriver = role === 'driver';

    const existing = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { universityId }],
    });
    if (existing) {
      return res.status(409).json({ message: 'An account with this email or university ID already exists' });
    }

    if (isDriver && !req.file) {
      return res.status(400).json({ message: 'A photo of your driving license is required to register as a driver' });
    }

    const username = await generateUsername(firstName, lastName);
    const { plaintext, record } = newOtpFields();

    // multipart/form-data is flat, so a driver's vehicle fields arrive as
    // vehicleSeatsTotal / vehiclePlate / vehicleMake rather than nested.
    const vehicle = isDriver
      ? {
          seatsTotal: Number(req.body.vehicleSeatsTotal) || undefined,
          plate: req.body.vehiclePlate || undefined,
          make: req.body.vehicleMake || undefined,
        }
      : undefined;

    const user = await User.create({
      firstName,
      lastName,
      username,
      universityId,
      email,
      phone,
      password,
      role: isDriver ? 'driver' : 'rider',
      vehicle,
      otp: record,
      license: req.file ? { photoUrl: `/uploads/licenses/${req.file.filename}` } : undefined,
    });

    await sendOtpEmail(user.email, user.firstName, plaintext);

    res.status(201).json({
      message: 'Check your email for a 6-digit verification code.',
      user: toPublicUser(user),
      requiresOtp: true,
    });
  } catch (err) {
    next(err);
  }
}

async function resendOtp(req, res, next) {
  try {
    const { username, email } = req.body;
    const query = username ? { username: username.toLowerCase() } : { email: (email || '').toLowerCase() };
    const user = await User.findOne(query).select('+otp.codeHash');
    if (!user) return res.status(404).json({ message: 'Account not found' });
    if (user.status !== 'pending_otp') return res.status(400).json({ message: 'This account is already verified' });

    if (user.otp?.lastSentAt && Date.now() - user.otp.lastSentAt.getTime() < OTP_RESEND_COOLDOWN_SECONDS * 1000) {
      return res.status(429).json({ message: `Please wait a few seconds before requesting another code` });
    }

    const { plaintext, record } = newOtpFields();
    user.otp = record;
    await user.save();
    await sendOtpEmail(user.email, user.firstName, plaintext);

    res.json({ message: 'A new code has been sent.' });
  } catch (err) {
    next(err);
  }
}

// Automated version of Sec. II-B.1.b "Validation Process", with a manual
// fallback only for what automation can't confidently resolve. OTP
// confirms the email is real; riders are then auto-accepted outright.
// Drivers are auto-accepted if their license photo passes every check in
// services/licenseCheck.js — anything less isn't guessed at either way,
// it's held for a human admin (see adminController.js) with the specific
// reason attached.
async function verifyOtp(req, res, next) {
  try {
    const { username, email, code } = req.body;
    const query = username ? { username: username.toLowerCase() } : { email: (email || '').toLowerCase() };
    const user = await User.findOne(query).select('+otp.codeHash');
    if (!user) return res.status(404).json({ message: 'Account not found' });
    if (user.status !== 'pending_otp') {
      return res.status(400).json({ message: 'This account is already verified' });
    }
    if (!user.otp?.expiresAt || user.otp.expiresAt.getTime() < Date.now()) {
      return res.status(400).json({ message: 'That code has expired — request a new one' });
    }
    if (user.otp.attempts >= MAX_OTP_ATTEMPTS) {
      return res.status(429).json({ message: 'Too many incorrect attempts — request a new code' });
    }
    if (hashOtp(String(code)) !== user.otp.codeHash) {
      user.otp.attempts += 1;
      await user.save();
      return res.status(400).json({ message: 'Incorrect code' });
    }

    user.emailVerified = true;
    user.otp = undefined;

    let decision = { status: 'accepted', reason: null };

    if (user.role === 'driver') {
      const result = await checkLicense(
        require('path').join(__dirname, '..', '..', 'uploads', 'licenses', require('path').basename(user.license.photoUrl)),
        { firstName: user.firstName, lastName: user.lastName }
      );
      user.license.extractedName = result.extractedName || undefined;
      user.license.extractedNumber = result.extractedNumber || undefined;
      user.license.extractedExpiry = result.extractedExpiry || undefined;
      user.license.rawText = result.rawText;
      user.license.checks = result.checks;
      user.license.checkedAt = new Date();

      if (!result.allPassed) {
        const CHECK_LABELS = {
          readable: 'the photo could not be read',
          nameMatch: "the name on it doesn't match your registration",
          numberPlausible: 'no license number could be found on it',
          notExpired: 'no valid, unexpired date could be found on it',
        };
        const reasons = Object.entries(result.checks)
          .filter(([, passed]) => !passed)
          .map(([check]) => CHECK_LABELS[check] || check);
        decision = {
          status: 'flagged',
          reason: `Automated license check couldn't confirm this: ${reasons.join('; ')}.`,
        };
      }
    }

    user.status = decision.status;
    await user.save();

    if (decision.status === 'accepted') {
      await sendAccountDecisionEmail(user.email, user.firstName, 'accepted');
      const token = generateToken(user._id);
      return res.json({
        message: user.role === 'driver' ? 'Email verified and license auto-approved — you\'re in.' : 'Email verified — you\'re in.',
        user: toPublicUser(user),
        token,
      });
    }

    res.json({
      message: 'Email verified. Your license needs a quick human check before you can log in — we\'ll notify you.',
      user: toPublicUser(user),
      flaggedReason: decision.reason,
    });
  } catch (err) {
    next(err);
  }
}

// Sec. II-B.1.c "Login Process".
async function login(req, res, next) {
  try {
    const { username, email, password } = req.body;

    const query = username ? { username: username.toLowerCase() } : { email: (email || '').toLowerCase() };
    const user = await User.findOne(query).select('+password');

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Invalid username/email or password' });
    }

    if (user.status === 'pending_otp') {
      return res.status(403).json({ message: 'Please verify your email first.', status: 'pending_otp' });
    }
    if (user.status === 'flagged') {
      return res.status(403).json({ message: 'Your account is still under review.', status: 'flagged' });
    }
    if (user.status === 'rejected') {
      return res.status(403).json({ message: 'Your registration was not approved. Please register again.', status: 'rejected' });
    }

    const token = generateToken(user._id);

    res.json({ message: 'Login successful', user: toPublicUser(user), token });
  } catch (err) {
    next(err);
  }
}

async function me(req, res) {
  res.json({ user: toPublicUser(req.user) });
}

module.exports = { register, login, me, verifyOtp, resendOtp, toPublicUser };
