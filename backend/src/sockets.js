const jwt = require('jsonwebtoken');
const cookie = require('cookie');

function setupSocket(io) {
  io.use((socket, next) => {
    try {
      const rawCookie = socket.handshake.headers.cookie;
      if (!rawCookie) return next(new Error('Giriş tələb olunur'));

      const parsed = cookie.parse(rawCookie);
      const token = parsed.token;
      if (!token) return next(new Error('Giriş tələb olunur'));

      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = payload;
      next();
    } catch (err) {
      next(new Error('Sessiya etibarsızdır'));
    }
  });

  io.on('connection', (socket) => {
    const { id, role } = socket.user;

    if (role === 'admin') {
      socket.join('admins');
    }
    if (role === 'superadmin') {
      socket.join('superadmins');
    }
    socket.join(`user:${id}`);

    socket.on('disconnect', () => {
    });
  });
}

module.exports = setupSocket;
