# Engineering Principles

1. Backend authority: normalized state, ranking, ordering, history, conflicts, sync cursors, and provider account state are authoritative on the backend.
2. One contract, many clients: web, desktop, Android, widgets, and local agents use versioned APIs and shared models instead of divergent behavior.
3. User isolation by construction: every user-owned query is scoped from authenticated server-side identity, never from a client-supplied user ID.
4. Original sources remain authoritative: DentLink preserves source links and does not pretend to replace email or calendar providers.
5. Modular connectors: integrations declare capabilities, settings, authentication, normalization, health, retry behavior, and supported actions.
6. Optional AI: core ingestion, ranking, sync, and manual workflows must function when every AI provider is disabled.
7. Explainable ranking: clients can display why an item appears where it does without reimplementing ranking.
8. Durable offline changes: client mutations can be queued, retried, reconciled, and conflict checked.
9. Isolated platform-specific code: desktop actions, Android widget behavior, and local agent capabilities stay out of shared UI and business packages.
10. Security at trust boundaries: source payloads, webhooks, provider data, local-agent requests, and AI outputs are untrusted until validated.
11. Documentation is part of implementation: architecture, API, schema, security, and UX changes include documentation updates.
12. Deliberate migrations: database changes use explicit migrations and preserve user data.
13. Small milestones over broad rewrites: complete one milestone at a time and avoid scaffolding unused systems early.
14. Specifications lead code: do not rewrite docs merely to justify implementation drift.
15. Provider payload containment: generic UI consumes normalized DentLink models, not connector-specific raw payloads.
16. Revocable access: sessions, connector credentials, webhook secrets, and local-agent pairings must be revocable.
