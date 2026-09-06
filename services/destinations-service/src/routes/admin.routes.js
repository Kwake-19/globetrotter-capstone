const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, writeDB } = require('../utils/dataStore');
const { identity, requireAdmin } = require('../middleware/identity');

const router = express.Router();

// The monolith did requireAuth + a users-table isAdmin lookup here; in
// Phase 2 the gateway has already verified the token and, for an admin,
// forwarded X-Is-Admin: true.
router.use(identity, requireAdmin);

const STRING_FIELDS = ['name', 'category', 'neighborhood', 'description', 'address', 'phone', 'website', 'openingHours', 'image', 'placeId'];
const ARRAY_FIELDS = ['tags', 'amenities'];
const NULLABLE_NUMBER_FIELDS = ['rating', 'priceLevel', 'googleRating'];

function toStringArray(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim()) : [];
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

// GET /api/admin/destinations - unfiltered, every field, admin only.
router.get('/destinations', async (req, res, next) => {
  try {
    const db = await readDB();
    return res.json({ count: db.destinations.length, results: db.destinations });
  } catch (err) {
    return next(err);
  }
});

// POST /api/admin/destinations
router.post('/destinations', async (req, res, next) => {
  try {
    const body = req.body || {};
    const { name, category, neighborhood, latitude, longitude } = body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!category || !String(category).trim()) {
      return res.status(400).json({ error: 'category is required' });
    }
    if (!neighborhood || !String(neighborhood).trim()) {
      return res.status(400).json({ error: 'neighborhood is required' });
    }
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (latitude === undefined || longitude === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'latitude and longitude are required and must be numeric' });
    }

    const db = await readDB();
    const photos = toStringArray(body.photos);

    const destination = {
      id: uuidv4(),
      name: String(name).trim(),
      category: String(category).trim(),
      neighborhood: String(neighborhood).trim(),
      description: body.description ? String(body.description).trim() : '',
      address: body.address ? String(body.address).trim() : '',
      latitude: lat,
      longitude: lng,
      rating: toNullableNumber(body.rating),
      priceLevel: toNullableNumber(body.priceLevel),
      tags: toStringArray(body.tags),
      image: body.image ? String(body.image).trim() : null,
      placeId: body.placeId ? String(body.placeId).trim() : null,
      googleRating: toNullableNumber(body.googleRating),
      phone: body.phone ? String(body.phone).trim() : null,
      website: body.website ? String(body.website).trim() : null,
      openingHours: body.openingHours ? String(body.openingHours).trim() : null,
      amenities: toStringArray(body.amenities),
      photos,
      // Read-only convenience field for frontend code that still reads a
      // single localImagePath - always derived from photos[0].
      localImagePath: photos[0] || null
    };

    db.destinations.push(destination);
    await writeDB(db);

    return res.status(201).json(destination);
  } catch (err) {
    return next(err);
  }
});

// PUT /api/admin/destinations/:id - partial update, any field except id.
router.put('/destinations/:id', async (req, res, next) => {
  try {
    const db = await readDB();
    const destination = db.destinations.find((d) => d.id === req.params.id);
    if (!destination) {
      return res.status(404).json({ error: 'Destination not found' });
    }

    const body = req.body || {};

    if (body.name !== undefined && !String(body.name).trim()) {
      return res.status(400).json({ error: 'name cannot be empty' });
    }
    if (body.category !== undefined && !String(body.category).trim()) {
      return res.status(400).json({ error: 'category cannot be empty' });
    }
    if (body.neighborhood !== undefined && !String(body.neighborhood).trim()) {
      return res.status(400).json({ error: 'neighborhood cannot be empty' });
    }
    if (body.latitude !== undefined && !Number.isFinite(Number(body.latitude))) {
      return res.status(400).json({ error: 'latitude must be numeric' });
    }
    if (body.longitude !== undefined && !Number.isFinite(Number(body.longitude))) {
      return res.status(400).json({ error: 'longitude must be numeric' });
    }

    STRING_FIELDS.forEach((field) => {
      if (body[field] === undefined) return;
      destination[field] = body[field] === null ? null : String(body[field]).trim();
    });

    if (body.latitude !== undefined) destination.latitude = Number(body.latitude);
    if (body.longitude !== undefined) destination.longitude = Number(body.longitude);

    NULLABLE_NUMBER_FIELDS.forEach((field) => {
      if (body[field] !== undefined) destination[field] = toNullableNumber(body[field]);
    });

    ARRAY_FIELDS.forEach((field) => {
      if (body[field] !== undefined) destination[field] = toStringArray(body[field]);
    });

    if (body.photos !== undefined) {
      destination.photos = toStringArray(body.photos);
      destination.localImagePath = destination.photos[0] || null;
    }

    await writeDB(db);
    return res.json(destination);
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/admin/destinations/:id
router.delete('/destinations/:id', async (req, res, next) => {
  try {
    const db = await readDB();
    const index = db.destinations.findIndex((d) => d.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Destination not found' });
    }

    db.destinations.splice(index, 1);
    await writeDB(db);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
