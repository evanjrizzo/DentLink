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

## Milestone 4: Calendar foundation and ICS

Implement calendar data model, DentLink-local events, ICS import/export, agenda/grid views,
filtering, annotations, and agenda-only dismissal.

## Milestone 5: Microsoft and IMAP

Add Microsoft 365 Mail, Microsoft 365 Calendar, and IMAP connectors with provider-specific
capability handling behind the connector abstraction.

## Milestone 6: Ranking and optional AI

Implement richer explainable ranking, feedback loops, ranking explanations, optional OpenAI provider
integration, usage accounting, provider-neutral AI interface, and approved task suggestions.

## Milestone 7: Tauri desktop and local agent

Build the desktop client around shared UI, preserve touchscreen/fullscreen workflows, and add
trusted local capability layers for desktop-only actions.

## Milestone 8: Android app and native widget

Build Android surfaces, widget views, quick note, done, refresh, and source opening where possible.

## Milestone 9: Compatibility testing and migration

Validate behavior against previous reference systems, test multi-client sync, harden migration
paths, and prepare operational runbooks.
