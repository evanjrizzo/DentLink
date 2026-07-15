PRAGMA foreign_keys = ON;

ALTER TABLE notifications ADD COLUMN email_metadata_json TEXT;
ALTER TABLE notifications ADD COLUMN rule_metadata_json TEXT;
ALTER TABLE notifications ADD COLUMN ai_metadata_json TEXT;

CREATE INDEX idx_notifications_user_email_received
  ON notifications(user_id, json_extract(email_metadata_json, '$.receivedAt'));
CREATE INDEX idx_notifications_user_ai_status
  ON notifications(user_id, json_extract(ai_metadata_json, '$.status'));

CREATE TABLE ai_usage_daily (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_date TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  input_chars INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  failed_requests INTEGER NOT NULL DEFAULT 0,
  estimated_cost_micros INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, usage_date, provider, model)
);

CREATE INDEX idx_ai_usage_user_date ON ai_usage_daily(user_id, usage_date);
