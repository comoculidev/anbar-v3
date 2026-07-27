

BEGIN;

ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_proposed_by_check;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS proposed_by VARCHAR(10);
ALTER TABLE requests ADD CONSTRAINT requests_proposed_by_check
    CHECK (proposed_by IS NULL OR proposed_by IN ('admin', 'superadmin'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requests' AND column_name = 'confirmed_at')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requests' AND column_name = 'delivered_at') THEN
    ALTER TABLE requests RENAME COLUMN confirmed_at TO delivered_at;
  END IF;
END $$;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_status_check;
UPDATE requests SET status = 'pending_delivery' WHERE status = 'pending_confirmation';
ALTER TABLE requests ADD CONSTRAINT requests_status_check CHECK (status IN (
    'pending', 'pending_agreement', 'pending_superadmin', 'pending_delivery', 'completed', 'rejected'
));

COMMIT;
