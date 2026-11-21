// Tracks which socket(s) belong to which user so REST controllers can push
// a targeted event after they persist a state change — the paper's pattern
// of a POST handler doing the DB write and then emitting/notifying the
// other side (Sec. II-B.2.d "Logic behind").
let ioInstance = null;
const userSockets = new Map(); // userId (string) -> Set<socketId>

function setIO(io) {
  ioInstance = io;
}

function addSocket(userId, socketId) {
  const key = String(userId);
  if (!userSockets.has(key)) userSockets.set(key, new Set());
  userSockets.get(key).add(socketId);
}

function removeSocket(userId, socketId) {
  const key = String(userId);
  const set = userSockets.get(key);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) userSockets.delete(key);
}

function emitToUser(userId, event, payload) {
  if (!ioInstance) return;
  const key = String(userId);
  const set = userSockets.get(key);
  if (!set || set.size === 0) return;
  set.forEach((socketId) => ioInstance.to(socketId).emit(event, payload));
}

function emitToUsers(userIds, event, payload) {
  userIds.filter(Boolean).forEach((id) => emitToUser(id, event, payload));
}

function isUserOnline(userId) {
  const set = userSockets.get(String(userId));
  return Boolean(set && set.size > 0);
}

module.exports = { setIO, addSocket, removeSocket, emitToUser, emitToUsers, isUserOnline };
