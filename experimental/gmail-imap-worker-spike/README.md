# Gmail IMAP Worker Feasibility Spike

This directory is an isolated prototype for answering one question:

Can Cloudflare Workers reliably poll Gmail IMAP using OAuth2 XOAUTH2?

It is not part of the DentLink production API. Do not deploy it as DentLink and do not use it to
change the current Gmail API connector.

## Phase 1: Workers compatibility

- Cloudflare Workers expose outbound TCP sockets through `cloudflare:sockets`.
- `connect()` supports `secureTransport: "on"` for implicit TLS and `secureTransport: "starttls"`
  for STARTTLS.
- Gmail IMAP should use implicit TLS to `imap.gmail.com:993`.
- STARTTLS remains relevant for future generic IMAP providers on port 143.
- Existing Node IMAP libraries commonly assume Node `net.Socket` streams. A lightweight custom IMAP
  client is preferable for this spike because it proves the exact Worker stream APIs and avoids
  dependency compatibility ambiguity.
- Gmail XOAUTH2 for IMAP requires the OAuth scope `https://mail.google.com/`. DentLink's current
  Gmail API `gmail.readonly` credential is not sufficient for this IMAP test.

## Prototype architecture

`worker.ts` implements a narrow IMAP client:

1. Open TLS socket to Gmail IMAP.
2. Authenticate with XOAUTH2.
3. `SELECT INBOX`.
4. `UID SEARCH SINCE <yesterday>`.
5. `UID FETCH <uid>` headers for one message.
6. `UID FETCH <uid> BODY.PEEK[]` full MIME for one message.
7. Parse Subject, From, To, Date, Message-ID, plain text, HTML, and attachment metadata.

It intentionally does not create DentLink notifications, source records, checkpoints, migrations,
rules, AI summaries, or production connector state.

## Safe OAuth flow

The deployed spike has an isolated OAuth flow for Gmail IMAP credentials:

- `GET /oauth/start`
- `GET /oauth/callback`
- `GET /run`

`/oauth/start` and `/run` require either:

- `Authorization: Bearer <SPIKE_ADMIN_KEY>`
- or `?key=<SPIKE_ADMIN_KEY>`

The OAuth request uses:

- `scope=https://mail.google.com/`
- `access_type=offline`
- `prompt=consent`

The callback stores the returned refresh token encrypted in `TOKEN_KV` using
`SPIKE_TOKEN_ENCRYPTION_KEY`. Token values, authorization codes, client secrets, and authorization
headers are never returned by the Worker.

Required remote secrets:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GMAIL_IMAP_USER`
- `SPIKE_ADMIN_KEY`
- `SPIKE_STATE_SECRET`
- `SPIKE_TOKEN_ENCRYPTION_KEY`

The isolated Worker name is `dentlink-gmail-imap-spike-preview`.

## Running the spike

Use a Gmail OAuth access token with the `https://mail.google.com/` scope. For a real repeatable
test, prefer the isolated OAuth flow above so the Worker performs the same token-refresh shape
DentLink already uses without writing to DentLink connector storage.

Required:

- `GMAIL_IMAP_USER`
- Either an encrypted token in `TOKEN_KV`, `GMAIL_IMAP_ACCESS_TOKEN`, or all of:
  - `GMAIL_IMAP_REFRESH_TOKEN`
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`

Local run:

```sh
pnpm exec wrangler dev experimental/gmail-imap-worker-spike/worker.ts \
  --config experimental/gmail-imap-worker-spike/wrangler.toml \
  --local
```

Then request:

```sh
curl -H "Authorization: Bearer $SPIKE_ADMIN_KEY" http://127.0.0.1:8787/run
```

Remote preview-style validation can use:

```sh
pnpm exec wrangler dev experimental/gmail-imap-worker-spike/worker.ts \
  --config experimental/gmail-imap-worker-spike/wrangler.toml \
  --remote
```

Do not deploy this Worker as a DentLink service or production Worker.

After deployment, run 10 remote probes with:

```sh
SPIKE_RUN_URL="https://dentlink-gmail-imap-spike-preview.<account>.workers.dev/run" \
SPIKE_ADMIN_KEY="..." \
node experimental/gmail-imap-worker-spike/run-remote-probe.mjs
```

## Measurements captured

The JSON result includes only sanitized structural data:

- connection latency
- authentication latency
- mailbox select latency
- search latency
- header fetch latency
- full MIME fetch latency
- parse latency
- total elapsed time
- approximate response bytes for each IMAP stage
- whether Subject/From/To/Date/Message-ID are present
- whether plain text or HTML are present
- attachment count and content types
- identifier availability for X-GM-MSGID, Message-ID, UID, UIDVALIDITY, and INTERNALDATE
- recovery notes

The JSON result intentionally does not include email bodies, full subjects, addresses, tokens,
authorization codes, refresh tokens, access tokens, client secrets, or attachment contents.

Worker CPU and memory are not directly exposed through standard runtime APIs in this prototype. Use
Wrangler logs/observability for CPU wall time and platform memory data when running remotely.

## Current comparison hypothesis

IMAP should be simpler for recovery because a rolling recent-window scan can be correct without
Gmail history checkpoints. The real feasibility risk is not Gmail protocol support; it is whether
Workers TCP sockets plus a small IMAP client behave reliably enough under scheduled execution.

## Live validation summary: 2026-07-14

Isolated Worker:

- Name: `dentlink-gmail-imap-spike-preview`
- URL: `https://dentlink-gmail-imap-spike-preview.evanjrizzo.workers.dev`
- KV namespace: `ce86bd37cf9b44608888e13dbd6d7334`
- OAuth scope: `https://mail.google.com/`
- Callback: `https://dentlink-gmail-imap-spike-preview.evanjrizzo.workers.dev/oauth/callback`

Observed live results:

- OAuth consent completed with `prompt=consent` and `access_type=offline`.
- OAuth callback returned `refreshTokenReturned: true`.
- Live IMAP probe completed successfully:
  - TLS connection to `imap.gmail.com:993`: succeeded
  - `CAPABILITY`: succeeded; `AUTH=XOAUTH2`, `IDLE`, and `X-GM-EXT-1` present
  - XOAUTH2 authentication: succeeded
  - `SELECT INBOX`: succeeded
  - `UID SEARCH SINCE <yesterday>`: succeeded
  - bounded header fetch: succeeded
  - one full MIME fetch and limited parse: succeeded
  - clean logout/socket close: succeeded
- Identifier availability was stable across repeated runs:
  - `X-GM-MSGID`: available
  - `Message-ID`: available
  - UID: available
  - UIDVALIDITY: available
  - INTERNALDATE: available
- Ten remote `/run` probes completed with 10 successes and 0 failures.
  - Average total latency: 1068.1 ms
  - Total latency range: 797-2202 ms
  - UID count in recent-window search: 37 on every run
  - Full MIME fetch: true on every run
- One isolated scheduled invocation completed successfully.
  - Wall time: 1743 ms
  - CPU time: 20 ms
  - Full MIME fetch: true

Recommendation from this spike: begin a controlled IMAP migration design, but do not remove the
current Gmail API connector until a production-grade IMAP connector has parity tests, bounded
message-size handling, and a safe OAuth scope migration plan.
