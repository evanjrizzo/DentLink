# DentLink Vision

## Definition

DentLink is a unified personal information hub that aggregates, organizes, ranks, and presents information from many independent systems without replacing them.

## Problem

Important information is fragmented across email accounts, calendars, notifications, webhooks, notes, desktop tools, and mobile devices. DentLink creates one glanceable command center.

## Product question

> What do I need to know, do, or review right now?

## Target user experience

DentLink should feel like one dependable command center rather than another inbox. The first screen should quickly surface the highest-value notifications, tasks, and calendar context while keeping the full source history searchable and reachable.

Users should be able to act quickly:

- mark handled items done
- pin important items
- open the authoritative source
- create or edit notes
- review ranking explanations
- enter Ranking Mode when they want to tune relevance
- switch between calendar views without losing provider context

## Experience principles

- Useful at a glance
- Deep detail is one click away
- Original systems remain authoritative
- Important information rises without making other information disappear
- User control outranks automation
- Configuration is powerful but unobtrusive
- Data behaves consistently across platforms
- Platform-specific features do not fragment the system

## Primary sections

### Notifications

Notifications contain ranked externally sourced information: email summaries, webhook alerts, connector alerts, reminders, future phone notifications, and conservative AI action suggestions. Every fetched email remains available in a searchable source inbox, even when it is not promoted into Notifications.

### Notes

Notes contain user-created or captured tasks and reference material. Notes may originate manually, through clients, named webhooks, Pebble or voice capture, or approved AI suggestions. They support one folder, multiple tags, due dates, priorities, pins, search, editing, global ordering, and optional source URLs.

### Calendar

Calendar combines Google Calendar, Microsoft 365 Calendar, ICS imports, and DentLink-created events. It supports day, week, month, and agenda views; source filtering; colors; source links; DentLink-only annotations; local events; and later explicit provider synchronization.

Agenda dismissal hides an event from the agenda only. It must not modify the provider event or remove the event from the calendar grid.

## Control semantics

Done means the item was handled. It moves applicable items to completed history and does not strongly penalize similar future items.

Dismiss is available only in Ranking Mode on web and desktop. It means the item should not have been promoted, moves it to dismissed history, and records negative relevance feedback. It must not modify the source item.

Manual drag ordering changes the user's ordering preference. It must not automatically create negative feedback.

## Long-term direction

Users can add accounts, webhooks, rules, polling preferences, colors, connectors, local agents, and interchangeable AI providers while remaining isolated from other users.

## Never become

- Dependent on one AI vendor
- Dependent on one platform
- A system that silently deletes provider data
- A system where one user can access another user's data
- A collection of incompatible client implementations
