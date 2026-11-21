import { io } from 'socket.io-client';
import { SOCKET_URL } from './client';

// The client side of the Socket.IO communication layer chosen in the paper
// (Sec. II-A "Communication") — a single authenticated connection reused by
// every screen that needs real-time ride events or GPS updates.
let socket = null;

export function connectSocket(token) {
  if (socket) {
    if (socket.connected) return socket;
    socket.disconnect();
  }
  socket = io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
  });
  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
