const express = require('express');
const XLSX = require('xlsx');
const pool = require('../config/db');
const { authenticate, requireRoles } = require('../middleware/auth');

const router = express.Router();

function fetchFullRequest(whereClause, params) {
  return pool.query(
    `SELECT r.*, i.name AS item_name, i.inventory_number, i.unit, i.unit_value,
            i.quantity AS stock_qty, u.full_name AS user_full_name, u.username
     FROM requests r
     JOIN inventory i ON i.id = r.inventory_id
     JOIN users u ON u.id = r.user_id
     ${whereClause}
     ORDER BY r.created_at DESC`,
    params
  );
}

function broadcastUpdate(req, requestObj) {
  const io = req.app.get('io');
  io.to('admins').emit('request:updated', requestObj);
  io.to('superadmins').emit('request:updated', requestObj);
  io.to(`user:${requestObj.user_id}`).emit('request:updated', requestObj);
}


router.get('/', authenticate, async (req, res) => {
  const { status } = req.query;
  const conditions = [];
  const params = [];

  if (req.user.role === 'user') {
    params.push(req.user.id);
    conditions.push(`r.user_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`r.status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await fetchFullRequest(where, params);
    res.json({ requests: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'İstəklər yüklənərkən xəta baş verdi.' });
  }
});


router.get('/export', authenticate, requireRoles('admin', 'superadmin'), async (req, res) => {
  const STATUS_LABELS_AZ = {
    pending: 'Anbardar baxışı gözlənilir',
    pending_agreement: 'İstifadəçi razılığı gözlənilir',
    pending_superadmin: 'Superadmin təsdiqi gözlənilir',
    pending_delivery: 'Təhvilə hazırdır',
    completed: 'Təhvil verildi',
    rejected: 'Rədd edildi',
  };

  const { from, to } = req.query;
  const conditions = [];
  const params = [];

  if (from) {
    params.push(from);
    conditions.push(`r.created_at >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    conditions.push(`r.created_at < ($${params.length}::date + interval '1 day')`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await fetchFullRequest(where, params);
    const data = result.rows.map((r) => ({
      'İstəyən': r.user_full_name,
      'İstifadəçi adı': r.username,
      'Mal': r.item_name,
      'İnventar Nömrəsi': r.inventory_number,
      'İstənilən say': r.requested_qty,
      'Təklif/verilən say': r.approved_qty ?? '',
      'Ölçü vahidi': r.unit,
      'Dəyər (AZN)': Number(r.unit_value),
      'Təyinat': r.purpose || '',
      'Status': STATUS_LABELS_AZ[r.status] || r.status,
      'Göndərilmə tarixi': r.created_at ? new Date(r.created_at).toLocaleString('az-AZ') : '',
      'Təhvil tarixi': r.delivered_at ? new Date(r.delivered_at).toLocaleString('az-AZ') : '',
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    worksheet['!cols'] = [
      { wch: 22 }, { wch: 16 }, { wch: 26 }, { wch: 16 }, { wch: 12 },
      { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 26 }, { wch: 24 },
      { wch: 18 }, { wch: 18 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'İstəklər');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="isteklar.xlsx"');
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fayl hazırlanarkən xəta baş verdi.' });
  }
});


router.post('/bulk', authenticate, async (req, res) => {
  const { purpose, items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Ən azı bir mal seçilməlidir.' });
  }

  try {
    const createdIds = [];
    const skipped = [];

    for (const it of items) {
      const inventoryId = it?.inventory_id;
      const qty = Number(it?.requested_qty);

      if (!inventoryId || !qty || qty <= 0) {
        skipped.push(it?.inventory_id || '?');
        continue;
      }

      const itemCheck = await pool.query('SELECT id FROM inventory WHERE id = $1', [inventoryId]);
      if (itemCheck.rows.length === 0) {
        skipped.push(inventoryId);
        continue;
      }

      const inserted = await pool.query(
        `INSERT INTO requests (user_id, inventory_id, requested_qty, purpose, status)
         VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
        [req.user.id, inventoryId, qty, purpose || null]
      );
      createdIds.push(inserted.rows[0].id);
    }

    if (createdIds.length === 0) {
      return res.status(400).json({ error: 'Heç bir düzgün mal seçilmədi.' });
    }

    const full = await fetchFullRequest('WHERE r.id = ANY($1)', [createdIds]);
    const io = req.app.get('io');
    full.rows.forEach((r) => io.to('admins').emit('request:new', r));

    res.status(201).json({ requests: full.rows, skipped });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'İstəklər göndərilərkən xəta baş verdi.' });
  }
});


