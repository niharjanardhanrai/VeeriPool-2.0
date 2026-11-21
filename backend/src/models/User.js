const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Fields follow the GO-DRiVeS "Registration process": university ID and
// email, first and last names, phone number, and a password of at least 6
// characters (arXiv:2601.12367, Sec. II-B.1.a).
const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: [true, 'First name is required'], trim: true },
    lastName: { type: String, required: [true, 'Last name is required'], trim: true },

    // Auto-generated as "firstname.lastname" at registration time — the
    // paper's login process uses this instead of the email (Sec. II-B.1.c).
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },

    universityId: { type: String, required: [true, 'University ID is required'], trim: true },

    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },

    phone: { type: String, required: [true, 'Phone number is required'], trim: true },

    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 6,
      select: false,
    },

    // Admin, Cars (drivers) and Users (faculty/students) — the three
    // stakeholders named in Sec. II ("The user perspective").
    role: {
      type: String,
      enum: ['rider', 'driver', 'admin'],
      default: 'rider',
    },

    // The automated version of the paper's "Validation Process" (Sec.
    // II-B.1.b), with a manual fallback only for the case automation can't
    // confidently resolve:
    //   pending_otp -> just registered, waiting on the emailed code
    //   accepted    -> OTP verified (riders: immediately; drivers: also
    //                  passed every automated license check)
    //   flagged     -> OTP verified but the license check failed something —
    //                  held for a human admin to accept/reject, reason shown
    //   rejected    -> a human admin turned this account down
    status: {
      type: String,
      enum: ['pending_otp', 'accepted', 'rejected', 'flagged'],
      default: 'pending_otp',
    },
    emailVerified: { type: Boolean, default: false },

    // One-time passcode for email verification. `code` is a salted hash,
    // never the plaintext — same reasoning as the password field.
    otp: {
      codeHash: { type: String, select: false },
      expiresAt: Date,
      attempts: { type: Number, default: 0 },
      lastSentAt: Date,
    },

    // Driver-only fields — the car's seat capacity and live GPS position,
    // used by the ride-matching and tracking flow (Sec. II-B.2/3).
    vehicle: {
      make: { type: String, trim: true },
      plate: { type: String, trim: true },
      seatsTotal: { type: Number, min: 1, max: 8 },
    },
    isAvailable: { type: Boolean, default: false },
    currentLocation: {
      lat: Number,
      lng: Number,
      updatedAt: Date,
    },

    // Driver-only: the uploaded license photo plus what the automated OCR
    // check (backend/src/services/licenseCheck.js) found. This is a
    // plausibility check, NOT a real government (RTO/DigiLocker) lookup —
    // no free, legitimate API for that exists for a student project, so
    // this is best-effort text extraction + rule checks, always disclosed
    // as such to the driver and the admin.
    license: {
      photoUrl: { type: String, trim: true },
      extractedName: { type: String, trim: true },
      extractedNumber: { type: String, trim: true },
      extractedExpiry: Date,
      rawText: { type: String, select: false },
      checks: {
        readable: Boolean,
        nameMatch: Boolean,
        numberPlausible: Boolean,
        notExpired: Boolean,
      },
      checkedAt: Date,
    },
  },
  { timestamps: true }
);

userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
