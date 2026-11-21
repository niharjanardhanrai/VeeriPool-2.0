function notFound(req, res, next) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
}

function errorHandler(err, req, res, next) {
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors)
      .map((e) => e.message)
      .join(', ');
    return res.status(400).json({ message });
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(409).json({ message: `${field} is already registered` });
  }

  console.error(err);
  const status = res.statusCode !== 200 ? res.statusCode : 500;
  res.status(status).json({ message: err.message || 'Server error' });
}

module.exports = { notFound, errorHandler };