router.post('/', authenticate, async (req, res) => {
  const { inventory_id, requested_qty, purpose } = req.body;

  if (!inventory_id || !requested_qty || Number(requested_qty) <= 0) {
    return res.status(400).json({ error: 'Mal və düzgün miqdar tələb olunur.' });
  }

  try {
    const itemCheck = await pool.query('SELECT id, name FROM inventory WHERE id = $1', [inventory_id]);
    if (itemCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Mal tapılmadı.' });
    }

    const result = await pool.query(
      `INSERT INTO requests (user_id, inventory_id, requested_qty, purpose, status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING *`,
      [req.user.id, inventory_id, requested_qty, purpose || null]
    );

    const full = await fetchFullRequest('WHERE r.id = $1', [result.rows[0].id]);
    req.app.get('io').to('admins').emit('request:new', full.rows[0]);

    res.status(201).json({ request: full.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'İstək göndərilərkən xəta baş verdi.' });
  }
});


router.patch('/:id', authenticate, requireRoles('admin', 'superadmin'), async (req, res) => {
  const { id } = req.params;
  const { action, proposed_qty } = req.body;

  if (!['propose', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Əməliyyat "propose" və ya "reject" olmalıdır.' });
  }

  try {
    const reqRes = await pool.query(
      `SELECT r.*, i.quantity AS stock_qty, i.unit, i.name AS item_name
       FROM requests r JOIN inventory i ON i.id = r.inventory_id
       WHERE r.id = $1`,
      [id]
    );
    if (reqRes.rows.length === 0) {
      return res.status(404).json({ error: 'İstək tapılmadı.' });
    }
    const request = reqRes.rows[0];
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Bu istək artıq baxılıb.' });
    }

    if (action === 'reject') {
      const updated = await pool.query(
        `UPDATE requests SET status = 'rejected', updated_at = now() WHERE id = $1 RETURNING id`,
        [id]
      );
      const full = await fetchFullRequest('WHERE r.id = $1', [updated.rows[0].id]);
      broadcastUpdate(req, full.rows[0]);
      return res.json({ request: full.rows[0] });
    }

    // propose
    const finalQty = proposed_qty !== undefined && proposed_qty !== null
      ? Number(proposed_qty)
      : request.requested_qty;

    if (finalQty <= 0) {
      return res.status(400).json({ error: 'Miqdar 0-dan böyük olmalıdır.' });
    }
    if (finalQty > request.stock_qty) {
      return res.status(400).json({
        error: `Anbarda yalnız ${request.stock_qty} ${request.unit || ''} "${request.item_name}" var.`,
      });
    }

    const updated = await pool.query(
      `UPDATE requests SET status = 'pending_agreement', approved_qty = $1, proposed_by = $2, updated_at = now()
       WHERE id = $3 RETURNING id`,
      [finalQty, req.user.role, id]
    );

    const full = await fetchFullRequest('WHERE r.id = $1', [updated.rows[0].id]);
    broadcastUpdate(req, full.rows[0]);
    res.json({ request: full.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'İstək yenilənərkən xəta baş verdi.' });
  }
});


router.post('/:id/agree', authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    const reqRes = await pool.query('SELECT * FROM requests WHERE id = $1', [id]);
    if (reqRes.rows.length === 0) {
      return res.status(404).json({ error: 'İstək tapılmadı.' });
    }
    const request = reqRes.rows[0];
    if (request.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Bu istək sizə aid deyil.' });
    }
    if (request.status !== 'pending_agreement') {
      return res.status(400).json({ error: 'Bu istək razılıq gözləmir.' });
    }

    const nextStatus = request.proposed_by === 'superadmin' ? 'pending_delivery' : 'pending_superadmin';

    const updated = await pool.query(
      `UPDATE requests SET status = $1, updated_at = now() WHERE id = $2 RETURNING id`,
      [nextStatus, id]
    );
    const full = await fetchFullRequest('WHERE r.id = $1', [updated.rows[0].id]);
    broadcastUpdate(req, full.rows[0]);
    if (nextStatus === 'pending_superadmin') {
      req.app.get('io').to('superadmins').emit('request:new', full.rows[0]);
    }
    res.json({ request: full.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Xəta baş verdi.' });
  }
});


