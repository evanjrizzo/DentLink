# Data Model

Use a common item envelope with type-specific details.

Core concepts: users, sessions, devices, connector definitions, connector accounts, sync state, items, notification details, note details, calendar details, folders, tags, rules, ranking feedback, revisions, conflicts, webhook endpoints, AI usage, and audit events.

Notes belong to at most one folder and may have multiple tags.

Provider IDs are external identities, not DentLink primary keys.

Editable records use versions. Every user-owned record must include or derive user scope.
