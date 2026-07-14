# API App

Responsibility: Cloudflare Worker-style API and ingestion boundary.

This app owns the auth, manual Notes, Notifications, named webhook, and provider-neutral connector
plumbing API handler, request validation, server-side session identity, user isolation, sync
responses, note history, and conflict persistence. Session storage keeps token hashes rather than
raw bearer tokens. Webhook endpoint storage keeps only hashed webhook secrets and returns the raw
secret once at endpoint creation. Connector account storage keeps credential references only, not
raw provider credentials. It must not execute arbitrary desktop commands or accept client-supplied
user IDs for authorization.

It does not implement Gmail, Google Calendar, Outlook, Microsoft Graph, IMAP, provider OAuth, Tauri,
Android, widgets, push notifications, ranking changes, or AI calls.

Milestone 1.2 runs this app as the Cloudflare Worker entrypoint. Runtime configuration comes from
`wrangler.toml` and Worker environment variables; D1 is bound as `DB`. The public deployment check
is `GET /v1/health`, which returns only safe environment/build/database reachability information.
