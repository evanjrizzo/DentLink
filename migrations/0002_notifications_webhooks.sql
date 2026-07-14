PRAGMA foreign_keys = ON;

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK(source IN ('webhook', 'manual', 'system')),
  source_label TEXT NOT NULL,
  source_url TEXT,
  severity TEXT NOT NULL DEFAULT 'info' CHECK(severity IN ('info', 'low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'done', 'dismissed', 'deleted')),
  pinned INTEGER NOT NULL DEFAULT 0,
  rank INTEGER NOT NULL DEFAULT 0,
  global_order INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  dismissed_at TEXT
);

CREATE INDEX idx_notifications_user_status_order
  ON notifications(user_id, status, pinned, rank, global_order);
CREATE INDEX idx_notifications_user_global_order ON notifications(user_id, global_order);
CREATE INDEX idx_notifications_user_updated ON notifications(user_id, updated_at);
CREATE UNIQUE INDEX idx_notifications_id_user_id ON notifications(id, user_id);

CREATE TABLE webhook_endpoints (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  destination TEXT NOT NULL CHECK(destination IN ('notification', 'note')),
  enabled INTEGER NOT NULL DEFAULT 1,
  default_severity TEXT NOT NULL DEFAULT 'info' CHECK(default_severity IN ('info', 'low', 'medium', 'high')),
  default_priority TEXT NOT NULL DEFAULT 'none' CHECK(default_priority IN ('none', 'low', 'medium', 'high')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_triggered_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(user_id, slug)
);

CREATE INDEX idx_webhook_endpoints_user_enabled ON webhook_endpoints(user_id, enabled, slug);
CREATE INDEX idx_webhook_endpoints_slug_enabled ON webhook_endpoints(slug, enabled);

CREATE TABLE webhook_deliveries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('accepted', 'rejected')),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_webhook_deliveries_endpoint_created
  ON webhook_deliveries(endpoint_id, created_at);
CREATE INDEX idx_webhook_deliveries_user_created ON webhook_deliveries(user_id, created_at);

CREATE TABLE sync_changes_v2 (
  cursor INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('note', 'folder', 'tag', 'notification', 'webhook', 'conflict')),
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('upsert', 'delete')),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO sync_changes_v2 (cursor, user_id, entity_type, entity_id, operation, payload_json, created_at)
SELECT cursor, user_id, entity_type, entity_id, operation, payload_json, created_at
FROM sync_changes;

DROP TABLE sync_changes;
ALTER TABLE sync_changes_v2 RENAME TO sync_changes;

CREATE INDEX idx_sync_changes_user_cursor ON sync_changes(user_id, cursor);
CREATE INDEX idx_sync_changes_user_entity ON sync_changes(user_id, entity_type, entity_id, cursor);
