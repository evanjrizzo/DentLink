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
- `/v1/notifications/*`: list, source inbox search, mark done, pin, reorder, dismiss, restore, and
  soft delete.
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
- `GET /v1/events`: authenticated Server-Sent Events stream for DentLink-owned change metadata.
  Events include only safe hints such as change type, source, account ID, and revision; clients
  refresh normal API resources after receiving an event.
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
- Gmail-derived notification responses may include provider-neutral `email`, `rule`, and `ai`
  metadata. `email` contains sender, recipient, subject, timestamp, label, attachment metadata, and
  a bounded snippet, not attachment binaries. `rule` explains the deterministic rule decision. `ai`
  reports optional summary/classification state as `disabled`, `pending`, `complete`, `failed`, or
  `skipped`.
- Notification status values keep their existing API representation. `active` appears in the normal
  Notifications list. `done` means the user completed the required action and storage sets
  `completedAt`. `dismissed` means the user removed the item from Active without claiming
  completion and storage sets `dismissedAt`. `deleted` is soft-deleted. Restoring a completed or
  dismissed item uses `PATCH /v1/notifications/:id` with `status: "active"` and clears the
  applicable timestamp through the existing storage behavior. Slice 4.3 changed the web action
  model only; it added no notification endpoint or migration.
- `GET /v1/ai/settings`: return authenticated user's server-side email AI availability, effective
  enabled state, provider/model, input limit, unavailable reason when applicable, and monthly usage
  counters. It never returns `OPENAI_API_KEY` or provider credentials.
- `PATCH /v1/ai/settings`: persist the authenticated user's explicit AI enabled/disabled
  preference. New users and existing users with no preference default to enabled when
  `OPENAI_API_KEY` is configured and the server has not disabled AI.
- `GET /v1/webhooks`: list authenticated user's named webhook endpoints. Responses include
  `ingestUrl` but never include the endpoint secret or secret hash.
- `POST /v1/webhooks`: create a named webhook endpoint. The response returns the generated webhook
  secret once, alongside the public endpoint record and `ingestUrl`.
- `PATCH /v1/webhooks/:id`: update an authenticated user's webhook endpoint with `expectedVersion`.
- `DELETE /v1/webhooks/:id`: delete an authenticated user's webhook endpoint with `expectedVersion`.
  Deleted endpoints are removed from authenticated listings and cannot ingest new deliveries.
- `POST /v1/ingest/webhooks/:slug`: public ingest route for enabled webhook endpoints.

Webhook ingest requests authenticate with `X-DentLink-Webhook-Secret`. The slug is not treated as a
secret. The raw secret is hashed before lookup, and only the hash is stored. Missing secrets return
`401`; unknown, disabled, or wrong-secret endpoints return `404`; accepted deliveries return `202`.
Endpoints are currently limited to 60 accepted deliveries per minute per endpoint. Accepted
deliveries are not idempotency-keyed in Milestone 2.1, so callers that replay the same request with
the same secret should expect another accepted delivery until a later idempotency contract exists.

Webhook endpoints route payloads to one of two destinations:

- `notification`: creates a normalized notification with source `webhook` and source label from the
  endpoint name.
- `note`: creates a task/reference note using the endpoint defaults and submitted note fields.

Notification and webhook changes are included in `/v1/sync` through the same numeric cursor log used
by Milestone 1. Notification and webhook deletes are emitted as tombstones. Webhook secrets and
hashes are never included in sync payloads.

## Milestone 3 endpoints

Milestone 3 adds provider-neutral connector plumbing without adding any real provider integration.
The catalog intentionally exposes generic connector families only; provider keys such as `gmail`,
`google-calendar`, `outlook`, `microsoft-graph`, and `imap` are rejected until later milestones
implement those connectors through the framework.

- `GET /v1/connectors/catalog`: list safe connector definitions, auth type, capabilities, and
  settings schema. Requires authentication.
- `GET /v1/connectors/accounts`: list the authenticated user's non-deleted connector accounts.
- `POST /v1/connectors/sync-all`: run manual sync for connected supported connector accounts,
  continue after per-connector failures, and return an aggregate `success`, `partial`, or `failed`
  result with safe per-connector counts. Gmail and Google Calendar are currently supported.
