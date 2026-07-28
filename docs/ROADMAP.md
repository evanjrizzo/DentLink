# Roadmap

## Milestone 0A: Documentation foundation

Status: in progress until accepted.

Scope:

- Establish product vision, principles, requirements, architecture, data model, API contract,
  security model, ranking model, roadmap, and ADR index.
- Record initial ADRs for the major architectural decisions.
- Do not scaffold applications, packages, migrations, connectors, authentication, Tauri, Android, or
  AI calls.

Exit criteria:

- The documentation set can guide implementation without relying on older dashboard projects.
- Non-negotiable boundaries are explicit.
- Initial ADRs are present and non-placeholder.

## Milestone 0B: Monorepo and tooling scaffold

Status: in progress until accepted.

Create the TypeScript monorepo structure, package manager setup, shared TypeScript config,
formatting/linting/test conventions, CI-ready commands, and empty package/app boundaries only where
justified by the documentation.

Scope:

- Create `apps/web` and `apps/api` package boundaries.
- Create shared packages for item model, API client, sync engine, UI, design tokens, ranking, AI,
  and connector SDK.
- Add pnpm workspace configuration, shared TypeScript config, formatting, linting, tests, CI,
  `.gitignore`, and names-only `.env.example`.
- Add package responsibility READMEs.
- Do not implement authentication, D1 schema, Notes, connectors, calendar providers, webhooks,
  Tauri, Android, or AI calls.

Exit criteria:

- Workspace packages can be installed and validated with one command.
- Package boundaries match accepted ADRs and foundation docs.
- Scaffold contains no product implementation beyond package boundary smoke tests.

## Milestone 1: Authentication and Notes vertical slice

Status: implemented.

Implement email/password authentication, server-resolved identity, sessions, initial notes API,
notes data model, conflict-aware note edits, and a minimal shared client path.

Implemented scope:

- Email/password registration and login.
- Secure password hashing with Web Crypto PBKDF2.
- Server-side session identity resolution.
- User-isolated Notes, folders, tags, sync, and conflicts.
- Task/reference notes with CRUD, one folder, multiple tags, pin, due date, priority, done, global
  ordering, history, search, versioned sync, optimistic concurrency, and conflict persistence.
- Responsive Notes UI shell with auth, folder/tag/search controls, task checkbox, pin, editing, and
  reorder controls.
- D1 migration for auth and manual Notes.
- Shared types, typed API client, sync helper, API validation, tests, and documentation.

Out of scope and still not implemented: email connectors, calendar providers, named webhooks, AI,
Tauri, and Android.

## Milestone 1.2: Runtime and deployment baseline

Status: implemented after Milestone 1.1.

Scope:

- Standardize on Node.js 22 and project-local Wrangler.
- Configure local, preview, and production Cloudflare Worker/D1 environments.
- Add CORS, health checks, deployment workflows, smoke tests, and deployment documentation.
- Do not add Milestone 2 product functionality.

Exit criteria:

- Local validation passes.
- CI validates Worker and D1 migration setup without production secrets.
- Preview and production workflows are explicit and safe.

## Milestone 1.3: Preview web deployment and browser verification

Status: implemented after Milestone 1.2.

Scope:

- Deploy the preview web client to Cloudflare Pages.
- Configure preview API CORS for the deployed web origin.
- Verify authentication, session restore, manual Notes workflows, and optimistic-concurrency
  behavior in a real browser against the preview API.
- Do not add Milestone 2 product functionality.

## Milestone 2: Named webhooks and Notifications

Status: implemented.

Implemented scope:

- User-scoped Notifications with list, create, pin, done, delete, global reorder, version checks,
  sync changes, and Ranking Mode dismiss.
- Named webhook endpoints with user-scoped slug uniqueness, one-time generated secrets, hashed
  secret storage, enabled/disabled state, destination mapping to notification or note creation, and
  last-triggered health metadata.
- Public webhook ingest endpoint using `X-DentLink-Webhook-Secret`, validated normalized payloads,
  accepted delivery recording, and per-endpoint accepted delivery rate limiting.
- D1 migration for notifications, webhook endpoints, webhook deliveries, and sync change support for
  notification/webhook changes.
- Shared types, typed API client methods, storage contract coverage for memory and D1 adapters, and
  web UI tabs for Notifications and Webhooks.

