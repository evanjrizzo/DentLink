# Data Model

Use a common item envelope with type-specific details.

## Core concepts

- users
- sessions
- devices
- connector definitions
- connector accounts
- connector sync state
- items
- notification details
- note details
- calendar details
- folders
- tags
- rules
- ranking results
- ranking feedback
- revisions
- conflicts
- webhook endpoints
- AI usage
- audit events

Notes belong to at most one folder and may have multiple tags.

Provider IDs are external identities, not DentLink primary keys.

Editable records use versions. Every user-owned record must include or derive user scope.

## Item envelope

Every promoted or user-visible unit uses a shared envelope:

- `id`: DentLink primary identifier
- `userId`: server-owned user scope, never accepted from client authorization input
- `type`: notification, note, calendar_event, or future supported type
- `source`: connector, webhook, manual, local_agent, or system
- `sourceAccountId`: optional connector account reference
- `sourceExternalId`: optional provider identifier
- `title`
- `summary`
- `status`: active, done, dismissed, archived, or deleted where applicable
- `pinned`
- `rank`
- `rankExplanationId`
- `globalOrder`
- `createdAt`
- `updatedAt`
- `version`
- type-specific detail reference

The envelope must remain provider-neutral. Raw connector payloads belong in connector storage or
source-specific records, not in generic UI models.

## Type-specific details

Notification details capture source URL, sender or origin label, severity, promotion reason, source
timestamps, and searchable summary/body metadata.

Note details capture task/reference type, body, folder, tags, due date, priority, source URL, and
completion metadata.

Calendar details capture start/end times, timezone, all-day status, recurrence reference, location,
attendees where allowed, source link, DentLink annotations, and agenda-hidden state.

## Conflict and revision model

Editable records keep revisions with editor metadata and version numbers. Mutations include
`expectedVersion`. When a conflict occurs, DentLink stores both revisions, creates a conflict
record, and returns enough information for clients to offer resolution options.

## Retention model

Summaries, normalized metadata, history, and user-created notes persist until deletion. Raw email
body cache is limited, initially 7 to 30 days. Attachments are not downloaded by default.

## Milestone 1.1 D1 schema

`migrations/0001_auth_notes.sql` creates the first durable schema:

- `users`: user identity, normalized email, and password hash metadata.
- `sessions`: revocable authenticated sessions scoped to users. Only session token hashes are
  stored.
- `folders`: one-folder-per-note organization, user-scoped with unique names per user.
- `tags`: reusable user-scoped note labels.
- `notes`: task/reference notes with due date, priority, pin, status, global order, source URL,
  version, and completion metadata.
- `note_tags`: many-to-many tag assignments.
- `note_history`: immutable snapshots for created, updated, done, reopened, deleted, and reordered
  events.
- `note_conflicts`: persisted optimistic concurrency conflicts with attempted patch and server
  snapshot.
- `sync_changes`: deterministic cursor-based changes for notes, folders, tags, conflicts, and delete
  tombstones.

Every table containing user data includes `user_id` directly or through a user-scoped parent record.
The production storage adapter uses this schema through Cloudflare D1 and the same storage contract
as the in-memory adapter.

Milestone 1 sync cursors are numeric change-log positions. Clients should treat them as opaque and
send back only the cursor returned by the API.

Versioned D1 note mutations use SQL affected-row checks with `id`, `user_id`, and `version`
conditions. Failed checks create persisted conflict records instead of performing unconditional
updates.

## Milestone 2 D1 schema

`migrations/0002_notifications_webhooks.sql` extends the durable schema:

- `notifications`: user-scoped active/done/dismissed/deleted notification records with title,
  summary, body, source metadata, severity, pin state, rank, global order, version, timestamps, and
  completion/dismissal timestamps.
- `webhook_endpoints`: user-scoped named endpoints with unique `(user_id, slug)`, hashed secret
  storage, destination mapping, enabled state, default severity/priority, last-triggered metadata,
  and version.
- `webhook_deliveries`: user-scoped accepted delivery records used for endpoint health metadata and
  per-endpoint rate limiting.
- `sync_changes`: rebuilt in place to permit `notification` and `webhook` entity types while
  preserving existing cursors and payloads.

Notification and webhook mutations are versioned and user-scoped. D1 notification and webhook
updates use affected-row checks with `id`, `user_id`, and `version` conditions before accepting a
mutation. Webhook raw secrets are returned only at endpoint creation; the schema stores only
`secret_hash`.

Milestone 2 indexes cover user/status/order notification listing, notification sync/update scans,
endpoint lookup by slug/enabled state, user webhook listing, webhook delivery history, and the
extended sync change log.

## Milestone 3 D1 schema

`migrations/0003_connector_framework.sql` extends the durable schema with provider-neutral connector
plumbing:

- `connector_accounts`: user-scoped connector account metadata with catalog key, display name,
  connection status, health status, sync status, settings JSON, credential reference/status,
  sync/health timestamps, last error metadata, version, and timestamps.
- `connector_source_records`: user-scoped normalized source-record bookkeeping tied to a connector
  account, external source ID, source type, payload hash, normalized payload JSON, processing
  status, version, and timestamps.
- `sync_changes`: rebuilt in place to permit `connector_account` entity changes while preserving
  existing cursors and payloads.

Connector accounts are soft-deleted with status `deleted` and emit sync tombstones. Source records
must belong to an owned non-deleted connector account and enforce uniqueness by
`(account_id, source_external_id)`.

Milestone 3 deliberately stores connector metadata and normalized source-record bookkeeping only. It
does not store Gmail, Google Calendar, Outlook, Microsoft Graph, IMAP, or other provider-specific
payloads, and it does not introduce authoritative ranking changes.

Indexes cover account lookup by user/status, user/connector key, health checks, source records by
user/account, source-record processing state, external source identity, and the extended sync change
log.

## Milestone 3.1 D1 schema

`migrations/0004_gmail_connector.sql` adds the Gmail connector persistence layer:

- `connector_oauth_states`: short-lived, user-scoped OAuth CSRF state records. Only the state hash
  is stored.
- `connector_credentials`: encrypted connector credentials separate from connector account metadata.
  Gmail stores refresh tokens as `oauth_refresh_token` encrypted values.
- `notifications`: rebuilt in place to permit `source = 'connector'` while preserving existing
  notification rows and indexes.

Gmail connector accounts continue to live in `connector_accounts` with `connector_key = 'gmail'`.
The account row stores only a credential reference and status fields. The encrypted refresh token is
stored in `connector_credentials`, and normalized Gmail message metadata is stored in
`connector_source_records`.

Gmail source records are unique by `(account_id, source_external_id)`, which makes message ingestion
retry-safe and prevents duplicate notification creation for the same Gmail message.
