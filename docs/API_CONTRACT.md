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

- `/v1/auth/*`: registration, sign in, sign out, current session, later password reset, later email verification, and later device/session revocation.
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

## Milestone 1 endpoints

Implemented in the Worker-style API handler:

- `POST /v1/auth/register`: create a user with email/password and return a session.
- `POST /v1/auth/login`: verify credentials and return a session.
- `GET /v1/auth/session`: return the authenticated user/session from the bearer token without echoing the raw token.
- `POST /v1/auth/logout`: revoke the current session token.
- `GET /v1/notes`: list authenticated user's notes, folders, and tags. Supports `search`, `folderId`, and repeated `tagId` query parameters.
- `POST /v1/notes`: create a task or reference note.
- `PATCH /v1/notes/:id`: update a note with `expectedVersion` optimistic concurrency.
- `DELETE /v1/notes/:id`: soft-delete a note with `expectedVersion`.
- `GET /v1/notes/:id/history`: list authenticated user's history events for a note.
- `POST /v1/notes/reorder`: update global ordering with per-note `expectedVersion`.
- `POST /v1/folders`: create one user-scoped folder.
- `POST /v1/tags`: create a user-scoped tag.
- `GET /v1/sync`: return cursor-based changes for the authenticated user. Empty cursor means `0`; invalid cursor values return `invalid_cursor`.
- `GET /v1/conflicts`: list open conflicts for the authenticated user.
- `POST /v1/conflicts/:id/resolve`: mark a conflict resolved with `expectedVersion`.

Milestone 1 clients authenticate with `Authorization: Bearer <session token>`. Server-side session
resolution determines user identity.

Delete operations are soft deletes in the notes table and emit sync tombstones. Conflict responses
use HTTP `409`; typed clients surface these as explicit conflict errors rather than silently
overwriting local state.

Milestone 1.1 keeps these endpoint shapes unchanged while adding a Cloudflare D1 storage adapter.
Clients should not observe different API behavior between the in-memory adapter and D1 adapter.
