# 0004 Unified Item Envelope

## Status

Accepted

## Date

2026-07-13

## Context

Notifications, notes, and calendar events share cross-cutting behavior: source identity, status, pinning, ranking, global order, search, sync metadata, revisions, and user scope. They also need different type-specific fields and provider metadata.

## Decision

Use a common item envelope for shared fields and type-specific detail records for notification, note, calendar, and future item categories. The envelope remains provider-neutral. Connector-specific raw payloads stay in connector/source storage and do not leak into generic UI models.

## Consequences

- Shared UI and sync code can handle common item behavior consistently.
- Type-specific details can evolve without turning every item into an untyped blob.
- Database schema and API responses need clear joins or resource expansion rules.
- Connector normalization must map provider data into stable DentLink fields.
- Future item types need explicit detail records and API contracts.

## Alternatives considered

- One large table or object containing every possible field: rejected because it would create ambiguous null-heavy models and weak type boundaries.
- Completely separate models for notifications, notes, and calendar events: rejected because shared rank, order, status, sync, and conflict logic would be duplicated.
- Raw provider payloads in UI models: rejected because it couples generic UI to connectors and leaks provider-specific details.
