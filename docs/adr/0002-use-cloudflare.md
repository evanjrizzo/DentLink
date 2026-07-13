# 0002 Use Cloudflare

## Status

Accepted

## Date

2026-07-13

## Context

DentLink needs a low-operations hosting target for API endpoints, scheduled polling, queue-backed ingestion, and a relational store. The initial product is personal and may begin single-user, but must be architected for authenticated multi-user data isolation.

## Decision

Use Cloudflare Workers, D1, Queues, and Cron Triggers as the initial backend hosting platform. Add R2 later only if storage needs justify it. Long-running, platform-specific, or device-specific work should run in trusted agents or external services rather than inside the primary Worker.

## Consequences

- The API and ingestion pipeline must be designed for Worker execution limits.
- Connector polling should use queues and scheduled triggers rather than blocking request paths.
- D1 migrations become the canonical database change mechanism.
- Some provider integrations may need careful retry, backoff, and pagination design.
- Cloudflare limits must be monitored; this ADR can be superseded if the workload outgrows the platform.

## Alternatives considered

- Traditional VPS or container deployment: rejected for the initial milestone path because it increases operational work before the product shape is proven.
- AWS/GCP serverless stack: viable, but rejected initially because Cloudflare better matches the desired lightweight Worker, D1, Queue, and Cron deployment model.
- Local-first desktop controller: rejected because the backend must be the source of truth and desktop is only a client.
