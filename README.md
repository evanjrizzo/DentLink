# DentLink

DentLink is a unified personal information hub that aggregates, organizes, ranks, and presents information from independent systems without replacing them.

It answers one product question: what do I need to know, do, or review right now?

DentLink is a new, independent platform. It must not depend on Odysseus, the previous desktop dashboard, the previous cloud dashboard, or the Android widget projects. Those systems may be inspected only as behavioral references.

## Current status

Milestone 0A: documentation foundation.

This repository intentionally does not yet contain application scaffolding, backend code, database migrations, connector code, Tauri code, Android code, or AI calls. Implementation begins after the documentation foundation is accepted.

## Product shape

DentLink has three primary user-facing sections:

- Notifications: ranked externally sourced information, such as email summaries, webhook alerts, connector alerts, reminders, and future phone notifications.
- Notes: manual or captured tasks and reference notes, with folders, tags, due dates, priorities, source links, and completion history.
- Calendar: unified events from providers, ICS feeds, and DentLink-local entries, with agenda and grid views.

## Planned sources

Gmail, Microsoft 365 Mail, IMAP, Google Calendar, Microsoft 365 Calendar, ICS, named webhooks, manual entries, and future local/device agents.

## Planned clients

Web, desktop, Android app, and Android homescreen widget.

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

For documentation-only changes, validate by checking repository status and reviewing the changed Markdown. Future implementation milestones must run relevant formatting, linting, type checking, tests, builds, and migration validation.
