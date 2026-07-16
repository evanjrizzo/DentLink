CREATE TABLE connector_sync_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  connector_key TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'scheduled', 'refresh_all', 'backfill')),
  engine TEXT NOT NULL CHECK (engine IN ('gmail_api', 'gmail_imap', 'unknown')),
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed', 'skipped')),
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  error_code TEXT,
  error_message TEXT,
  summary_json TEXT,
  details_json TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES connector_accounts(id) ON DELETE CASCADE
);

CREATE INDEX connector_sync_attempts_user_account_started_idx
  ON connector_sync_attempts(user_id, account_id, started_at);

CREATE INDEX connector_sync_attempts_user_status_started_idx
  ON connector_sync_attempts(user_id, status, started_at);
