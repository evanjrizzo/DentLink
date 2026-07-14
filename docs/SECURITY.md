# Security

Priorities: cross-user exposure, stolen credentials, session theft, webhook abuse, malicious payloads, secret leakage, unauthorized local commands, injection, and prompt injection.

## Identity and authorization

- Resolve identity server-side.
- Scope every query to authenticated user.
- Do not authorize based on client-supplied user IDs.
- Use revocable sessions and device/session management.
- Apply authorization checks before loading or mutating user-owned records.
- Milestone 1 uses bearer session tokens resolved server-side before Notes, folder, tag, sync, or conflict access.
- Raw session tokens are returned only at registration/login. Server storage keeps a SHA-256 token hash.

## Passwords

- Milestone 1 hashes passwords with Web Crypto PBKDF2-SHA-256, per-password random salt, and 210,000 iterations.
- Password hashes, salts, and iteration counts are stored separately from user-facing session payloads.
- Plaintext passwords are accepted only at registration/login request boundaries and are never returned.

## Sessions

- Session tokens are generated from 32 cryptographically random bytes.
- Session tokens expire after 30 days in Milestone 1.
- Logout removes the server-side session hash, so the prior bearer token cannot be reused.
- `GET /v1/auth/session` confirms identity without echoing the raw bearer token.

## Credentials and secrets

- Encrypt provider credentials before storage.
- Prefer OAuth and least-privilege scopes.
- Store IMAP credentials and provider refresh tokens only after encryption.
- Never commit, log, expose, or include real secrets in examples.
- Support rotation for webhook secrets and provider credentials where possible.

## Webhooks and source content

- Use high-entropy webhook secrets, rotation, validation, and rate limiting.
- Treat source content as untrusted data.
- Validate payload shape and destination mapping.
- Avoid rendering untrusted HTML directly.
- Do not download attachments by default.

## Local agents and platform actions

- Pair local agents explicitly.
- Never let the cloud execute arbitrary local commands directly.
- Route platform-specific behavior through capability layers.
- Treat local-agent submissions as authenticated but still untrusted input.

## AI safety

- Use structured AI outputs and require approval for sensitive actions.
- AI must not delete source content, dismiss items autonomously, send email, modify provider events, override explicit user rules, or produce unbounded ranking changes.
- Record provider, model, prompt or rule version, timestamp, confidence where available, source item, and usage metadata.

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
