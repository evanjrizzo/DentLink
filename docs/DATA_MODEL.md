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

## Milestone 4 D1 schema

`migrations/0005_google_calendar_connector.sql` adds Google Calendar agenda persistence:

- `calendar_events`: user-scoped normalized provider event instances linked to connector accounts.
  Rows store provider event ID, calendar ID/summary, title, description, location, source URL,
  start/end timestamps, all-day dates, timezone, status, version, and local dismissal timestamp.
- `sync_changes`: rebuilt in place to permit `calendar_event` entity changes while preserving
  existing cursors and payloads.

Google Calendar connector accounts continue to live in `connector_accounts` with
`connector_key = 'google-calendar'`. The account stores calendar metadata, sync token, health, and
credential reference only. Refresh tokens remain encrypted in `connector_credentials`.

Calendar events are unique by `(connector_account_id, provider_event_id)`, which makes repeated sync
retry-safe. DentLink-local agenda dismissal updates only the `calendar_events.status` and
`dismissed_at` fields; it does not mutate Google Calendar.

## Milestone 5 D1 schema

`migrations/0006_calendar_foundation_ics.sql` extends the calendar foundation without modifying
prior migrations:

- `calendar_events`: rebuilt in place to support both `source = 'google-calendar'` provider rows and
  `source = 'local'` DentLink-owned rows. Local rows have no connector account, provider, or
  provider event ID. Provider rows retain the Google connector linkage and read-only source fields.
- Local calendar event columns include recurrence rule, category, display color, reminder metadata,
  imported ICS UID, created/updated timestamps, version, and `status = 'deleted'` tombstones.
- `calendar_event_annotations`: user-scoped DentLink-only annotations tied to normalized calendar
  event IDs. Annotation rows store notes, pinned, completed, hidden, tag ID JSON, timestamps, and
  version.
- Sync support continues through `sync_changes` using `calendar_event` changes for local event and
  annotation mutations.

Indexes cover user/source/status/date range scans, provider event identity, local imported UID
deduplication, and annotation lookup by `(user_id, event_id)`.

Local and provider events share the same normalized envelope so the UI and API can render a single
calendar stream. Provider-owned fields remain authoritative to the provider; DentLink-owned local
events are editable inside DentLink. ICS import creates only `source = 'local'` rows and preserves
the imported UID as external import metadata for duplicate-safe retries.

## Milestone 7 Phase 1 D1 schema

`migrations/0007_gmail_ingestion_outcomes.sql` extends `connector_source_records` for reliable Gmail
ingestion diagnostics without changing provider credentials or notification ownership.

- Source-record `status` now accepts explicit Gmail processing outcomes: `notification_created`,
  `notification_updated`, `notification_suppressed`, `notification_grouped`, `skipped`, `duplicate`,
  `filtered`, and `failed`, while preserving earlier `pending` and `processed` values.
- `processing_reason` stores the safe reason for the final per-message outcome. `error_message`
  remains reserved for failed processing.
- Existing source records are preserved during migration replay and preview upgrades.

Gmail-created notifications continue to be user-scoped normal notifications. Their connector source
records now retain the DentLink notification ID in normalized metadata and record `processed_at`
when notification creation succeeds.

Milestone 7 Slice 2 does not add another migration. Gmail sync summaries and the diagnostics API are
derived from the existing user-scoped connector account plus `connector_source_records` rows.
Diagnostics expose normalized Gmail message IDs, processing outcomes, safe reasons, processed
timestamps, linked notification IDs, and source record IDs only.

Milestone 7 Slice 2.1 also uses the existing schema. Backfilled Gmail messages create the same
source-record and notification shapes as incremental sync, so `(account_id, source_external_id)`
continues to provide duplicate safety and existing notifications are not reset or replaced.

`migrations/0008_gmail_rules.sql` widens the source-record status constraint for deterministic Gmail
rule outcomes. Gmail rules are stored as validated JSON in the owned Gmail connector account
settings under `gmailRulesJson`; provider credentials remain in `connector_credentials`. Matched
rule ID, name, action, and category are copied into normalized Gmail source-record metadata so a
created or suppressed notification can be audited without storing raw email bodies.

`migrations/0009_email_sorting_ai.sql` adds optional email enrichment metadata without changing the
notification ownership model:

- `notifications.email_metadata_json`: provider-neutral normalized email metadata used by Gmail
  IMAP notifications, including sender, recipients, subject, received timestamp, unread state,
  attachment metadata, body hash, source link, and safe fallback snippet.
- `notifications.rule_metadata_json`: the deterministic rule decision that caused a notification to
  be shown, prioritized, tagged, categorized, or explained.
- `notifications.ai_metadata_json`: optional AI processing state, model, prompt version, content
  hash, summary/classification fields, usage estimates, and safe failure metadata.
- `ai_usage_daily`: user-scoped daily aggregate counts for AI requests, input characters, output
  tokens, failed requests, model, provider, and optional estimated cost.

Normalized email body text is retained in Gmail source-record normalized metadata only as bounded
text for notification fallback and optional summarization. Attachment binary content is not stored.
Older notifications without these metadata columns are surfaced with `ai.status = disabled` and
empty email/rule metadata.

`migrations/0010_ai_user_preferences.sql` adds `user_preferences` for small user-scoped UI and
processing preferences. Slice 4.2 uses key `email_ai_enabled` to store an explicit AI opt-out. The
absence of that key means AI follows server availability and defaults to enabled when
`OPENAI_API_KEY` is configured.
