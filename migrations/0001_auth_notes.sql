PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_token_hash_expires ON sessions(token_hash, expires_at);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, name)
);

CREATE INDEX idx_folders_user_id ON folders(user_id);
CREATE UNIQUE INDEX idx_folders_id_user_id ON folders(id, user_id);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, name)
);

CREATE INDEX idx_tags_user_id ON tags(user_id);
CREATE UNIQUE INDEX idx_tags_id_user_id ON tags(id, user_id);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('task', 'reference')),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  folder_id TEXT,
  due_at TEXT,
  priority TEXT NOT NULL DEFAULT 'none' CHECK(priority IN ('none', 'low', 'medium', 'high')),
  pinned INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'done', 'deleted')),
  global_order INTEGER NOT NULL,
  source_url TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK(folder_id IS NULL OR folder_id != ''),
  FOREIGN KEY(folder_id, user_id) REFERENCES folders(id, user_id)
);

CREATE INDEX idx_notes_user_status_order ON notes(user_id, status, pinned, global_order);
CREATE INDEX idx_notes_user_global_order ON notes(user_id, global_order);
CREATE INDEX idx_notes_user_folder ON notes(user_id, folder_id);
CREATE INDEX idx_notes_user_updated ON notes(user_id, updated_at);
CREATE UNIQUE INDEX idx_notes_id_user_id ON notes(id, user_id);

CREATE TABLE note_tags (
  note_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(note_id, tag_id),
  FOREIGN KEY(note_id, user_id) REFERENCES notes(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY(tag_id, user_id) REFERENCES tags(id, user_id) ON DELETE CASCADE
);

CREATE INDEX idx_note_tags_user_tag ON note_tags(user_id, tag_id);

CREATE TABLE note_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('created', 'updated', 'done', 'reopened', 'deleted', 'reordered', 'conflict_created', 'conflict_resolved')),
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_note_history_user_note ON note_history(user_id, note_id, created_at);
CREATE INDEX idx_note_history_user_note_version ON note_history(user_id, note_id, version);

CREATE TABLE note_conflicts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  expected_version INTEGER NOT NULL,
  actual_version INTEGER NOT NULL,
  attempted_patch_json TEXT NOT NULL,
  server_note_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved')),
  version INTEGER NOT NULL DEFAULT 1,
  resolution TEXT CHECK(resolution IN ('keep_mine', 'keep_theirs', 'merge', 'keep_both')),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX idx_note_conflicts_user_status ON note_conflicts(user_id, status, created_at);
CREATE INDEX idx_note_conflicts_user_note_status ON note_conflicts(user_id, note_id, status);

CREATE TABLE sync_changes (
  cursor INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('note', 'folder', 'tag', 'conflict')),
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('upsert', 'delete')),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_sync_changes_user_cursor ON sync_changes(user_id, cursor);
CREATE INDEX idx_sync_changes_user_entity ON sync_changes(user_id, entity_type, entity_id, cursor);
