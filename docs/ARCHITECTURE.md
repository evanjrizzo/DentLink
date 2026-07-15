# Architecture

```text
Sources → Connectors → Normalization → Rules/Ranking → Optional AI → Central DB/API → Clients
```

## System boundary

DentLink is an independent platform. It must not depend on Odysseus or any previous dashboard
runtime. Legacy projects may inform behavior, but they are not part of the runtime architecture.

## Ownership

The backend owns normalized items, status, pin state, global order, rank, rules, annotations,
connector state, conflicts, and sync cursors. Providers remain authoritative for original email and
calendar content.

Clients own presentation, local cache, optimistic UI state, and platform-specific capability
adapters. Clients must reconcile with the backend before claiming authoritative state.

Initial platform: Cloudflare Workers, D1, Queues, Cron Triggers, and later R2 if needed.

Shared client layers: TypeScript item model, API client, sync engine, React components, and design
tokens.

Platform layers: Tauri desktop shell, native Android widget, Android services, and trusted desktop
agent.

Connectors run in cloud, local agents, or external services depending on capability. Clients never
poll providers directly.

Clients use cursor-based incremental sync and optimistic versioned mutations. Conflicts are
persisted and surfaced.

## Ingestion pipeline

All provider polling, push subscriptions, named webhooks, manual submissions, and trusted agent
submissions enter the same normalization pipeline:

1. Receive raw source data.
2. Validate authentication, authorization, rate limits, and payload shape.
3. Store or reference raw data according to retention rules.
4. Normalize into shared item structures.
5. Apply deterministic rules.
6. Apply user rules.
7. Calculate base rank.
8. Optionally perform bounded AI enrichment.
9. Persist normalized state.
10. Emit a sync change.

## Connector architecture

A connector defines its manifest, authentication method, permissions, settings schema, polling or
webhook behavior, normalization, supported actions, health reporting, retry and backoff behavior,
and version.

Cloud connectors run in the backend where practical. Local or device-specific integrations run
through trusted local agents. The primary Worker must not execute arbitrary third-party connector
code.

Milestone 3 implements the framework pieces only: generic connector definitions, account metadata,
source-record bookkeeping, storage adapters, sync changes, and typed API/client contracts. Real
provider connectors such as Gmail or calendar providers must plug into this framework in later
milestones instead of adding special-case API routes or storage paths.

Milestone 3.1 adds Gmail as the first provider connector. Gmail uses the connector account,
credential, source-record, health, and sync-state plumbing rather than separate provider-specific
user data paths. OAuth callbacks link accounts server-side, encrypted refresh tokens live in
connector credential storage, and Gmail messages are normalized into source records before creating
DentLink notifications.

Milestone 7 Phase 1 hardens Gmail ingestion before dashboard, ranking, or AI work. Each fetched
Gmail message now records a source-record processing outcome such as `notification_created`,
`duplicate`, or `failed` with a reason. Partial per-message failures do not hide successful
notifications; the connector reports degraded health and keeps the failed source record visible for
diagnostics and retry analysis. The Gmail connector card reads provider-specific diagnostics through
the API client and displays aggregate sync counts plus recent source-record outcomes; clients still
do not poll Gmail directly or infer authoritative ingestion health locally.

Milestone 7 Slice 2.1 added Gmail backfill as a separate diagnostic action from incremental sync,
but it is no longer the primary product recovery path. Backfill remains duplicate-safe through
source records and does not reset notifications or the incremental history checkpoint.

Milestone 7 Slice 3 starts deterministic Gmail handling before any AI or ranking work. A Worker cron
trigger runs incremental Gmail sync every five minutes for connected, idle Gmail accounts. Gmail
rules are evaluated in the backend before Notification creation and can notify, suppress, change
priority, or assign a category using normalized sender, subject, label, recipient, unread,
attachment, automated-sender, and mailing-list metadata. Every fetched message still resolves to a
source-record outcome, including `notification_suppressed` when a rule intentionally prevents a
Notification.

