import { D1DentLinkStore, type D1DatabaseLike } from "./d1-storage";
import {
  generateSessionToken,
  generateWebhookSecret,
  hashPassword,
  hashSessionToken,
  verifyPassword
} from "./auth";
import { MemoryDentLinkStore, StoreError, type DentLinkStore } from "./storage";
import {
  backfillGmailAccount,
  completeGmailOAuth,
  disconnectGmailAccount,
  getGmailDiagnostics,
  getGmailRules,
  GmailConfigError,
  gmailConnectorDefinition,
  startGmailOAuth,
  syncConnectedGmailAccounts,
  syncGmailAccount,
  updateGmailEngine,
  updateGmailRules,
  type GmailApiClient,
  type GmailEngineUpdateInput,
  type GmailRuntimeEnv
} from "./gmail";
import {
  completeGoogleCalendarOAuth,
  disconnectGoogleCalendarAccount,
  googleCalendarConnectorDefinition,
  startGoogleCalendarOAuth,
  syncGoogleCalendarAccount,
  type GoogleCalendarApiClient,
  type GoogleCalendarRuntimeEnv
} from "./google-calendar";
import { IcsError, parseIcsCalendar, serializeIcsCalendar } from "./ics";
import {
  parseCalendarAnnotationPatch,
  parseCalendarQuery,
  parseConnectorAccountInput,
  parseConnectorAccountPatch,
  parseConnectorSourceRecordInput,
  parseCalendarEventPatch,
  parseCredentials,
  parseConflictResolution,
  parseCursor,
  parseExpectedVersion,
  parseIcsImportBody,
  parseLocalCalendarEventInput,
  parseLocalCalendarEventPatch,
  parseName,
  parseNotificationInput,
  parseNotificationPatch,
  parseNoteInput,
  parseNotePatch,
  parseReorder,
  parseSearch,
  parseWebhookEndpointInput,
  parseWebhookEndpointPatch,
  parseWebhookIngest,
  ValidationError
} from "./validation";

import type { ConnectorDefinition } from "@dentlink/connector-sdk";
import type { AuthSession, GmailRule, NoteConflict } from "@dentlink/item-model";

export type ApiEnv = GmailRuntimeEnv & {
  googleCalendarClient?: GoogleCalendarApiClient;
} & GoogleCalendarRuntimeEnv & {
    store?: DentLinkStore;
    DB?: D1DatabaseLike;
    DENTLINK_ENV?: string;
    ALLOWED_ORIGINS?: string;
    DENTLINK_BUILD_ID?: string;
    gmailClient?: GmailApiClient;
  };

const defaultStore = new MemoryDentLinkStore();

const connectorCatalog: ConnectorDefinition[] = [
  gmailConnectorDefinition(),
  googleCalendarConnectorDefinition(),
  {
    key: "generic-email",
    name: "Generic email connector",
    kind: "email",
    authType: "oauth2",
    capabilities: ["poll", "normalize_notifications"],
    settings: [
      {
        key: "label",
        label: "Display label",
        type: "string",
        required: false
      }
    ],
    version: 1
  },
  {
    key: "generic-calendar",
    name: "Generic calendar connector",
    kind: "calendar",
    authType: "oauth2",
    capabilities: ["poll", "normalize_calendar"],
    settings: [
      {
        key: "includeDeclined",
        label: "Include declined events",
        type: "boolean",
        required: false
      }
    ],
    version: 1
  }
];

function connectorByKey(key: string): ConnectorDefinition | null {
  return connectorCatalog.find((connector) => connector.key === key) ?? null;
}

export async function handleApiRequest(request: Request, env: ApiEnv = {}): Promise<Response> {
  const cors = corsForRequest(request, env);
  if (request.method.toUpperCase() === "OPTIONS") {
    return withRuntimeHeaders(
      cors.allowed
        ? new Response(null, { status: 204 })
        : error("origin_not_allowed", "Origin is not allowed", 403),
      cors
    );
  }
  return withRuntimeHeaders(await handleApiRoute(request, env), cors);
}

