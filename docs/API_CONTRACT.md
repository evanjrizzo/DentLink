# API Contract

All public endpoints are versioned under `/v1`.

Principles: JSON, server-resolved user identity, stable error shape, idempotency where appropriate, cursor sync, optimistic concurrency, no secrets, and normalized provider data.

Conceptual groups: auth, sync, notifications, notes, calendar, connectors, webhooks, ranking feedback/explanations, and conflicts.

Editable mutations include `expectedVersion`. Version mismatches return or create conflict information rather than silently overwriting.

## Contract rules

- Authenticate every non-public request.
- Resolve user identity from the session or token on the server.
- Ignore or reject client-supplied user IDs for authorization.
- Return normalized DentLink resources, not raw provider payloads.
- Include stable identifiers and record versions in mutable resources.
- Use idempotency keys for retryable creation or action endpoints where duplicate effects matter.
- Keep API versions stable; breaking changes require a new version or documented migration.
- Never return provider credentials, webhook secrets, session secrets, or AI provider keys.

## Conceptual endpoint groups

- `/v1/auth/*`: sign in, sign out, session refresh, password reset, email verification, and device/session revocation.
- `/v1/sync`: cursor-based incremental sync and mutation acknowledgement.
- `/v1/notifications/*`: list, source inbox search, mark done, pin, reorder, and Ranking Mode dismiss.
- `/v1/notes/*`: list, create, update, complete, pin, reorder, search, and conflict-aware edits.
- `/v1/calendar/*`: views, source filters, local events, annotations, agenda hide, ICS export, and future provider sync.
- `/v1/connectors/*`: connector catalog, account connection state, settings, health, enable/disable, and supported actions.
- `/v1/webhooks/*`: named endpoint management, secret rotation, health, and delivery history.
- `/v1/ranking/*`: explanations, positive feedback, dismiss feedback, and ranking mode metadata.
- `/v1/conflicts/*`: list, inspect revisions, resolve, and keep both.

## Mutation shape

Mutable records include `version`. Updates include `expectedVersion` and should return the updated resource or a conflict payload.

```json
{
  "expectedVersion": 7,
  "changes": {
    "title": "Renew insurance"
  }
}
```

## Sync shape

Sync uses cursors rather than timestamps as the authority. Responses include changed records, deleted tombstones where needed, server time, and the next cursor.

Error shape:

```json
{"error":{"code":"stable_code","message":"Human-readable message","requestId":"id","details":{}}}
```

## Conflict response

Conflict responses must preserve both edits and expose stable resolution choices:

- keep mine
- keep theirs
- merge
- keep both
