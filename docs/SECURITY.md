# Security

Priorities: cross-user exposure, stolen credentials, session theft, webhook abuse, malicious
payloads, secret leakage, unauthorized local commands, injection, and prompt injection.

## Identity and authorization

- Resolve identity server-side.
- Scope every query to authenticated user.
- Do not authorize based on client-supplied user IDs.
- Use revocable sessions and device/session management.
- Apply authorization checks before loading or mutating user-owned records.
- Milestone 1 uses bearer session tokens resolved server-side before Notes, folder, tag, sync, or
  conflict access.
- Raw session tokens are returned only at registration/login. Server storage keeps a SHA-256 token
  hash.
- Milestone 1.1 validates the same identity and user-isolation rules against the Cloudflare D1
  storage adapter.
- Milestone 2 applies the same server-resolved identity to Notifications and webhook endpoint
  management. Public webhook ingestion never accepts a client-supplied user ID; ownership is derived
  from the matched endpoint and hashed secret.
- Milestone 3 applies the same server-resolved identity to connector account and source-record
  management. Connector accounts and source records are always queried by authenticated user scope.

## Passwords

- Milestone 1 hashes passwords with Web Crypto PBKDF2-SHA-256, per-password random salt, and 100,000
  iterations, the Cloudflare Workers Web Crypto maximum for PBKDF2.
- Password hashes, salts, and iteration counts are stored separately from user-facing session
  payloads.
- Plaintext passwords are accepted only at registration/login request boundaries and are never
  returned.

## Sessions

- Session tokens are generated from 32 cryptographically random bytes.
- Session tokens expire after 30 days in Milestone 1.
- Logout removes the server-side session hash, so the prior bearer token cannot be reused.
- `GET /v1/auth/session` confirms identity without echoing the raw bearer token.
- The D1 adapter stores only token hashes in `sessions.token_hash`; raw bearer tokens are not
  persisted.
- Deployment configuration keeps secrets out of `wrangler.toml`; local `.dev.vars` and Wrangler
  secrets are ignored or stored outside Git.
- CORS is origin allowlist based. Production must set `ALLOWED_ORIGINS` to the real web origin
  rather than a wildcard.

## Credentials and secrets

- Encrypt provider credentials before storage.
- Prefer OAuth and least-privilege scopes.
- Store IMAP credentials and provider refresh tokens only after encryption.
- Never commit, log, expose, or include real secrets in examples.
- Support rotation for webhook secrets and provider credentials where possible.
- Named webhook endpoint secrets are generated from 32 cryptographically random bytes and returned
  once at endpoint creation.
- D1 and in-memory storage keep only the SHA-256 hash of webhook secrets. Raw webhook secrets are
  not listed, synced, or logged.
- Milestone 3 connector accounts store credential references and credential status only. They do not
  store or return raw OAuth tokens, refresh tokens, passwords, provider API keys, hashes, salts, or
  authorization headers.
- Provider-specific credential encryption and rotation remain required before any real provider
  connector, such as Gmail, is implemented.
- Milestone 3.1 stores Gmail refresh tokens only in `connector_credentials` after AES-GCM
  encryption. `connector_accounts` stores only a credential reference and credential status.
- `GMAIL_CREDENTIAL_ENCRYPTION_KEY` must be supplied as a Worker secret or local `.dev.vars` value
  and must decode to 32 bytes. Do not commit it. Rotation is handled by writing newly encrypted
  credentials with a higher encryption version in a future migration, then re-encrypting accounts
  during reconnect or a controlled maintenance task.
- Gmail OAuth state values are high-entropy random values. Only SHA-256 state hashes are stored
  server-side, and state records expire after 10 minutes and are consumed once.

## Webhooks and source content

- Use high-entropy webhook secrets, rotation, validation, and rate limiting.
- Treat source content as untrusted data.
- Validate payload shape and destination mapping.
- Avoid rendering untrusted HTML directly.
- Do not download attachments by default.
- Milestone 2 webhook ingestion requires `X-DentLink-Webhook-Secret`; secrets are not embedded in
  ingest URLs.
- Wrong-secret, disabled, or unknown webhook endpoints return a safe not-found response.
- Accepted deliveries are recorded and capped at 60 accepted deliveries per minute per endpoint.
- Deleted webhook endpoints are removed from active storage and cannot be reused for ingestion.
- Milestone 2.1 does not deduplicate webhook request replays. Replayed valid requests create another
  accepted delivery until a future idempotency key contract is added.
- Milestone 3 source records store normalized payload metadata for connector bookkeeping. Raw
  provider payload retention, attachment handling, and replay/idempotency behavior must be defined
  by future provider connectors before they ingest real external content.
- Gmail API synchronization uses `https://www.googleapis.com/auth/gmail.readonly` and does not
  request `gmail.modify`. The read-only scope is required because diagnostic backfill uses Gmail
  `users.messages.list` with the `q` search parameter; `gmail.metadata` cannot be used with `q`.
  IMAP synchronization is preview-only and requires an explicit reconnect to
  `https://mail.google.com/`. DentLink verifies the granted scope and IMAP login before replacing a
  credential or enabling the IMAP engine. Google Cloud OAuth consent configuration must include the
  scopes used by the selected engine, and DentLink must explicitly request them during Gmail OAuth.
  Gmail-created notifications use sender, subject, unread state, received metadata, connector
  reference, and a Gmail deep link.
- Milestone 7 Phase 1 records safe per-message Gmail ingestion outcomes and reasons in source
  records. It does not store raw message bodies, attachments, OAuth tokens, or provider credentials
  in diagnostics. Partial message failures are surfaced through degraded connector health instead of
  being treated as a healthy ingestion result.