Milestone 7 Slice 3.2 begins a controlled Gmail IMAP migration. Gmail connector accounts now support
an `ingestionEngine` setting with `gmail_api` as the default and `gmail_imap` as an explicit
per-account opt-in. IMAP ingestion uses Worker TLS sockets, Gmail XOAUTH2, `SELECT INBOX`, a rolling
recent-window `UID SEARCH`, bounded MIME fetches, and the existing deterministic-rule and
Notification pipeline. Existing Gmail API accounts are not switched automatically; IMAP accounts
must reconnect with the `https://mail.google.com/` scope and pass an IMAP capability check before
the credential is accepted. IMAP duplicate prevention prefers `X-GM-MSGID`, then `Message-ID`, then
a mailbox UID fallback.

Milestone 7 Slice 3.3 makes the IMAP engine selectable in preview without manual database edits. The
selector persists a requested engine separately from the active engine so a failed IMAP reconnect
does not silently switch ingestion away from Gmail API. Once reconnect succeeds, Sync Now and the
scheduled Worker cron use the active engine. IMAP comparison mode is diagnostic-only: it runs Gmail
API discovery after IMAP and stores comparison metrics without creating duplicate Notifications.

Milestone 7 Slice 3.5 makes the web app behave more like a live dashboard without moving provider
polling into the browser. The backend exposes a provider-neutral `sync-all` action that runs
supported connected connector syncs independently and returns aggregate success, partial, or failed
results. The web app has one refresh coordinator for Refresh All, individual Sync Now completion,
OAuth return, visibility changes, push events, and polling fallback. A metadata-only authenticated
event stream watches DentLink sync changes and emits change hints such as `notifications_updated`,
`calendar_updated`, and `connectors_updated`; clients then fetch normal API resources through the
existing contracts.

Milestone 7 Slice 4 keeps deterministic email rules as the correctness boundary and adds optional
provider-neutral AI enrichment after rule evaluation. IMAP messages are normalized into safe email
metadata plus bounded plain text, with text/plain preferred and cleaned HTML text used only as a
fallback. Rules can match sender, domain, recipients, subject, labels, unread state, attachment
presence, automated senders, mailing-list signals, body text, and always/never notify flags before a
Notification is created. If an OpenAI key is configured server-side, AI is available and defaults
to enabled for users unless they explicitly opt out in Settings -> AI. Non-suppressed notifications
may receive a structured summary, category, importance, suggested action, deadline, and explanation.
AI failures update AI metadata on the notification and usage counters but do not fail Gmail
ingestion or change connector health.

Milestone 4 adds Google Calendar using the same provider-neutral connector framework. Google
Calendar OAuth links a calendar connector account, encrypted refresh tokens remain in connector
credential storage, and synced event instances are normalized into `calendar_events` plus connector
source records. Google Calendar remains authoritative: DentLink supports agenda viewing and local
agenda dismissal only, not provider event creation, editing, deletion, RSVP, or attendee management.

Milestone 5 adds a provider-neutral local calendar foundation on top of the Google Calendar agenda.
DentLink Local events use the shared normalized calendar event envelope with `source = 'local'`,
versioned mutations, soft deletion, sync changes, and ICS import/export. Google Calendar events stay
read-only provider rows with `source = 'google-calendar'`; DentLink-only annotations are stored
separately so sync refreshes cannot overwrite user notes, hidden/completed state, pins, or tags.
Calendar views are source-filtered by the normalized source value so future calendar providers can
join the same listing contract without hardcoded Google-only UI logic.

ICS import is file-content based in Milestone 5. The backend parses bounded user-submitted ICS text
into DentLink Local events and does not fetch remote ICS URLs, subscribe to CalDAV, or write back to
providers. Export emits DentLink Local events by default and does not reclassify provider events as
DentLink-owned content.

## Sync architecture

Clients use cursor-based incremental synchronization, optimistic local updates, offline mutation
queues, retry, conflict detection, and server reconciliation. Sync responses contain normalized
records and enough metadata for clients to update local caches without recalculating authoritative
rank.

## Platform capability layers

Shared UI can request capabilities such as opening a source, invoking a desktop action, or launching
a mobile intent through typed adapters. Capability implementations are platform-local and cannot be
invoked directly by the cloud backend.
