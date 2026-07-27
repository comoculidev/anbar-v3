const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const pool = require('../config/db');
const { authenticate, requireRoles } = require('../middleware/auth');
const { getSettings } = require('./settings');

const router = express.Router();
const PAGE_SIZE = 50;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.get('/', authenticate, requireRoles('admin', 'superadmin'), async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      const settings = await getSettings();
      if (!settings.admin_full_inventory_visible) {
        return res.status(403).json({ error: 'Tam inventar siyahısına baxmaq icazəniz yoxdur. Baş admin bunu aça bilər.' });
      }
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const q = (req.query.q || '').trim();
    const offset = (page - 1) * PAGE_SIZE;

    let dataQuery, countQuery, params;

    if (q) {
      const like = `%${q}%`;
      dataQuery = `
        SELECT * FROM inventory
        WHERE name ILIKE $1 OR inventory_number ILIKE $1
        ORDER BY id DESC
        LIMIT $2 OFFSET $3`;
      countQuery = `
        SELECT COUNT(*) FROM inventory
        WHERE name ILIKE $1 OR inventory_number ILIKE $1`;
      params = [like, PAGE_SIZE, offset];
      const [dataRes, countRes] = await Promise.all([
        pool.query(dataQuery, params),
        pool.query(countQuery, [like]),
      ]);
      const total = parseInt(countRes.rows[0].count, 10);
      return res.json({
        items: dataRes.rows,
        total,
        page,
        pageSize: PAGE_SIZE,
        totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      });
    }

    dataQuery = `SELECT * FROM inventory ORDER BY id DESC LIMIT $1 OFFSET $2`;
    countQuery = `SELECT COUNT(*) FROM inventory`;
    const [dataRes, countRes] = await Promise.all([
      pool.query(dataQuery, [PAGE_SIZE, offset]),
      pool.query(countQuery),
    ]);
    const total = parseInt(countRes.rows[0].count, 10);
    res.json({
      items: dataRes.rows,
      total,
      page,
      pageSize: PAGE_SIZE,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'İnventar yüklənərkən xəta baş verdi.' });
  }
});


router.get('/export', authenticate, requireRoles('superadmin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT name, inventory_number, quantity, unit, unit_value FROM inventory ORDER BY name ASC`
    );
    const data = result.rows.map((r) => ({
      'Ad': r.name,
      'İnventar Nömrəsi': r.inventory_number,
      'Say': r.quantity,
      'Ölçü vahidi': r.unit,
      'Dəyər (AZN)': Number(r.unit_value),
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    worksheet['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 14 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'İnventar');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="inventar.xlsx"');
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fayl hazırlanarkən xəta baş verdi.' });
  }
});


router.post('/import', authenticate, requireRoles('admin', 'superadmin'), upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Excel faylı tələb olunur.' });
  }

  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Fayl boşdur və ya sətirlər oxunmadı.' });
    }

    let created = 0;
    let updated = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = String(row['Ad'] ?? row['ad'] ?? row['name'] ?? '').trim();
      const invNumber = String(row['İnventar Nömrəsi'] ?? row['inventory_number'] ?? '').trim();
      const qty = Number(row['Say'] ?? row['quantity'] ?? 0);
      const unit = String(row['Ölçü vahidi'] ?? row['unit'] ?? '').trim() || 'ədəd';
      const unitValueRaw = row['Dəyər (AZN)'] ?? row['unit_value'] ?? 0;
      const unitValue = Number(unitValueRaw) || 0;

      if (!name || !invNumber || !qty || qty <= 0) {
        errors.push(`Sətir ${i + 2}: "Ad", "İnventar Nömrəsi" və düzgün "Say" tələb olunur.`);
        continue;
      }

      try {
        const existing = await pool.query('SELECT id FROM inventory WHERE inventory_number = $1', [invNumber]);
        if (existing.rows.length > 0) {
          await pool.query(
            `UPDATE inventory SET quantity = quantity + $1, unit = $2, unit_value = $3, updated_at = now() WHERE id = $4`,
            [qty, unit, unitValue, existing.rows[0].id]
          );
          updated++;
        } else {
          await pool.query(
            `INSERT INTO inventory (name, inventory_number, quantity, unit, unit_value) VALUES ($1, $2, $3, $4, $5)`,
            [name, invNumber, qty, unit, unitValue]
          );
          created++;
        }
      } catch (rowErr) {
        errors.push(`Sətir ${i + 2}: yazılarkən xəta (${rowErr.message}).`);
      }
    }

    res.json({ created, updated, errors, total: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fayl oxunarkən xəta baş verdi. Excel strukturunun düzgünlüyünü yoxlayın.' });
  }
});


