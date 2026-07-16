# Product Requirements

## Scope

DentLink is a centralized personal dashboard for a single user's information streams. The first
deployment may be single-user, but the product must be designed as multi-user from the beginning.

## Authentication

Email/password initially, with secure sessions, password reset structure, email verification
structure, and revocable device sessions.

## Notifications

Ranked email summaries, webhook notifications, connector alerts, reminders, and future phone
notifications. Support contextual Complete for actionable items, Dismiss to remove items from Active
without implying completion, pin, source opening, global reorder, and Ranking Mode relevance
controls. Keep fetched email searchable even when not promoted.

Default email scope: inbox plus user-selected folders/labels. Initial import: previous seven days.

Notification cards must show source identity, source color or label, ranking explanation
availability, and a route to the original source where supported.

## Notes

Tasks and reference notes with title, body, one folder, multiple tags, due date, priority, pin,
global order, search, edit, optional URL, and done for tasks.

Notes may be created manually, through clients, named webhooks, future voice/Pebble capture, or
approved AI task suggestions. AI-created task suggestions require approval before becoming user
tasks.

Note titles are limited to 72 Unicode grapheme clusters. Notes may appear as all-day calendar items
when they have due dates; overdue active notes continue to appear in today's agenda until completed.

## Calendar

Google, Microsoft, ICS, and DentLink-local events. Day/week/month/agenda views, filtering, colors,
annotations, source links, ICS export, and later explicit provider sync. Agenda dismissal does not
remove grid events.

Initial import: previous 30 days and next 12 months.

DentLink annotations and agenda dismissal are local metadata unless explicit provider
synchronization is added later.

## Webhooks

Multiple named endpoints per user with secret, enabled state, destination, defaults, mapping, rate
limit, and health. Destinations: Notifications, Notes, Calendar.

## Ranking Mode

Web and desktop only initially. Enables dismiss, positive feedback, ranking explanation, and
optional structured reason.

Normal Dismiss is available as a local History action. Ranking Mode exposes more detailed relevance
feedback and ranking explanations. Complete remains available outside Ranking Mode only where
existing metadata makes the notification actionable.

## Retention

Summaries and history retained until deletion. Raw email body cached for a limited period, initially
7–30 days. Attachments not downloaded by default. Credentials encrypted.

## AI

Optional OpenAI integration using one administrator key initially. AI task suggestions require
approval.

The system must record provider, model, prompt or rule version, timestamp, confidence where
available, source item, and usage metadata for AI outputs.

Custom AI importance instructions supplement DentLink's fixed scoring instructions. Notification
thresholds are applied after scoring and are not sent to the AI provider.

The Home assistant is a read-only question-answering surface. It may answer from bounded,
authenticated DentLink context such as normalized Gmail source records and calendar events, and it
must return source references where possible. It must not send mail, modify provider data, complete
or dismiss items, create notes, or take calendar actions without a later explicit approval workflow.

## Offline

Clients cache data and queue mutations. Conflicts preserve both edits and notify the user.

Editable records include a version. Mutations include the expected version. If versions conflict,
DentLink preserves both revisions, creates a conflict record, and offers keep mine, keep theirs,
merge, or keep both.

## Desktop requirements

Touchscreen layout, fullscreen placement, configurable macro pad, files, terminal, mute, Voice FX,
chimes, badges, and health monitoring.

## Android widget

Compact Notifications/Notes view, quick note, done, refresh, and source/app opening where possible.

## Non-goals

- Replacing email or calendar providers
- Arbitrary automation
- Team collaboration
- AI-required operation
- Cloud execution of arbitrary desktop commands
