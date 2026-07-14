PRAGMA foreign_keys = ON;

CREATE TABLE connector_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connector_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'paused' CHECK(status IN ('connected', 'paused', 'error', 'deleted')),
  health_status TEXT NOT NULL DEFAULT 'unknown' CHECK(health_status IN ('unknown', 'healthy', 'degraded', 'error')),
  sync_status TEXT NOT NULL DEFAULT 'idle' CHECK(sync_status IN ('idle', 'syncing', 'error')),
  settings_json TEXT NOT NULL DEFAULT '{}',
  credential_ref TEXT,
  credential_status TEXT NOT NULL DEFAULT 'not_configured' CHECK(credential_status IN ('not_configured', 'configured')),
  sync_cursor TEXT,
  last_sync_at TEXT,
  next_sync_at TEXT,
  last_health_at TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(user_id, connector_key, display_name)
);

CREATE INDEX idx_connector_accounts_user_status
  ON connector_accounts(user_id, status, connector_key);
CREATE INDEX idx_connector_accounts_user_key ON connector_accounts(user_id, connector_key);
CREATE INDEX idx_connector_accounts_health ON connector_accounts(user_id, health_status, sync_status);

CREATE TABLE connector_source_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES connector_accounts(id) ON DELETE CASCADE,
  connector_key TEXT NOT NULL,
  source_external_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('email', 'calendar_event', 'notification', 'generic')),
  payload_hash TEXT NOT NULL,
  normalized_payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processed', 'failed')),
  received_at TEXT NOT NULL,
  processed_at TEXT,
  error_message TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(account_id, source_external_id)
);

CREATE INDEX idx_connector_records_user_account
  ON connector_source_records(user_id, account_id, received_at);
CREATE INDEX idx_connector_records_user_status
  ON connector_source_records(user_id, status, received_at);
CREATE INDEX idx_connector_records_external
  ON connector_source_records(account_id, source_external_id);

CREATE TABLE sync_changes_v3 (
  cursor INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('note', 'folder', 'tag', 'notification', 'webhook', 'connector_account', 'conflict')),
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('upsert', 'delete')),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO sync_changes_v3 (cursor, user_id, entity_type, entity_id, operation, payload_json, created_at)
SELECT cursor, user_id, entity_type, entity_id, operation, payload_json, created_at
FROM sync_changes;

DROP TABLE sync_changes;
ALTER TABLE sync_changes_v3 RENAME TO sync_changes;

CREATE INDEX idx_sync_changes_user_cursor ON sync_changes(user_id, cursor);
CREATE INDEX idx_sync_changes_user_entity ON sync_changes(user_id, entity_type, entity_id, cursor);
