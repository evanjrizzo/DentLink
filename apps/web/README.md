# Web App

Responsibility: browser client shell for DentLink Notes.

This app presents the Milestone 1 authentication and manual Notes workflow using shared packages. It
must consume the versioned API and server-provided state rather than calculating authoritative state
locally.

The Vite dev server mounts the Worker-style API handler at `/v1` with an in-memory store for local
manual testing. Local development data is nonpersistent and resets when the dev server process
restarts. Production deployment must use the real API app and durable D1 storage.

It does not implement Notifications, Calendar, Ranking Mode, connectors, Tauri, Android, or AI calls.