async function handleApiRoute(request: Request, env: ApiEnv = {}): Promise<Response> {
  const store = env.store ?? (env.DB ? new D1DentLinkStore(env.DB) : defaultStore);
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const now = new Date().toISOString();

  try {
    if (method === "GET" && path === "/v1/health") {
      return json({
        status: "ok",
        environment: env.DENTLINK_ENV ?? "local",
        build: env.DENTLINK_BUILD_ID ?? "local",
        database: await databaseHealth(env)
      });
    }

    if (method === "POST" && path === "/v1/auth/register") {
      const credentials = parseCredentials(await readJson(request));
      const password = await hashPassword(credentials.password);
      const user = await store.createUser({ email: credentials.email, password });
      const token = generateSessionToken();
      const session = await store.createSession(
        user.id,
        await hashSessionToken(token),
        now,
        sessionExpiry(now)
      );
      return json(
        {
          user,
          session: { token, expiresAt: session.expiresAt }
        },
        201
      );
    }

    if (method === "POST" && path === "/v1/auth/login") {
      const credentials = parseCredentials(await readJson(request));
      const user = await store.findUserByEmail(credentials.email);
      if (!user || !(await verifyPassword(credentials.password, user.password))) {
        return error("invalid_credentials", "Email or password is incorrect", 401);
      }
      const token = generateSessionToken();
      const session = await store.createSession(
        user.id,
        await hashSessionToken(token),
        now,
        sessionExpiry(now)
      );
      return json({
        user: { id: user.id, email: user.email, createdAt: user.createdAt },
        session: { token, expiresAt: session.expiresAt }
      });
    }

    const webhookIngestMatch = path.match(/^\/v1\/ingest\/webhooks\/([^/]+)$/);
    if (webhookIngestMatch && method === "POST") {
      const secret = request.headers.get("X-DentLink-Webhook-Secret");
      if (!secret) return error("unauthorized", "Webhook secret is required", 401);
      const delivered = await store.deliverWebhook(
        webhookIngestMatch[1] ?? "",
        await hashSessionToken(secret),
        parseWebhookIngest(await readJson(request)),
        now
      );
      if (!delivered) return error("not_found", "Webhook not found", 404);
      return json(
        {
          accepted: true,
          notification: delivered.notification,
          note: delivered.note
        },
        202
      );
    }

    if (method === "GET" && path === "/v1/connectors/gmail/callback") {
      const result = await completeGmailOAuth(store, env, url, now);
      if (request.headers.get("Accept")?.includes("application/json")) {
        return json({ account: result.account });
      }
      const redirectTo = result.returnTo
        ? withOAuthResult(result.returnTo, "gmail", "connected")
        : `${url.origin}/v1/connectors/accounts`;
      return new Response(null, { status: 303, headers: { Location: redirectTo } });
    }
    if (method === "GET" && path === "/v1/connectors/google-calendar/callback") {
      const result = await completeGoogleCalendarOAuth(store, env, url, now);
      const sync = await syncGoogleCalendarAccount(
        store,
        result.account.userId,
        result.account.id,
        env,
        now
      );
      if (request.headers.get("Accept")?.includes("application/json")) {
        return json({ account: sync.account, initialSync: sync });
      }
      const redirectTo = result.returnTo
        ? withOAuthResult(result.returnTo, "calendar", "connected")
        : `${url.origin}/v1/connectors/accounts`;
      return new Response(null, { status: 303, headers: { Location: redirectTo } });
    }

    const token = bearerToken(request);
    const tokenHash = token ? await hashSessionToken(token) : null;
    const auth = tokenHash ? await store.findSessionByTokenHash(tokenHash, now) : null;
    if (method === "GET" && path === "/v1/auth/session") {
      if (!auth) return error("unauthorized", "Authentication required", 401);
      return json(auth);
    }
    if (method === "POST" && path === "/v1/auth/logout") {
      if (tokenHash) await store.deleteSessionByTokenHash(tokenHash);
      return json({ ok: true });
    }
    if (!auth) return error("unauthorized", "Authentication required", 401);

    if (method === "GET" && path === "/v1/notes") {
      return json(
        await store.listNotes(auth.user.id, {
          search: parseSearch(url.searchParams.get("search")),
          folderId: url.searchParams.get("folderId") ?? undefined,
          tagIds: url.searchParams.getAll("tagId")
        })
      );
    }
    if (method === "POST" && path === "/v1/notes") {
      return json(
        await store.createNote(auth.user.id, parseNoteInput(await readJson(request)), now),
        201
      );
    }
    if (method === "POST" && path === "/v1/notes/reorder") {
      return noteResult(
        await store.reorderNotes(auth.user.id, parseReorder(await readJson(request)), now)
      );
    }

    const noteMatch = path.match(/^\/v1\/notes\/([^/]+)$/);
    if (noteMatch && method === "PATCH") {
      const { expectedVersion, patch } = parseNotePatch(await readJson(request));
      return noteResult(
        await store.updateNote(auth.user.id, noteMatch[1] ?? "", expectedVersion, patch, now)
      );
    }
    if (noteMatch && method === "DELETE") {
      return noteResult(
        await store.deleteNote(
          auth.user.id,
          noteMatch[1] ?? "",
          parseExpectedVersion(await readJson(request)),
          now
        )
      );
    }

    if (method === "POST" && path === "/v1/folders") {
      return json(
        await store.createFolder(auth.user.id, parseName(await readJson(request)), now),
        201
      );
    }
    if (method === "POST" && path === "/v1/tags") {
      return json(
        await store.createTag(auth.user.id, parseName(await readJson(request)), now),
        201
      );
    }
    if (method === "GET" && path === "/v1/connectors/catalog") {
      return json({ connectors: connectorCatalog });
    }
    if (method === "POST" && path === "/v1/connectors/gmail/start") {
      return json(await startGmailOAuth(store, auth.user.id, env, url, now), 201);
    }
    if (method === "POST" && path === "/v1/connectors/google-calendar/start") {
      return json(await startGoogleCalendarOAuth(store, auth.user.id, env, url, now), 201);
    }
    if (method === "GET" && path === "/v1/connectors/accounts") {
      return json(await store.listConnectorAccounts(auth.user.id));
    }
    if (method === "POST" && path === "/v1/connectors/accounts") {
      const input = parseConnectorAccountInput(await readJson(request));
      if (!connectorByKey(input.connectorKey)) {
        return error("unknown_connector", "Connector is not available", 400);
      }
      if (input.connectorKey === "gmail") {
        return error("gmail_oauth_required", "Use the Gmail OAuth flow to connect Gmail", 400);
      }
      if (input.connectorKey === "google-calendar") {
        return error(
          "google_calendar_oauth_required",
          "Use the Google Calendar OAuth flow to connect Google Calendar",
          400
        );
      }
      return json(await store.createConnectorAccount(auth.user.id, input, now), 201);
    }
    const connectorAccountMatch = path.match(/^\/v1\/connectors\/accounts\/([^/]+)$/);
    if (connectorAccountMatch && method === "PATCH") {
      const body = parseConnectorAccountPatch(await readJson(request));
      const account = await store.updateConnectorAccount(
        auth.user.id,
        connectorAccountMatch[1] ?? "",
        body.expectedVersion,
        body.patch,
        now
      );
      if (!account) return error("not_found", "Connector account not found", 404);
      return json(account);
    }
    if (connectorAccountMatch && method === "DELETE") {
      const account = await store.deleteConnectorAccount(
        auth.user.id,
        connectorAccountMatch[1] ?? "",
        parseExpectedVersion(await readJson(request)),
        now
      );
      if (!account) return error("not_found", "Connector account not found", 404);
      return json(account);
    }
    const connectorRecordsMatch = path.match(
      /^\/v1\/connectors\/accounts\/([^/]+)\/source-records$/
    );
    if (connectorRecordsMatch && method === "GET") {
      return json({
        records: await store.listConnectorSourceRecords(
          auth.user.id,
          connectorRecordsMatch[1] ?? ""
        )
      });
    }
    if (method === "POST" && path === "/v1/connectors/source-records") {
      return json(
        await store.createConnectorSourceRecord(
          auth.user.id,
          parseConnectorSourceRecordInput(await readJson(request)),
          now
        ),
        201
      );
    }
    const gmailSyncMatch = path.match(/^\/v1\/connectors\/gmail\/([^/]+)\/sync$/);
    if (gmailSyncMatch && method === "POST") {
      return json(await syncGmailAccount(store, auth.user.id, gmailSyncMatch[1] ?? "", env, now));
    }
    const gmailBackfillMatch = path.match(/^\/v1\/connectors\/gmail\/([^/]+)\/backfill$/);
    if (gmailBackfillMatch && method === "POST") {
      return json(
        await backfillGmailAccount(store, auth.user.id, gmailBackfillMatch[1] ?? "", env, now)
      );
    }
    const gmailDiagnosticsMatch = path.match(/^\/v1\/connectors\/gmail\/([^/]+)\/diagnostics$/);
    if (gmailDiagnosticsMatch && method === "GET") {
      return json(await getGmailDiagnostics(store, auth.user.id, gmailDiagnosticsMatch[1] ?? ""));
    }
    const gmailEngineMatch = path.match(/^\/v1\/connectors\/gmail\/([^/]+)\/engine$/);
    if (gmailEngineMatch && method === "PUT") {
      return json(
        await updateGmailEngine(
          store,
          auth.user.id,
          gmailEngineMatch[1] ?? "",
          parseGmailEngineBody(await readJson(request)),
          now
        )
      );
    }
    const gmailRulesMatch = path.match(/^\/v1\/connectors\/gmail\/([^/]+)\/rules$/);
    if (gmailRulesMatch && method === "GET") {
      return json(await getGmailRules(store, auth.user.id, gmailRulesMatch[1] ?? ""));
    }
    if (gmailRulesMatch && method === "PUT") {
      return json(
        await updateGmailRules(
          store,
          auth.user.id,
          gmailRulesMatch[1] ?? "",
          parseGmailRulesBody(await readJson(request)),
          now
        )
      );
    }
    const gmailDisconnectMatch = path.match(/^\/v1\/connectors\/gmail\/([^/]+)\/disconnect$/);
    if (gmailDisconnectMatch && method === "POST") {
      return json(
        await disconnectGmailAccount(store, auth.user.id, gmailDisconnectMatch[1] ?? "", now)
      );
    }
    const googleCalendarSyncMatch = path.match(
      /^\/v1\/connectors\/google-calendar\/([^/]+)\/sync$/
    );
    if (googleCalendarSyncMatch && method === "POST") {
      return json(
        await syncGoogleCalendarAccount(
          store,
          auth.user.id,
          googleCalendarSyncMatch[1] ?? "",
          env,
          now
        )
      );
    }
    const googleCalendarDisconnectMatch = path.match(
      /^\/v1\/connectors\/google-calendar\/([^/]+)\/disconnect$/
    );
    if (googleCalendarDisconnectMatch && method === "POST") {
      return json(
        await disconnectGoogleCalendarAccount(
          store,
          auth.user.id,
          googleCalendarDisconnectMatch[1] ?? "",
          now
        )
      );
    }
    if (method === "GET" && path === "/v1/calendar/events") {
      return json(await store.listCalendarEvents(auth.user.id, parseCalendarQuery(url)));
    }
    if (method === "POST" && path === "/v1/calendar/events") {
      return json(
        await store.createLocalCalendarEvent(
          auth.user.id,
          parseLocalCalendarEventInput(await readJson(request)),
          now
        ),
        201
      );
    }
    if (method === "POST" && path === "/v1/calendar/ics/import") {
      const { ics } = parseIcsImportBody(await readJson(request));
      const imported = [];
      let skippedDuplicates = 0;
      const warnings: string[] = [];
      for (const parsed of parseIcsCalendar(ics)) {
        try {
          imported.push(await store.createLocalCalendarEvent(auth.user.id, parsed, now));
          warnings.push(...parsed.warnings);
        } catch (caught) {
          if (caught instanceof StoreError && caught.code === "calendar_event_exists") {
            skippedDuplicates += 1;
            continue;
          }
          throw caught;
        }
      }
      return json(
        { imported: imported.length, skippedDuplicates, events: imported, warnings },
        201
      );
    }
    if (method === "GET" && path === "/v1/calendar/ics/export") {
      const events = await store.listCalendarEvents(auth.user.id, {
        ...parseCalendarQuery(url),
        source: "local",
        includeHidden: false
      });
      return new Response(serializeIcsCalendar(events.events, now), {
        status: 200,
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": 'attachment; filename="dentlink-calendar.ics"'
        }
      });
    }
    const calendarEventMatch = path.match(/^\/v1\/calendar\/events\/([^/]+)$/);
    if (calendarEventMatch && method === "GET") {
      const event = await store.getCalendarEvent(auth.user.id, calendarEventMatch[1] ?? "");
      if (!event) return error("not_found", "Calendar event not found", 404);
      return json(event);
    }
    if (calendarEventMatch && method === "PATCH") {
      const { expectedVersion, patch } = parseCalendarEventPatch(await readJson(request));
      return json(
        await store.updateCalendarEvent(
          auth.user.id,
          calendarEventMatch[1] ?? "",
          expectedVersion,
          patch,
          now
        )
      );
    }
    const localCalendarEventMatch = path.match(/^\/v1\/calendar\/local-events\/([^/]+)$/);
    if (localCalendarEventMatch && method === "PATCH") {
      const { expectedVersion, patch } = parseLocalCalendarEventPatch(await readJson(request));
      return json(
        await store.updateLocalCalendarEvent(
          auth.user.id,
          localCalendarEventMatch[1] ?? "",
          expectedVersion,
          patch,
          now
        )
      );
    }
    if (localCalendarEventMatch && method === "DELETE") {
      return json(
        await store.deleteLocalCalendarEvent(
          auth.user.id,
          localCalendarEventMatch[1] ?? "",
          parseExpectedVersion(await readJson(request)),
          now
        )
      );
    }
    const calendarAnnotationMatch = path.match(/^\/v1\/calendar\/events\/([^/]+)\/annotation$/);
    if (calendarAnnotationMatch && method === "PATCH") {
      const { expectedVersion, patch } = parseCalendarAnnotationPatch(await readJson(request));
      return json(
        await store.upsertCalendarEventAnnotation(
          auth.user.id,
          calendarAnnotationMatch[1] ?? "",
          expectedVersion,
          patch,
          now
        )
      );
    }
    if (method === "GET" && path === "/v1/notifications") {
      return json(await store.listNotifications(auth.user.id));
    }
    if (method === "POST" && path === "/v1/notifications") {
      return json(
        await store.createNotification(
          auth.user.id,
          parseNotificationInput(await readJson(request)),
          now
        ),
        201
      );
    }
    if (method === "POST" && path === "/v1/notifications/reorder") {
      return json(
        await store.reorderNotifications(auth.user.id, parseReorder(await readJson(request)), now)
      );
    }
    const notificationMatch = path.match(/^\/v1\/notifications\/([^/]+)$/);
    if (notificationMatch && method === "PATCH") {
      const { expectedVersion, patch } = parseNotificationPatch(await readJson(request));
      return json(
        await store.updateNotification(
          auth.user.id,
          notificationMatch[1] ?? "",
          expectedVersion,
          patch,
          now
        )
      );
    }
    if (notificationMatch && method === "DELETE") {
      return json(
        await store.updateNotification(
          auth.user.id,
          notificationMatch[1] ?? "",
          parseExpectedVersion(await readJson(request)),
          { status: "deleted" },
          now
        )
      );
    }
    if (method === "GET" && path === "/v1/webhooks") {
      return json({
        webhooks: (await store.listWebhookEndpoints(auth.user.id)).map((webhook) => ({
          ...webhook,
          ingestUrl: webhookIngestUrl(url, webhook.slug)
        }))
      });
    }
    if (method === "POST" && path === "/v1/webhooks") {
      const input = parseWebhookEndpointInput(await readJson(request));
      const secret = generateWebhookSecret();
      const webhook = await store.createWebhookEndpoint(
        auth.user.id,
        input,
        await hashSessionToken(secret),
        now
      );
      return json(
        {
          webhook: { ...webhook, ingestUrl: webhookIngestUrl(url, webhook.slug) },
          secret
        },
        201
      );
    }
    const webhookMatch = path.match(/^\/v1\/webhooks\/([^/]+)$/);
    if (webhookMatch && method === "PATCH") {
      const body = parseWebhookEndpointPatch(await readJson(request));
      const webhook = await store.updateWebhookEndpoint(
        auth.user.id,
        webhookMatch[1] ?? "",
        body.expectedVersion,
        body.patch,
        now
      );
      if (!webhook) return error("not_found", "Webhook not found", 404);
      return json({ ...webhook, ingestUrl: webhookIngestUrl(url, webhook.slug) });
    }
    if (webhookMatch && method === "DELETE") {
      const webhook = await store.deleteWebhookEndpoint(
        auth.user.id,
        webhookMatch[1] ?? "",
        parseExpectedVersion(await readJson(request)),
        now
      );
      if (!webhook) return error("not_found", "Webhook not found", 404);
      return json({ ...webhook, ingestUrl: webhookIngestUrl(url, webhook.slug) });
    }
    if (method === "GET" && path === "/v1/sync") {
      return json(await store.sync(auth.user.id, parseCursor(url.searchParams.get("cursor"))));
    }
    const historyMatch = path.match(/^\/v1\/notes\/([^/]+)\/history$/);
    if (historyMatch && method === "GET") {
      return json({ history: await store.listHistory(auth.user.id, historyMatch[1] ?? "") });
    }
    if (method === "GET" && path === "/v1/conflicts") {
      return json((await store.listConflicts(auth.user.id)).map((conflict) => ({ conflict })));
    }
    const conflictMatch = path.match(/^\/v1\/conflicts\/([^/]+)\/resolve$/);
    if (conflictMatch && method === "POST") {
      const body = parseConflictResolution(await readJson(request));
      const conflict = await store.resolveConflict(
        auth.user.id,
        conflictMatch[1] ?? "",
        body.expectedVersion,
        body.resolution,
        now
      );
      if (!conflict) return error("not_found", "Conflict not found", 404);
      return json({ conflict });
    }

    return error("not_found", "Endpoint not found", 404);
  } catch (caught) {
    if (caught instanceof ValidationError) return error(caught.code, caught.message, 400);
    if (caught instanceof IcsError) return error(caught.code, caught.message, 400);
    if (caught instanceof GmailConfigError)
      return error("google_not_configured", caught.message, 503);
    if (caught instanceof StoreError) {
      const status =
        caught.code === "not_found"
          ? 404
          : caught.code === "invalid_cursor"
            ? 400
            : caught.code === "rate_limited"
              ? 429
              : caught.code === "gmail_auth_failed"
                ? 401
                : caught.code === "gmail_permission_denied"
                  ? 403
                  : caught.code === "gmail_rate_limited"
                    ? 429
                    : caught.code === "gmail_query_invalid" ||
                        caught.code === "gmail_response_invalid"
                      ? 502
                      : caught.code === "gmail_upstream_failed"
                        ? 502
                        : caught.code === "invalid_oauth_state" ||
                            caught.code === "invalid_oauth_callback" ||
                            caught.code === "oauth_denied"
                          ? 400
                          : 409;
      return error(caught.code, caught.message, status);
    }
    const requestId = crypto.randomUUID();
    logUnexpectedError(caught, { method, path, requestId });
    return error("internal_error", "Unexpected server error", 500, requestId);
  }
}

