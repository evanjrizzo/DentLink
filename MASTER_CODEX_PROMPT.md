# DentLink Master Codex Prompt

You are beginning implementation of **DentLink** in this repository:

`https://github.com/evanjrizzo/DentLink`

DentLink is a new, independent platform. It must not depend on Odysseus or on the existing desktop dashboard, cloud dashboard, or Android widget projects. Those older projects may be inspected only as reference implementations for behavior that must be preserved.

Your role is to implement DentLink incrementally, one milestone at a time, while preserving the product vision, architecture boundaries, security rules, and documentation in this repository.

Do not attempt to build the entire system in one run.

## Product vision

DentLink is a unified personal information hub that aggregates, organizes, ranks, and presents information from many independent systems without replacing them.

It collects data from multiple email accounts, calendar providers, named webhooks, manual entries, platform applications, future local agents, and future device integrations. It normalizes that information and makes it consistently available across web, desktop, Android, widgets, and future clients.

The backend is the source of truth. Every client uses the same API, item model, synchronization protocol, ranking output, and global ordering.

The first deployment may be single-user, but all core data must be scoped by authenticated user from the beginning. No user may access another user's data.

## What DentLink is

- A centralized personal information dashboard
- A unified notification and note command center
- A ranked overview of what matters now
- A calendar aggregation layer
- A modular connector platform
- A cross-platform client ecosystem
- A user-configurable information routing system

DentLink should answer: **What do I need to know, do, or review right now?**

## What DentLink is not

DentLink is not a replacement email provider, calendar provider, general-purpose automation platform, team collaboration suite, or AI-first application that stops functioning without an LLM. It sits above existing systems, preserving source links and provider authority.

## Primary sections

### Notifications

Contains ranked externally sourced information: email summaries, webhook alerts, connector alerts, reminders, future phone notifications, and conservative AI action suggestions.

Every fetched email remains available in a searchable source inbox, while only relevant items are promoted into Notifications.

Cards support done, pin, open-source by clicking the card, global drag ordering, source labels/colors, and ranking explanations. Dismiss appears only in Ranking Mode.

### Notes

Contains tasks and reference notes created manually, through clients, named webhooks, Pebble/voice capture, or approved AI suggestions.

Notes support task/reference types, ranked overview, one folder, multiple tags, due date, priority, pin, editing, global order, search, and optional source URL.

### Calendar

Combines Google Calendar, Microsoft 365 Calendar, ICS imports, and DentLink-created events.

Supports day/week/month/agenda views, source filtering and colors, DentLink-only annotations, source links, local events, ICS export, and later explicit provider synchronization.

Dismissing an event hides it from agenda only. It does not modify the provider event or remove it from the calendar grid.

## Done and dismiss

Done means the item was handled. It is always available where applicable, moves the item to completed history, and does not strongly penalize similar future items.

Dismiss is available only in Ranking Mode on web and desktop. It means the item should not have been promoted, moves it to dismissed history, and records negative relevance feedback. It must not modify the source item.

Manual drag ordering must not automatically create negative feedback.

## Connector model

Every integration uses a connector abstraction. Initial connectors are Gmail, Microsoft 365 Mail, IMAP, Google Calendar, Microsoft 365 Calendar, ICS, and named webhooks.

A connector defines a manifest, authentication method, permissions, settings schema, polling/webhook behavior, normalization, supported actions, health reporting, retry/backoff behavior, and version.

Cloud connectors run in the backend where practical. Local or device-specific integrations run through trusted local agents. Do not allow arbitrary third-party code to execute inside the primary Worker.

## Ingestion and sync

All provider polling, push subscriptions, webhooks, manual submissions, and agent submissions feed one normalization pipeline:

1. Receive raw source data
2. Normalize into shared item structures
3. Apply deterministic rules
4. Apply user rules
5. Calculate base rank
6. Optionally perform bounded AI enrichment
7. Store normalized state
8. Emit a sync change

