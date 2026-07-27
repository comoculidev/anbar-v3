require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./db');

async function createIfMissing({ username, password, fullName, role }) {
  if (!username || !password) return;

  const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (existing.rows.length > 0) {
    console.log(`"${username}" (${role}) adlı istifadəçi artıq mövcuddur, ötürüldü.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO users (username, password_hash, full_name, role) VALUES ($1, $2, $3, $4)`,
    [username, passwordHash, fullName, role]
  );

  console.log(`✅ ${role} istifadəçi yaradıldı: ${username} / ${password}`);
}

async function seed() {
  try {
    await createIfMissing({
      username: process.env.SEED_ADMIN_USERNAME || 'admin',
      password: process.env.SEED_ADMIN_PASSWORD || 'Admin123!',
      fullName: process.env.SEED_ADMIN_FULLNAME || 'Sistem Admini',
      role: 'admin',
    });

    if (process.env.SEED_SUPERADMIN_USERNAME) {
      await createIfMissing({
        username: process.env.SEED_SUPERADMIN_USERNAME,
        password: process.env.SEED_SUPERADMIN_PASSWORD || 'SuperAdmin123!',
        fullName: process.env.SEED_SUPERADMIN_FULLNAME || 'Super Admin',
        role: 'superadmin',
      });
    }

    console.log('Bu şifrələri ilk girişdən sonra dəyişməyi tövsiyə edirik.');
    process.exit(0);
  } catch (err) {
    console.error('Seed xətası:', err);
    process.exit(1);
  }
}

seed();