export const apiAppBoundary = {
  name: "@dentlink/api",
  responsibility: "Backend API and ingestion boundary"
} as const;

export default {
  fetch(request: Request, env: ApiEnv): Promise<Response> {
    return handleApiRequest(request, env);
  },
  scheduled(
    _controller: { scheduledTime: number; cron: string },
    env: ApiEnv,
    ctx: { waitUntil(promise: Promise<unknown>): void }
  ): void {
    const store = env.store ?? (env.DB ? new D1DentLinkStore(env.DB) : defaultStore);
    ctx.waitUntil(syncConnectedGmailAccounts(store, env, new Date().toISOString()));
  }
};

function noteResult(value: unknown): Response {
  if (isConflict(value)) return json({ conflict: value }, 409);
  return json(value);
}

function parseGmailRulesBody(value: unknown): GmailRule[] {
  if (!value || typeof value !== "object") {
    throw new ValidationError("invalid_gmail_rules", "Gmail rules payload is invalid");
  }
  const rules = (value as { rules?: unknown }).rules;
  if (!Array.isArray(rules)) {
    throw new ValidationError("invalid_gmail_rules", "Gmail rules must be an array");
  }
  if (rules.length > 50) {
    throw new ValidationError("too_many_gmail_rules", "Too many Gmail rules");
  }
  return rules as GmailRule[];
}

