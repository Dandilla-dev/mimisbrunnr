export function checkBook(req, res, next) {
  const { isbn, title } = req.body;
  if (!isbn || !title) return res.status(400).json({ error: 'isbn and title are required' });
  return next();
}

export function checkIsbn(req, res, next) {
  if (!/^[0-9-]{10,17}$/.test(req.params.isbn)) return res.status(400).json({ error: 'bad isbn' });
  return next();
}
