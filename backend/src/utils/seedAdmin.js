// One-off script: `npm run seed`. Creates the Admin stakeholder from the
// paper (Sec. II "Admin, Cars (drivers), and Users ... are its three
// stakeholders") since there is no public "become an admin" endpoint.
require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/User');
const { generateUsername } = require('./username');

async function seed() {
  await connectDB();

  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@veripool.app').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'admin12345';

  const existing = await User.findOne({ email });
  if (existing) {
    console.log(`Admin already exists: ${email}`);
    process.exit(0);
  }

  const username = await generateUsername('admin', 'veripool');

  await User.create({
    firstName: 'Admin',
    lastName: 'VeriPool',
    username,
    universityId: 'ADMIN-0000',
    email,
    phone: '0000000000',
    password,
    role: 'admin',
    status: 'accepted',
  });

  console.log(`Admin account created.\n  email:    ${email}\n  password: ${password}\n  username: ${username}`);
  process.exit(0);
}

seed().catch((err) => {
  console.error('Failed to seed admin:', err);
  process.exit(1);
});