function parseGmailEngineBody(value: unknown): GmailEngineUpdateInput {
  if (!value || typeof value !== "object") {
    throw new ValidationError("invalid_gmail_engine", "Gmail engine payload is invalid");
  }
  const input = value as {
    expectedVersion?: unknown;
    engine?: unknown;
    comparisonMode?: unknown;
  };
  if (typeof input.expectedVersion !== "number" || !Number.isInteger(input.expectedVersion)) {
    throw new ValidationError("invalid_expected_version", "Expected version is required");
  }
  const expectedVersion = input.expectedVersion;
  if (input.engine !== "gmail_api" && input.engine !== "gmail_imap") {
    throw new ValidationError("invalid_gmail_engine", "Gmail ingestion engine is invalid");
  }
  const engine = input.engine;
  if (input.comparisonMode !== undefined && typeof input.comparisonMode !== "boolean") {
    throw new ValidationError("invalid_gmail_engine", "Comparison mode must be a boolean");
  }
  return {
    expectedVersion,
    engine,
    comparisonMode: input.comparisonMode
  };
}

function isConflict(value: unknown): value is NoteConflict {
  return (
    typeof value === "object" &&
    value !== null &&
    "expectedVersion" in value &&
    "actualVersion" in value
  );
}

async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => {
    throw new ValidationError("invalid_json", "Request body must be valid JSON");
  });
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

