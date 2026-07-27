

BEGIN;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(12);
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'user', 'superadmin'));

ALTER TABLE inventory ADD COLUMN IF NOT EXISTS unit VARCHAR(20) NOT NULL DEFAULT 'ədəd';
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS unit_value NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_value >= 0);

ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_status_check;
ALTER TABLE requests ALTER COLUMN status TYPE VARCHAR(20);

UPDATE requests SET status = 'pending_confirmation' WHERE status = 'approved';
ALTER TABLE requests ADD CONSTRAINT requests_status_check CHECK (status IN (
    'pending', 'pending_superadmin', 'pending_confirmation', 'completed', 'rejected'
));
ALTER TABLE requests ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

COMMIT;