- `POST /v1/connectors/accounts`: create a connector account metadata record for a catalog key.
- `PATCH /v1/connectors/accounts/:id`: update account metadata with `expectedVersion`.
- `DELETE /v1/connectors/accounts/:id`: soft-delete an account with `expectedVersion`.
- `GET /v1/connectors/accounts/:id/source-records`: list normalized source records for an owned
  connector account.
- `POST /v1/connectors/source-records`: create a normalized source-record bookkeeping entry for an
  owned non-deleted connector account.

Connector account responses may include `credentialRef` and `credentialStatus`, but never include
raw provider credentials, OAuth tokens, refresh tokens, passwords, salts, hashes, or authorization
headers. Source records store normalized payloads only; raw provider payload retention is reserved
for future connector-specific storage decisions.

Connector account mutations participate in `/v1/sync` as `connector_account` upserts and delete
tombstones. Source records are user-scoped bookkeeping records and are not promoted into user-facing
items by Milestone 3.

## Milestone 3.1 Gmail endpoints

Milestone 3.1 adds Gmail as the first real provider through the connector framework. It does not add
Google Calendar or any other Google service.

- `POST /v1/connectors/gmail/start`: authenticated OAuth initiation. Optional query parameters:
  `returnTo` and `accountId` for reconnect. Returns an authorization URL and state expiration. The
  state value is stored server-side as a hash.
- `GET /v1/connectors/gmail/callback`: public OAuth callback. Validates state, exchanges the code,
  links or reconnects the Gmail account, stores the encrypted refresh token, and redirects to a safe
  `returnTo` URL when present. JSON clients may send `Accept: application/json`.
- `POST /v1/connectors/gmail/:accountId/sync`: authenticated manual Gmail sync for an owned Gmail
  connector account. The default `gmail_api` engine is incremental and uses Gmail history IDs when a
  checkpoint exists. The preview-only `gmail_imap` engine uses a rolling recent-window IMAP scan.
- `POST /v1/connectors/gmail/:accountId/backfill`: authenticated backfill for an owned Gmail
  connector account. It scans at least the last 30 days through Gmail message-list pagination and
  does not reset existing notifications or the incremental history checkpoint.
- `GET /v1/connectors/gmail/:accountId/diagnostics`: authenticated diagnostics for an owned Gmail
  connector account. Returns aggregate processing counts and recent per-message outcomes without raw
  email bodies.
- `PUT /v1/connectors/gmail/:accountId/engine`: authenticated update of the Gmail ingestion engine
  for an owned Gmail connector account. Body includes `expectedVersion`, `engine` (`gmail_api` or
  `gmail_imap`), and optional `comparisonMode`. Selecting IMAP without a verified IMAP credential
  records a pending selection and reconnect requirement; it does not activate IMAP until OAuth
  reconnect succeeds.
- `GET /v1/connectors/gmail/:accountId/rules`: authenticated read of deterministic Gmail rules for
  an owned Gmail connector account.
- `PUT /v1/connectors/gmail/:accountId/rules`: authenticated replacement of deterministic Gmail
  rules. Rules are evaluated before Notification creation.
- `POST /v1/connectors/gmail/:accountId/disconnect`: authenticated disconnect. Removes stored
  connector credentials and leaves the metadata account paused.

Generic `POST /v1/connectors/accounts` rejects `connectorKey: "gmail"`; Gmail accounts must be
linked through OAuth.

Gmail sync stores normalized source records with provider metadata, including `provider`,
`provider_item_id`, `history_id`, `thread_id`, `message_id`, `internal_date`, `labels`, `permalink`,
and `connector_account`. Gmail-created notifications use source `connector`, source label `Gmail`,
the sender and subject, unread state in summary text, received timestamp metadata in the source
record, and a Gmail deep link. The Gmail API engine does not download message bodies or attachments.
The IMAP engine may fetch bounded MIME content for parsing, but diagnostics and Notifications still
store only normalized metadata and attachment metadata.

The Gmail connector explicitly requests the read-only Gmail scope:

```text
https://www.googleapis.com/auth/gmail.readonly
```