function webhookIngestUrl(url: URL, slug: string): string {
  return `${url.origin}/v1/ingest/webhooks/${slug}`;
}

function withOAuthResult(
  returnTo: string,
  provider: "gmail" | "calendar",
  result: "connected" | "error"
): string {
  const url = new URL(returnTo);
  url.searchParams.set(provider, result);
  return url.toString();
}

function sessionExpiry(now: string): string {
  return new Date(new Date(now).getTime() + 1000 * 60 * 60 * 24 * 30).toISOString();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function error(
  code: string,
  message: string,
  status: number,
  requestId = crypto.randomUUID()
): Response {
  return json(
    {
      error: {
        code,
        message,
        requestId
      }
    },
    status
  );
}

function logUnexpectedError(
  caught: unknown,
  context: { method: string; path: string; requestId: string }
): void {
  const details =
    caught instanceof Error
      ? { name: caught.name, message: caught.message }
      : { name: typeof caught, message: "Non-Error thrown" };
  console.error(
    JSON.stringify({
      level: "error",
      event: "api_unexpected_error",
      requestId: context.requestId,
      method: context.method,
      path: context.path,
      error: details
    })
  );
}

async function databaseHealth(
  env: ApiEnv
): Promise<{ reachable: boolean; adapter: "d1" | "memory" }> {
  if (!env.DB) return { reachable: true, adapter: "memory" };
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    return { reachable: true, adapter: "d1" };
  } catch {
    return { reachable: false, adapter: "d1" };
  }
}

