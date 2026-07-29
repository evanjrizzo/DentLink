ALTER TABLE user_archive_objects ADD COLUMN verified_at TEXT;

CREATE INDEX IF NOT EXISTS idx_user_archive_objects_notification_verified
  ON user_archive_objects(user_id, source_entity_type, source_entity_id, verified_at)
  WHERE object_type = 'notification' AND source_entity_type = 'notification';
