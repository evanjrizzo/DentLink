# API App

Responsibility: future Cloudflare Worker API and ingestion boundary.

This app will own authenticated API routes, ingestion orchestration, sync responses, conflict
handling, and backend-authoritative ranking. It must not execute arbitrary desktop commands or
accept client-supplied user IDs for authorization.

Milestone 0B contains only the package boundary and tooling smoke test. It does not define routes,
authentication, D1 schema, connectors, webhooks, or AI calls.