type CorsDecision = {
  allowed: boolean;
  origin: string | null;
};

function corsForRequest(request: Request, env: ApiEnv): CorsDecision {
  const origin = request.headers.get("Origin");
  if (!origin) return { allowed: true, origin: null };
  const allowedOrigins = configuredOrigins(env);
  return { allowed: allowedOrigins.has(origin), origin };
}

function configuredOrigins(env: ApiEnv): Set<string> {
  const configured = env.ALLOWED_ORIGINS?.split(",").map((origin) => origin.trim()) ?? [];
  return new Set(
    configured.filter(Boolean).length > 0
      ? configured.filter(Boolean)
      : [
          "http://localhost:5173",
          "http://127.0.0.1:5173",
          "http://localhost:5174",
          "http://127.0.0.1:5174",
          "http://localhost:8787",
          "http://127.0.0.1:8787"
        ]
  );
}

function withRuntimeHeaders(response: Response, cors: CorsDecision): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  headers.set("Cache-Control", "no-store");
  headers.append("Vary", "Origin");
  if (cors.allowed && cors.origin) {
    headers.set("Access-Control-Allow-Origin", cors.origin);
    headers.set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Authorization,Content-Type,Accept");
    headers.set("Access-Control-Max-Age", "600");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export type { AuthSession };
