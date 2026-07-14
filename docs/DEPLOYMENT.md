# Deployment

DentLink targets Cloudflare Workers with D1. The runtime baseline is shared by the Milestone 1 Notes
slice, the Milestone 2 Notifications/webhook slice, the Milestone 3 connector framework, the
Milestone 3.1 Gmail connector, and the Milestone 4 Google Calendar connector.

## Runtime

- Node.js: `22.13.1`, declared in `.nvmrc`, `.node-version`, and `package.json`.
- pnpm: `9.15.4`, declared in `packageManager` and `engines`.
- Wrangler: project-local dependency from `package.json`; use `pnpm exec wrangler` or package
  scripts.

Use the project dependency rather than a global Wrangler installation.

## Environments

`wrangler.toml` defines three environments using the same `DB` binding name:

- Local: `dentlink`, local D1 through `wrangler dev --local`.
- Preview API: `dentlink-api-preview`, D1 database `dentlink-preview`.
- Preview web: Cloudflare Pages project `dentlink-web-preview`.
- Production: `dentlink-api-production`, D1 database `dentlink-production`.

The preview database ID is configured after creating `dentlink-preview`. The production database ID
is still a placeholder and must be replaced before production deployment:

- `REPLACE_WITH_PRODUCTION_D1_DATABASE_ID`

Production routes are intentionally commented until the real zone and API hostname are known.

## First Preview Deployment

Use these steps for the first real preview deployment. Do not reuse production identifiers.

1. Authenticate Wrangler locally, or configure equivalent GitHub secrets for the preview workflow:

   ```bash
   pnpm exec wrangler login
   pnpm exec wrangler whoami
   ```

2. Create the preview D1 database:

   ```bash
   pnpm exec wrangler d1 create dentlink-preview
   ```

3. Copy the `database_id` from the creation output. If needed, list databases again:

   ```bash
   pnpm exec wrangler d1 list
   ```

4. Replace the preview `database_id` in `wrangler.toml` if the preview database is recreated. Leave
   the production placeholder unchanged until production is intentionally configured.

5. Set `[env.preview.vars].ALLOWED_ORIGINS` to the exact preview web origin that will call the API.
   The Milestone 1.3 preview origin is:

   ```text
   https://dentlink-web-preview.pages.dev
   ```

   Use a comma-separated list only if there are multiple intentional preview origins. Do not use `*`
   for preview or production.

6. Apply remote preview migrations:

   ```bash
   pnpm db:migrate:preview
   ```

7. Deploy the preview Worker:

   ```bash
   pnpm deploy:preview
   ```

8. Configure the web client to use the deployed preview API origin:

   ```bash
   VITE_DENTLINK_API_BASE_URL=https://dentlink-api-preview.evanjrizzo.workers.dev pnpm --filter @dentlink/web build
   pnpm deploy:web:preview
   ```

   For hosted web deployments, set `VITE_DENTLINK_API_BASE_URL` in the web hosting environment
   instead of committing it.

9. Run the remote API smoke test against the actual preview API URL:

   ```bash
   DENTLINK_SMOKE_BASE_URL=https://dentlink-api-preview.evanjrizzo.workers.dev pnpm smoke:api
   ```

10. Verify the deployed web client in a browser at:

    ```text
    https://dentlink-web-preview.pages.dev
    ```

    Confirm registration, login, logout, refresh session restore, Notes CRUD, folders, tags, search,
    reorder, pin, due date, priority, done state, and optimistic-concurrency conflict handling
    against the preview API.

11. If validation fails, redeploy the last known-good Worker or Pages deployment, or disable the
    preview route. Do not run destructive database rollback automation.

## Configuration

Non-secret Worker variables:

- `DENTLINK_ENV`: `local`, `preview`, or `production`.
- `ALLOWED_ORIGINS`: comma-separated web origins allowed to call the API.
- `DENTLINK_BUILD_ID`: safe build identifier.
- `GOOGLE_REDIRECT_URI`: OAuth callback URL, for example
  `https://dentlink-api-preview.evanjrizzo.workers.dev/v1/connectors/gmail/callback`.
- `GOOGLE_CALENDAR_REDIRECT_URI`: OAuth callback URL for Google Calendar, for example
  `https://dentlink-api-preview.evanjrizzo.workers.dev/v1/connectors/google-calendar/callback`.
- `DENTLINK_WEB_ORIGIN`: exact web origin allowed for Google connector OAuth return redirects.

