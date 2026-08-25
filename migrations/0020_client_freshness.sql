PRAGMA foreign_keys = ON;

CREATE TABLE client_freshness (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  client_type TEXT NOT NULL CHECK(client_type IN ('web', 'desktop', 'mobile', 'widget')),
  label TEXT NOT NULL,
  build_id TEXT,
  platform TEXT,
  last_read_at TEXT NOT NULL,
  last_read_revision TEXT NOT NULL,
  last_read_status TEXT NOT NULL CHECK(last_read_status IN ('current', 'degraded')),
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(user_id, client_id)
);

CREATE INDEX idx_client_freshness_user_updated
  ON client_freshness(user_id, updated_at DESC);
