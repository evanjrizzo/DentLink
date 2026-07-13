# Architecture

```text
Sources → Connectors → Normalization → Rules/Ranking → Optional AI → Central DB/API → Clients
```

The backend owns normalized items, status, pin state, global order, rank, rules, annotations, connector state, conflicts, and sync cursors. Providers remain authoritative for original email and calendar content.

Initial platform: Cloudflare Workers, D1, Queues, Cron Triggers, and later R2 if needed.

Shared client layers: TypeScript item model, API client, sync engine, React components, and design tokens.

Platform layers: Tauri desktop shell, native Android widget, Android services, and trusted desktop agent.

Connectors run in cloud, local agents, or external services depending on capability. Clients never poll providers directly.

Clients use cursor-based incremental sync and optimistic versioned mutations. Conflicts are persisted and surfaced.
