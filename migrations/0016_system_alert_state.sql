PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS system_alert_state (
  key TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
