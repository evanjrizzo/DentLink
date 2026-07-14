CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connector_account_id TEXT NOT NULL REFERENCES connector_accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('google-calendar')),
  provider_event_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  calendar_summary TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location TEXT,
  source_url TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  timezone TEXT,
  all_day INTEGER NOT NULL DEFAULT 0 CHECK(all_day IN (0, 1)),
  status TEXT NOT NULL CHECK(status IN ('active', 'cancelled', 'dismissed', 'deleted')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  dismissed_at TEXT,
  UNIQUE(connector_account_id, provider_event_id)
);

CREATE INDEX idx_calendar_events_user_time
  ON calendar_events(user_id, status, start_at, end_at);
CREATE INDEX idx_calendar_events_user_account
  ON calendar_events(user_id, connector_account_id, start_at);
CREATE INDEX idx_calendar_events_provider
  ON calendar_events(connector_account_id, provider_event_id);

CREATE TABLE sync_changes_v5 (
  cursor INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('note', 'folder', 'tag', 'notification', 'calendar_event', 'webhook', 'connector_account', 'conflict')),
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('upsert', 'delete')),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO sync_changes_v5 (cursor, user_id, entity_type, entity_id, operation, payload_json, created_at)
SELECT cursor, user_id, entity_type, entity_id, operation, payload_json, created_at
FROM sync_changes;

DROP TABLE sync_changes;
ALTER TABLE sync_changes_v5 RENAME TO sync_changes;

CREATE INDEX idx_sync_changes_user_cursor ON sync_changes(user_id, cursor);
CREATE INDEX idx_sync_changes_user_entity ON sync_changes(user_id, entity_type, entity_id, cursor);
