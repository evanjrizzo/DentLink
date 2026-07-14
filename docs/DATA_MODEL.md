# Data Model

Use a common item envelope with type-specific details.

## Core concepts

- users
- sessions
- devices
- connector definitions
- connector accounts
- connector sync state
- items
- notification details
- note details
- calendar details
- folders
- tags
- rules
- ranking results
- ranking feedback
- revisions
- conflicts
- webhook endpoints
- AI usage
- audit events

Notes belong to at most one folder and may have multiple tags.

Provider IDs are external identities, not DentLink primary keys.

Editable records use versions. Every user-owned record must include or derive user scope.

## Item envelope

Every promoted or user-visible unit uses a shared envelope:

- `id`: DentLink primary identifier
- `userId`: server-owned user scope, never accepted from client authorization input
- `type`: notification, note, calendar_event, or future supported type
- `source`: connector, webhook, manual, local_agent, or system
- `sourceAccountId`: optional connector account reference
- `sourceExternalId`: optional provider identifier
- `title`
- `summary`
- `status`: active, done, dismissed, archived, or deleted where applicable
- `pinned`
- `rank`
- `rankExplanationId`
- `globalOrder`
- `createdAt`
- `updatedAt`
- `version`
- type-specific detail reference

The envelope must remain provider-neutral. Raw connector payloads belong in connector storage or source-specific records, not in generic UI models.

## Type-specific details

Notification details capture source URL, sender or origin label, severity, promotion reason, source timestamps, and searchable summary/body metadata.

Note details capture task/reference type, body, folder, tags, due date, priority, source URL, and completion metadata.

Calendar details capture start/end times, timezone, all-day status, recurrence reference, location, attendees where allowed, source link, DentLink annotations, and agenda-hidden state.

## Conflict and revision model

Editable records keep revisions with editor metadata and version numbers. Mutations include `expectedVersion`. When a conflict occurs, DentLink stores both revisions, creates a conflict record, and returns enough information for clients to offer resolution options.

## Retention model

Summaries, normalized metadata, history, and user-created notes persist until deletion. Raw email body cache is limited, initially 7 to 30 days. Attachments are not downloaded by default.

## Milestone 1 D1 schema

`migrations/0001_auth_notes.sql` creates the first durable schema:

- `users`: user identity, normalized email, and password hash metadata.
- `sessions`: revocable authenticated sessions scoped to users. Only session token hashes are stored.
- `folders`: one-folder-per-note organization, user-scoped with unique names per user.
- `tags`: reusable user-scoped note labels.
- `notes`: task/reference notes with due date, priority, pin, status, global order, source URL, version, and completion metadata.
- `note_tags`: many-to-many tag assignments.
- `note_history`: immutable snapshots for created, updated, done, reopened, deleted, and reordered events.
- `note_conflicts`: persisted optimistic concurrency conflicts with attempted patch and server snapshot.
- `sync_changes`: deterministic cursor-based changes for notes, folders, tags, conflicts, and delete tombstones.

Every table containing user data includes `user_id` directly or through a user-scoped parent record.

Milestone 1 sync cursors are numeric change-log positions. Clients should treat them as opaque and
send back only the cursor returned by the API.
