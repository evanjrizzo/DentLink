# Web App

Responsibility: browser client shell for DentLink Home, Notifications, Agenda, Notes, Settings, and
connector management.

This app presents authentication, Home assistant, Notifications, Agenda, Notes, Settings, connector
management, webhooks, email rules, and AI settings using shared packages. It must consume the
versioned API and server-provided state rather than calculating authoritative state locally.

The Vite dev server mounts the Worker-style API handler at `/v1` with an in-memory store for local
manual testing. Local development data is nonpersistent and resets when the dev server process
restarts. Production deployment must use the real API app and durable D1 storage.

It does not implement Tauri, Android, widgets, provider writeback, or direct browser-side provider
polling.

The normal UI is touch-first and uses five top-level sections: Home, Notifications, Agenda, Notes,
and Settings. The Home tab is a glanceable command center with Today, Priority Inbox, Due Notes,
Needs Review, quick task capture, contextual assistant prompts, and a responsive read-only assistant
panel that calls `/v1/assistant/chat`. It keeps transient chat state in the browser and relies on
the backend to retrieve bounded user-scoped Gmail/calendar context. Advanced diagnostics and local
refresh controls are hidden behind Debug Mode. Notification cards use compact contextual icon
actions: Pin/Unpin, Dismiss, source Open when available, and Complete only when the notification is
actionable. Complete and Dismiss are separate local DentLink states and both move items into History
with restore controls.

The Notes view keeps completed notes visible by default, sorts them after active notes inside the
same folder or visible list, and provides a Filters checkbox to hide or show them locally. The card
completion checkbox is sized as a touch control; changing it still uses the versioned Notes API and
backend-owned completion state.

The top refresh control runs `Refresh All`, which asks the backend to queue sync jobs for every
connected service that supports manual sync. Normal visible-tab refreshes then apply `/v1/sync`
deltas to a browser IndexedDB cache instead of downloading every current notification, note,
calendar row, webhook, and connector account again. Full list endpoints are still used for initial
bootstrap, calendar range changes, and cache repair. Per-account Sync Now uses the same background
queue. The automatic header countdown can enqueue background work without holding the browser
request open for provider polling. Hidden/background tabs do not run the browser timer, so provider
sync continuity also depends on backend cron and platform-native refresh jobs. Gmail queued/scheduled
syncs can reclaim a stuck in-progress lock after the backend stale-lock window. Settings ->
Connections shows Gmail scheduled sync as an expected backend cadence, not an authoritative
appointment. When the expected five-minute window has already elapsed, the card shows `Due now`
instead of rendering a past timestamp.

The local sync cache is controlled by `VITE_DENTLINK_LOCAL_SYNC_CACHE_ENABLED` and defaults on unless
set to `false`, `0`, or `off`. The backend remains authoritative; the browser cache stores normalized
DentLink records and the last applied sync cursor for the authenticated user, and it is cleared on
logout.

Gmail diagnostics separate the latest sync check from the latest per-message processing outcome.
When a newer sync check finds no newer eligible messages, Connections explains that diagnostics may
still show older message outcomes. Connections also shows recent durable Gmail sync attempts with
trigger, engine, status, duration, counts, and safe error details; the diagnostics export includes
the full safe attempt rows.

Settings -> Connections also shows DentLink freshness from two different sources. Backend freshness
comes from `/v1/status` and each client heartbeat after a successful backend reload, so browser,
desktop, mobile, and widget clients can show the backend revision and time they last read. Connector
freshness comes from backend connector sync state and remains separate from client-read freshness.
Sub-minute freshness uses an exact local clock time instead of `Just now`.

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
