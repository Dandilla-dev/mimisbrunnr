const errorHandler = (err, req, res, next) => {
  if (err.message.includes('not found')) return res.status(404).json({ message: err.message });
  if (err.message.includes('already exists')) return res.status(409).json({ message: err.message });
  return res.status(500).json({ message: err.message });
};

export default errorHandler;