Out of scope and still not implemented: email connectors, calendar providers, provider OAuth, AI
calls, Tauri, Android, widgets, and richer ranking models.

## Milestone 2.1: Browser verification and webhook hardening

Status: implemented after Milestone 2.

Implemented scope:

- Repeatable Playwright browser verification against the deployed preview web and API environments.
- Browser coverage for authentication, session restore, Notes, Notifications, Ranking Mode dismiss
  gating, webhook creation, one-time secret display, copy feedback, endpoint disable/enable,
  endpoint deletion, invalid/missing secrets, notification and note webhook destinations, and
  logout/invalid-token behavior.
- Web UI hardening for request ordering, in-flight note mutation controls, notification
  create/delete/refresh, webhook copy/enable/delete/refresh controls, and stale webhook version
  retry.
- D1 webhook delete hardening for remote D1 responses that omit affected-row metadata.

Out of scope and still not implemented: Gmail, Google Calendar, Microsoft 365, IMAP, AI, Tauri,
Android, widgets, push notifications, provider connectors, and webhook provider templates.

## Milestone 3: Connector framework and integration plumbing

Status: implemented.

Implemented scope:

- Provider-neutral connector catalog contracts for future email and calendar families.
- User-scoped connector account metadata with status, health, sync state, settings, credential
  reference fields, version checks, sync changes, and soft deletion.
- User-scoped connector source records for normalized provider input bookkeeping.
- D1 migration and in-memory/D1 storage parity for connector account and source-record plumbing.
- API, typed client, shared model, connector SDK, storage contract tests, and smoke-test coverage.

Out of scope and still not implemented: Gmail API, Google Calendar API, Outlook, Microsoft Graph,
IMAP, AI summaries, ranking changes, mobile, desktop, widgets, and push notifications.

## Milestone 3.1: Gmail connector

Status: implemented.

Implemented scope:

- Gmail OAuth authorization start and callback endpoints with server-side CSRF state storage.
- Gmail account linking, reconnect, manual sync, status refresh, and disconnect using the Milestone
  3 connector account framework.
- Encrypted refresh-token storage in a separate connector credential table; connector accounts keep
  credential references only.
- Gmail metadata synchronization using history ID checkpoints, pagination-aware API clients,
  idempotent source-record ingestion, connector health/status transitions, and notification
  creation.
- Minimal web Connectors page for Connect Gmail, Sync Now, Reconnect, Disconnect, Last Sync, Status,
  Health, and Error display.

Out of scope and still not implemented: Google Calendar, Microsoft Graph, Outlook, IMAP, AI
summaries, attachments, email sending, notification ranking changes, widgets, desktop features,
Android, and push notifications.

## Milestone 4: Google Calendar connector

Status: implemented.

Implemented scope:

- Google Calendar OAuth authorization start and callback endpoints using server-side CSRF state
  storage.
- Google Calendar account linking, reconnect, manual sync, status refresh, and disconnect using the
  connector account framework.
- Encrypted refresh-token storage in the shared connector credential table.
- Primary calendar discovery, read-only event synchronization, incremental sync tokens,
  invalid-token recovery, pagination handling, idempotent provider-event upsert, and connector
  health/status transitions.
- Normalized agenda events for timed, all-day, cancelled, and recurring instances as returned by
  Google Calendar.
- Minimal Agenda UI for chronological events, all-day indicator, time range, location, provider
  source link, Refresh, Sync Now, and local dismissal.

Out of scope and still not implemented: ICS import/export, local event creation, Google event
editing, RSVP, attendee management, Microsoft Graph, Outlook, IMAP, AI summaries, push
notifications, widgets, Tauri, and Android.

## Milestone 5: Calendar foundation and ICS

Status: implemented.

Implemented scope:

- DentLink-owned local calendar events with CRUD, version checks, user isolation, all-day support,
  timezone metadata, simple RRULE recurrence storage, category/color fields, reminder metadata, and
  soft deletion.
- ICS import/export for authenticated DentLink Local events, including timed events, all-day events,
  descriptions, locations, safe URLs, imported UID deduplication, and recurrence preservation where
  supported.
- DentLink-only annotations for provider events: notes, pinned, completed, hidden, and tags without
  mutating Google Calendar.
- Calendar source filters for all sources, Google Calendar, and DentLink Local.
- Agenda, Day, Week, and Month browser views with date navigation, source distinction, local event
  editing controls, provider read-only behavior, annotation controls, and ICS import/export
  controls.
