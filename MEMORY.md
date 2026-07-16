# DentLink Agent Memory

## Current Branch

- Branch: `development`
- Latest observed commit: `8ccfae8 Fix calendar browser test selector`.
- Worktree was clean before the current cleanup and Notes UI work.

## Current Product State

- Current documented implementation state: Milestone 7 Slice 4.4.
- Implemented major capabilities:
  - Email/password auth, server-side sessions, user-isolated Notes, folders, tags, history,
    conflicts, optimistic note mutations, and cursor sync.
  - Notifications, History, named webhooks, one-time webhook secrets, and webhook delivery
    recording.
  - Provider-neutral connector account/source-record framework.
  - Gmail OAuth, Gmail API synchronization, diagnostics, per-message ingestion outcomes, duplicate
    prevention, deterministic Gmail rules, scheduled Gmail sync, diagnostic backfill, and preview
    Gmail IMAP engine selection.
  - Metadata-only authenticated event stream, polling fallback, visibility refresh, and `sync-all`
    refresh orchestration.
  - Optional provider-neutral OpenAI email summarization/classification after deterministic rules,
    user AI settings, user importance preferences, usage accounting, and suppressed notification
    status.
  - Read-only Home assistant that answers from bounded DentLink Gmail source-record and calendar
    context when AI is configured.
  - Read-only Google Calendar connector.
  - DentLink Local calendar events, source-filtered agenda/day/week/month views, provider-event
    annotations, and ICS import/export.
  - Responsive touch-first web UI with adaptive bottom sheets/right panels.
  - Contextual notification actions: Pin/Unpin and Dismiss generally available, source Open only
    when supported, and Complete only for actionable notifications.

## Current Home Assistant Change

- The web app now has a top-level `Home` tab and uses it as the default signed-in view.
- Home now combines a glanceable Today strip, Priority Inbox, Due Notes, Needs Review, quick task
  capture, contextual assistant prompt chips, and a responsive assistant chat panel. Connector
  health remains in Settings rather than Home.
- `POST /v1/assistant/chat` is a stateless authenticated endpoint. It resolves user identity
  server-side, gathers bounded normalized Gmail source-record context and upcoming calendar events,
  and calls the provider-neutral AI boundary.
- The assistant response returns text plus source references for emails and calendar events. Chat
  history is transient browser state only.
- The assistant is read-only in this slice. It does not send email, mutate providers, complete or
  dismiss notifications, create notes, update calendar events, or write connector state.
- Missing `OPENAI_API_KEY` or `DENTLINK_AI_ENABLED=false` returns a stable assistant error instead
  of falling through to an internal error.
- Follow-up fix: Home assistant now shows a thinking indicator while a request is in flight.
  Pressing Enter sends immediately, while Shift+Enter inserts a newline.
- Follow-up fix: assistant email retrieval treats "latest", "newest", "recent", and "new messages"
  as received-time queries instead of sender/subject search terms. "Latest 5" now limits context to
  the five newest deduplicated email records before calling AI.
- Follow-up fix: assistant context now includes normalized Notifications as first-class context.
  Notifications and email are sent newest-first, calendar events are sent earliest-upcoming first,
  and backend response source previews are sorted before returning to the web client.
- Follow-up fix: assistant answers are now prompted to stay concise, source card IDs are capped at
  five, and latest/new/recent notification or email questions without an explicit count receive only
  the five newest context items by default.
- Follow-up fix: the Home assistant transcript auto-scrolls to new messages while the user is at the
  bottom, but stops following when the transcript is manually scrolled upward.
- Follow-up fix: assistant context now includes bounded static DentLink usage guidance so "how do I
  use DentLink" questions can be answered without relying on notification, Gmail, or calendar data.
- Follow-up fix: assistant answers now normalize inline numbered and bulleted lists so repeated
  markers render on separate lines for readability.

## Current Cleanup

- `README.md` migration replay commands were corrected to match the actual migration filenames:
  - `0007_gmail_ingestion_outcomes.sql`
  - `0008_gmail_rules.sql`
  - `0009_email_sorting_ai.sql`
  - `0010_ai_user_preferences.sql`
  - `0011_notification_suppressed_status.sql`
- This memory file was refreshed from its obsolete Milestone 4 handoff state.

## Current Notes UI Change

- The shared Notes workspace now includes a `Show completed notes` checkbox in Filters.
- Completed notes are visible by default.
- Clearing the checkbox hides notes with `status = "done"` from the visible Notes lists and folder
  group counts without deleting or mutating them.
- When completed notes are visible, active notes sort before completed notes within the same folder
  or visible list.
- Note completion checkboxes on cards are larger and touch-friendlier.

## Current Settings Connections Fix

- Settings -> Connections Gmail cards now compute Next Scheduled Sync from the engine diagnostic
  timestamp with account `lastSyncAt` as a fallback.
- If the expected five-minute scheduled window is already in the past, the card shows `Due now`
  instead of displaying a stale past timestamp.
- The web header countdown is now an explicit one-minute auto-sync timer. Each visible timer tick
  calls backend `sync-all` for connected supported services before reloading Notifications and other
  DentLink data; the header label says `Auto sync` instead of `Live`.
- Invalid or missing sync timestamps still show `Within 5 minutes after activation`.
- Gmail diagnostics now distinguish the latest sync check from the latest per-message processing
  outcome. If a newer sync check finds no newer eligible messages, Connections shows an explanatory
  note instead of implying processing is stale.
