PRAGMA foreign_keys = ON;

CREATE TABLE shops (
  id TEXT PRIMARY KEY,
  shop_domain TEXT NOT NULL UNIQUE,
  access_token_ciphertext TEXT NOT NULL,
  access_token_iv TEXT NOT NULL,
  refresh_token_ciphertext TEXT,
  refresh_token_iv TEXT,
  token_expires_at TEXT,
  refresh_token_expires_at TEXT,
  token_refreshing_at TEXT,
  scopes TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'UNINSTALLED')),
  installed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  timezone TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','DISCOVERING','PROCESSING','CANCELLING','CANCELLED','COMPLETED','FAILED')),
  discovery_cursor TEXT,
  total_orders INTEGER NOT NULL DEFAULT 0,
  eligible_orders INTEGER NOT NULL DEFAULT 0,
  processed_orders INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  rolling_avg_ms REAL,
  last_order_name TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX jobs_shop_created ON jobs(shop_id, created_at DESC);

CREATE TABLE job_orders (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  shopify_order_id TEXT NOT NULL,
  order_name TEXT NOT NULL,
  eligible INTEGER,
  status TEXT NOT NULL CHECK (status IN ('PENDING','PROCESSING','SUCCESS','SKIPPED','FAILED','AUDIT_AFTER_FAILED','CANCELLED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  before_audit_status TEXT NOT NULL DEFAULT 'PENDING',
  after_audit_status TEXT NOT NULL DEFAULT 'PENDING',
  before_row_start INTEGER,
  after_row_start INTEGER,
  audit_row_count INTEGER,
  snapshot_json TEXT,
  result_json TEXT,
  shopify_order_edit_id TEXT,
  error_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(shop_id, job_id, shopify_order_id)
);

CREATE INDEX job_orders_job_status ON job_orders(shop_id, job_id, status);

CREATE TABLE audit_counters (
  tab TEXT PRIMARY KEY CHECK (tab IN ('BEFORE','AFTER')),
  next_row INTEGER NOT NULL
);

INSERT INTO audit_counters(tab, next_row) VALUES ('BEFORE', 2), ('AFTER', 2);
