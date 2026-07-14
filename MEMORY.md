# DentLink Agent Memory

## Current Branch

- Branch: `development`
- Latest committed work before Milestone 4: `e0e3500 fix: refresh gmail notifications after sync`
- Current worktree contains uncommitted Milestone 4 changes.
- There is one odd pre-existing untracked file named `h gmail notifications after sync"...` with
  escape characters. It was present before Milestone 4 work and was intentionally left untouched.

## Completed Recent Work

### Gmail Post-Sync UI Fix

- Root cause: after Gmail `Sync Now`, connector metadata and notifications could refresh, but the
  user stayed on the Connectors tab; Connectors Refresh also refreshed only connector metadata.
- Fix:
  - Added explicit connector + notification refresh after Gmail sync.
  - Refresh from Connectors now also refreshes Notifications.
  - If Gmail sync creates notifications, the UI switches to Notifications immediately.
  - Added Playwright coverage for controlled Gmail sync and Refresh without full page reload.
- Commit present: `e0e3500 fix: refresh gmail notifications after sync`.

### Milestone 4: Google Calendar Connector

- Implemented Google Calendar as a provider connector using the existing connector framework.
- Scope stayed read-only:
  - No Google event creation.
  - No Google event editing.
  - No Google event deletion.
  - No RSVP.
  - No attendee management.
  - No Microsoft, Outlook, IMAP, AI, mobile, desktop, widgets, push notifications, or scheduled
    background sync.

## Milestone 4 Architecture

- Added shared Google helper module:
  - `apps/api/src/google.ts`
  - Centralizes Google OAuth token exchange, OAuth state creation, safe return URLs, and AES-GCM
    refresh-token encryption/decryption.
- Refactored Gmail to use shared Google helpers while preserving Gmail behavior.
- Added Google Calendar provider module:
  - `apps/api/src/google-calendar.ts`
  - Uses `https://www.googleapis.com/auth/calendar.readonly`.
  - Discovers primary calendar during OAuth callback.
  - Stores encrypted refresh tokens in `connector_credentials`.
  - Stores connector metadata in `connector_accounts`.
  - Stores provider metadata in `connector_source_records`.
  - Normalizes provider events into `calendar_events`.
- Google Calendar remains source of truth. DentLink stores normalized agenda copies and local
  dismissal state only.

## Milestone 4 API

Added:

- `POST /v1/connectors/google-calendar/start`
- `GET /v1/connectors/google-calendar/callback`
- `POST /v1/connectors/google-calendar/:accountId/sync`
- `POST /v1/connectors/google-calendar/:accountId/disconnect`
- `GET /v1/calendar/events`
- `PATCH /v1/calendar/events/:eventId`

Behavior:

- `POST /v1/connectors/accounts` rejects `connectorKey: "google-calendar"` with
  `google_calendar_oauth_required`.
- Calendar event patch accepts only local agenda status changes:
  - `active`
  - `dismissed`
- All routes are authenticated except OAuth callback.
- All owned data paths derive user identity from validated server session.

## Milestone 4 Data Model And Migration

- Added `CalendarEvent`, `CalendarEventsList`, `CalendarEventPatch`, and
  `GoogleCalendarSyncResult` shared types.
- Added sync changes for `calendar_event` upserts/deletes.
- Added migration:
  - `migrations/0005_google_calendar_connector.sql`
- Migration creates:
  - `calendar_events`
  - indexes for user/time, user/account, provider identity
  - updated `sync_changes` constraint allowing `calendar_event`
- Calendar events are unique by `(connector_account_id, provider_event_id)`.
- Local dismissal updates `calendar_events.status` and `dismissed_at`; it does not modify Google.

## Milestone 4 UI

- Added `Agenda` tab in `apps/web/src/notes-app.tsx`.
- Agenda shows:
  - chronological events
  - all-day indicator
  - start/end times
  - location
  - calendar/source label
  - Open in Google Calendar link
  - Refresh
  - Sync Now
  - local Dismiss
- Connectors tab now supports Google Calendar:
  - Connect Google Calendar
  - Reconnect
  - Sync Now
  - Disconnect
  - Last sync/status/health/error display
- After Google Calendar Sync Now, events refresh immediately and the UI switches to Agenda when
  events were upserted.

## Milestone 4 Tests

