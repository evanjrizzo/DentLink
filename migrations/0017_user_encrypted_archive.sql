CREATE TABLE IF NOT EXISTS user_archive_key_wrappers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  wrapper_type TEXT NOT NULL,
  wrapping_algorithm TEXT NOT NULL,
  wrapped_key_b64 TEXT NOT NULL,
  salt_b64 TEXT,
  public_metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, key_id, wrapper_type)
);

CREATE INDEX IF NOT EXISTS idx_user_archive_key_wrappers_user
  ON user_archive_key_wrappers(user_id, updated_at);

CREATE TABLE IF NOT EXISTS user_archive_objects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  object_type TEXT NOT NULL,
  source_entity_type TEXT,
  source_entity_id TEXT,
  r2_key TEXT NOT NULL,
  encryption_algorithm TEXT NOT NULL,
  key_id TEXT NOT NULL,
  nonce_b64 TEXT NOT NULL,
  ciphertext_sha256_b64 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  public_metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, r2_key)
);

CREATE INDEX IF NOT EXISTS idx_user_archive_objects_user_created
  ON user_archive_objects(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_archive_objects_user_source
  ON user_archive_objects(user_id, source_entity_type, source_entity_id);
