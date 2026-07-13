# AGENTS.md

## Project

DentLink is a centralized, user-scoped personal information platform.

Read before architectural or product changes:

- `docs/VISION.md`
- `docs/ENGINEERING_PRINCIPLES.md`
- `docs/PRODUCT_REQUIREMENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/API_CONTRACT.md`
- `docs/SECURITY.md`
- `docs/RANKING.md`
- `docs/ROADMAP.md`

## Non-negotiable boundaries

- No Odysseus dependency.
- Existing dashboards are references only.
- Backend is the source of truth.
- All user data is scoped by authenticated server-side identity.
- Clients do not calculate authoritative rank.
- Shared business logic is not duplicated across clients.
- Connector-specific payloads do not leak into generic UI components.
- AI remains optional and provider-neutral.
- Secrets are never committed, logged, or placed in examples.
- Provider credentials are encrypted before storage.
- Platform-specific behavior belongs in capability layers.
- Desktop is a client, not the controller.

## Development rules

- One milestone at a time.
- Do not broaden scope without documenting why.
- Add tests with behavior changes.
- Update documentation with architecture, API, schema, security, or UX changes.
- Use migrations for database changes.
- Keep APIs versioned.
- Validate trust boundaries.
- Preserve user data.
- Never silently discard conflicting edits.
- Do not commit directly to `main`.

## Validation

Run relevant formatting, linting, type checking, tests, builds, and migration validation. Report commands and results.

## ADRs

Create an ADR under `docs/adr/` for long-lived architectural decisions. Supersede prior ADRs rather than rewriting history.
