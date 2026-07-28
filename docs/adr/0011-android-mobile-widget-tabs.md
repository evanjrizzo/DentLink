# ADR 0011: Android Mobile App and Tabbed Widget

Status: Accepted

Date: 2026-07-23

## Context

DentLink needs an Android mobile app and home-screen widget without fragmenting the product model.
The PC app includes source-specific Calendar, Notes, and Notifications views. The Android widget
should expose source-specific Calendar, Notes, and Emails tabs in a compact multiple-tab design
while preserving the backend as the authority for normalized state, ordering, ranking, connector
sync, and user scope.

The widget also needs to look like DentLink. Color scheme, font choices, logo assets, source accent
behavior, and compact card treatment must come from shared design tokens rather than being copied
into Android-specific business code.

## Decision

Add an Android-first `apps/mobile` client boundary. The mobile app owns Android session storage,
local cache, offline mutation queue integration, native intents, and native widget integration. It
uses the existing versioned API, shared item model, API client, sync engine, and design tokens.

The initial Android widget has three tabs:

- `Calendar`: compact list of active upcoming calendar events.
- `Notes`: compact list of active notes, with note completion available from a checkbox.
- `Emails`: compact list of active email notifications using backend-provided rank and global order,
  with pinned items first.

Widget rendering is native Android, but the widget contract is typed in the mobile boundary so tests
can verify tab identity, display selection, and brand-token usage. Widget actions enqueue versioned
DentLink API mutations through the mobile client; they do not call providers directly and do not
calculate authoritative rank. Widget surface taps and item taps do not open the app; only explicit
widget controls perform widget actions. The widget refreshes authenticated DentLink content every
five minutes.

## Consequences

- Android can use native widgets while still sharing DentLink contracts.
- The widget remains a compact view over backend-owned data, not a provider poller or independent
  ranking engine.
- Source-specific tabs become product vocabulary for the widget, so future source/view label changes
  should update this ADR by supersession if the concept changes.
- Shared visual tokens need to be real exported values, not only CSS custom properties inside the
  web app.

## Alternatives Considered

- Single combined widget feed. Rejected because the requested interaction explicitly separates
  Calendar, Notes, and Emails, and tabs keep each list scannable.
- WebView widget. Rejected because Android widgets require native rendering and should not embed
  the full web client.
- Android-specific duplicated colors and sort rules. Rejected because it would drift from the PC app
  and duplicate client behavior.
