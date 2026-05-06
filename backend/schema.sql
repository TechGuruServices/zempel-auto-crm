-- =============================================================
-- PartsCommand CRM — Neon Serverless PostgreSQL Schema
-- =============================================================
-- Run this once against your Neon database to bootstrap tables.
-- The Worker also auto-creates these via ensureSchema() on first request.
--
-- Connection: neon.tech → New Project → Connection Details
-- Run via: psql <connection-string> -f schema.sql
-- =============================================================

-- Inventory
CREATE TABLE IF NOT EXISTS inventory (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventory_part_number ON inventory ((data->>'partNumber'));
CREATE INDEX IF NOT EXISTS idx_inventory_barcode     ON inventory ((data->>'barcode'));
CREATE INDEX IF NOT EXISTS idx_inventory_category    ON inventory ((data->>'category'));

-- Customers
CREATE TABLE IF NOT EXISTS customers (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customers_name  ON customers ((data->>'name'));
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers ((data->>'phone'));

-- Vehicles
CREATE TABLE IF NOT EXISTS vehicles (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vehicles_vin         ON vehicles ((data->>'vin'));
CREATE INDEX IF NOT EXISTS idx_vehicles_customer_id ON vehicles ((data->>'customerId'));

-- Sales
CREATE TABLE IF NOT EXISTS sales (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_customer_id ON sales ((data->>'customerId'));
CREATE INDEX IF NOT EXISTS idx_sales_status      ON sales ((data->>'status'));
CREATE INDEX IF NOT EXISTS idx_sales_date        ON sales ((data->>'date'));

-- Retailer Prices (cache)
CREATE TABLE IF NOT EXISTS retailer_prices (
  part_number TEXT PRIMARY KEY,
  data        JSONB NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action       ON audit_logs ((data->>'action'));
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp    ON audit_logs ((data->>'timestamp'));
CREATE INDEX IF NOT EXISTS idx_audit_logs_ip           ON audit_logs ((data->>'ip'));
CREATE INDEX IF NOT EXISTS idx_audit_logs_payload_hash ON audit_logs ((data->>'payload_hash'));

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER trg_inventory_updated_at
    BEFORE UPDATE ON inventory
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_customers_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_vehicles_updated_at
    BEFORE UPDATE ON vehicles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_sales_updated_at
    BEFORE UPDATE ON sales
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Settings
CREATE TABLE IF NOT EXISTS settings (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  CREATE TRIGGER trg_settings_updated_at
    BEFORE UPDATE ON settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
