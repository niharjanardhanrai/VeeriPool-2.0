const express = require('express');
const { protect } = require('../middleware/auth');
const { getDirections } = require('../utils/directions');

const router = express.Router();

const MAX_POINTS = 25;

// GET /api/directions?points=lat,lng|lat,lng|...  (travel order)
router.get('/', protect, async (req, res, next) => {
  try {
    const points = String(req.query.points || '')
      .split('|')
      .filter(Boolean)
      .map((pair) => {
        const [lat, lng] = pair.split(',').map(Number);
        return { lat, lng };
      });
    const valid = points.every(
      (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180
    );
    if (points.length < 2 || points.length > MAX_POINTS || !valid) {
      return res.status(400).json({ message: `Send 2 to ${MAX_POINTS} points as lat,lng separated by |` });
    }
    res.json(await getDirections(points));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
