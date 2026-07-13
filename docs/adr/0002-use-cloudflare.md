# 0002 Use Cloudflare

## Status

Proposed

## Context

DentLink needs a durable architectural choice in this area.

## Decision

Use Cloudflare Workers, D1, Queues, and Cron Triggers initially; monitor platform limits and move long-running work to agents/services.

## Consequences

Document implementation benefits, constraints, operational costs, and migration implications during review.

## Alternatives considered

Record rejected alternatives before accepting this ADR.
