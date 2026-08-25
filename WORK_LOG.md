# DentLink Work Log

Generated: 2026-07-28, after mobile/widget/web styling and sync work.

## Current Worktree

Uncommitted modified files:

- `apps/api/src/d1-storage.ts`
- `apps/api/src/index.test.ts`
- `apps/api/src/index.ts`
- `apps/api/src/storage.ts`
- `apps/mobile/README.md`
- `apps/mobile/android/app/src/main/AndroidManifest.xml`
- `apps/mobile/android/app/src/main/java/com/dentlink/mobile/DentLinkApiSync.java`
- `apps/mobile/android/app/src/main/java/com/dentlink/mobile/DentLinkWidgetProvider.java`
- `apps/mobile/android/app/src/main/java/com/dentlink/mobile/DentLinkWidgetStore.java`
- `apps/mobile/android/app/src/main/java/com/dentlink/mobile/MainActivity.java`
- `apps/mobile/android/app/src/main/res/layout/dentlink_widget.xml`
- `apps/web/src/notes-app.tsx`
- `apps/web/src/styles.css`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `scripts/web-preview.mjs`

Diff stat at handoff: 16 files changed, 743 insertions, 233 deletions.

## API Session / Sync Changes

- Added session extension support:
  - `apps/api/src/storage.ts`: new `extendSession`.
  - `apps/api/src/d1-storage.ts`: D1 implementation.
  - `apps/api/src/index.ts`: authenticated API use renews session expiry.
  - `apps/api/src/index.test.ts`: added coverage for session renewal.
- Updated `docs/SECURITY.md` to describe 30-day sliding expiry.
- Preview API deployed earlier in the session as version `898f3e52-f203-48fb-a76a-5fe0768e19bc`.

## Android Widget Changes

- `dentlink_widget.xml`
  - Bottom nav converted to icon tab buttons with notification bubble image views.
  - Plus button now matches tab button styling.
- `DentLinkWidgetProvider.java`
  - Widget logo opens `MainActivity`.
  - Bottom nav tabs bind click handlers on both tab container and icon.
  - Removed parent/header/status/empty no-op click bindings that were stealing launcher taps.
  - Refresh button uses widget refresh action.
  - Added `ACTION_AUTO_REFRESH`.
  - Auto-refresh now self-schedules a native alarm every 5 minutes via `AlarmManager`.
  - Auto-refresh reschedules after widget events and refresh completion.
  - Old inexact repeating `REFRESH` alarm is cancelled when scheduling the new auto-refresh.
- `AndroidManifest.xml`
  - Registered `com.dentlink.mobile.widget.AUTO_REFRESH` receiver action.
- `DentLinkApiSync.java`
  - Refresh calls `/v1/connectors/sync-all`, then reads backend resource cache.
  - If connector `sync-all` fails transiently, widget still fetches backend data.
- `DentLinkWidgetStore.java`
  - Manual refresh clears stale error state.
  - Transient sync failures no longer leave sticky `Sync error` if cached data already exists.
- `apps/mobile/README.md`
  - Documents self-scheduled five-minute native auto-refresh.

## Android App Changes

- `MainActivity.java`
  - Android app is now a WebView shell loading `https://dentlink-web-preview.pages.dev?dentlink_app=android&shell_version=2`.
  - JS and DOM storage enabled.
  - App adds top inset padding for the phone status bar.
  - WebView back button navigates browser history.
- `docs/ARCHITECTURE.md`
  - Documents temporary Android WebView shell and native widget boundary.

## Web / Android-App UI Changes

- `notes-app.tsx`
  - Detects Android app URL query and adds `dentlink-android-app` class.
  - Applies widget-like dark appearance only in Android app WebView.
  - Mobile bottom nav uses desktop icon set.
  - Mobile bottom nav includes page label and refresh button.
  - Notifications list gets a right-side checkbox for active cards.
- `styles.css`
  - Mobile bottom nav is one row.
  - Android-app-only dark widget-like theme for cards, inputs, calendar panels, notification cards, and details.
  - Replaced many hardcoded light card/control colors with variables.
  - Textboxes/selects are darker in Android app.
  - Notification and email cards recolored consistently.
  - Importance indicators are blue.
  - Action-required indicators are red.
  - Notification checkboxes are on the right.
  - Android notification cards truncate sender, put time/importance/action at top-right, and center checkbox on the right.
  - Active Android notification cards hide the pin button on the right edge to maximize content space.
- `scripts/web-preview.mjs`
  - Default preview Pages branch changed from `development` to `main`.

## Deploy / Install State

- Web preview deployed multiple times.
- Important deploy nuance: after `pnpm deploy:web:preview`, also deploy root alias with:
  - `pnpm exec wrangler pages deploy apps/web/dist --project-name dentlink-web-preview`
- Last verified root preview bundle for notification card work:
  - JS: `assets/index-Cxb0XuVt.js`
  - CSS: `assets/index-C7wNOwHn.css`
- Android APK was built and installed after widget auto-refresh changes:
  - Build command: `pnpm --filter @dentlink/mobile android:assemble`
  - Install command used: `adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`

## Phone Verification Performed

- Widget nav taps verified through logs and screenshots:
  - Calendar tab works.
  - Notes tab works.
  - Emails tab works.
  - Refresh icon receives clicks.
- Widget click fix verified by `DentLinkWidget` logs showing `SWITCH_TAB` and `REFRESH`.
- Widget cache verified with `run-as com.dentlink.mobile cat shared_prefs/dentlink_widget_cache.xml`.
- Auto-refresh verified:
  - `dumpsys alarm` showed scheduled `com.dentlink.mobile.widget.AUTO_REFRESH`.
  - Direct `AUTO_REFRESH` broadcast rebuilt widget and scheduled the next alarm.
- Android app Home and Notifications screenshots verified:
  - right-side checkboxes,
  - blue importance,
  - red action-required,
  - sender truncation,
  - top-right metadata cluster.

## Validation Commands Run

- `pnpm --filter @dentlink/web typecheck`: passed after web changes.
- `pnpm format:check`: passed after web/mobile docs/style changes.
- `pnpm --filter @dentlink/mobile android:assemble`: passed after widget changes.
- API validations earlier:
  - `pnpm --filter @dentlink/api typecheck`: passed.
  - Targeted API tests for auth/sync-all passed.
  - `pnpm smoke:api` against preview passed.
  - Full API suite had unrelated AI/assistant date-sensitive failures.

## Known Notes / Risks

- Android `appwidget-provider updatePeriodMillis="300000"` is still present, but Android clamps widget provider periodic updates. The real refresh mechanism is now the self-scheduled `AUTO_REFRESH` alarm.
- `AlarmManager.setAndAllowWhileIdle` may still be deferred by Android power management, but the widget now reschedules itself and uses a distinct action rather than relying on the clamped widget update period.
- A transient connector sync failure should not stick the widget in `Sync error` when cached data exists.
- There is a visible Google Calendar D1 size reconnect warning in screenshots; that appears backend/provider related, not a widget click issue.
- Worktree is dirty and should be reviewed before committing. Do not discard user changes.
