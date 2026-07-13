# Roadmap

## Milestone 0A: Documentation foundation

Status: in progress until accepted.

Scope:

- Establish product vision, principles, requirements, architecture, data model, API contract, security model, ranking model, roadmap, and ADR index.
- Record initial ADRs for the major architectural decisions.
- Do not scaffold applications, packages, migrations, connectors, authentication, Tauri, Android, or AI calls.

Exit criteria:

- The documentation set can guide implementation without relying on older dashboard projects.
- Non-negotiable boundaries are explicit.
- Initial ADRs are present and non-placeholder.

## Milestone 0B: Monorepo and tooling scaffold

Create the TypeScript monorepo structure, package manager setup, shared TypeScript config, formatting/linting/test conventions, CI-ready commands, and empty package/app boundaries only where justified by the documentation.

## Milestone 1: Authentication and Notes vertical slice

Implement email/password authentication, server-resolved identity, sessions, initial notes API, notes data model, conflict-aware note edits, and a minimal shared client path.

## Milestone 2: Named webhooks and Notifications

Implement named webhook endpoints, normalized notification creation, webhook health/rate limiting, notification list, done/pin/reorder behavior, and Ranking Mode dismiss.

## Milestone 3: Calendar foundation and ICS

Implement calendar data model, DentLink-local events, ICS import/export, agenda/grid views, filtering, annotations, and agenda-only dismissal.

## Milestone 4: Google integrations

Add Google OAuth, Gmail ingestion, Google Calendar ingestion, connector health, token encryption, and least-privilege scopes.

## Milestone 5: Microsoft and IMAP

Add Microsoft 365 Mail, Microsoft 365 Calendar, and IMAP connectors with provider-specific capability handling behind the connector abstraction.

## Milestone 6: Ranking and optional AI

Implement richer explainable ranking, feedback loops, ranking explanations, optional OpenAI provider integration, usage accounting, provider-neutral AI interface, and approved task suggestions.

## Milestone 7: Tauri desktop and local agent

Build the desktop client around shared UI, preserve touchscreen/fullscreen workflows, and add trusted local capability layers for desktop-only actions.

## Milestone 8: Android app and native widget

Build Android surfaces, widget views, quick note, done, refresh, and source opening where possible.

## Milestone 9: Compatibility testing and migration

Validate behavior against previous reference systems, test multi-client sync, harden migration paths, and prepare operational runbooks.
