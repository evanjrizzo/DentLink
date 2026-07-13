# Security

Priorities: cross-user exposure, stolen credentials, session theft, webhook abuse, malicious payloads, secret leakage, unauthorized local commands, injection, and prompt injection.

- Resolve identity server-side.
- Scope every query to authenticated user.
- Encrypt provider credentials before storage.
- Prefer OAuth and least-privilege scopes.
- Use high-entropy webhook secrets, rotation, validation, and rate limiting.
- Pair local agents explicitly.
- Never let the cloud execute arbitrary local commands directly.
- Treat source content as untrusted data.
- Use structured AI outputs and require approval for sensitive actions.
- Never commit secrets.
- Minimize body retention and do not download attachments by default.
- Do not claim end-to-end encryption in version one.
