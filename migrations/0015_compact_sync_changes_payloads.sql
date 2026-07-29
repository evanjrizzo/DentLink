PRAGMA foreign_keys = ON;

-- sync_changes is a rebuildable cursor/invalidation log, not a user-data archive.
-- Replace historical full entity snapshots with a compact envelope. Authoritative records remain
-- in their user-scoped tables and are hydrated by the storage adapter when /v1/sync needs them.
UPDATE sync_changes
SET payload_json = json_object(
  'type', entity_type,
  'op', operation,
  'id', entity_id,
  'userId', user_id
);