Worker secrets for Google connectors:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GMAIL_CREDENTIAL_ENCRYPTION_KEY`

`GMAIL_CREDENTIAL_ENCRYPTION_KEY` must be a base64 or base64url value that decodes to 32 bytes.
Generate it outside the repository and store it with Wrangler secrets or local `.dev.vars`.

Client-side Vite variable:

- `VITE_DENTLINK_API_BASE_URL`: API origin for preview or production web builds.

Use `.dev.vars` for local non-committed Worker values and Wrangler secrets for preview/production.
`.dev.vars` and `.dev.vars.*` are ignored by Git. Webhook endpoint secrets are generated through the
API and stored only as server-side hashes; they are not Worker environment secrets.

## Gmail OAuth Setup

Create a Google Cloud OAuth client for a web application:

1. Configure the OAuth consent screen for Gmail metadata access.
2. Add the Gmail API to the Google Cloud project.
3. Add the authorized redirect URI:

   ```text
   https://dentlink-api-preview.evanjrizzo.workers.dev/v1/connectors/gmail/callback
   ```

4. Store the Google values without printing them:

   ```bash
   pnpm exec wrangler secret put GOOGLE_CLIENT_ID --env preview
   pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET --env preview
   pnpm exec wrangler secret put GMAIL_CREDENTIAL_ENCRYPTION_KEY --env preview
   ```

5. Set `GOOGLE_REDIRECT_URI` and `DENTLINK_WEB_ORIGIN` for preview before deploying.

The Gmail connector requests only:

```text
https://www.googleapis.com/auth/gmail.metadata
```

Disconnect removes encrypted credentials and pauses the account metadata. Reconnect starts OAuth
with the account ID and replaces the stored encrypted refresh token.

## Google Calendar OAuth Setup

Use the same Google Cloud project or OAuth client if it includes both authorized redirect URIs.
Google Calendar is read-only in Milestone 4.

1. Enable the Google Calendar API in the Google Cloud project.
2. Add the authorized redirect URI:

   ```text
   https://dentlink-api-preview.evanjrizzo.workers.dev/v1/connectors/google-calendar/callback
   ```

3. Store or update the same Google OAuth secrets used by Gmail:

   ```bash
   pnpm exec wrangler secret put GOOGLE_CLIENT_ID --env preview
   pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET --env preview
   pnpm exec wrangler secret put GMAIL_CREDENTIAL_ENCRYPTION_KEY --env preview
   ```

4. Set `GOOGLE_CALENDAR_REDIRECT_URI` and `DENTLINK_WEB_ORIGIN` for preview before deploying.

The Google Calendar connector requests only:

```text
https://www.googleapis.com/auth/calendar.readonly
```

Disconnect removes encrypted credentials and pauses the account metadata. Reconnect starts OAuth
with the account ID and replaces the stored encrypted refresh token. DentLink does not request write
scopes and cannot create, edit, delete, RSVP to, or manage attendees on Google Calendar events.

## Local Development

```bash
pnpm install --frozen-lockfile
pnpm db:migrate:local
pnpm dev
```

The Vite web shell can still run separately:

```bash
pnpm --filter @dentlink/web dev
```

## Migrations

```bash
pnpm db:migrate:local
pnpm db:migrate:preview
pnpm db:migrate:production
```

Production migrations are explicit and manual. Do not add destructive production reset scripts.
Milestone 2 adds `0002_notifications_webhooks.sql`; Milestone 3 adds `0003_connector_framework.sql`;
Milestone 3.1 adds `0004_gmail_connector.sql`; Milestone 4 adds
`0005_google_calendar_connector.sql`; Milestone 5 adds `0006_calendar_foundation_ics.sql`. Apply
migrations to preview before deploying code that uses the corresponding sync change types or local
calendar/annotation tables.

## Workflows

CI validates pull requests and `development` pushes without Cloudflare secrets. It installs Node 22,
runs `pnpm validate`, checks whitespace, applies local D1 migrations, and performs a Wrangler
dry-run Worker build.

Preview deployment is manual through the `Deploy Preview` workflow. Required GitHub secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `DENTLINK_PREVIEW_API_BASE_URL`

`DENTLINK_PREVIEW_API_BASE_URL` must be the deployed preview API origin used by the smoke test. The
preview workflow assumes `wrangler.toml` already contains the real preview D1 `database_id` and
allowed web origin.

The preview workflow also builds and deploys the Cloudflare Pages web client to
`dentlink-web-preview` with `VITE_DENTLINK_API_BASE_URL` set from `DENTLINK_PREVIEW_API_BASE_URL`.

Production deployment is manual through the `Deploy Production` workflow and requires typing
`production`. Configure a protected GitHub `production` environment with required reviewers before
using it. Required GitHub secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `DENTLINK_PRODUCTION_API_BASE_URL`

## Smoke Tests

Run against any deployed or local API:

```bash
DENTLINK_SMOKE_BASE_URL=http://127.0.0.1:8787 pnpm smoke:api
```

The script creates temporary users, notes, notifications, webhooks, and generic connector records
through the public API. It also checks that Gmail and Google Calendar OAuth start return controlled
responses when Google secrets are absent. It does not print bearer tokens, passwords, webhook
secrets, OAuth state values, or connector credential references.

## Browser Verification

Milestone 2.1 adds repeatable Playwright browser verification for the deployed preview web client:

```bash
DENTLINK_PREVIEW_WEB_URL=https://dentlink-web-preview.pages.dev \
DENTLINK_PREVIEW_API_URL=https://dentlink-api-preview.evanjrizzo.workers.dev \
pnpm test:browser
```

The browser suite creates temporary users and data through the UI, uses public webhook ingest calls
to simulate external delivery, and checks session restore, local storage contents, CORS-backed API
requests, Notes, Notifications, webhook secret lifecycle, endpoint disabling, endpoint deletion,
last-triggered refresh, and logout behavior. It must not print passwords, bearer tokens, or webhook
secrets in logs.

## Rollback

- Redeploy a known-good Worker version through Cloudflare or the deployment workflow.
- Redeploy a known-good Pages deployment for preview web rollback.
- Do not run destructive down migrations automatically.
- Treat code rollback and database rollback separately.
- If a migration fails, stop deployment, inspect D1 migration state, and preserve existing user
  data.
- Disable or replace a broken preview deployment before promoting changes.
- Confirm the active deployment with Wrangler or the Cloudflare dashboard before and after rollback.
