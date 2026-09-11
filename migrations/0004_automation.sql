ALTER TABLE shops ADD COLUMN automation_enabled_at TEXT;
ALTER TABLE jobs ADD COLUMN automation_enabled_at TEXT;
ALTER TABLE jobs ADD COLUMN automatic_order_id TEXT;
CREATE UNIQUE INDEX jobs_automatic_order ON jobs(shop_id, automatic_order_id);
