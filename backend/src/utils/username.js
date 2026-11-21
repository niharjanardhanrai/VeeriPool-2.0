const User = require('../models/User');

// "the username will be auto generated for the user, and it will be the
// combination of the first and last names separated by a (.)" — Sec.
// II-B.1.c. Appends a numeric suffix on collision (e.g. jane.doe2).
async function generateUsername(firstName, lastName) {
  const base = `${firstName}.${lastName}`
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '');

  let candidate = base;
  let suffix = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await User.exists({ username: candidate })) {
    suffix += 1;
    candidate = `${base}${suffix}`;
  }
  return candidate;
}

module.exports = { generateUsername };
