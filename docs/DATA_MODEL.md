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

Folder deletion moves notes to Unfiled rather than deleting notes. Tag deletion removes the tag
relationship from notes and does not delete the notes themselves.

Account-level preferences currently use `user_preferences` for timezone and AI importance
configuration. Appearance presets, density, source colors, and animation preferences are local
per-device browser settings.

Client read freshness is durable user-scoped operational metadata, not user content. Each client
keeps a stable local `clientId` and reports the latest backend sync revision it successfully read.
Connector freshness remains derived from connector account sync/health timestamps and status.

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

`migrations/0020_client_freshness.sql` adds `client_freshness`, a user-scoped table keyed by
`(user_id, client_id)` for browser, desktop, mobile, and widget read heartbeats. Rows store client
type, label, optional build/platform metadata, last backend revision read, read status, optional
error metadata, timestamps, and version. It lets Settings -> Connections show backend-read
freshness per client separately from provider connector freshness.

`migrations/0021_connector_sync_jobs.sql` adds `connector_sync_jobs`, a durable user/account-scoped
background queue for Gmail and Google Calendar sync. Rows store connector key, trigger, queued or
running status, priority, run-after time, lease metadata, attempt counts, safe error metadata, and
completion time. Manual Refresh All, per-account Sync Now, and scheduled cron use this table so
provider sync can continue independently from client requests.

Versioned D1 note mutations use SQL affected-row checks with `id`, `user_id`, and `version`
conditions. Failed checks create persisted conflict records instead of performing unconditional
updates.

## Milestone 2 D1 schema

`migrations/0002_notifications_webhooks.sql` extends the durable schema:

- `notifications`: user-scoped active/done/dismissed/suppressed/deleted notification records with
  title, summary, body, source metadata, severity, pin state, rank, global order, version,
  timestamps, and completion/dismissal timestamps. `done` records a handled item through
  `completed_at`; `dismissed` records an item removed from Active without implying completion
  through `dismissed_at`. `suppressed` records a stored/searchable item whose independent AI
  importance score is below the user's notification threshold. Restoring these states to `active`
  clears the matching timestamp where applicable while preserving the notification's versioned
  lineage.
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

Gmail IMAP accounts also store safe cursor metadata in connector account settings:
`gmailLastImapUidValidity` and `gmailLastImapUid`. The IMAP engine uses these values to search for
newer INBOX UIDs first and falls back to the rolling recent-window scan if UIDVALIDITY is missing or
changes. The cursor advances only after IMAP syncs without per-message failures. Gmail source-record
normalized metadata may include safe `imap_uid` and `imap_uid_validity` values for diagnostics.

`migrations/0009_email_sorting_ai.sql` adds optional email enrichment metadata without changing the
notification ownership model:

- `notifications.email_metadata_json`: provider-neutral normalized email metadata used by Gmail IMAP
  notifications, including sender, recipients, subject, received timestamp, unread state, attachment
  metadata, body hash, source link, and safe fallback snippet.
- `notifications.rule_metadata_json`: the deterministic rule decision that caused a notification to
  be shown, prioritized, tagged, categorized, or explained.
- `notifications.ai_metadata_json`: optional AI processing state, model, prompt version, content
  hash, summary/classification fields, usage estimates, and safe failure metadata.
- `ai_usage_daily`: user-scoped daily aggregate counts for AI requests, input characters, output
  tokens, failed requests, model, provider, and optional estimated cost.

Normalized email body text is used only during the active ingestion request for deterministic rules,
notification fallback, and optional summarization. Gmail source records persist the normalized body
hash and a short snippet, not the full normalized body. Attachment binary content is not stored.
Older notifications without these metadata columns are surfaced with `ai.status = disabled` and
empty email/rule metadata.

`migrations/0010_ai_user_preferences.sql` adds `user_preferences` for small user-scoped UI and
processing preferences. Slice 4.2 uses key `email_ai_enabled` to store an explicit AI opt-out. The
absence of that key means AI follows server availability and defaults to enabled when
`OPENAI_API_KEY` is configured.

`migrations/0011_notification_suppressed_status.sql` rebuilds `notifications` in place so the D1
status check accepts `suppressed` while preserving existing rows, AI/email/rule metadata, ordering,
versions, and indexes. Suppressed notifications remain user-scoped records; normal listings hide
them unless the client explicitly includes suppressed results, and search can still return them.

