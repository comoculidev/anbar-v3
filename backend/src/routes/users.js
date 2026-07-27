const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { authenticate, requireRoles } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate, requireRoles('admin', 'superadmin'));

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, full_name, role, created_at
       FROM users ORDER BY created_at DESC`
    );
    res.json({ users: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'İstifadəçilər yüklənərkən xəta baş verdi.' });
  }
});

router.post('/', async (req, res) => {
  const { username, password, full_name, role } = req.body;

  if (!username || !password || !full_name || !role) {
    return res.status(400).json({ error: 'Bütün sahələr doldurulmalıdır.' });
  }
  if (!['admin', 'user', 'superadmin'].includes(role)) {
    return res.status(400).json({ error: 'Rol "admin", "user" və ya "superadmin" olmalıdır.' });
  }
  if (role === 'superadmin' && req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Yalnız superadmin yeni superadmin yarada bilər.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Şifrə ən azı 6 simvol olmalıdır.' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Bu istifadəçi adı artıq mövcuddur.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, full_name, role, created_at`,
      [username, passwordHash, full_name, role]
    );

    res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'İstifadəçi yaradılarkən xəta baş verdi.' });
  }
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  if (Number(id) === req.user.id) {
    return res.status(400).json({ error: 'Özünüzü silə bilməzsiniz.' });
  }

  try {
    const target = await pool.query('SELECT role FROM users WHERE id = $1', [id]);
    if (target.rows.length === 0) {
      return res.status(404).json({ error: 'İstifadəçi tapılmadı.' });
    }
    if (['admin', 'superadmin'].includes(target.rows[0].role) && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Admin/superadmin hesablarını yalnız superadmin silə bilər.' });
    }

    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'İstifadəçi silinərkən xəta baş verdi.' });
  }
});

module.exports = router;
