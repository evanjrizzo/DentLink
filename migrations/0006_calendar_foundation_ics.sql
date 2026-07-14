CREATE TABLE calendar_events_v6 (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK(source IN ('google-calendar', 'local')),
  connector_account_id TEXT REFERENCES connector_accounts(id) ON DELETE CASCADE,
  provider TEXT CHECK(provider IN ('google-calendar')),
  provider_event_id TEXT,
  calendar_id TEXT,
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
  recurrence_rule TEXT,
  category TEXT,
  color TEXT,
  reminder_minutes INTEGER,
  imported_uid TEXT,
  status TEXT NOT NULL CHECK(status IN ('active', 'cancelled', 'dismissed', 'deleted')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  dismissed_at TEXT,
  CHECK(
    (source = 'google-calendar' AND connector_account_id IS NOT NULL AND provider = 'google-calendar' AND provider_event_id IS NOT NULL)
    OR
    (source = 'local' AND connector_account_id IS NULL AND provider IS NULL AND provider_event_id IS NULL)
  ),
  UNIQUE(connector_account_id, provider_event_id)
);

INSERT INTO calendar_events_v6 (
  id, user_id, source, connector_account_id, provider, provider_event_id, calendar_id,
  calendar_summary, title, description, location, source_url, start_at, end_at, start_date,
  end_date, timezone, all_day, recurrence_rule, category, color, reminder_minutes, imported_uid,
  status, version, created_at, updated_at, dismissed_at
)
SELECT
  id, user_id, 'google-calendar', connector_account_id, provider, provider_event_id, calendar_id,
  calendar_summary, title, description, location, source_url, start_at, end_at, start_date,
  end_date, timezone, all_day, NULL, NULL, NULL, NULL, NULL,
  status, version, created_at, updated_at, dismissed_at
FROM calendar_events;

DROP TABLE calendar_events;
ALTER TABLE calendar_events_v6 RENAME TO calendar_events;

CREATE INDEX idx_calendar_events_user_time
  ON calendar_events(user_id, status, start_at, end_at);
CREATE INDEX idx_calendar_events_user_account
  ON calendar_events(user_id, connector_account_id, start_at);
CREATE INDEX idx_calendar_events_provider
  ON calendar_events(connector_account_id, provider_event_id);
CREATE INDEX idx_calendar_events_user_source_time
  ON calendar_events(user_id, source, start_at, end_at);
CREATE UNIQUE INDEX idx_calendar_events_user_import_uid
  ON calendar_events(user_id, imported_uid)
  WHERE imported_uid IS NOT NULL AND source = 'local';

CREATE TABLE calendar_event_annotations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  notes TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0, 1)),
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1)),
  hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0, 1)),
  tag_ids_json TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, event_id)
);

CREATE INDEX idx_calendar_annotations_user_event
  ON calendar_event_annotations(user_id, event_id);
CREATE INDEX idx_calendar_annotations_user_flags
  ON calendar_event_annotations(user_id, hidden, pinned, completed);
