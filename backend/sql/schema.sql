

DROP TABLE IF EXISTS wishlist CASCADE;
DROP TABLE IF EXISTS requests CASCADE;
DROP TABLE IF EXISTS inventory CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS settings CASCADE;


CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(50)  NOT NULL UNIQUE,
    password_hash TEXT         NOT NULL,
    full_name     VARCHAR(150) NOT NULL,
    role          VARCHAR(12)  NOT NULL CHECK (role IN ('admin', 'user', 'superadmin')),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);


CREATE TABLE inventory (
    id               SERIAL PRIMARY KEY,
    name             VARCHAR(200) NOT NULL,
    inventory_number VARCHAR(100) NOT NULL UNIQUE,
    quantity         INTEGER      NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    unit             VARCHAR(20)  NOT NULL DEFAULT 'ədəd',
    unit_value       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_value >= 0),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_inventory_name ON inventory USING gin (to_tsvector('simple', name));
CREATE INDEX idx_inventory_number ON inventory (inventory_number);

CREATE TABLE requests (
    id             SERIAL PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    inventory_id   INTEGER NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
    requested_qty  INTEGER NOT NULL CHECK (requested_qty > 0),
    approved_qty   INTEGER,
    proposed_by    VARCHAR(10) CHECK (proposed_by IS NULL OR proposed_by IN ('admin', 'superadmin')),
    purpose        TEXT,
    status         VARCHAR(20) NOT NULL DEFAULT 'pending'
                   CHECK (status IN (
                       'pending',
                       'pending_agreement',
                       'pending_superadmin',
                       'pending_delivery',
                       'completed',
                       'rejected'
                   )),
    delivered_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_requests_user ON requests (user_id);
CREATE INDEX idx_requests_status ON requests (status);


CREATE TABLE wishlist (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_name   VARCHAR(200) NOT NULL,
    needed_qty  INTEGER NOT NULL CHECK (needed_qty > 0),
    description TEXT,
    status      VARCHAR(10) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wishlist_user ON wishlist (user_id);
CREATE INDEX idx_wishlist_status ON wishlist (status);


CREATE TABLE settings (
    key        VARCHAR(50) PRIMARY KEY,
    value      BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO settings (key, value) VALUES
    ('wishlist_enabled', true),
    ('admin_full_inventory_visible', false);

DROP TABLE IF EXISTS settings CASCADE;
CREATE TABLE settings (
    key   VARCHAR(50) PRIMARY KEY,
    value BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO settings (key, value) VALUES
    ('wishlist_enabled', true),
    ('admin_inventory_visible', true);

