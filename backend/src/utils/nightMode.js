// Night mode — the hours when the stricter safety rules apply:
//   • drop-offs only at night-safe hotspots (staffed all night, see hotspots.js)
//   • a narrower route corridor and faster alerts (services/safetyMonitor.js)
//
// Hours are read in India time whatever the server's clock is set to.
// NIGHT_START_HOUR / NIGHT_END_HOUR (24h, default 21 and 6) move the window;
// FORCE_NIGHT_MODE=true turns it on all day, for demos.
const TIME_ZONE = 'Asia/Kolkata';
const NIGHT_START_HOUR = Number(process.env.NIGHT_START_HOUR ?? 21);
const NIGHT_END_HOUR = Number(process.env.NIGHT_END_HOUR ?? 6);

const hourFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: 'numeric', hourCycle: 'h23' });

function localHour(date) {
  return Number(hourFormat.format(date));
}

function isNight(date = new Date()) {
  if (process.env.FORCE_NIGHT_MODE === 'true') return true;
  const h = localHour(new Date(date));
  return NIGHT_START_HOUR > NIGHT_END_HOUR
    ? h >= NIGHT_START_HOUR || h < NIGHT_END_HOUR
    : h >= NIGHT_START_HOUR && h < NIGHT_END_HOUR;
}

function describeWindow() {
  const fmt = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? 'am' : 'pm'}`;
  return `${fmt(NIGHT_START_HOUR)}–${fmt(NIGHT_END_HOUR)}`;
}

module.exports = { isNight, describeWindow, NIGHT_START_HOUR, NIGHT_END_HOUR };
