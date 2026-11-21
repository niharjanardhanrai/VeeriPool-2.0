// Dev-only: creates three accepted test accounts (one driver, two riders)
// for trying out posted rides locally, and prints a login token for each.
// Run: node src/utils/seedOfferTest.js
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const User = require('../models/User');
const generateToken = require('./generateToken');

const TEST_PASSWORD = 'testpass123';

const ACCOUNTS = [
  { firstName: 'Test', lastName: 'Driver', role: 'driver', vehicle: { make: 'Maruti Swift', plate: 'KA20AB1234', seatsTotal: 4 } },
  { firstName: 'Test', lastName: 'Rider', role: 'rider' },
  { firstName: 'Test', lastName: 'Ridertwo', role: 'rider' },
];

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const out = {};
  for (const a of ACCOUNTS) {
    const username = `${a.firstName}.${a.lastName}`.toLowerCase();
    let user = await User.findOne({ username });
    if (!user) {
      user = await User.create({
        ...a,
        username,
        universityId: `TEST-${a.lastName.toUpperCase()}`,
        email: `${username}@veripool.test`,
        phone: '9000000000',
        password: TEST_PASSWORD,
        status: 'accepted',
        emailVerified: true,
        isAvailable: a.role === 'driver',
      });
    }
    out[username] = { id: String(user._id), token: generateToken(user._id) };
  }
  console.log(JSON.stringify({ password: TEST_PASSWORD, accounts: out }, null, 2));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
