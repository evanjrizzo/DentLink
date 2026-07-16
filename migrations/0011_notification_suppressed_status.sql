PRAGMA foreign_keys = OFF;

CREATE TABLE notifications_v11 (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('webhook', 'manual', 'system', 'connector')),
  source_label TEXT NOT NULL,
  source_url TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high')),
  status TEXT NOT NULL CHECK (status IN ('active', 'suppressed', 'done', 'dismissed', 'deleted')),
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  rank REAL NOT NULL DEFAULT 0,
  global_order REAL NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  dismissed_at TEXT,
  email_metadata_json TEXT,
  rule_metadata_json TEXT,
  ai_metadata_json TEXT
);

INSERT INTO notifications_v11 (
  id, user_id, title, summary, body, source, source_label, source_url, severity, status, pinned,
  rank, global_order, version, created_at, updated_at, completed_at, dismissed_at,
  email_metadata_json, rule_metadata_json, ai_metadata_json
)
SELECT
  id, user_id, title, summary, body, source, source_label, source_url, severity, status, pinned,
  rank, global_order, version, created_at, updated_at, completed_at, dismissed_at,
  email_metadata_json, rule_metadata_json, ai_metadata_json
FROM notifications;

DROP TABLE notifications;
ALTER TABLE notifications_v11 RENAME TO notifications;

CREATE INDEX idx_notifications_user_status_order
  ON notifications(user_id, status, pinned, rank, global_order);
CREATE INDEX idx_notifications_user_global_order ON notifications(user_id, global_order);
CREATE INDEX idx_notifications_user_updated ON notifications(user_id, updated_at);
CREATE UNIQUE INDEX idx_notifications_id_user_id ON notifications(id, user_id);
CREATE INDEX idx_notifications_email_received
  ON notifications(user_id, json_extract(email_metadata_json, '$.receivedAt'));
CREATE INDEX idx_notifications_ai_status
  ON notifications(user_id, json_extract(ai_metadata_json, '$.status'));

PRAGMA foreign_keys = ON;
