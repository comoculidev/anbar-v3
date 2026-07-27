const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
  const tokenFromCookie = req.cookies?.token;
  const authHeader = req.headers.authorization;
  const tokenFromHeader = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  const token = tokenFromCookie || tokenFromHeader;

  if (!token) {
    return res.status(401).json({ error: 'Giriş tələb olunur.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sessiya etibarsızdır, yenidən daxil olun.' });
  }
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ error: 'Bu əməliyyat üçün kifayət qədər icazəniz yoxdur.' });
    }
    next();
  };
}

const requireAdmin = requireRoles('admin');

module.exports = { authenticate, requireRoles, requireAdmin };