- D1 migration and memory/D1 storage parity for local events, annotations, source-filtered range
  listing, sync changes, and duplicate-safe ICS import.

Out of scope and still not implemented: Google Calendar writeback, provider event creation or
editing, attendee management, CalDAV, remote ICS subscriptions, Microsoft Graph, Outlook, IMAP, AI
summaries, reminder delivery, push/email/SMS notifications, drag-and-drop scheduling, mobile,
desktop, widgets, and production deployment. Future providers

Calendar Annotations Allow users to add DentLink-only metadata to imported events: notes pinned
completed hidden tags without modifying Google.

ICS Import upload .ics parse import into local calendar Export export local events optionally export
annotations No CalDAV. No provider sync.

API CRUD local events import endpoint export endpoint filter endpoint

Tests

Browser API ICS parser Timezone handling

Recurring events

## Milestone 6 (DEFER UNTIL LATER): Microsoft and IMAP

Add Microsoft 365 Mail, Microsoft 365 Calendar, and IMAP connectors with provider-specific
capability handling behind the connector abstraction.

## Milestone 6.5: Android mobile app and tabbed widget

Status: planned.

Scope:

- Add the Android-first mobile app boundary.
- Reuse shared item models, API contracts, sync behavior, and DentLink design tokens.
- Store mobile sessions in Android secure storage and keep a local authenticated cache.
- Queue versioned optimistic mutations while offline and reconcile through backend sync.
- Build a native Android multiple-tab widget with `Calendar`, `Notes`, and `Emails` tabs.
- Match the PC/web DentLink color scheme, font stack, logo assets, source accents, and compact card
  treatment.
- Support widget refresh, app/source opening where possible, quick note, note done, and contextual
  notification Complete/Dismiss actions through DentLink APIs.

Out of scope:

- Direct Gmail, Google Calendar, or provider polling from Android.
- Android-authoritative ranking or ordering.
- Push notifications, provider writeback, voice capture, Pebble capture, and arbitrary desktop/local
  actions.

## Milestone 7: Unified Dashboard, Ranking, and AI Assistance

Status: in progress after Milestone 6 is deferred. Slices through 4.3 are implemented on the
development branch.

Objective

Transform DentLink from a collection of independent Notes, Notifications, Gmail, and Calendar views
into a unified, prioritized personal dashboard.

Milestone 7 focuses on three areas:

reliable notification ingestion unified ranking across all sources optional AI-powered summarization
and classification

Microsoft 365, Outlook, and IMAP remain deferred under Milestone 6.

Phase 1: Notification Reliability

Before introducing AI, ensure Gmail synchronization is complete, deterministic, and observable.

Implemented slices now include Gmail API diagnostics, Gmail backfill as a low-priority maintenance
tool, deterministic Gmail rules, preview Gmail IMAP engine selection, and live-dashboard refresh
behavior. Gmail sync attempts are now durably logged for manual Sync Now, scheduled sync, Refresh
All, backfill, skipped fresh-lock attempts, partial attempts, and failed attempts, with safe details
available in Connections diagnostics and JSON export. Slice 3.5 adds an authenticated metadata-only
DentLink event stream, polling fallback, visibility refresh, and `Refresh All` orchestration across
connected supported services without moving provider polling into the browser.

Slice 4 adds user-manageable email sorting rules, normalized IMAP email metadata, optional
server-side OpenAI summarization/classification, AI usage accounting, explainable notification
sorting modes, and a more organized Connections view with collapsible Gmail, Google Calendar, and
Webhook sections. Slice 4.2 makes the web UI responsive and touch-first across mobile, the 1280x720
dashboard, and desktop, with advanced Notes, Agenda, connection, and diagnostic controls behind
adaptive sheets, panels, Settings, or Debug Mode. AI summaries default to enabled when an OpenAI key
is configured and remain user-disableable in Settings.

