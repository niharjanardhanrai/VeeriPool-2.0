require('dotenv').config();
const http = require('http');
const app = require('./src/app');
const connectDB = require('./src/config/db');
const initSockets = require('./src/sockets');

const PORT = process.env.PORT || 5050;

// Defense in depth: a bad request (e.g. a corrupt license photo tripping up
// the OCR worker — see src/services/licenseCheck.js) should fail that one
// request, never take the whole server down. This is a safety net, not a
// substitute for fixing the actual bug — it just means one more unforeseen
// case doesn't turn into a full outage.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] kept the process alive:', err?.stack || err);
});
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection] kept the process alive:', err?.stack || err);
});

async function start() {
  await connectDB();

  const httpServer = http.createServer(app);
  initSockets(httpServer);

  httpServer.listen(PORT, () => {
    console.log(`VeriPool 2.o API + Socket.IO listening on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
