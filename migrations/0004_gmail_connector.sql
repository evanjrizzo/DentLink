CREATE TABLE connector_oauth_states (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state_hash TEXT NOT NULL UNIQUE,
  connector_key TEXT NOT NULL,
  reconnect_account_id TEXT REFERENCES connector_accounts(id) ON DELETE CASCADE,
  return_to TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_connector_oauth_states_hash
  ON connector_oauth_states(state_hash, connector_key, expires_at);
CREATE INDEX idx_connector_oauth_states_user
  ON connector_oauth_states(user_id, connector_key, expires_at);

CREATE TABLE connector_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES connector_accounts(id) ON DELETE CASCADE,
  connector_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('oauth_refresh_token')),
  encrypted_value TEXT NOT NULL,
  encryption_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, kind)
);

CREATE INDEX idx_connector_credentials_user_account
  ON connector_credentials(user_id, account_id, kind);

CREATE TABLE notifications_v4 (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('webhook', 'manual', 'system', 'connector')),
  source_label TEXT NOT NULL,
  source_url TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high')),
  status TEXT NOT NULL CHECK (status IN ('active', 'done', 'dismissed', 'deleted')),
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  rank REAL NOT NULL DEFAULT 0,
  global_order REAL NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  dismissed_at TEXT
);

INSERT INTO notifications_v4 (
  id, user_id, title, summary, body, source, source_label, source_url, severity, status, pinned,
  rank, global_order, version, created_at, updated_at, completed_at, dismissed_at
)
SELECT
  id, user_id, title, summary, body, source, source_label, source_url, severity, status, pinned,
  rank, global_order, version, created_at, updated_at, completed_at, dismissed_at
FROM notifications;

DROP TABLE notifications;
ALTER TABLE notifications_v4 RENAME TO notifications;

CREATE INDEX idx_notifications_user_status_order
  ON notifications(user_id, status, pinned, rank, global_order);
CREATE INDEX idx_notifications_user_global_order ON notifications(user_id, global_order);
CREATE INDEX idx_notifications_user_updated ON notifications(user_id, updated_at);
CREATE UNIQUE INDEX idx_notifications_id_user_id ON notifications(id, user_id);
