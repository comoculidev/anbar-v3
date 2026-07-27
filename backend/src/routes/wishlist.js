const express = require('express');
const XLSX = require('xlsx');
const pool = require('../config/db');
const { authenticate, requireRoles } = require('../middleware/auth');
const { getSettings } = require('./settings');

const router = express.Router();

const WISHLIST_STATUS_LABELS = { pending: 'Gözləmədə', approved: 'Qəbul edilib', rejected: 'Rədd edilib' };

router.get('/', authenticate, async (req, res) => {
  const { status } = req.query;
  const conditions = [];
  const params = [];

  if (req.user.role === 'user') {
    params.push(req.user.id);
    conditions.push(`w.user_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`w.status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await pool.query(
      `SELECT w.*, u.full_name AS user_full_name, u.username
       FROM wishlist w
       JOIN users u ON u.id = w.user_id
       ${where}
       ORDER BY w.created_at DESC`,
      params
    );
    res.json({ wishlist: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Siyahı yüklənərkən xəta baş verdi.' });
  }
});

router.get('/export', authenticate, requireRoles('admin', 'superadmin'), async (req, res) => {
  const { from, to } = req.query; // 'YYYY-MM-DD' formatında (könüllü)
  const conditions = [];
  const params = [];

  if (from) {
    params.push(from);
    conditions.push(`w.created_at >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    conditions.push(`w.created_at < ($${params.length}::date + interval '1 day')`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await pool.query(
      `SELECT w.*, u.full_name AS user_full_name, u.username
       FROM wishlist w JOIN users u ON u.id = w.user_id
       ${where}
       ORDER BY w.created_at DESC`,
      params
    );

    const data = result.rows.map((w) => ({
      'İstəyən': w.user_full_name,
      'İstifadəçi adı': w.username,
      'Mal adı': w.item_name,
      'Lazım olan say': w.needed_qty,
      'Qeyd': w.description || '',
      'Status': WISHLIST_STATUS_LABELS[w.status] || w.status,
      'Göndərilmə tarixi': w.created_at ? new Date(w.created_at).toLocaleString('az-AZ') : '',
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    worksheet['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 28 }, { wch: 14 }, { wch: 30 }, { wch: 14 }, { wch: 18 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Arzu olunan mallar');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="arzu-olunan-mallar.xlsx"');
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fayl hazırlanarkən xəta baş verdi.' });
  }
});

router.post('/', authenticate, async (req, res) => {
  const { item_name, needed_qty, description } = req.body;

  if (!item_name || !needed_qty || Number(needed_qty) <= 0) {
    return res.status(400).json({ error: 'Mal adı və düzgün miqdar tələb olunur.' });
  }

  try {
    const settings = await getSettings();
    if (!settings.wishlist_enabled) {
      return res.status(403).json({ error: 'Arzu olunan mallar funksiyası hazırda deaktiv edilib.' });
    }

    const result = await pool.query(
      `INSERT INTO wishlist (user_id, item_name, needed_qty, description, status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING *`,
      [req.user.id, item_name, needed_qty, description || null]
    );

    const full = await pool.query(
      `SELECT w.*, u.full_name AS user_full_name, u.username
       FROM wishlist w JOIN users u ON u.id = w.user_id WHERE w.id = $1`,
      [result.rows[0].id]
    );

    const io = req.app.get('io');
    io.to('admins').emit('wishlist:new', full.rows[0]);
    io.to('superadmins').emit('wishlist:new', full.rows[0]);

    res.status(201).json({ item: full.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Tələb göndərilərkən xəta baş verdi.' });
  }
});

router.patch('/:id', authenticate, requireRoles('admin', 'superadmin'), async (req, res) => {
  const { id } = req.params;
  const { action } = req.body;

  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Əməliyyat "approve" və ya "reject" olmalıdır.' });
  }

  try {
    const result = await pool.query(
      `UPDATE wishlist SET status = $1, updated_at = now()
       WHERE id = $2 AND status = 'pending' RETURNING *`,
      [action === 'approve' ? 'approved' : 'rejected', id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tələb tapılmadı və ya artıq cavablandırılıb.' });
    }

    const full = await pool.query(
      `SELECT w.*, u.full_name AS user_full_name, u.username
       FROM wishlist w JOIN users u ON u.id = w.user_id WHERE w.id = $1`,
      [result.rows[0].id]
    );

    const io = req.app.get('io');
    io.to('admins').emit('wishlist:updated', full.rows[0]);
    io.to('superadmins').emit('wishlist:updated', full.rows[0]);
    io.to(`user:${full.rows[0].user_id}`).emit('wishlist:updated', full.rows[0]);

    res.json({ item: full.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Tələb yenilənərkən xəta baş verdi.' });
  }
});

module.exports = router;
