const jwt = require('jsonwebtoken');
const { sendMessage } = require('./utils/messaging');

/** Room name that collects every socket belonging to one user (multi-tab safe). */
function userRoom(userId) {
  return `user:${userId}`;
}

/**
 * Delivers a message to exactly the conversation's participants (never a
 * broadcast). The sender is included so their other tabs stay in sync and they
 * see their own message land. Shared by the socket handler and the REST send
 * route, so `io` may be undefined (e.g. in tests with no socket server) - then
 * this is a no-op.
 */
function emitNewMessage(io, participantIds, message) {
  if (!io) return;
  participantIds.forEach((id) => io.to(userRoom(id)).emit('new_message', message));
}

/**
 * Attaches a Socket.io server to the existing HTTP server. Same trust model as
 * requireAuth: the client sends its JWT in the handshake, we verify it and pin
 * the user id to the socket. No token / bad token => connection refused.
 */
function attachSocketServer(httpServer, app) {
  // Lazy require: only src/server.js calls this, so the Jest suite (which loads
  // src/app.js but never src/server.js) doesn't need socket.io installed.
  const { Server } = require('socket.io');

  const io = new Server(httpServer, {
    cors: { origin: process.env.CORS_ORIGIN || '*' }
  });

  // Let REST routes reach io for the send-fallback fan-out.
  app.set('io', io);

  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error('unauthorized'));
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.data.userId = payload.sub;
      return next();
    } catch (err) {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(userRoom(socket.data.userId));

    socket.on('send_message', async (payload, ack) => {
      try {
        const { message, participantIds } = await sendMessage({
          senderId: socket.data.userId,
          conversationId: payload && payload.conversationId,
          toUserId: payload && payload.toUserId,
          type: payload && payload.type,
          text: payload && payload.text,
          destinationId: payload && payload.destinationId,
          itineraryId: payload && payload.itineraryId
        });
        emitNewMessage(io, participantIds, message);
        if (typeof ack === 'function') ack({ ok: true, message });
      } catch (err) {
        const errorText = err.message || 'Could not send message';
        if (typeof ack === 'function') ack({ ok: false, error: errorText });
        socket.emit('message_error', { error: errorText });
      }
    });
  });

  return io;
}

module.exports = { attachSocketServer, emitNewMessage, userRoom };
