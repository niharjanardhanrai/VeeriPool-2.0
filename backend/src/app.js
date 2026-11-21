const express = require('express');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');

const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const rideRoutes = require('./routes/rideRoutes');
const driverRoutes = require('./routes/driverRoutes');
const supportRoutes = require('./routes/supportRoutes');
const offerRoutes = require('./routes/offerRoutes');
const directionsRoutes = require('./routes/directionsRoutes');
const safetyRoutes = require('./routes/safetyRoutes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Uploaded driver license photos — served so the admin screen and the OCR
// step can both load them. Prototype-scope: filenames are random, not
// otherwise access-controlled.
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/', (req, res) => {
  res.json({
    service: 'VeriPool 2.o API',
    status: 'ok',
    basedOn: 'GO-DRiVeS (arXiv:2601.12367)',
    endpoints: [
      'GET  /api/health',
      'POST /api/auth/register',
      'POST /api/auth/verify-otp',
      'POST /api/auth/resend-otp',
      'POST /api/auth/login',
      'GET  /api/auth/me',
      'GET  /api/admin/flagged',
      'GET  /api/admin/recent',
      'POST /api/admin/users/:id/approve',
      'POST /api/admin/users/:id/reject',
      'POST /api/rides',
      'GET  /api/rides/mine',
      'GET  /api/rides/queue',
      'GET  /api/rides/:id',
      'POST /api/rides/:id/accept',
      'POST /api/rides/:id/reject',
      'POST /api/rides/:id/cancel',
      'POST /api/rides/:id/stage',
      'GET  /api/rides/:id/messages',
      'POST /api/rides/:id/messages',
      'POST /api/drivers/availability',
      'POST /api/offers/plan',
      'POST /api/offers',
      'GET  /api/offers/search',
      'GET  /api/offers/mine',
      'GET  /api/offers/:id',
      'POST /api/offers/:id/book',
      'POST /api/offers/:id/cancel-booking',
      'POST /api/offers/:id/status',
      'GET  /api/directions?points=lat,lng|lat,lng',
      'POST /api/rides/:id/safety/respond',
      'POST /api/rides/:id/safety/sos',
      'POST /api/rides/:id/share',
      'GET  /api/safety/mode',
      'GET  /api/track/:token',
      'GET  /track/:token  (guardian live page)',
      'GET  /api/support/messages',
      'POST /api/support/messages',
      'GET  /api/support/threads',
      'GET  /api/support/threads/:userId',
      'POST /api/support/threads/:userId',
    ],
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'VeriPool 2.o API' });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/offers', offerRoutes);
app.use('/api/directions', directionsRoutes);
app.use('/api', safetyRoutes.api);
app.use('/', safetyRoutes.page);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
