# ADR 0012: Zero-knowledge user data archive

Status: Accepted Date: 2026-07-29

## Context

DentLink must prevent the D1 database from filling while preserving existing app behavior. The
immediate cause is `sync_changes` storing full mutation snapshots, especially high-churn calendar
events. DentLink also needs a stronger privacy boundary: user content should be inaccessible to
storage administrators or anyone with direct D1/R2 access.

An automatic account-based key cannot be zero-knowledge if it is derived only from server-side
account data. Anyone with backend data and code access could reproduce that key. Password changes
also must not destroy access to historical data, so content encryption cannot be directly tied to
the login password hash.

## Decision

`sync_changes` is a cursor/invalidation log, not an archive. It stores only compact per-user
metadata: entity type, operation, entity ID, user ID, and cursor timestamps. The authoritative
entity tables remain the source of truth for current app behavior.

Archived user content will use client-held envelope encryption:

- Generate a random per-user content encryption key.
- Encrypt archived objects with Web Crypto AES-GCM using fresh nonces per object.
- Store encrypted archive objects in R2 under user-scoped prefixes.
- Store only ciphertext metadata and a small user-scoped archive index in D1.
- Wrap the content key separately from the login password so password changes do not re-encrypt or
  orphan data.
- Prefer automatic unlock via a device/passkey-backed key wrapper where available; otherwise use a
  recovery phrase or user-held recovery key.

Server-side assistant access to archived plaintext requires an explicit authenticated user-mediated
grant. The backend may decrypt only for that request/session, must not persist plaintext, and must
not log decrypted content. Without such a grant, the assistant can search only plaintext metadata
that was intentionally left outside the encrypted archive.

## Consequences

Direct D1/R2 access cannot read encrypted archived content. User data remains separated by
authenticated `user_id` checks and user-scoped R2 object prefixes.

Zero-knowledge cannot be implemented as a backend-only silent migration. The frontend or native
clients must participate in key creation, wrapping, unlock, recovery, and assistant grants.

Password resets do not affect encrypted archive access as long as at least one independent key
wrapper or recovery key remains available.

## Alternatives Considered

Server-derived account key: rejected for zero-knowledge because backend access can derive it.

Cloudflare-managed R2/D1 encryption only: rejected as insufficient because platform/backend
administrators can still access plaintext through the application layer.

Immediate encryption of all active D1 rows: deferred because it would change current list, search,
sync, assistant, and connector behavior unless client key flows are implemented first.
