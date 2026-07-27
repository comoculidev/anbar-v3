
BEGIN;

UPDATE settings SET key = 'admin_full_inventory_visible'
WHERE key = 'admin_inventory_search_enabled';

-- Əgər settings cədvəli heç olmayıbsa və ya açar hələ yoxdursa, indi yaradılır
INSERT INTO settings (key, value) VALUES
    ('wishlist_enabled', true),
    ('admin_full_inventory_visible', false)
ON CONFLICT (key) DO NOTHING;

COMMIT;
