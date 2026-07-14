PRAGMA foreign_keys = ON;

CREATE TABLE connector_source_records_v8 (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES connector_accounts(id) ON DELETE CASCADE,
  connector_key TEXT NOT NULL,
  source_external_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('email', 'calendar_event', 'notification', 'generic')),
  payload_hash TEXT NOT NULL,
  normalized_payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
    'pending',
    'processed',
    'notification_created',
    'notification_updated',
    'notification_suppressed',
    'notification_grouped',
    'skipped',
    'duplicate',
    'filtered',
    'failed'
  )),
  received_at TEXT NOT NULL,
  processed_at TEXT,
  processing_reason TEXT,
  error_message TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(account_id, source_external_id)
);

INSERT INTO connector_source_records_v8 (
  id, user_id, account_id, connector_key, source_external_id, source_type, payload_hash,
  normalized_payload_json, status, received_at, processed_at, processing_reason, error_message,
  version
)
SELECT
  id, user_id, account_id, connector_key, source_external_id, source_type, payload_hash,
  normalized_payload_json, status, received_at, processed_at, processing_reason, error_message,
  version
FROM connector_source_records;

DROP TABLE connector_source_records;
ALTER TABLE connector_source_records_v8 RENAME TO connector_source_records;

CREATE INDEX idx_connector_records_user_account
  ON connector_source_records(user_id, account_id, received_at);
CREATE INDEX idx_connector_records_user_status
  ON connector_source_records(user_id, status, received_at);
CREATE INDEX idx_connector_records_external
  ON connector_source_records(account_id, source_external_id);