- Durable Gmail sync-attempt logging is implemented through `connector_sync_attempts` and migration
  `0012_connector_sync_attempts.sql`. Manual Sync Now, Refresh All, scheduled sync, backfill,
  skipped fresh-lock attempts, partial attempts, and failed attempts append safe diagnostic rows.
- Scheduled fresh-lock skips are logged as `skipped` attempts with safe lock reference time and lock
  age details so delayed cron cycles can be distinguished from missing sync activity.
- Refresh All and manual Gmail sync treat an orphaned `syncing` lock as stale after 60 seconds,
  while scheduled sync keeps the five-minute stale window. This gives user-initiated refreshes a
  faster recovery path when a previous Gmail poll was interrupted after marking the account
  `syncing`.
- Refresh All reports a fresh Gmail `sync_in_progress` lock as a skipped connector instead of a
  failed connector while still appending the durable skipped attempt log.
- Gmail IMAP sync now stores the last observed INBOX UID and UIDVALIDITY on the connector account.
  When UIDVALIDITY still matches, subsequent IMAP polls search only for UIDs newer than the stored
  UID. If UIDVALIDITY is missing or changes, sync falls back to the rolling recent-window scan. The
  cursor advances only when the IMAP sync has no per-message failures. Source records store safe
  IMAP UID metadata for diagnostics.
- Settings -> Connections shows recent Gmail sync attempts and the diagnostics JSON export includes
  the full safe attempt rows. Attempt logs include trigger, engine, status, timestamps, duration,
  counts, safe error code/message, and safe details; they must not include OAuth tokens, refresh
  tokens, raw email bodies, MIME parts, or attachment binaries.
- Gmail API sync now requests full message payloads and extracts bounded text/plain or cleaned HTML
  body text for normalized source records and optional AI. Previously, Gmail API messages were
  metadata-only and therefore produced `ai.status = skipped` even when the original email had a
  body. IMAP sync already parsed MIME bodies.
- Settings -> Connections keeps the just-saved Gmail requested engine in local UI state after a
  successful save. This prevents the ingestion engine select from visually snapping back to Gmail
  API while IMAP is requested but still awaiting reconnect/permission verification.
- Follow-up hardening: the Gmail engine selector now optimistically writes the requested engine into
  the local connector account immediately and prefers the API's explicit `requestedEngine` field
  over the active engine. This keeps the select on IMAP even while Active Engine remains Gmail API
  until reconnect verifies the mail scope.

## Current Gmail Timing Observation

- After the IMAP UID cursor deployment, new dual-recipient Gmail tests were created in DentLink
  roughly 40 to 55 seconds after Gmail receipt, dominated by the one-minute auto-sync cadence.
- Actual UID-incremental Gmail IMAP sync work is now typically sub-second for duplicate checks and
  roughly 2.5 to 4.5 seconds when creating a notification.
- The latest observed successful UID-incremental attempts discovered and fetched one newer UID per
  account, skipped Gmail API comparison, appended durable attempt logs, and left both Gmail accounts
  `idle`.

## Known Deferred Work

- Rich unified Dashboard widgets around the Home assistant.
- Full cross-source ranking and ranking explanations across Notifications, Notes, and Calendar.
- Microsoft 365, Outlook, and production generic IMAP rollout.
- Google Calendar writeback/provider event editing.
- Tauri desktop, Android app, Android widget, push notifications, and provider mutation actions such
  as email archive/reply or calendar RSVP.

## Validation Notes

- Standard local validation command remains:

```bash
pnpm validate
```

- Focused checks that are useful after this cleanup:

```bash
pnpm --filter @dentlink/ui typecheck
pnpm --filter @dentlink/web typecheck
pnpm --filter @dentlink/web test
git diff --check
```

## Session Handoff 2026-07-16

- Latest deployed API preview after Gmail API body extraction:
  `https://dentlink-api-preview.evanjrizzo.workers.dev`, version
  `6120fbe0-6cdd-46d9-be60-6a18c0219541`.
- Latest deployed web preview after Gmail engine selector hardening:
  `https://6eb81c43.dentlink-web-preview.pages.dev`.
- Gmail API messages now fetch `format=full`, extract bounded text/plain or cleaned HTML body text,
  and avoid attachment bodies. This fixes new Gmail API notifications that previously showed
  `ai.status = skipped` despite real email bodies.
- Existing skipped Gmail API notifications created before the body extraction fix still do not have
  stored body text. Repairing those requires a future refetch/backfill path that updates source
  records and reprocesses AI.
- IMAP engine switching should keep the dropdown on Gmail IMAP immediately after selection, even
  while Active Engine remains Gmail API until reconnect verifies the `https://mail.google.com/`
  scope. If it still snaps back for JP, check whether the web build is
  `https://6eb81c43.dentlink-web-preview.pages.dev` and capture the selector error text under the
  control; that would indicate the PUT is failing in his browser session.
- Last focused validation run:
  - `pnpm --filter @dentlink/api typecheck`
  - `pnpm --filter @dentlink/api test` — 90 passed
  - `pnpm --filter @dentlink/web typecheck`
  - `pnpm --filter @dentlink/web test` — 3 passed
  - `git diff --check`
  - `pnpm smoke:api https://dentlink-api-preview.evanjrizzo.workers.dev`