Slice 4.3 refines daily notification actions and adaptive surfaces. Notification cards expose
compact contextual actions: Pin/Unpin and Dismiss are always available, source opening appears when
a source URL exists, and Complete appears only when existing rule, AI, deadline, category, or
task-type signals mark the item actionable. Complete moves an item to History as completed and
records completion time; Dismiss moves it to History as dismissed and records dismissal time.
Restore returns either state to Active and clears the corresponding completion or dismissal marker
through the existing notification status model. Adaptive panels use tokenized width and height
rules, choose bottom-sheet mode for phone, narrow landscape, and short 1280x720 layouts, and use
wider right-side panels only when the panel and remaining main content are both usable. The Notes
view keeps completed notes visible by default, provides a local Filters checkbox to hide or show
them, sorts completed notes after active notes within their folder, and sizes card completion
checkboxes for touch use while preserving backend-owned note status.

Scope

Implement:

complete Gmail pagination incremental history synchronization validation duplicate prevention
idempotent notification creation robust HTML and multipart email parsing retry handling for partial
sync failures sync diagnostics per-message processing status browser regression coverage for large
mailboxes

Each processed Gmail message must end with one of:

notification created notification updated skipped duplicate filtered failed

with an associated reason.

Healthy connector status alone must never imply successful ingestion.

Phase 2: Unified Notification Model

Refine Notifications into DentLink's primary information stream.

Supported sources:

Gmail Webhooks Google Calendar Local Calendar Future providers

Every notification should share a common model regardless of origin.

Common fields include:

title summary source source identifier timestamp priority tags pinned completed hidden dismissed
ranking score explanation AI metadata

Notifications become the central object presented to the user.

Phase 3: User Filtering Rules

Implement deterministic filtering before AI.

Supported rule types:

sender sender domain recipient subject contains Gmail labels attachment presence mailing list
detection automated sender detection keyword matching include rules exclude rules always notify
never notify

Rules execute before AI.

Every notification should expose why it was shown or hidden.

Phase 4: Optional AI Processing

Introduce an optional provider-neutral AI layer.

Implemented in Slice 4 for Gmail IMAP notifications as an optional post-rule enrichment step. AI is
available when server-side configuration supplies an OpenAI key and defaults to enabled unless the
user opts out or the server explicitly disables AI. Failures are recorded on the notification and do
not block ingestion.

Requirements:

enabled by default when an OpenAI key is configured, user-disableable in Settings OpenAI API key
stored server-side provider-neutral AI interface configurable model selection graceful degradation
if unavailable AI failure never blocks synchronization

Initial capabilities:

Email summarization

Produce concise summaries suitable for dashboard display.

Classification

Predict:

importance category requires action deadline detected newsletter receipt personal work Suggested
action

Examples:

Reply Review Schedule Ignore Archive Explainability

Every AI result should include a brief explanation.

Example:

High priority because your manager requested a response before Friday.

Phase 5: Unified Ranking

Replace chronological ordering with explainable ranking.

Ranking inputs include:

due dates deadlines sender importance pinned state user feedback completion state calendar proximity
AI importance deterministic rules recency

Every ranked item should expose:

overall score contributing factors ranking explanation

Example:

Ranked #2 because it contains a deadline tomorrow, is from a starred sender, and requires action.

Phase 6: Unified Dashboard

Create DentLink's primary landing page.

Sections:

Today's schedule High-priority notifications Upcoming calendar events Overdue tasks Pinned notes
Recently completed items

Support:

cross-source search source filters quick complete quick dismiss quick pin quick open

The dashboard becomes the default home screen.

Phase 7: AI Usage and Settings

Add configuration for:

AI enable/disable selected provider selected model monthly usage estimated token cost processing
status privacy controls resend for AI processing Exit Criteria Gmail sync reliably processes every
eligible message. Large mailboxes synchronize without duplicates or missing messages. Every
notification has a recorded processing outcome. Deterministic filtering works before AI. AI
summaries and classifications are optional. AI failures never interrupt synchronization. Users can
explain why every notification was shown or hidden. Notifications from Notes, Gmail, Webhooks, and
Calendar participate in the same ranking system. The Dashboard becomes the default landing page.
Existing authentication, Notes, Calendar, connector, and synchronization tests continue to pass.

## Milestone 8: Tauri desktop and local agent

Build the desktop client around shared UI, preserve touchscreen/fullscreen workflows, and add
trusted local capability layers for desktop-only actions.

## Milestone 9: Android app and native widget

Build Android surfaces, widget views, quick note, done, refresh, and source opening where possible.

## Milestone 10: Compatibility testing and migration

Validate behavior against previous reference systems, test multi-client sync, harden migration
paths, and prepare operational runbooks.