router.post('/:id/disagree', authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE requests SET status = 'rejected', updated_at = now()
       WHERE id = $1 AND user_id = $2 AND status = 'pending_agreement' RETURNING id`,
      [id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'İstək tapılmadı və ya artıq baxılıb.' });
    }
    const full = await fetchFullRequest('WHERE r.id = $1', [result.rows[0].id]);
    broadcastUpdate(req, full.rows[0]);
    res.json({ request: full.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Xəta baş verdi.' });
  }
});

router.patch('/:id/superadmin', authenticate, requireRoles('superadmin'), async (req, res) => {
  const { id } = req.params;
  const { action, proposed_qty } = req.body;

  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Əməliyyat "approve" və ya "reject" olmalıdır.' });
  }

  try {
    const reqRes = await pool.query(
      `SELECT r.*, i.quantity AS stock_qty, i.unit, i.name AS item_name
       FROM requests r JOIN inventory i ON i.id = r.inventory_id
       WHERE r.id = $1`,
      [id]
    );
    if (reqRes.rows.length === 0) {
      return res.status(404).json({ error: 'İstək tapılmadı.' });
    }
    const request = reqRes.rows[0];
    if (request.status !== 'pending_superadmin') {
      return res.status(400).json({ error: 'Bu istək hazırda superadmin təsdiqi gözləmir.' });
    }

    if (action === 'reject') {
      const updated = await pool.query(
        `UPDATE requests SET status = 'rejected', updated_at = now() WHERE id = $1 RETURNING id`,
        [id]
      );
      const full = await fetchFullRequest('WHERE r.id = $1', [updated.rows[0].id]);
      broadcastUpdate(req, full.rows[0]);
      return res.json({ request: full.rows[0] });
    }

    const finalQty = proposed_qty !== undefined && proposed_qty !== null
      ? Number(proposed_qty)
      : request.approved_qty;

    if (finalQty <= 0) {
      return res.status(400).json({ error: 'Miqdar 0-dan böyük olmalıdır.' });
    }
    if (finalQty > request.stock_qty) {
      return res.status(400).json({
        error: `Anbarda yalnız ${request.stock_qty} ${request.unit || ''} "${request.item_name}" var.`,
      });
    }

    if (finalQty === request.approved_qty) {
      const updated = await pool.query(
        `UPDATE requests SET status = 'pending_delivery', updated_at = now() WHERE id = $1 RETURNING id`,
        [id]
      );
      const full = await fetchFullRequest('WHERE r.id = $1', [updated.rows[0].id]);
      broadcastUpdate(req, full.rows[0]);
      return res.json({ request: full.rows[0] });
    }

    const updated = await pool.query(
      `UPDATE requests SET status = 'pending_agreement', approved_qty = $1, proposed_by = 'superadmin', updated_at = now()
       WHERE id = $2 RETURNING id`,
      [finalQty, id]
    );
    const full = await fetchFullRequest('WHERE r.id = $1', [updated.rows[0].id]);
    broadcastUpdate(req, full.rows[0]);
    res.json({ request: full.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'İstək yenilənərkən xəta baş verdi.' });
  }
});


router.post('/:id/deliver', authenticate, requireRoles('admin', 'superadmin'), async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const reqRes = await client.query(
      `SELECT r.*, i.quantity AS stock_qty, i.unit, i.name AS item_name
       FROM requests r JOIN inventory i ON i.id = r.inventory_id
       WHERE r.id = $1 FOR UPDATE OF i`,
      [id]
    );

    if (reqRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'İstək tapılmadı.' });
    }

    const request = reqRes.rows[0];

    if (request.status !== 'pending_delivery') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Bu istək təhvilə hazır deyil.' });
    }
    if (request.approved_qty > request.stock_qty) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Təəssüf ki, anbarda kifayət qədər "${request.item_name}" qalmayıb.`,
      });
    }

    await client.query(
      `UPDATE inventory SET quantity = quantity - $1, updated_at = now() WHERE id = $2`,
      [request.approved_qty, request.inventory_id]
    );
    const updated = await client.query(
      `UPDATE requests SET status = 'completed', delivered_at = now(), updated_at = now() WHERE id = $1 RETURNING id`,
      [id]
    );

    await client.query('COMMIT');

    const full = await fetchFullRequest('WHERE r.id = $1', [updated.rows[0].id]);
    broadcastUpdate(req, full.rows[0]);
    res.json({ request: full.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Təhvil qeyd edilərkən xəta baş verdi.' });
  } finally {
    client.release();
  }
});


router.post('/:id/deliver-decline', authenticate, requireRoles('admin', 'superadmin'), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE requests SET status = 'rejected', updated_at = now()
       WHERE id = $1 AND status = 'pending_delivery' RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'İstək tapılmadı və ya artıq baxılıb.' });
    }
    const full = await fetchFullRequest('WHERE r.id = $1', [result.rows[0].id]);
    broadcastUpdate(req, full.rows[0]);
    res.json({ request: full.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Xəta baş verdi.' });
  }
});

module.exports = router;
