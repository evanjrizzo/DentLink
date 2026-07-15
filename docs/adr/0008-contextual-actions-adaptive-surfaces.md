# ADR 0008: Contextual Notification Actions and Adaptive Surfaces

Status: Accepted

Date: 2026-07-15

## Context

DentLink's touch-first web UI must work on phone-sized browsers, narrow landscape layouts, a
1280x720 dedicated touchscreen dashboard, standard desktops, and large desktops. The previous
generic Notification action row showed the same large text actions for every item, including
irrelevant Complete/Done actions on FYI messages. Right-side panels also used a narrow fixed width
that clipped forms such as local event creation, note editing, notification details, and ICS import.

## Decision

Notification cards use contextual compact actions. Pin/Unpin and Dismiss are generally available,
source Open appears only when a source URL exists, and Complete appears only when existing metadata
marks the notification actionable. Actionability is derived from AI `requiresAction`, non-ignore
suggested actions, action-oriented categories, high-priority deterministic rules, task-like source
labels, or explicit deadlines. Importance alone is not actionability.

Complete maps to the existing `status = done` state and means the user handled the required action.
Dismiss maps to `status = dismissed` and means the user removed the item from Active without
claiming the action was completed. Both states appear in History and can be restored through the
existing versioned notification API.

Adaptive surfaces share tokenized sizing. Phone, narrow landscape, and short dashboard-height
viewports use bottom sheets. Wider and taller desktop layouts may use right-side panels only when
the panel can meet its minimum content width and the remaining main content remains usable. Panels
have sticky headers, independent internal scrolling, compact accessible close controls, and
one-column forms by default; container queries permit two columns only when the panel itself is wide
enough.

## Consequences

- The data model and API do not need a new migration for this slice.
- UI action labels are more precise: Complete replaces ambiguous Done where the action is shown.
- Dismiss remains a local DentLink state change and must not mutate Gmail, Google Calendar, or any
  provider source.
- Icon-only controls must keep accessible names, keyboard operation, visible focus, and touch target
  sizing.
- Google Calendar provider events remain read-only; only DentLink annotations/local state may
  change.

## Alternatives Considered

- Keep generic Pin/Done/Dismiss buttons everywhere. Rejected because it confused FYI messages with
  actionable work and consumed too much mobile space.
- Add new provider actions such as archive or reply. Rejected because provider mutation and email
  actions are outside this slice.
- Use only side panels on tablet/desktop breakpoints. Rejected because 1280x720 has enough width but
  not enough height for cramped fixed panels; actual usable width and height both matter.
