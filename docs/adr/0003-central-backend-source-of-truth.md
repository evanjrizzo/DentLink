# 0003 Central Backend Source Of Truth

## Status

Accepted

## Date

2026-07-13

## Context

DentLink must present consistent notifications, notes, calendar state, ranking, ordering, history, sync, and conflicts across web, desktop, Android, widgets, and future clients. Previous dashboards are references only and must not become the controller.

## Decision

Use the central backend as authoritative for normalized state, ranking, global order, item status, history, connector state, user rules, annotations, sync cursors, revisions, and conflicts.

Clients may cache, display, optimistically mutate, and queue offline changes, but server reconciliation determines authoritative state.

## Consequences

- Every client receives the same ranking and ordering results.
- Clients must use versioned APIs and sync cursors instead of direct provider polling.
- Offline clients need mutation queues and conflict handling.
- Server code must scope all data by authenticated user identity.
- Desktop capability code cannot become an alternate source of truth.

## Alternatives considered

- Client-authoritative sync: rejected because it risks divergent rank, order, and conflict behavior.
- Desktop-controller architecture: rejected because desktop must remain a client and the cloud cannot depend on a local runtime.
- Provider-authoritative aggregation only: rejected because DentLink needs normalized status, ranking, notes, annotations, and history across sources.
