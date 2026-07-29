# Mobile

Responsibility: Android mobile app and native widget client boundary for DentLink.

This app is a client of the versioned DentLink API. It must reuse shared item models, API/sync
contracts, visual tokens, and platform capability boundaries. It must not poll providers directly,
calculate authoritative rank, store connector payloads in UI state, or become a controller for
desktop/local actions.

Initial widget design:

- Native Android multiple-tab widget.
- Tab 1: `Calendar`, showing calendar events only.
- Tab 2: `Notes`, showing notes only.
- Tab 3: `Emails`, showing email notifications only.
- Same DentLink color scheme, font stack, logo assets, and compact card treatment as the web/desktop
  client.
- Widget tab buttons reuse the desktop navigation icon shapes.
- Widget actions enqueue versioned DentLink API mutations and reconcile from backend state. The
  widget self-schedules a five-minute native auto-refresh alarm and refreshes from DentLink's backend
  cache even when a connector sync attempt is deferred or interrupted.

Native Android implementation:

- Android module: `apps/mobile/android`.
- Widget provider: `com.dentlink.mobile.DentLinkWidgetProvider`.
- Widget layout: `android/app/src/main/res/layout/dentlink_widget.xml`.
- Cache contract: shared preferences named `dentlink_widget_cache`.
- Cache keys include `calendar_json`, `notes_json`, `emails_json`, `active_tab`, per-tab seen/new
  markers, and `refresh_requested_at`.
- Cached item shape: `{ id, kind, version, title, subtitle, metadata, accentColor }`.

Build command:

```sh
pnpm --filter @dentlink/mobile android:assemble
```