Google Cloud OAuth consent configuration must include this scope, but the application must still
request it in the authorization URL. DentLink does not request `gmail.modify`. The prior
`gmail.metadata` scope is insufficient for backfill because Gmail API `users.messages.list` rejects
the `q` search parameter when accessed with `gmail.metadata`.

Milestone 7 Slice 3.2 adds a preview-only Gmail IMAP ingestion engine behind connector account
settings. Slice 3.3 exposes account-level engine selection. IMAP accounts require a reconnect that
explicitly requests:

```text
https://mail.google.com/
```

Existing Gmail API accounts are not migrated automatically. Selecting IMAP first sets
`gmailRequestedIngestionEngine = "gmail_imap"` and `gmailReconnectRequired = true`; the active
`gmailIngestionEngine` remains unchanged until reconnect succeeds. A successful IMAP reconnect means
the new credential was granted the IMAP scope and passed a server-side IMAP login/capability check.

Milestone 7 Phase 1 extends Gmail sync responses with per-message processing outcomes while keeping
the same endpoint:

- `processed`: number of Gmail message IDs attempted.
- `createdNotifications`: number of DentLink notifications newly created.
- `summary`: aggregate counts for `discovered`, `examined`, `created`, `updated`, `duplicate`,
  `skipped`, `filtered`, and `failed`.
- `outcomes`: ordered entries containing `messageId`, `status`, `reason`, and `recordId`.

Outcome `status` values are `notification_created`, `notification_updated`,
`notification_suppressed`, `notification_grouped`, `skipped`, `duplicate`, `filtered`, and `failed`.
Source records expose the same final processing status plus `processingReason`, `processedAt`, and
`errorMessage` for failures. A sync with partial message failures returns `200` with connector
`healthStatus = "degraded"` and a stable `errorCode = "gmail_partial_sync_failed"`; global provider,
credential, or database failures still return normal API errors and set connector sync status to
`error`.

Deterministic Gmail rules support name, enabled state, priority/order, `all` or `any` match mode,
sender address, sender domain, subject contains, body contains, Gmail/IMAP label, recipient,
attachment presence, unread state, automated sender detection, mailing-list detection,
always-notify, and never-notify predicates. Actions are `notify`, `suppress`, `low_priority`,
`high_priority`, `assign_category`, and `assign_tag`. Rules execute before Notification creation and
before optional AI. Suppressed messages create source records with `notification_suppressed` and no
DentLink Notification; created Notifications copy matched rule metadata into the source record and
notification metadata.

Optional email AI processing runs when `OPENAI_API_KEY` is configured and the user has not disabled
AI in Settings -> AI. `DENTLINK_AI_ENABLED=false` disables AI globally; otherwise users default to
enabled. It uses `DENTLINK_AI_MODEL` and `DENTLINK_AI_MAX_INPUT_CHARS` when set. AI receives bounded
normalized subject, sender, labels, timestamp, and body text only after deterministic rules have
allowed notification creation. Invalid, timed-out, or rate-limited AI output records
`ai.status = failed` and preserves the notification and Gmail connector health.

The Worker also runs scheduled Gmail synchronization every five minutes for connected, idle Gmail
accounts. Scheduled sync uses the account's selected ingestion engine. `gmail_api` accounts use the
history-checkpoint path; `gmail_imap` accounts use a duplicate-safe rolling recent-window scan.

Incremental Gmail API sync advances `syncCursor` only when all discovered message IDs finish without
a per-message failure. Backfill remains duplicate-safe through source-record identity but is no
longer exposed as the normal user recovery path. IMAP recovery relies on rolling scans and source
record uniqueness.

The diagnostics endpoint returns:

- `account`: the safe connector account metadata.
- `summary`: aggregate counts derived from Gmail source-record outcomes.
- `messages`: recent entries with Gmail message ID, outcome, processing reason, processed timestamp,
  linked DentLink notification ID where present, and source record ID.

Connector settings additionally store engine-aware diagnostics for the connector card: selected and
active engine, last sync timestamp, duration, scanned count, processed count, notifications created,
duplicates, suppressed count, failures, last successful sync, average sync time, expected messages,
actual notifications, and missing-message difference. Preview comparison mode stores the latest
Gmail API discovery count beside IMAP discovery, created, duplicate, and failure counts without
creating Gmail API notifications.

## Milestone 4 Google Calendar endpoints