Clients use cursor-based incremental synchronization, optimistic local updates, offline mutation queues, retry, conflict detection, and server reconciliation.

## Conflict policy

Editable records have a version and editor metadata. Mutations include an expected version. When edits conflict, preserve both revisions, create a conflict record, notify the user, and offer keep mine, keep theirs, merge, or keep both. Never silently discard an edit.

## AI rules

AI is optional, replaceable, and removable. OpenAI is the initial provider using one administrator-owned API key with per-user usage accounting designed into the system.

AI may summarize content, estimate urgency, extract due dates, detect likely action requests, apply bounded ranking adjustments, and suggest task creation.

AI must not be required for ingestion, delete source content, dismiss items autonomously, send email, modify provider events without explicit action, override explicit user rules, or produce unbounded ranking changes.

AI-created tasks initially require approval. Record provider, model, prompt/rule version, timestamp, confidence where available, source item, and usage metadata.

## Security

- Authenticate using email and password initially.
- Resolve user identity on the server.
- Never authorize using a client-supplied user ID.
- Scope every query to authenticated user identity.
- Use secure password hashing and revocable sessions.
- Prefer OAuth for Google and Microsoft.
- Encrypt provider refresh tokens and IMAP credentials before storage.
- Use least-privilege scopes.
- Never commit or log secrets.
- Treat email and webhook content as untrusted data.
- Do not claim true end-to-end encryption in version one.
- Do not download attachments by default.

## Hosting

Initial target: Cloudflare Workers, D1, Queues, Cron Triggers, and later R2 if needed. Use `dentlabs.net`, with configurable domains such as `dash.dentlabs.net`, `api.dentlabs.net`, `auth.dentlabs.net`, and `hooks.dentlabs.net`.

## UI architecture

Use shared TypeScript/React packages where practical: design tokens, components, item model, API client, sync engine, and ranking result types.

Use Tauri for desktop around the shared UI where practical. Android homescreen widgets remain native.

Desktop must preserve touchscreen form factor, fullscreen placement, configurable macro pad, files, terminal, mute, Voice FX, chimes, badges, health reporting, and local platform actions.

The cloud backend must never execute arbitrary desktop commands directly.

## Preferred repository shape

```text
DentLink/
├── apps/
│   ├── web/
│   ├── api/
│   ├── desktop/
│   └── android/
├── packages/
│   ├── item-model/
│   ├── api-client/
│   ├── sync-engine/
│   ├── ui/
│   ├── design-tokens/
│   ├── ranking/
│   ├── ai/
│   └── connector-sdk/
├── connectors/
├── agents/
├── migrations/
├── docs/
│   └── adr/
├── AGENTS.md
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── .env.example
└── .gitignore
```

Do not create empty complexity solely to match this layout. Preserve the boundaries as features are added.

## Engineering rules

- Backend owns authoritative business logic.
- Clients do not calculate authoritative rank.
- Shared logic is not copied between clients.
- Connector payloads do not leak into generic UI components.
- Public APIs are versioned.
- Database changes use migrations.
- Every connector and AI provider can be disabled without breaking core functionality.
- Platform-specific code stays out of shared packages.
- Ranking is explainable.
- Documentation changes are part of feature completion.
- The specification leads the code; do not rewrite documentation to justify implementation drift.
- Work on one milestone at a time.
- Do not commit directly to `main`.

## Current task: Milestone 0A only

Perform documentation foundation work only. Do not scaffold the application yet.

Create or improve:

- `AGENTS.md`
- `README.md`
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

Create initial ADRs covering:

- TypeScript monorepo
- Cloudflare hosting
- Central backend as source of truth
- Unified item envelope with type-specific details
- Shared web UI plus platform capability layers
- Optional provider-neutral AI

Do not implement React, Workers, D1, authentication, connectors, Tauri, Android, or AI calls in this milestone.

At completion report files changed, decisions documented, open questions, risks, validation performed, and a recommended commit message. Stop after Milestone 0A.
