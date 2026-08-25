PRAGMA foreign_keys = ON;

CREATE TABLE connector_sync_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES connector_accounts(id) ON DELETE CASCADE,
  connector_key TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK(trigger IN ('manual', 'scheduled', 'refresh_all')),
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed', 'skipped')),
  priority INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_after TEXT NOT NULL,
  locked_at TEXT,
  locked_by TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX idx_connector_sync_jobs_due
  ON connector_sync_jobs(status, run_after, priority DESC, created_at);

CREATE INDEX idx_connector_sync_jobs_user_account
  ON connector_sync_jobs(user_id, account_id, status, updated_at DESC);
