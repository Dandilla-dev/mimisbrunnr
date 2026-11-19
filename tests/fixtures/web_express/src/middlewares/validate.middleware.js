export function checkBook(req, res, next) {
  const { isbn, title } = req.body;
  if (!isbn || !title) return res.status(400).json({ error: 'isbn and title are required' });
  return next();
}
