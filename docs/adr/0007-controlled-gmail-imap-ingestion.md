# ADR 0007: Controlled Gmail IMAP Ingestion

Status: Accepted

Date: 2026-07-14

## Context

DentLink's Gmail API ingestion became operationally complex because it depended on history
checkpoints, historical backfill, Gmail API query/scope behavior, and reconnect-specific credential
upgrades. A Worker spike proved that Cloudflare Workers can connect to Gmail IMAP over TLS,
authenticate with XOAUTH2, search recent mail, fetch bounded MIME content, and parse messages within
runtime limits.

## Decision

DentLink will add Gmail IMAP as a second Gmail ingestion engine behind a per-account
`gmailIngestionEngine` setting. Existing accounts remain on `gmail_api` until explicitly migrated.
IMAP accounts require the `https://mail.google.com/` OAuth scope and must pass an IMAP capability
check before the credential replaces the existing one.

IMAP ingestion uses scheduled rolling recent-window scans rather than IMAP IDLE or Gmail history
checkpoint replay. It reuses the existing source-record, deterministic-rule, and Notification
pipeline. Source identity prefers `X-GM-MSGID`, then `Message-ID`, then an account/mailbox UID
fallback.

## Consequences

- Gmail API remains available while IMAP is validated in preview.
- Existing Gmail users are not switched automatically.
- IMAP reconnects intentionally request broader Gmail mailbox access than `gmail.readonly`; the UI
  must present this as an explicit reconnect requirement.
- Backfill is no longer the primary user recovery flow. Rolling scans and duplicate-safe source
  records provide recovery for recent missed mail.
- Provider protocol details stay out of generic UI; diagnostics show aggregate sync health and safe
  source-record outcomes.

## Alternatives Considered

- Continue investing in Gmail API history/backfill only. Rejected for now because the proven IMAP
  path reduces checkpoint and query-scope coupling.
- Switch all accounts immediately to IMAP. Rejected because existing users must not be silently
  moved to a broader OAuth scope.
