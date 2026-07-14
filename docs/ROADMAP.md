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

## Milestone 2: Named webhooks and Notifications

Implement named webhook endpoints, normalized notification creation, webhook health/rate limiting,
notification list, done/pin/reorder behavior, and Ranking Mode dismiss.

## Milestone 3: Calendar foundation and ICS

Implement calendar data model, DentLink-local events, ICS import/export, agenda/grid views,
filtering, annotations, and agenda-only dismissal.

## Milestone 4: Google integrations

Add Google OAuth, Gmail ingestion, Google Calendar ingestion, connector health, token encryption,
and least-privilege scopes.

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
