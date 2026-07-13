# Architecture

```text
Sources → Connectors → Normalization → Rules/Ranking → Optional AI → Central DB/API → Clients
```

## System boundary

DentLink is an independent platform. It must not depend on Odysseus or any previous dashboard runtime. Legacy projects may inform behavior, but they are not part of the runtime architecture.

## Ownership

The backend owns normalized items, status, pin state, global order, rank, rules, annotations, connector state, conflicts, and sync cursors. Providers remain authoritative for original email and calendar content.

Clients own presentation, local cache, optimistic UI state, and platform-specific capability adapters. Clients must reconcile with the backend before claiming authoritative state.

Initial platform: Cloudflare Workers, D1, Queues, Cron Triggers, and later R2 if needed.

Shared client layers: TypeScript item model, API client, sync engine, React components, and design tokens.

Platform layers: Tauri desktop shell, native Android widget, Android services, and trusted desktop agent.

Connectors run in cloud, local agents, or external services depending on capability. Clients never poll providers directly.

Clients use cursor-based incremental sync and optimistic versioned mutations. Conflicts are persisted and surfaced.

## Ingestion pipeline

All provider polling, push subscriptions, named webhooks, manual submissions, and trusted agent submissions enter the same normalization pipeline:

1. Receive raw source data.
2. Validate authentication, authorization, rate limits, and payload shape.
3. Store or reference raw data according to retention rules.
4. Normalize into shared item structures.
5. Apply deterministic rules.
6. Apply user rules.
7. Calculate base rank.
8. Optionally perform bounded AI enrichment.
9. Persist normalized state.
10. Emit a sync change.

## Connector architecture

A connector defines its manifest, authentication method, permissions, settings schema, polling or webhook behavior, normalization, supported actions, health reporting, retry and backoff behavior, and version.

Cloud connectors run in the backend where practical. Local or device-specific integrations run through trusted local agents. The primary Worker must not execute arbitrary third-party connector code.

## Sync architecture

Clients use cursor-based incremental synchronization, optimistic local updates, offline mutation queues, retry, conflict detection, and server reconciliation. Sync responses contain normalized records and enough metadata for clients to update local caches without recalculating authoritative rank.

## Platform capability layers

Shared UI can request capabilities such as opening a source, invoking a desktop action, or launching a mobile intent through typed adapters. Capability implementations are platform-local and cannot be invoked directly by the cloud backend.