The `email_ai_preferences_v1` user preference stores bounded AI customization: `globalPrompt`,
global `summaryPrompt`, global `textReplacements`, global `threshold`, saved prompt `presets`, and
optional `accountOverrides`. `summaryPrompt` is per-user global wording guidance for generated
summaries. `textReplacements` is a bounded per-user list of exact `find`/`replace` rules applied
after AI processing to notification subject/title and summary text. Per-account overrides are keyed
by Gmail connector account ID and affect importance prompt/threshold. Disabled or missing overrides
inherit the global prompt and threshold. Same-day reprocessing reads normalized Gmail source records
and updates existing notifications in place, preserving user action state and duplicate identity.

Milestone 7 Slice 4.3 adds no schema migration. Contextual actionability is derived from existing
notification metadata: AI `requiresAction`, non-ignore suggested actions, action-oriented
categories, high-priority rule metadata, task-like source labels, or explicit deadlines. Importance
is a ranking/display signal and does not by itself make a notification actionable.

`migrations/0012_connector_sync_attempts.sql` adds durable per-attempt connector sync logging. Gmail
manual Sync Now, Refresh All, scheduled sync, backfill, skipped fresh-lock attempts, partial
attempts, and failed attempts append user-scoped rows to `connector_sync_attempts`.

Each row stores account ID, connector key, trigger, active engine, status, start/completion time,
duration, safe error code/message, aggregate Gmail counts where available, and JSON details. Details
may include safe message IDs, outcome reasons, cursor-presence booleans, active/requested engine,
credential status, reconnect-required state, fresh-lock reference time, age, stale-lock threshold,
IMAP UID cursor details, comparison metrics, and failure names. It must not store OAuth tokens,
refresh tokens, provider credentials, raw MIME, email bodies, or attachment binaries.

`migrations/0013_d1_storage_retention.sql` enforces the D1 storage-retention boundary for preview
and production databases. It removes historically stored Gmail `normalized_body` fields from source
records while preserving snippets and body hashes, deletes expired OAuth state, trims old webhook
delivery rows, caps old sync-attempt diagnostics, and trims stale cursor-log rows while preserving a
large recent tail. `migrations/0014_sync_changes_tail_retention.sql` additionally caps the
rebuildable `sync_changes` cursor log to 10,000 recent rows and installs a trigger to maintain that
tail as calendar/account churn creates new rows. The scheduled Worker cron also runs the same D1
maintenance thresholds, so cleanup continues even when churn comes from routes that do not hit the
insert trigger frequently.

`migrations/0015_compact_sync_changes_payloads.sql` converts historical `sync_changes.payload_json`
from full entity snapshots into compact invalidation envelopes containing only type, operation,
entity ID, and user ID. New D1 writes use the same compact payload shape. `/v1/sync` hydrates live
upsert responses from the authoritative user-scoped tables, preserving client response shape without
using `sync_changes` as a user-data archive.

Active D1 user-content fields are encrypted at rest by the D1 adapter with `dlenc:v1.` AES-GCM
string envelopes or JSON wrappers containing `__dentlinkEncrypted`. `users.email` is now a
normalized-email SHA-256 lookup hash for new/backfilled rows, with the display email stored in
`users.encrypted_email`. Reads decrypt inside the Worker and keep the existing API response shape.
Text search over encrypted note fields falls back to authenticated post-decrypt filtering in the D1
adapter.

The content-encryption maintenance backfill is idempotent and bounded. It updates legacy plaintext
rows for users, notes, folders, tags, notifications, connector accounts/source records/sync
attempts, calendar events/annotations, note history/conflicts, preferences, and webhook names using
the Worker-bound content key. It does not expose plaintext or key material in API responses.

ADR `0012-zero-knowledge-user-data-archive.md` defines the stronger archive storage boundary:
archived user content uses client-held envelope encryption before D1/R2 direct access can be
considered unable to read user content. Active D1 rows use backend-held encryption at rest to
preserve current functionality and are not zero-knowledge.

`migrations/0017_user_encrypted_archive.sql` adds the additive archive foundation:

- `user_archive_key_wrappers`: user-scoped wrapped content encryption keys. Rows store wrapper
  ciphertext and public wrapper metadata only; the backend does not derive or unwrap archive keys.
- `user_archive_objects`: user-scoped encrypted object index rows. D1 stores object type, optional
  source entity reference, per-object encryption metadata, ciphertext hash, size, and R2 key. The
  encrypted envelope itself is stored under a user-scoped R2 prefix.

The archive tables do not change existing notes, notifications, calendar, Gmail, sync, or assistant
behavior. Client-held key creation/unlock/recovery remains required before active content can be
moved into zero-knowledge archive storage.
