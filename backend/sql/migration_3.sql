
BEGIN;

CREATE TABLE IF NOT EXISTS settings (
    key        VARCHAR(50) PRIMARY KEY,
    value      BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO settings (key, value) VALUES
    ('wishlist_enabled', true),
    ('admin_full_inventory_visible', false)
ON CONFLICT (key) DO NOTHING;

COMMIT;
