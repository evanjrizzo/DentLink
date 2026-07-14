# API Contract

All public endpoints are versioned under `/v1`.

Principles: JSON, server-resolved user identity, stable error shape, idempotency where appropriate,
cursor sync, optimistic concurrency, no secrets, and normalized provider data.

Conceptual groups: auth, sync, notifications, notes, calendar, connectors, webhooks, ranking
feedback/explanations, and conflicts.

Editable mutations include `expectedVersion`. Version mismatches return or create conflict
information rather than silently overwriting.

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

- `/v1/auth/*`: registration, sign in, sign out, current session, later password reset, later email
  verification, and later device/session revocation.
- `/v1/sync`: cursor-based incremental sync and mutation acknowledgement.
- `/v1/notifications/*`: list, source inbox search, mark done, pin, reorder, and Ranking Mode
  dismiss.
- `/v1/notes/*`: list, create, update, complete, pin, reorder, search, and conflict-aware edits.
- `/v1/calendar/*`: views, source filters, local events, annotations, agenda hide, ICS export, and
  future provider sync.
- `/v1/connectors/*`: connector catalog, account connection state, settings, health, enable/disable,
  and supported actions.
- `/v1/webhooks/*`: named endpoint management, secret rotation, health, and delivery history.
- `/v1/ranking/*`: explanations, positive feedback, dismiss feedback, and ranking mode metadata.
- `/v1/conflicts/*`: list, inspect revisions, resolve, and keep both.

## Mutation shape

Mutable records include `version`. Updates include `expectedVersion` and should return the updated
resource or a conflict payload.

```json
{
  "expectedVersion": 7,
  "changes": {
    "title": "Renew insurance"
  }
}
```

## Sync shape

Sync uses cursors rather than timestamps as the authority. Responses include changed records,
deleted tombstones where needed, server time, and the next cursor.

Error shape:

```json
{
  "error": {
    "code": "stable_code",
    "message": "Human-readable message",
    "requestId": "id",
    "details": {}
  }
}
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
- `GET /v1/health`: return safe deployment health, environment, build, and database reachability.
- `POST /v1/auth/login`: verify credentials and return a session.
- `GET /v1/auth/session`: return the authenticated user/session from the bearer token without
  echoing the raw token.
- `POST /v1/auth/logout`: revoke the current session token.
- `GET /v1/notes`: list authenticated user's notes, folders, and tags. Supports `search`,
  `folderId`, and repeated `tagId` query parameters.
- `POST /v1/notes`: create a task or reference note.
- `PATCH /v1/notes/:id`: update a note with `expectedVersion` optimistic concurrency.
- `DELETE /v1/notes/:id`: soft-delete a note with `expectedVersion`.
- `GET /v1/notes/:id/history`: list authenticated user's history events for a note.
- `POST /v1/notes/reorder`: update global ordering with per-note `expectedVersion`.
- `POST /v1/folders`: create one user-scoped folder.
- `POST /v1/tags`: create a user-scoped tag.
- `GET /v1/sync`: return cursor-based changes for the authenticated user. Empty cursor means `0`;
  invalid cursor values return `invalid_cursor`.
- `GET /v1/conflicts`: list open conflicts for the authenticated user.
- `POST /v1/conflicts/:id/resolve`: mark a conflict resolved with `expectedVersion`.

Milestone 1 clients authenticate with `Authorization: Bearer <session token>`. Server-side session
resolution determines user identity.

Delete operations are soft deletes in the notes table and emit sync tombstones. Conflict responses
use HTTP `409`; typed clients surface these as explicit conflict errors rather than silently
overwriting local state.

Milestone 1.1 keeps these endpoint shapes unchanged while adding a Cloudflare D1 storage adapter.
Clients should not observe different API behavior between the in-memory adapter and D1 adapter.

## Milestone 2 endpoints

Milestone 2 adds Notifications and named webhook ingestion without changing the Milestone 1 auth,
Notes, sync, history, or conflict contracts.

- `GET /v1/notifications`: list the authenticated user's non-deleted notifications.
- `POST /v1/notifications`: create a manual/system notification for the authenticated user.
- `PATCH /v1/notifications/:id`: update `pinned` or `status` with `expectedVersion`.
- `DELETE /v1/notifications/:id`: soft-delete a notification with `expectedVersion`.
- `POST /v1/notifications/reorder`: update notification global ordering with per-notification
  `expectedVersion` entries.
- `GET /v1/webhooks`: list authenticated user's named webhook endpoints. Responses include
  `ingestUrl` but never include the endpoint secret or secret hash.
- `POST /v1/webhooks`: create a named webhook endpoint. The response returns the generated webhook
  secret once, alongside the public endpoint record and `ingestUrl`.
- `PATCH /v1/webhooks/:id`: update an authenticated user's webhook endpoint with
  `expectedVersion`.
- `POST /v1/ingest/webhooks/:slug`: public ingest route for enabled webhook endpoints.

Webhook ingest requests authenticate with `X-DentLink-Webhook-Secret`. The slug is not treated as a
secret. The raw secret is hashed before lookup, and only the hash is stored. Missing secrets return
`401`; unknown, disabled, or wrong-secret endpoints return `404`; accepted deliveries return `202`.
Endpoints are currently limited to 60 accepted deliveries per minute per endpoint.

Webhook endpoints route payloads to one of two destinations:

- `notification`: creates a normalized notification with source `webhook` and source label from the
  endpoint name.
- `note`: creates a task/reference note using the endpoint defaults and submitted note fields.

Notification and webhook changes are included in `/v1/sync` through the same numeric cursor log used
by Milestone 1. Notification deletes are emitted as tombstones. Webhook secrets and hashes are never
included in sync payloads.
