# ADR 0009: Queued optimistic mutations

Status: Accepted
Date: 2026-07-15

## Context

Rapid completion, text editing, and reorder actions can produce ordinary stale-version conflicts when
each UI interaction immediately sends a versioned request.

## Decision

Web clients may apply local optimistic state immediately, then serialize related writes per item,
coalesce superseded patches, and retry ordinary stale-version failures against the latest server
version. The backend remains authoritative and still records conflicts when automatic retry is not
safe.

## Consequences

Local interaction stays responsive while versioned APIs remain the source of truth. Clients must
guard against older responses overwriting newer local intent.