- Gmail diagnostics are scoped to the authenticated owner of the connector account. The diagnostics
  endpoint returns aggregate counts, provider message IDs, safe processing reasons, processed
  timestamps, source record IDs, linked DentLink notification IDs, and durable sync-attempt
  summaries only; it does not expose raw email bodies, MIME parts, attachments, OAuth tokens, or
  provider credentials. Sync-attempt details are limited to safe connector state, trigger, engine,
  counts, outcome IDs/reasons, cursor-presence booleans, lock age/reference timestamps, comparison
  metrics, and safe error code/messages.
- The DentLink event stream is authenticated with the same bearer session model as the JSON API. It
  emits only metadata about DentLink-owned changes, such as change type, source, account ID, and
  revision. It never pushes email bodies, calendar descriptions, raw provider payloads, OAuth data,
  credentials, or authorization headers. Browser clients fetch updated user-scoped data through the
  normal API after receiving an event.
- Gmail rules are stored in the owned connector account settings and are applied server-side before
  Notification creation. Rule evaluation uses normalized metadata only and does not download or
  expose raw message bodies. Scheduled Gmail sync runs under Worker cron with stored encrypted
  credentials and the same user-scoped connector account checks as manual Sync Now.
- Milestone 7 Slice 4 normalizes bounded email text for optional summarization only after
  deterministic rules have allowed notification creation. Suppressed messages do not call OpenAI.
  DentLink never sends OAuth data, credentials, full raw MIME, attachment binary content, or hidden
  headers to AI providers. Email bodies are not written to normal logs, diagnostics exports, or the
  browser diagnostics surface. AI provider keys must be configured only as Worker secrets; the
  `/v1/ai/settings` response returns availability, effective enabled state, provider/model, safe
  unavailable reason, and usage state but never returns provider keys. Invalid, timed-out, or
  rate-limited AI responses are stored as safe AI failure metadata while the notification remains
  visible with deterministic fallback content.
- The read-only assistant endpoint sends only bounded, server-selected DentLink context to the AI
  provider: normalized notification fields, normalized Gmail source-record fields, and upcoming
  calendar event fields for the authenticated user, plus static product usage guidance. It does not
  send provider credentials, OAuth tokens, raw MIME, attachment binaries, hidden headers, cross-user
  data, or connector diagnostics. Source content is treated as untrusted prompt context, and
  assistant output is not allowed to mutate Gmail, Google Calendar, notifications, notes, connector
  accounts, or provider state.
- Milestone 4 Google Calendar synchronization uses the read-only Calendar scope, stores normalized
  event metadata and provider identifiers, and does not create, edit, delete, RSVP to, or manage
  attendees on Google Calendar events. Calendar refresh tokens use the same AES-GCM encrypted
  connector credential storage as Gmail. Agenda dismissal is DentLink-local state only.
- Milestone 5 ICS import accepts only authenticated, size-limited posted ICS text. DentLink does not
  fetch remote ICS URLs, read local filesystem paths, or execute/render HTML from event
  descriptions. Imported URLs are validated before being stored as source links.
- Milestone 5 local calendar event APIs reject provider ownership fields and require server-resolved
  user scope plus version checks. Google Calendar event fields remain read-only; DentLink
  annotations are stored separately and cannot mutate provider data.
- Milestone 5 ICS export emits only the authenticated user's allowed DentLink Local events by
  default and uses calendar download headers without exposing provider credentials or connector
  secrets.

## Local agents and platform actions

- Pair local agents explicitly.
- Never let the cloud execute arbitrary local commands directly.
- Route platform-specific behavior through capability layers.
- Treat local-agent submissions as authenticated but still untrusted input.

## AI safety

- Use structured AI outputs and require approval for sensitive actions.
- AI must not delete source content, dismiss items autonomously, send email, modify provider events,
  override explicit user rules, or produce unbounded ranking changes.
- Record provider, model, prompt or rule version, timestamp, confidence where available, source
  item, and usage metadata.
- Email AI is available when `OPENAI_API_KEY` is configured server-side and defaults to enabled for
  users with no explicit preference. Users may opt out through Settings -> AI, and
  `DENTLINK_AI_ENABLED=false` disables AI globally. Model and input length are configurable with
  `DENTLINK_AI_MODEL` and `DENTLINK_AI_MAX_INPUT_CHARS`.
- The assistant uses the same administrator-configured OpenAI key and `DENTLINK_AI_ENABLED` global
  disable switch. It is read-only and stateless in the first implementation; persistent transcripts,
  tools that take action, or provider writeback require a later approval and auditing design.
- Contextual notification actions are DentLink-local state changes. Complete and Dismiss update the
  authenticated user's notification record only; they do not archive, delete, reply to, or otherwise
  mutate Gmail, Google Calendar, webhooks, or future provider source records. Source-opening actions
  use stored safe source URLs and never expose provider credentials.
- Adaptive panels and icon actions are accessibility-sensitive UI behavior rather than new trust
  boundaries. Icon-only actions must keep accessible labels, focus styles, keyboard activation, and
  non-hover operation so touch and assistive-technology users can invoke the same local API actions.

## Data minimization

- Minimize body retention and do not download attachments by default.
- Do not claim end-to-end encryption in version one.
- Retain raw email body cache for a limited period, initially 7 to 30 days.

## Threats to revisit before implementation

- Cross-user data leakage in every query path
- Confused-deputy bugs in connector actions
- Webhook replay or endpoint guessing
- Session fixation or long-lived stolen sessions
- Prompt injection through email, webhooks, or calendar content
- Local-agent command abuse
- Accidental logging of credentials or private content
- Misconfigured preview or production Cloudflare secrets and origins
