# DentLink

DentLink is a unified personal information hub that aggregates, organizes, ranks, and presents
information from independent systems without replacing them.

It answers one product question: what do I need to know, do, or review right now?

DentLink is a new, independent platform. It must not depend on Odysseus, the previous desktop
dashboard, the previous cloud dashboard, or the Android widget projects. Those systems may be
inspected only as behavioral references.

## Current status

Milestone 1.2: authentication and manual Notes vertical slice with Cloudflare runtime and deployment
baseline.

This repository contains the pnpm TypeScript workspace, shared package boundaries, a Worker-style
API handler, Cloudflare D1 storage adapter, D1 migration for auth and notes, shared
auth/note/sync/conflict types, a typed API client, a small sync helper, and a responsive Notes UI
shell. It does not yet contain email connectors, calendar providers, named webhooks, Tauri, Android,
or AI calls.

## Product shape

DentLink has three primary user-facing sections:

- Notifications: ranked externally sourced information, such as email summaries, webhook alerts,
  connector alerts, reminders, and future phone notifications.
- Notes: manual or captured tasks and reference notes, with folders, tags, due dates, priorities,
  source links, and completion history.
- Calendar: unified events from providers, ICS feeds, and DentLink-local entries, with agenda and
  grid views.

## Planned sources

Gmail, Microsoft 365 Mail, IMAP, Google Calendar, Microsoft 365 Calendar, ICS, named webhooks,
manual entries, and future local/device agents.

## Planned clients

Web, desktop, Android app, and Android homescreen widget.

## Repository layout

```text
apps/
  api/                 Worker-style auth and Notes API boundary
  web/                 Browser Notes client shell
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
- AI is optional and provider-neutral.

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
D1-compatible adapter.

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
sqlite3 /tmp/dentlink_m1_migration_check.db < migrations/0001_auth_notes.sql
sqlite3 /tmp/dentlink_m1_migration_check.db "PRAGMA foreign_key_check;"
sqlite3 /tmp/dentlink_m1_migration_check.db "PRAGMA integrity_check;"
```

Deployment, preview, production, smoke-test, and rollback instructions live in `docs/DEPLOYMENT.md`.
