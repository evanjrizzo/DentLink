# Sync Engine

Responsibility: shared client-side sync and offline mutation queue contracts.

This package will coordinate cursor sync, optimistic mutation queues, retry behavior, and conflict
handoff. It must not calculate authoritative rank or bypass the backend source of truth.

Milestone 0B contains only the package boundary and tooling smoke test.