- API storage contract tests run against memory and D1-compatible adapters.
- Added API coverage for:
  - Google Calendar OAuth start/callback
  - hashed state behavior through callback consumption
  - encrypted credential storage
  - primary calendar discovery
  - timed events
  - all-day events
  - cancelled events
  - idempotent incremental sync
  - source records
  - local dismissal
  - sync changes
  - disconnect
  - cross-user isolation
- Updated connector SDK tests to allow Gmail and Google Calendar while still rejecting Outlook/IMAP.
- Updated smoke script:
  - Calendar OAuth start controlled response
  - agenda list
  - OAuth-only account creation enforcement
- Added Playwright controlled Calendar coverage:
  - mocked connected Calendar account
  - Sync Now
  - agenda rendering without page reload
  - all-day/timed event rendering
  - normal Refresh retrieves newly available event
  - Open in Google Calendar link
  - local dismissal

## Milestone 4 Documentation

Updated:

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/API_CONTRACT.md`
- `docs/DATA_MODEL.md`
- `docs/SECURITY.md`
- `docs/DEPLOYMENT.md`
- `docs/ROADMAP.md`

Key docs:

- Google Calendar uses read-only scope:
  `https://www.googleapis.com/auth/calendar.readonly`
- Required redirect URI:
  `https://dentlink-api-preview.evanjrizzo.workers.dev/v1/connectors/google-calendar/callback`
- Worker non-secret var added:
  `GOOGLE_CALENDAR_REDIRECT_URI`
- Worker secrets remain:
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GMAIL_CREDENTIAL_ENCRYPTION_KEY`

## Validation Already Performed

- Baseline before Milestone 4:
  - `pnpm validate`: passed
  - `git diff --check`: passed
- During/final Milestone 4:
  - `pnpm --filter @dentlink/api test`: passed, 26 tests
  - `pnpm validate`: passed
  - `git diff --check`: passed
  - SQLite migration replay through `0005`: passed
  - `PRAGMA foreign_key_check`: no output
  - `PRAGMA integrity_check`: `ok`
  - `pnpm db:migrate:local`: passed, applied `0005_google_calendar_connector.sql`
  - Worker dry-run preview: passed
  - `pnpm db:migrate:preview`: passed, applied `0005_google_calendar_connector.sql`
  - `pnpm deploy:preview`: passed
  - preview Worker URL: `https://dentlink-api-preview.evanjrizzo.workers.dev`
  - preview Worker version ID: `755bb9a1-874e-4b3b-8d4e-5a385fa50420`
  - preview web build with preview API URL: passed
  - `pnpm deploy:web:preview`: passed
  - preview Pages deployment URL: `https://158f7a53.dentlink-web-preview.pages.dev`
  - stable preview web URL tested: `https://dentlink-web-preview.pages.dev`
  - remote smoke test: passed
  - preview Playwright: passed, 3 tests
- Remote D1 `PRAGMA integrity_check` was attempted but Cloudflare rejected it with
  `not authorized: SQLITE_AUTH`.

## Current Git Status Summary

Modified:

- `README.md`
- `wrangler.toml`
- `apps/api/src/d1-storage.ts`
- `apps/api/src/gmail.ts`
- `apps/api/src/index.test.ts`
- `apps/api/src/index.ts`
- `apps/api/src/storage.ts`
- `apps/api/src/validation.ts`
- `apps/web/src/notes-app.tsx`
- `apps/web/src/styles.css`
- `docs/API_CONTRACT.md`
- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/DEPLOYMENT.md`
- `docs/ROADMAP.md`
- `docs/SECURITY.md`
- `packages/api-client/src/index.ts`
- `packages/connector-sdk/src/index.test.ts`
- `packages/connector-sdk/src/index.ts`
- `packages/item-model/src/index.ts`
- `scripts/smoke-api.mjs`
- `tests/browser/milestone-2-1.spec.ts`

Added:

- `MEMORY.md`
- `apps/api/src/google.ts`
- `apps/api/src/google-calendar.ts`
- `migrations/0005_google_calendar_connector.sql`

Untracked pre-existing odd file:

- `h gmail notifications after sync"...` with terminal escape characters.

## Recommended Commit Message

```text
feat: implement milestone 4 google calendar connector
```

## Recommended Next Milestone

Milestone 5 should implement Calendar foundation and ICS/local calendar support:

- DentLink-local calendar events
- ICS import/export
- annotations
- source filters
- richer calendar views
- no provider writeback unless explicitly scoped
