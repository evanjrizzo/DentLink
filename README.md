# DentLink

DentLink is a unified personal information hub that aggregates, organizes, ranks, and presents
information from independent systems without replacing them.

It answers one product question: what do I need to know, do, or review right now?

DentLink is a new, independent platform. It must not depend on Odysseus, the previous desktop
dashboard, the previous cloud dashboard, or the Android widget projects. Those systems may be
inspected only as behavioral references.

## Current status

Milestone 7 Slice 4.3: authentication, manual Notes, named webhook ingestion, Notifications,
provider-neutral connector plumbing, Gmail API fallback, preview Gmail IMAP ingestion, read-only
Google Calendar synchronization, DentLink Local calendar events with ICS import/export, email
rules, optional AI summaries, live refresh, and the responsive touch-first web UI.

This repository contains the pnpm TypeScript workspace, shared package boundaries, a Worker-style
API handler, Cloudflare D1 storage adapter, D1 migrations for auth, notes, notifications, and
webhooks, connector framework tables, encrypted Google credential storage, shared
auth/note/notification/sync/conflict types, a typed API client, a small sync helper, and a
responsive web UI shell. It does not yet contain Microsoft 365, Outlook, production IMAP rollout,
Tauri, Android, push notifications, widgets, or Google Calendar writeback.

## Product shape

DentLink has three primary user-facing sections:

- Notifications: ranked externally sourced information, such as email summaries, webhook alerts,
  connector alerts, reminders, and future phone notifications. Normal cards use contextual compact
  actions: pin/unpin, dismiss, source open when available, and Complete only for actionable items.
  Complete means handled and Dismiss means remove from active without implying completion; both move
  to History and can be restored.
- Notes: manual or captured tasks and reference notes, with folders, tags, due dates, priorities,
  source links, and completion history.
- Calendar: unified events from providers, ICS files, and DentLink-local entries, with agenda and
  grid views. Google Calendar provider events remain read-only; DentLink-only annotations and agenda
  dismissal do not mutate Google Calendar.

## Planned sources

Gmail API, preview Gmail IMAP, Microsoft 365 Mail, generic IMAP, Google Calendar, Microsoft 365
Calendar, ICS, named webhooks, manual entries, and future local/device agents.

## Planned clients

Web, desktop, Android app, and Android homescreen widget.

## Repository layout

```text
apps/
  api/                 Worker-style auth, Notes, Notifications, and webhook API boundary
  web/                 Browser Notes, Notifications, and webhook management client shell
packages/
  ai/                  Optional provider-neutral AI boundary
  api-client/          Versioned API client contracts
  connector-sdk/       Connector manifest and normalization contracts
  design-tokens/       Shared visual token boundary
  item-model/          Provider-neutral auth, note, sync, and conflict contracts
  ranking/             Ranking result and explanation contracts
  sync-engine/         Client sync and offline queue contracts
  ui/                  Shared presentation boundary
```

## Architectural boundaries

- The backend is the source of truth for normalized state, ranking, ordering, sync, history, and
  conflict records.
- Every user-owned record is scoped by authenticated server-side identity.
- Clients never authorize themselves with a client-supplied user ID.
- Clients do not calculate authoritative rank.
- Connector-specific provider payloads do not leak into generic UI components.
- Platform-specific capabilities live behind web, desktop, Android, or local-agent capability
  layers.
- AI is provider-neutral and optional to the user. When `OPENAI_API_KEY` is configured and the
  server has not disabled AI, summaries default to enabled for users with no explicit preference.

## Documentation

Read these before architectural, product, API, schema, security, or UX changes:

- `AGENTS.md`
- `docs/VISION.md`
- `docs/ENGINEERING_PRINCIPLES.md`
- `docs/PRODUCT_REQUIREMENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/API_CONTRACT.md`
- `docs/SECURITY.md`
- `docs/RANKING.md`
- `docs/ROADMAP.md`
- `docs/adr/README.md`

## Validation

Install dependencies with `pnpm install`, then run:

```bash
pnpm validate
```

The validation command checks formatting, linting, TypeScript, and tests across the workspace. The
API test suite runs the same storage contract tests against the in-memory adapter and the
D1-compatible adapter. Gmail and Google Calendar tests use fake Google clients and verify OAuth
state handling, encrypted credential storage, idempotent sync, normalized item mapping, local
calendar CRUD, annotations, ICS import/export, and disconnect behavior without requiring real Google
credentials.

Use Node.js `22.13.1` and pnpm `9.15.4`. Run the API locally against Wrangler's local D1 binding
with:

```bash
pnpm db:migrate:local
pnpm dev
```

The Vite web app remains available with:

```bash
pnpm --filter @dentlink/web dev
```

Migration validation can also be run directly with:

```bash
sqlite3 /tmp/dentlink_m3_migration_check.db < migrations/0001_auth_notes.sql
sqlite3 /tmp/dentlink_m3_migration_check.db < migrations/0002_notifications_webhooks.sql
sqlite3 /tmp/dentlink_m3_migration_check.db < migrations/0003_connector_framework.sql
sqlite3 /tmp/dentlink_m3_migration_check.db < migrations/0004_gmail_connector.sql
sqlite3 /tmp/dentlink_m3_migration_check.db < migrations/0005_google_calendar_connector.sql
sqlite3 /tmp/dentlink_m3_migration_check.db < migrations/0006_calendar_foundation_ics.sql
sqlite3 /tmp/dentlink_m3_migration_check.db < migrations/0007_gmail_sync_diagnostics.sql
sqlite3 /tmp/dentlink_m3_migration_check.db < migrations/0008_gmail_rules_ai.sql
sqlite3 /tmp/dentlink_m3_migration_check.db < migrations/0009_gmail_imap_engine.sql
sqlite3 /tmp/dentlink_m3_migration_check.db < migrations/0010_ai_user_preferences.sql
sqlite3 /tmp/dentlink_m3_migration_check.db "PRAGMA foreign_key_check;"
sqlite3 /tmp/dentlink_m3_migration_check.db "PRAGMA integrity_check;"
```

Gmail and Google Calendar OAuth require Google Cloud OAuth credentials and Worker secrets before
real authorization can be completed. See `docs/DEPLOYMENT.md` for Google OAuth setup.

Deployment, preview, production, smoke-test, and rollback instructions live in `docs/DEPLOYMENT.md`.
Repeatable preview browser verification is available with:

```bash
DENTLINK_PREVIEW_WEB_URL=https://dentlink-web-preview.pages.dev \
DENTLINK_PREVIEW_API_URL=https://dentlink-api-preview.evanjrizzo.workers.dev \
pnpm test:browser
```