router.get('/search', authenticate, requireRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const result = q
      ? await pool.query(
          `SELECT id, name, inventory_number, unit FROM inventory WHERE name ILIKE $1 ORDER BY name ASC LIMIT 20`,
          [`%${q}%`]
        )
      : await pool.query(`SELECT id, name, inventory_number, unit FROM inventory ORDER BY name ASC LIMIT 20`);
    res.json({ items: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Mallar yüklənərkən xəta baş verdi.' });
  }
});

router.get('/names', authenticate, async (req, res) => {
  const q = (req.query.q || '').trim();
  try {
    const result = q
      ? await pool.query(
          `SELECT id, name, unit FROM inventory WHERE name ILIKE $1 ORDER BY name ASC LIMIT 100`,
          [`%${q}%`]
        )
      : await pool.query(`SELECT id, name, unit FROM inventory ORDER BY name ASC LIMIT 100`);
    res.json({ items: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Mallar yüklənərkən xəta baş verdi.' });
  }
});


router.post('/', authenticate, requireRoles('admin', 'superadmin'), async (req, res) => {
  const { inventory_id, name, inventory_number, quantity, unit, unit_value } = req.body;
  const qty = Number(quantity);

  if (!qty || qty <= 0) {
    return res.status(400).json({ error: 'Say 0-dan böyük olmalıdır.' });
  }

  try {
    let targetId = inventory_id || null;

    // Əgər açıq şəkildə mal seçilməyibsə, adı tam üst-üstə düşən mal varsa ona birləşdiririk
    if (!targetId && name) {
      const exact = await pool.query('SELECT id FROM inventory WHERE LOWER(name) = LOWER($1)', [name.trim()]);
      if (exact.rows.length > 0) targetId = exact.rows[0].id;
    }

    if (targetId) {
      const result = await pool.query(
        `UPDATE inventory SET quantity = quantity + $1, updated_at = now() WHERE id = $2 RETURNING *`,
        [qty, targetId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Mal tapılmadı.' });
      }
      return res.json({ item: result.rows[0], merged: true });
    }


    if (!name || !inventory_number) {
      return res.status(400).json({ error: 'Yeni mal üçün ad və inventar nömrəsi tələb olunur.' });
    }

    const dup = await pool.query('SELECT id FROM inventory WHERE inventory_number = $1', [inventory_number]);
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'Bu inventar nömrəsi artıq mövcuddur.' });
    }

    const result = await pool.query(
      `INSERT INTO inventory (name, inventory_number, quantity, unit, unit_value)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name.trim(), inventory_number.trim(), qty, (unit || 'ədəd').trim(), unit_value ? Number(unit_value) : 0]
    );
    res.status(201).json({ item: result.rows[0], merged: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Mal əlavə edilərkən xəta baş verdi.' });
  }
});

router.put('/:id', authenticate, requireRoles('superadmin'), async (req, res) => {
  const { id } = req.params;
  const { name, inventory_number, quantity, unit, unit_value } = req.body;

  if (!name || !inventory_number || quantity === undefined) {
    return res.status(400).json({ error: 'Ad, inventar nömrəsi və say tələb olunur.' });
  }
  if (Number(quantity) < 0) {
    return res.status(400).json({ error: 'Say mənfi ola bilməz.' });
  }

  try {
    const dupCheck = await pool.query(
      'SELECT id FROM inventory WHERE inventory_number = $1 AND id != $2',
      [inventory_number, id]
    );
    if (dupCheck.rows.length > 0) {
      return res.status(409).json({ error: 'Bu inventar nömrəsi başqa mala aiddir.' });
    }

    const result = await pool.query(
      `UPDATE inventory SET name = $1, inventory_number = $2, quantity = $3, unit = $4, unit_value = $5, updated_at = now()
       WHERE id = $6 RETURNING *`,
      [name, inventory_number, quantity, unit || 'ədəd', unit_value ? Number(unit_value) : 0, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Mal tapılmadı.' });
    }
    res.json({ item: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Mal redaktə edilərkən xəta baş verdi.' });
  }
});


router.delete('/:id', authenticate, requireRoles('superadmin'), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM inventory WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Mal tapılmadı.' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Mal silinərkən xəta baş verdi.' });
  }
});

module.exports = router;
