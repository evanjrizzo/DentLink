# Web App

Responsibility: browser client shell for DentLink Notifications, Agenda, Notes, Settings, and
connector management.

This app presents authentication, Notifications, Agenda, Notes, Settings, connector management,
webhooks, email rules, and AI settings using shared packages. It must consume the versioned API and
server-provided state rather than calculating authoritative state locally.

The Vite dev server mounts the Worker-style API handler at `/v1` with an in-memory store for local
manual testing. Local development data is nonpersistent and resets when the dev server process
restarts. Production deployment must use the real API app and durable D1 storage.

It does not implement Tauri, Android, widgets, provider writeback, or direct browser-side provider
polling.

The normal UI is touch-first and uses four top-level sections: Notifications, Agenda, Notes, and
Settings. Advanced diagnostics and local refresh controls are hidden behind Debug Mode. Notification
cards use compact contextual icon actions: Pin/Unpin, Dismiss, source Open when available, and
Complete only when the notification is actionable. Complete and Dismiss are separate local DentLink
states and both move items into History with restore controls.

Adaptive surfaces are shared across notification details, note create/edit, local event creation,
calendar event details, and ICS import. Phone, narrow landscape, and short dashboard-height
viewports use bottom sheets. Wider/taller desktop layouts use right-side panels with tokenized
widths, sticky headers, internal scrolling, and one-column forms unless the panel itself has enough
space for two columns. Google Calendar provider events remain read-only in these surfaces.

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
