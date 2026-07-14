# Web App

Responsibility: browser client shell for DentLink Notes, Notifications, and webhook management.

This app presents authentication, manual Notes, Notifications, and named webhook setup using shared
packages. It must consume the versioned API and server-provided state rather than calculating
authoritative state locally.

The Vite dev server mounts the Worker-style API handler at `/v1` with an in-memory store for local
manual testing. Local development data is nonpersistent and resets when the dev server process
restarts. Production deployment must use the real API app and durable D1 storage.

It does not implement Calendar, provider connectors, Tauri, Android, widgets, or AI calls.

Preview and production builds use `VITE_DENTLINK_API_BASE_URL` to select the deployed API origin.
This value is public client configuration, not a secret. Local Vite development can continue using
the middleware-mounted `/v1` API when the variable is unset.

The Milestone 1.3 preview web deployment is hosted on Cloudflare Pages:

```text
https://dentlink-web-preview.pages.dev
```

Build preview artifacts with the preview API URL injected:

```bash
VITE_DENTLINK_API_BASE_URL=https://dentlink-api-preview.evanjrizzo.workers.dev pnpm --filter @dentlink/web build
```
