const express = require('express');
const pool = require('../config/db');
const { authenticate, requireRoles } = require('../middleware/auth');

const router = express.Router();

const ALLOWED_KEYS = ['wishlist_enabled', 'admin_full_inventory_visible'];

async function getSettings() {
  const result = await pool.query('SELECT key, value FROM settings');
  const map = {};
  for (const row of result.rows) map[row.key] = row.value;
  for (const key of ALLOWED_KEYS) {
    if (!(key in map)) map[key] = true;
  }
  return map;
}

router.get('/', authenticate, async (req, res) => {
  try {
    const settings = await getSettings();
    res.json(settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Parametrlər yüklənərkən xəta baş verdi.' });
  }
});

router.patch('/', authenticate, requireRoles('superadmin'), async (req, res) => {
  const updates = Object.entries(req.body).filter(([key]) => ALLOWED_KEYS.includes(key));

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Heç bir dəyişdirilə bilən parametr göndərilmədi.' });
  }

  try {
    for (const [key, value] of updates) {
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
        [key, Boolean(value)]
      );
    }
    const settings = await getSettings();
    req.app.get('io').emit('settings:updated', settings);
    res.json(settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Parametrlər yenilənərkən xəta baş verdi.' });
  }
});

module.exports = { router, getSettings };