Milestone 4 adds Google Calendar as a read-only calendar connector through the same connector
framework. It does not add event creation, editing, deletion, RSVP, attendee management, Microsoft
Graph, Outlook, IMAP, push notifications, widgets, or AI behavior.

- `POST /v1/connectors/google-calendar/start`: authenticated OAuth initiation. Optional query
  parameters: `returnTo` and `accountId` for reconnect. Returns an authorization URL and state
  expiration. The state value is stored server-side as a hash.
- `GET /v1/connectors/google-calendar/callback`: public OAuth callback. Validates state, exchanges
  the code, discovers the primary calendar, links or reconnects the connector account, stores the
  encrypted refresh token, runs the initial read-only event sync, and redirects to a safe `returnTo`
  URL when present. JSON clients may send `Accept: application/json`.
- `POST /v1/connectors/google-calendar/:accountId/sync`: authenticated manual sync for an owned
  Google Calendar connector account.
- `POST /v1/connectors/google-calendar/:accountId/disconnect`: authenticated disconnect. Removes
  stored connector credentials and leaves the metadata account paused.
- `GET /v1/calendar/events`: list the authenticated user's upcoming, non-dismissed normalized
  calendar events in chronological order.
- `PATCH /v1/calendar/events/:eventId`: update DentLink-local agenda state with `expectedVersion`.
  Milestone 4 accepts only `status: "dismissed"` or `status: "active"`.

Generic `POST /v1/connectors/accounts` rejects `connectorKey: "google-calendar"`; Google Calendar
accounts must be linked through OAuth.

Google Calendar sync stores normalized source records with provider metadata, including provider,
provider item ID, calendar ID, calendar summary, recurrence identifiers where provided, permalink,
and connector account. Normalized agenda events include all-day/timed start and end fields,
location, status, provider deep link, and source calendar label. Cancelled events are preserved with
`status: "cancelled"`. Agenda dismissal hides the DentLink copy from agenda listing only and does
not modify or delete the Google event.

The Google Calendar connector uses the read-only Calendar scope:

```text
https://www.googleapis.com/auth/calendar.readonly
```

## Milestone 5 calendar foundation and ICS endpoints

Milestone 5 keeps Google Calendar read-only and adds DentLink-owned local calendar events, ICS file
import/export, source filters, and DentLink-only annotations on provider events.

- `GET /v1/calendar/events`: list normalized calendar events for the authenticated user. Supports
  bounded `timeMin`, `timeMax`, `source=all|google-calendar|local`, and `includeHidden=true`.
- `POST /v1/calendar/events`: create a DentLink Local calendar event. The server resolves ownership
  and rejects client-supplied provider ownership fields.
- `GET /v1/calendar/events/:eventId`: read one authenticated user's calendar event.
- `PATCH /v1/calendar/events/:eventId`: update DentLink-local agenda state with `expectedVersion`;
  provider-owned content fields remain read-only.
- `PATCH /v1/calendar/local-events/:eventId`: update editable DentLink Local event fields with
  `expectedVersion`.
- `DELETE /v1/calendar/local-events/:eventId`: soft-delete a DentLink Local event with
  `expectedVersion`.
- `PATCH /v1/calendar/events/:eventId/annotation`: upsert DentLink-only annotations for any owned
  normalized event. Supported fields are `notes`, `pinned`, `completed`, `hidden`, and `tagIds`.
- `POST /v1/calendar/ics/import`: import posted ICS text into the authenticated user's DentLink
  Local calendar. The request body is `{ "ics": "BEGIN:VCALENDAR..." }` and is size-limited.
- `GET /v1/calendar/ics/export`: export DentLink Local events in the requested bounded date range as
  `text/calendar` with an attachment disposition.

Local event recurrence is stored as RFC 5545 RRULE text when supported. ICS import preserves UID,
description, location, safe URL, all-day dates, timezone metadata, and recurrence where recognized.
Unsupported recurrence metadata is reported as an import warning rather than silently promoted into
provider-owned state.

Provider-owned Google Calendar events can be hidden, completed, pinned, tagged, or annotated inside
DentLink, but their title, time, recurrence, location, URL, and source calendar fields cannot be
edited through Milestone 5 APIs.
