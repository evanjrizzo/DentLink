PRAGMA foreign_keys = ON;

-- Gmail source records are identity and diagnostics records, not a durable raw body cache.
-- Keep a short snippet plus the existing body hash, and remove historically stored full bodies.
UPDATE connector_source_records
SET normalized_payload_json = json_remove(
  json_set(
    normalized_payload_json,
    '$.snippet',
    substr(
      COALESCE(
        json_extract(normalized_payload_json, '$.snippet'),
        json_extract(normalized_payload_json, '$.normalized_body'),
        ''
      ),
      1,
      500
    )
  ),
  '$.normalized_body'
)
WHERE connector_key = 'gmail'
  AND json_extract(normalized_payload_json, '$.normalized_body') IS NOT NULL;

-- OAuth state and webhook delivery rows are short-lived operational data.
DELETE FROM connector_oauth_states
WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

DELETE FROM webhook_deliveries
WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days');

-- Sync attempts are diagnostics. Keep recent entries and a generous per-account tail.
DELETE FROM connector_sync_attempts
WHERE started_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
  AND id NOT IN (
    SELECT id
    FROM (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY user_id, account_id
          ORDER BY started_at DESC, id DESC
        ) AS row_number
      FROM connector_sync_attempts
    )
    WHERE row_number <= 200
  );

-- The cursor log is rebuildable notification for clients. Preserve recent rows and a large tail
-- so active clients still receive incremental updates while old previews stop growing forever.
DELETE FROM sync_changes
WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days')
  AND cursor NOT IN (
    SELECT cursor
    FROM sync_changes
    ORDER BY cursor DESC
    LIMIT 10000
  );
