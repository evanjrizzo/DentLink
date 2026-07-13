# DentLink

DentLink is a unified personal information hub that aggregates, organizes, ranks, and presents information from independent systems without replacing them.

It answers one product question: what do I need to know, do, or review right now?

DentLink is a new, independent platform. It must not depend on Odysseus, the previous desktop dashboard, the previous cloud dashboard, or the Android widget projects. Those systems may be inspected only as behavioral references.

## Current status

Milestone 0B: monorepo and tooling scaffold.

This repository contains the pnpm TypeScript workspace structure, shared package boundaries, app
boundaries, formatting/linting/type checking/test commands, and CI configuration. It does not yet
contain implemented backend routes, database migrations, authentication, Notes behavior, connectors,
calendar providers, webhooks, Tauri, Android, or AI calls.

## Product shape

DentLink has three primary user-facing sections:

- Notifications: ranked externally sourced information, such as email summaries, webhook alerts, connector alerts, reminders, and future phone notifications.
- Notes: manual or captured tasks and reference notes, with folders, tags, due dates, priorities, source links, and completion history.
- Calendar: unified events from providers, ICS feeds, and DentLink-local entries, with agenda and grid views.

## Planned sources

Gmail, Microsoft 365 Mail, IMAP, Google Calendar, Microsoft 365 Calendar, ICS, named webhooks, manual entries, and future local/device agents.

## Planned clients

Web, desktop, Android app, and Android homescreen widget.

## Repository layout

```text
apps/
  api/                 Future Cloudflare Worker API and ingestion boundary
  web/                 Future browser client shell
packages/
  ai/                  Optional provider-neutral AI boundary
  api-client/          Versioned API client contracts
  connector-sdk/       Connector manifest and normalization contracts
  design-tokens/       Shared visual token boundary
  item-model/          Provider-neutral DentLink item contracts
  ranking/             Ranking result and explanation contracts
  sync-engine/         Client sync and offline queue contracts
  ui/                  Shared presentation boundary
```

## Architectural boundaries

- The backend is the source of truth for normalized state, ranking, ordering, sync, history, and conflict records.
- Every user-owned record is scoped by authenticated server-side identity.
- Clients never authorize themselves with a client-supplied user ID.
- Clients do not calculate authoritative rank.
- Connector-specific provider payloads do not leak into generic UI components.
- Platform-specific capabilities live behind web, desktop, Android, or local-agent capability layers.
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

The validation command checks formatting, linting, TypeScript, and tests across the workspace.
