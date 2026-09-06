const http = require('http');
const request = require('supertest');
const { io: ioClient } = require('socket.io-client');
const { createTestApp, registerUser, mutualFollow, follow } = require('./helpers/testApp');

/**
 * End-to-end check of the realtime path: a real Socket.io server on an
 * ephemeral port, real socket.io-client connections, JWT handshake auth, and
 * targeted "new_message" delivery. (The REST send endpoint - same
 * messaging.sendMessage core - is covered more exhaustively in
 * tests/conversations.test.js.)
 */
describe('Realtime messaging (Socket.io)', () => {
  let app;
  let cleanup;
  let server;
  let port;
  let userA;
  let userB;
  const clients = [];

  function connect(token) {
    const socket = ioClient(`http://localhost:${port}`, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      reconnection: false
    });
    clients.push(socket);
    return socket;
  }

  beforeAll(async () => {
    ({ app, cleanup } = createTestApp());
    // require after createTestApp() so it shares the same dataStore module.
    const { attachSocketServer } = require('../src/realtime');

    server = http.createServer(app);
    attachSocketServer(server, app);
    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;

    userA = await registerUser(app);
    userB = await registerUser(app);
    await mutualFollow(app, userA, userB);
  });

  afterEach(() => {
    while (clients.length) {
      const c = clients.pop();
      c.removeAllListeners();
      c.disconnect();
    }
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    cleanup();
  });

  it('rejects a socket connection with no / bad token', async () => {
    await expect(new Promise((resolve, reject) => {
      const s = connect(null);
      s.on('connect', () => reject(new Error('should not connect')));
      s.on('connect_error', (err) => resolve(err.message));
    })).resolves.toMatch(/unauthorized/i);
  });

  it('delivers a message to the recipient live and acks the sender', async () => {
    const a = connect(userA.token);
    const b = connect(userB.token);
    await Promise.all([
      new Promise((r) => a.on('connect', r)),
      new Promise((r) => b.on('connect', r))
    ]);

    const received = new Promise((resolve) => b.on('new_message', resolve));
    const acked = new Promise((resolve) => {
      a.emit('send_message', { toUserId: userB.user.id, type: 'text', text: 'live hello' }, resolve);
    });

    const ack = await acked;
    expect(ack.ok).toBe(true);
    expect(ack.message.text).toBe('live hello');

    const msg = await received;
    expect(msg.text).toBe('live hello');
    expect(msg.senderId).toBe(userA.user.id);
    expect(msg.conversationId).toBe(ack.message.conversationId);
  });

  it('does not deliver to a third user who is not a participant', async () => {
    const userC = await registerUser(app);
    const a = connect(userA.token);
    const c = connect(userC.token);
    await Promise.all([
      new Promise((r) => a.on('connect', r)),
      new Promise((r) => c.on('connect', r))
    ]);

    let leaked = false;
    c.on('new_message', () => { leaked = true; });

    await new Promise((resolve) => {
      a.emit('send_message', { toUserId: userB.user.id, type: 'text', text: 'not for C' }, resolve);
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(leaked).toBe(false);
  });

  it('rejects send_message between users who are not mutual follows', async () => {
    const stranger = await registerUser(app);
    await follow(app, userA, stranger.user.id); // one-way only

    const a = connect(userA.token);
    await new Promise((r) => a.on('connect', r));

    const ack = await new Promise((resolve) => {
      a.emit('send_message', { toUserId: stranger.user.id, type: 'text', text: 'hi' }, resolve);
    });
    expect(ack.ok).toBe(false);
    expect(ack.error).toMatch(/both follow/i);
  });
});
