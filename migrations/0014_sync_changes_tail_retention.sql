PRAGMA foreign_keys = ON;

-- Preview generated enough calendar/account churn inside the 14-day retention window to hit the D1
-- storage limit. Keep a large recent cursor tail for incremental clients, but do not let this
-- rebuildable log grow unbounded between date-based cleanup windows.
DELETE FROM sync_changes
WHERE cursor NOT IN (
  SELECT cursor
  FROM sync_changes
  ORDER BY cursor DESC
  LIMIT 10000
);

DROP TRIGGER IF EXISTS sync_changes_tail_retention_after_insert;

CREATE TRIGGER sync_changes_tail_retention_after_insert
AFTER INSERT ON sync_changes
WHEN (NEW.cursor % 100) = 0
BEGIN
  DELETE FROM sync_changes
  WHERE cursor NOT IN (
    SELECT cursor
    FROM sync_changes
    ORDER BY cursor DESC
    LIMIT 10000
  );
END;
