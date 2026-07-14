# Deployment

DentLink targets Cloudflare Workers with D1. The runtime baseline is shared by the Milestone 1 Notes
slice and the Milestone 2 Notifications/webhook slice.

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

Client-side Vite variable:

- `VITE_DENTLINK_API_BASE_URL`: API origin for preview or production web builds.

Current runtime does not require committed secrets. Use `.dev.vars` for local non-committed Worker
values and Wrangler secrets for future secret values. `.dev.vars` and `.dev.vars.*` are ignored by
Git. Webhook endpoint secrets are generated through the API and stored only as server-side hashes;
they are not Worker environment secrets.

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
Milestone 2 adds `0002_notifications_webhooks.sql`; apply it to preview before deploying code that
uses notification or webhook sync changes.

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

The script creates temporary users and notes through the public API. It does not print bearer tokens
or passwords.

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
