# API Contract

All public endpoints are versioned under `/v1`.

Principles: JSON, server-resolved user identity, stable error shape, idempotency where appropriate, cursor sync, optimistic concurrency, no secrets, and normalized provider data.

Conceptual groups: auth, sync, notifications, notes, calendar, connectors, webhooks, ranking feedback/explanations, and conflicts.

Editable mutations include `expectedVersion`. Version mismatches return or create conflict information rather than silently overwriting.

Error shape:

```json
{"error":{"code":"stable_code","message":"Human-readable message","requestId":"id","details":{}}}
```
