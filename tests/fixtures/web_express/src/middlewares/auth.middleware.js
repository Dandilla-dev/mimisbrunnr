export function requireToken(req, res, next) {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: 'no token' });
  req.user = { token };
  return next();
}
