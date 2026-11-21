const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Ride = require('../models/Ride');
const registry = require('./registry');
const safety = require('../services/safetyMonitor');

// Communication layer chosen per the paper: "Socket.IO ... allows
// bidirectional, event based communication between clients and servers ...
// best for real time events, location and chats" (Sec. II-A "Communication").
function initSockets(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*' },
  });
  registry.setIO(io);

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('No token provided'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.sub);
      if (!user) return next(new Error('User no longer exists'));
      socket.userId = user._id.toString();
      socket.role = user.role;
      next();
    } catch (err) {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    registry.addSocket(socket.userId, socket.id);

    // Live GPS updates from the driver's device while a ride is active
    // (Sec. II-A "Tracking": "Expo location ... to get the GPS location").
    // The client emits ride:location, and it is fanned out to the rider
    // tracking that specific ride.
    socket.on('ride:location', async ({ rideId, lat, lng, accuracy }) => {
      if (!rideId || typeof lat !== 'number' || typeof lng !== 'number') return;
      try {
        const ride = await Ride.findById(rideId);
        if (!ride || String(ride.driver) !== socket.userId) return;

        ride.driverLocation = { lat, lng, updatedAt: new Date() };
        // Route-deviation check while the rider is on board.
        const effects = safety.onLocation(ride, {
          lat,
          lng,
          t: Date.now(),
          accuracy: typeof accuracy === 'number' ? accuracy : 0,
        });
        await ride.save();
        await safety.runEffects(ride, effects);

        await User.findByIdAndUpdate(socket.userId, {
          currentLocation: { lat, lng, updatedAt: new Date() },
        });

        registry.emitToUser(ride.rider, 'ride:location', {
          rideId: ride._id,
          lat,
          lng,
        });
      } catch (err) {
        // Best-effort — a dropped location tick shouldn't crash the socket.
        console.error('ride:location error', err.message);
      }
    });

    socket.on('disconnect', () => {
      registry.removeSocket(socket.userId, socket.id);
    });
  });

  return io;
}

module.exports = initSockets;
