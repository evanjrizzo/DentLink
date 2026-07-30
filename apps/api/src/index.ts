import { D1DentLinkStore, type D1DatabaseLike } from "./d1-storage";
import { ContentEncryption, isEncryptedString } from "./content-encryption";
import { AssistantError, answerAssistantQuestion, type AssistantRuntimeEnv } from "./assistant";
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
  getEmailAiSettings,
  getGmailRules,
  GmailConfigError,
  gmailConnectorDefinition,
  reprocessSameDayEmailAi,
  startGmailOAuth,
  syncConnectedGmailAccounts,
  syncGmailAccount,
  updateEmailAiSettings,
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
  parseNamePatch,
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
import type {
  AuthSession,
  ConnectorAccount,
  ConnectorSyncAllResult,
  DentLinkChangeEvent,
  GmailRule,
  NoteConflict,
  SyncChange,
  UserPreferences
} from "@dentlink/item-model";

export type ApiEnv = GmailRuntimeEnv &
  AssistantRuntimeEnv & {
    googleCalendarClient?: GoogleCalendarApiClient;
  } & GoogleCalendarRuntimeEnv & {
    ALERT_EMAIL?: {
      send(input: {
        to: string | string[];
        from: { email: string; name?: string };
        subject: string;
        text: string;
      }): Promise<unknown>;
    };
    ARCHIVE_BUCKET?: {
      put(
        key: string,
        value: string,
        options?: {
          httpMetadata?: { contentType?: string };
          customMetadata?: Record<string, string>;
        }
      ): Promise<unknown>;
      get(key: string): Promise<{ text(): Promise<string> } | null>;
    };
    store?: DentLinkStore;
    DB?: D1DatabaseLike;
    DENTLINK_ENV?: string;
    ALLOWED_ORIGINS?: string;
    DENTLINK_BUILD_ID?: string;
    DENTLINK_ALERT_EMAIL_TO?: string;
    DENTLINK_ALERT_EMAIL_FROM?: string;
    DENTLINK_STORAGE_ALERT_COOLDOWN_HOURS?: string;
    DENTLINK_SYNC_CHANGES_ROW_ALERT_THRESHOLD?: string;
    DENTLINK_SYNC_CHANGES_AVG_PAYLOAD_ALERT_BYTES?: string;
    DENTLINK_SYNC_CHANGES_MAX_PAYLOAD_ALERT_BYTES?: string;
    DENTLINK_ARCHIVE_MAX_TOTAL_BYTES?: string;
    DENTLINK_ARCHIVE_NOTIFICATION_RETENTION_ENABLED?: string;
    DENTLINK_ARCHIVE_NOTIFICATION_RETENTION_DAYS?: string;
    DENTLINK_ARCHIVE_NOTIFICATION_RETENTION_BATCH_SIZE?: string;
    DENTLINK_ARCHIVE_NOTIFICATION_RETENTION_USER_IDS?: string;
    DENTLINK_SYNC_ALL_CONNECTOR_TIMEOUT_MS?: string;
    DENTLINK_CONTENT_ENCRYPTION_KEY?: string;
    DENTLINK_CONTENT_ENCRYPTION_KEY_V2?: string;
    DENTLINK_REQUIRE_CONTENT_ENCRYPTION?: string;
    DENTLINK_CONTENT_ENCRYPTION_BACKFILL_ENABLED?: string;
    DENTLINK_CONTENT_ENCRYPTION_BACKFILL_BATCH_SIZE?: string;
    DENTLINK_MAINTENANCE_TOKEN?: string;
    gmailClient?: GmailApiClient;
  };

const defaultStore = new MemoryDentLinkStore();
const SYNC_CHANGES_RETENTION_ROWS = 10000;
const WEBHOOK_DELIVERY_RETENTION_DAYS = 7;
const SYNC_ATTEMPT_RETENTION_DAYS = 30;
const SYNC_ATTEMPT_ACCOUNT_TAIL_ROWS = 200;
const DEFAULT_ALERT_EMAIL_TO = "evanjrizzo@gmail.com";
const DEFAULT_STORAGE_ALERT_COOLDOWN_HOURS = 6;
const DEFAULT_SYNC_CHANGES_ROW_ALERT_THRESHOLD = 12000;
const DEFAULT_SYNC_CHANGES_AVG_PAYLOAD_ALERT_BYTES = 500;
const DEFAULT_SYNC_CHANGES_MAX_PAYLOAD_ALERT_BYTES = 2000;
const DEFAULT_ARCHIVE_MAX_TOTAL_BYTES = 9_000_000_000;
const DEFAULT_ARCHIVE_NOTIFICATION_RETENTION_DAYS = 30;
const DEFAULT_ARCHIVE_NOTIFICATION_RETENTION_BATCH_SIZE = 25;
const MAX_ARCHIVE_NOTIFICATION_RETENTION_BATCH_SIZE = 100;
const DEFAULT_SYNC_ALL_CONNECTOR_TIMEOUT_MS = 25_000;
const DEFAULT_CONTENT_ENCRYPTION_BACKFILL_BATCH_SIZE = 50;
const MAX_CONTENT_ENCRYPTION_BACKFILL_BATCH_SIZE = 200;
const AUTH_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const AUTH_CHALLENGE_FAKE_ITERATIONS = 100_000;

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

function contentEncryptionOptions(env: ApiEnv): { contentEncryptionKey?: string | null } {
  if (env.DENTLINK_REQUIRE_CONTENT_ENCRYPTION === "true" && !contentEncryptionKey(env)?.trim()) {
    throw new StoreError("missing_content_encryption_key", "Content encryption key is required");
  }
  return { contentEncryptionKey: contentEncryptionKey(env) };
}

function contentEncryptionKey(env: ApiEnv): string | undefined {
  return env.DENTLINK_CONTENT_ENCRYPTION_KEY_V2 || env.DENTLINK_CONTENT_ENCRYPTION_KEY;
}

function contentEncryption(env: ApiEnv): ContentEncryption {
  return new ContentEncryption({ keyB64: contentEncryptionKey(env) });
}

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

    if (method === "POST" && path === "/v1/maintenance/content-encryption/backfill") {
      return json(await runContentEncryptionBackfillRequest(request, env));
    }

    const store =
      env.store ??
      (env.DB ? new D1DentLinkStore(env.DB, contentEncryptionOptions(env)) : defaultStore);

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

    if (method === "POST" && path === "/v1/auth/login-challenge") {
      const { email } = parseLoginChallengeStart(await readJson(request));
      const user = await store.findUserByEmail(email);
      const salt = user?.password.salt ?? toBase64(crypto.getRandomValues(new Uint8Array(16)));
      const iterations = user?.password.iterations ?? AUTH_CHALLENGE_FAKE_ITERATIONS;
      return json({
        email,
        salt,
        iterations,
        challenge: await createAuthChallenge(env, email, now)
      });
    }

    if (method === "POST" && path === "/v1/auth/login") {
      const body = await readJson(request);
      const challengeLogin = parseChallengeLogin(body);
      const credentials = challengeLogin ? null : parseCredentials(body);
      const email = challengeLogin?.email ?? credentials?.email ?? "";
      const user = await store.findUserByEmail(email);
      const passwordOk = challengeLogin
        ? await verifyAuthChallengeLogin(env, challengeLogin, user?.password.hash ?? null, now)
        : user
          ? await verifyPassword(credentials?.password ?? "", user.password)
          : false;
      if (!user || !passwordOk) {
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
    if (auth && tokenHash) {
      const renewedExpiresAt = sessionExpiry(now);
      await store.extendSession(tokenHash, renewedExpiresAt);
      auth.session.expiresAt = renewedExpiresAt;
    }
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
    const folderMatch = path.match(/^\/v1\/folders\/([^/]+)$/);
    if (folderMatch && method === "PATCH") {
      const { patch } = parseNamePatch(await readJson(request));
      return json(await store.updateFolder(auth.user.id, folderMatch[1] ?? "", patch, now));
    }
    if (folderMatch && method === "DELETE") {
      await store.deleteFolder(auth.user.id, folderMatch[1] ?? "", now);
      return json({ ok: true });
    }
    if (method === "POST" && path === "/v1/tags") {
      return json(
        await store.createTag(auth.user.id, parseName(await readJson(request)), now),
        201
      );
    }
    const tagMatch = path.match(/^\/v1\/tags\/([^/]+)$/);
    if (tagMatch && method === "PATCH") {
      const { patch } = parseNamePatch(await readJson(request));
      return json(await store.updateTag(auth.user.id, tagMatch[1] ?? "", patch, now));
    }
    if (tagMatch && method === "DELETE") {
      await store.deleteTag(auth.user.id, tagMatch[1] ?? "", now);
      return json({ ok: true });
    }
    if (method === "GET" && path === "/v1/preferences") {
      return json(await getUserPreferences(store, auth.user.id, url.searchParams, now));
    }
    if (method === "PATCH" && path === "/v1/preferences") {
      return json(await updateUserPreferences(store, auth.user.id, await readJson(request), now));
    }
    if (method === "GET" && path === "/v1/archive/key-wrappers") {
      return json(await listArchiveKeyWrappers(env, auth.user.id));
    }
    if (method === "POST" && path === "/v1/archive/key-wrappers") {
      return json(
        await createArchiveKeyWrapper(env, auth.user.id, await readJson(request), now),
        201
      );
    }
    if (method === "GET" && path === "/v1/archive/objects") {
      return json(await listArchiveObjects(env, auth.user.id));
    }
    if (method === "POST" && path === "/v1/archive/objects") {
      return json(await createArchiveObject(env, auth.user.id, await readJson(request), now), 201);
    }
    const archiveVerifyMatch = path.match(/^\/v1\/archive\/objects\/([^/]+)\/verify$/);
    if (archiveVerifyMatch && method === "POST") {
      return json(await verifyArchiveObject(env, auth.user.id, archiveVerifyMatch[1] ?? "", now));
    }
    const archiveObjectMatch = path.match(/^\/v1\/archive\/objects\/([^/]+)$/);
    if (archiveObjectMatch && method === "GET") {
      return json(await getArchiveObject(env, auth.user.id, archiveObjectMatch[1] ?? ""));
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
    if (method === "POST" && path === "/v1/connectors/sync-all") {
      return json(await syncAllConnectors(store, auth.user.id, env, now));
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
        gmailEngineResponse(
          await updateGmailEngine(
            store,
            auth.user.id,
            gmailEngineMatch[1] ?? "",
            parseGmailEngineBody(await readJson(request)),
            now
          )
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
    if (method === "POST" && path === "/v1/ai/reprocess") {
      return json(
        await reprocessSameDayEmailAi(
          store,
          auth.user.id,
          env,
          parseAiReprocessBody(await readJson(request)),
          now
        ),
        202
      );
    }
    if (method === "POST" && path === "/v1/assistant/chat") {
      return json(
        await answerAssistantQuestion(store, auth.user.id, env, await readJson(request), now)
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
      const listed = await store.listNotifications(auth.user.id);
      const includeSuppressed = url.searchParams.get("includeSuppressed") === "true";
      const search = (url.searchParams.get("search") ?? "").trim().toLowerCase();
      return json({
        notifications: listed.notifications.filter((notification) => {
          if (!includeSuppressed && notification.status === "suppressed") return false;
          if (!search) return true;
          return JSON.stringify({
            title: notification.title,
            summary: notification.summary,
            body: notification.body,
            sender: notification.email?.senderDisplayName,
            senderAddress: notification.email?.senderAddress,
            subject: notification.email?.subject,
            category: notification.ai?.category
          })
            .toLowerCase()
            .includes(search);
        })
      });
    }
    if (method === "GET" && path === "/v1/ai/settings") {
      return json(await getEmailAiSettings(store, auth.user.id, env, now));
    }
    if (method === "PATCH" && path === "/v1/ai/settings") {
      return json(
        await updateEmailAiSettings(
          store,
          auth.user.id,
          parseEmailAiSettingsPatch(await readJson(request)),
          env,
          now
        )
      );
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
    if (method === "GET" && path === "/v1/events") {
      return eventStream(
        store,
        auth.user.id,
        parseCursor(url.searchParams.get("cursor")),
        request.signal
      );
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
    if (caught instanceof AssistantError) return error(caught.code, caught.message, caught.status);
    if (caught instanceof ValidationError) return error(caught.code, caught.message, 400);
    if (caught instanceof IcsError) return error(caught.code, caught.message, 400);
    if (caught instanceof GmailConfigError)
      return error("google_not_configured", caught.message, 503);
    if (caught instanceof StoreError) {
      const status =
        caught.code === "not_found"
          ? 404
          : caught.code === "unauthorized"
            ? 401
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
                          : caught.code === "archive_unavailable"
                            ? 503
                            : caught.code === "archive_quota_exceeded"
                              ? 413
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
    const store =
      env.store ??
      (env.DB ? new D1DentLinkStore(env.DB, contentEncryptionOptions(env)) : defaultStore);
    ctx.waitUntil(
      Promise.all([
        syncConnectedGmailAccounts(store, env, new Date().toISOString()).catch(async (caught) => {
          await sendOperationalAlert(
            env,
            "scheduled-gmail-sync-failed",
            "DentLink scheduled Gmail sync failed",
            safeAlertText("Scheduled Gmail sync failed.", caught)
          );
          throw caught;
        }),
        runD1StorageMaintenance(env).then(() => sendStorageHealthAlertIfNeeded(env))
      ])
    );
  }
};

type ArchiveKeyWrapperRow = {
  id: string;
  key_id: string;
  wrapper_type: string;
  wrapping_algorithm: string;
  wrapped_key_b64: string;
  salt_b64: string | null;
  public_metadata_json: string;
  created_at: string;
  updated_at: string;
};

type ArchiveObjectRow = {
  id: string;
  object_type: string;
  source_entity_type: string | null;
  source_entity_id: string | null;
  r2_key: string;
  encryption_algorithm: string;
  key_id: string;
  nonce_b64: string;
  ciphertext_sha256_b64: string;
  size_bytes: number;
  verified_at: string | null;
  public_metadata_json: string;
  created_at: string;
  updated_at: string;
};

async function listArchiveKeyWrappers(
  env: ApiEnv,
  userId: string
): Promise<{ wrappers: unknown[] }> {
  const db = archiveDb(env);
  const rows = await db
    .prepare(
      `SELECT id, key_id, wrapper_type, wrapping_algorithm, wrapped_key_b64, salt_b64,
              public_metadata_json, created_at, updated_at
       FROM user_archive_key_wrappers
       WHERE user_id = ?
       ORDER BY updated_at DESC`
    )
    .bind(userId)
    .all<ArchiveKeyWrapperRow>();
  return { wrappers: (rows.results ?? []).map(archiveKeyWrapperFromRow) };
}

async function createArchiveKeyWrapper(
  env: ApiEnv,
  userId: string,
  raw: unknown,
  now: string
): Promise<{ wrapper: unknown }> {
  const db = archiveDb(env);
  const input = parseArchiveKeyWrapperInput(raw);
  const id = `archive_key_${crypto.randomUUID().replaceAll("-", "")}`;
  await db
    .prepare(
      `INSERT INTO user_archive_key_wrappers
         (id, user_id, key_id, wrapper_type, wrapping_algorithm, wrapped_key_b64, salt_b64,
          public_metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, key_id, wrapper_type) DO UPDATE SET
         wrapping_algorithm = excluded.wrapping_algorithm,
         wrapped_key_b64 = excluded.wrapped_key_b64,
         salt_b64 = excluded.salt_b64,
         public_metadata_json = excluded.public_metadata_json,
         updated_at = excluded.updated_at`
    )
    .bind(
      id,
      userId,
      input.keyId,
      input.wrapperType,
      input.wrappingAlgorithm,
      input.wrappedKeyB64,
      input.saltB64,
      JSON.stringify(input.publicMetadata),
      now,
      now
    )
    .run();
  const row = await db
    .prepare(
      `SELECT id, key_id, wrapper_type, wrapping_algorithm, wrapped_key_b64, salt_b64,
              public_metadata_json, created_at, updated_at
       FROM user_archive_key_wrappers
       WHERE user_id = ? AND key_id = ? AND wrapper_type = ?`
    )
    .bind(userId, input.keyId, input.wrapperType)
    .first<ArchiveKeyWrapperRow>();
  if (!row) throw new StoreError("not_found", "Archive key wrapper not found");
  return { wrapper: archiveKeyWrapperFromRow(row) };
}

async function listArchiveObjects(env: ApiEnv, userId: string): Promise<{ objects: unknown[] }> {
  const db = archiveDb(env);
  const rows = await db
    .prepare(
      `SELECT id, object_type, source_entity_type, source_entity_id, r2_key, encryption_algorithm,
              key_id, nonce_b64, ciphertext_sha256_b64, size_bytes, verified_at, public_metadata_json,
              created_at, updated_at
       FROM user_archive_objects
       WHERE user_id = ?
       ORDER BY created_at DESC`
    )
    .bind(userId)
    .all<ArchiveObjectRow>();
  return { objects: (rows.results ?? []).map(archiveObjectMetadataFromRow) };
}

async function createArchiveObject(
  env: ApiEnv,
  userId: string,
  raw: unknown,
  now: string
): Promise<{ object: unknown }> {
  const db = archiveDb(env);
  const bucket = archiveBucket(env);
  const input = parseArchiveObjectInput(raw);
  const id = `archive_object_${crypto.randomUUID().replaceAll("-", "")}`;
  const r2Key = `users/${userId}/archive/${id}.json`;
  const envelope = {
    version: 1,
    id,
    objectType: input.objectType,
    sourceEntityType: input.sourceEntityType,
    sourceEntityId: input.sourceEntityId,
    encryption: {
      algorithm: input.encryptionAlgorithm,
      keyId: input.keyId,
      nonceB64: input.nonceB64,
      ciphertextSha256B64: input.ciphertextSha256B64
    },
    ciphertextB64: input.ciphertextB64,
    createdAt: now
  };
  const serialized = JSON.stringify(envelope);
  const storedBytes = textByteLength(serialized);
  await assertArchiveQuota(db, storedBytes, env);
  await bucket.put(r2Key, serialized, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: {
      userId,
      archiveObjectId: id,
      objectType: input.objectType
    }
  });
  await db
    .prepare(
      `INSERT INTO user_archive_objects
         (id, user_id, object_type, source_entity_type, source_entity_id, r2_key,
          encryption_algorithm, key_id, nonce_b64, ciphertext_sha256_b64, size_bytes,
          public_metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      userId,
      input.objectType,
      input.sourceEntityType,
      input.sourceEntityId,
      r2Key,
      input.encryptionAlgorithm,
      input.keyId,
      input.nonceB64,
      input.ciphertextSha256B64,
      storedBytes,
      JSON.stringify(input.publicMetadata),
      now,
      now
    )
    .run();
  const row = await archiveObjectRow(db, userId, id);
  if (!row) throw new StoreError("not_found", "Archive object not found");
  return { object: archiveObjectMetadataFromRow(row) };
}

async function verifyArchiveObject(
  env: ApiEnv,
  userId: string,
  objectId: string,
  now: string
): Promise<{ object: unknown }> {
  const db = archiveDb(env);
  const result = await db
    .prepare(
      `UPDATE user_archive_objects
       SET verified_at = COALESCE(verified_at, ?), updated_at = ?
       WHERE user_id = ? AND id = ?`
    )
    .bind(now, now, userId, objectId)
    .run();
  if ((result.meta?.changes ?? 0) !== 1) {
    throw new StoreError("not_found", "Archive object not found");
  }
  const row = await archiveObjectRow(db, userId, objectId);
  if (!row) throw new StoreError("not_found", "Archive object not found");
  return { object: archiveObjectMetadataFromRow(row) };
}

async function getArchiveObject(
  env: ApiEnv,
  userId: string,
  objectId: string
): Promise<{ object: unknown; envelope: unknown }> {
  const db = archiveDb(env);
  const bucket = archiveBucket(env);
  const row = await archiveObjectRow(db, userId, objectId);
  if (!row) throw new StoreError("not_found", "Archive object not found");
  const stored = await bucket.get(row.r2_key);
  if (!stored) throw new StoreError("not_found", "Archive object not found");
  return {
    object: archiveObjectMetadataFromRow(row),
    envelope: JSON.parse(await stored.text()) as unknown
  };
}

async function archiveObjectRow(
  db: D1DatabaseLike,
  userId: string,
  objectId: string
): Promise<ArchiveObjectRow | null> {
  return await db
    .prepare(
      `SELECT id, object_type, source_entity_type, source_entity_id, r2_key, encryption_algorithm,
              key_id, nonce_b64, ciphertext_sha256_b64, size_bytes, verified_at, public_metadata_json,
              created_at, updated_at
       FROM user_archive_objects
       WHERE user_id = ? AND id = ?`
    )
    .bind(userId, objectId)
    .first<ArchiveObjectRow>();
}

async function assertArchiveQuota(
  db: D1DatabaseLike,
  nextObjectBytes: number,
  env: ApiEnv
): Promise<void> {
  const maxBytes = envInteger(
    env.DENTLINK_ARCHIVE_MAX_TOTAL_BYTES,
    DEFAULT_ARCHIVE_MAX_TOTAL_BYTES
  );
  const row = await db
    .prepare(`SELECT COALESCE(SUM(size_bytes), 0) AS total_bytes FROM user_archive_objects`)
    .first<{ total_bytes: number }>();
  const currentBytes = row?.total_bytes ?? 0;
  if (currentBytes + nextObjectBytes > maxBytes) {
    throw new StoreError(
      "archive_quota_exceeded",
      "Encrypted archive storage is full. DentLink refused this write before exceeding the storage cap."
    );
  }
}

function archiveDb(env: ApiEnv): D1DatabaseLike {
  if (!env.DB) throw new StoreError("archive_unavailable", "Encrypted archive requires D1");
  return env.DB;
}

function archiveBucket(env: ApiEnv): NonNullable<ApiEnv["ARCHIVE_BUCKET"]> {
  if (!env.ARCHIVE_BUCKET)
    throw new StoreError("archive_unavailable", "Encrypted archive storage is not configured");
  return env.ARCHIVE_BUCKET;
}

function archiveKeyWrapperFromRow(row: ArchiveKeyWrapperRow): unknown {
  return {
    id: row.id,
    keyId: row.key_id,
    wrapperType: row.wrapper_type,
    wrappingAlgorithm: row.wrapping_algorithm,
    wrappedKeyB64: row.wrapped_key_b64,
    saltB64: row.salt_b64,
    publicMetadata: parseStoredJson(row.public_metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function archiveObjectMetadataFromRow(row: ArchiveObjectRow): unknown {
  return {
    id: row.id,
    objectType: row.object_type,
    sourceEntityType: row.source_entity_type,
    sourceEntityId: row.source_entity_id,
    encryptionAlgorithm: row.encryption_algorithm,
    keyId: row.key_id,
    nonceB64: row.nonce_b64,
    ciphertextSha256B64: row.ciphertext_sha256_b64,
    sizeBytes: row.size_bytes,
    verifiedAt: row.verified_at,
    publicMetadata: parseStoredJson(row.public_metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseArchiveKeyWrapperInput(raw: unknown): {
  keyId: string;
  wrapperType: string;
  wrappingAlgorithm: string;
  wrappedKeyB64: string;
  saltB64: string | null;
  publicMetadata: Record<string, unknown>;
} {
  const object = objectInput(raw);
  return {
    keyId: safeToken(object.keyId, "keyId"),
    wrapperType: safeToken(object.wrapperType, "wrapperType"),
    wrappingAlgorithm: safeToken(object.wrappingAlgorithm, "wrappingAlgorithm"),
    wrappedKeyB64: boundedBase64(object.wrappedKeyB64, "wrappedKeyB64", 64 * 1024),
    saltB64:
      object.saltB64 === undefined || object.saltB64 === null
        ? null
        : boundedBase64(object.saltB64, "saltB64", 1024),
    publicMetadata: publicMetadata(object.publicMetadata)
  };
}

function parseArchiveObjectInput(raw: unknown): {
  objectType: string;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  encryptionAlgorithm: string;
  keyId: string;
  nonceB64: string;
  ciphertextSha256B64: string;
  ciphertextB64: string;
  publicMetadata: Record<string, unknown>;
} {
  const object = objectInput(raw);
  return {
    objectType: safeToken(object.objectType, "objectType"),
    sourceEntityType:
      object.sourceEntityType === undefined || object.sourceEntityType === null
        ? null
        : safeToken(object.sourceEntityType, "sourceEntityType"),
    sourceEntityId:
      object.sourceEntityId === undefined || object.sourceEntityId === null
        ? null
        : safeToken(object.sourceEntityId, "sourceEntityId"),
    encryptionAlgorithm: safeToken(object.encryptionAlgorithm, "encryptionAlgorithm"),
    keyId: safeToken(object.keyId, "keyId"),
    nonceB64: boundedBase64(object.nonceB64, "nonceB64", 1024),
    ciphertextSha256B64: boundedBase64(object.ciphertextSha256B64, "ciphertextSha256B64", 128),
    ciphertextB64: boundedBase64(object.ciphertextB64, "ciphertextB64", 1024 * 1024),
    publicMetadata: publicMetadata(object.publicMetadata)
  };
}

function objectInput(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("invalid_archive_input", "Archive input must be an object");
  }
  return raw as Record<string, unknown>;
}

function safeToken(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:+-]{1,128}$/.test(value)) {
    throw new ValidationError(`invalid_${field}`, `${field} must be a safe token`);
  }
  return value;
}

function boundedBase64(value: unknown, field: string, maxBytes: number): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`invalid_${field}`, `${field} must be base64 text`);
  }
  try {
    const byteLength = encodedByteLength(value);
    if (byteLength <= 0 || byteLength > maxBytes) {
      throw new ValidationError(`invalid_${field}`, `${field} is too large`);
    }
  } catch (caught) {
    if (caught instanceof ValidationError) throw caught;
    throw new ValidationError(`invalid_${field}`, `${field} must be valid base64`);
  }
  return value;
}

function encodedByteLength(value: string): number {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)).byteLength;
}

function textByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function publicMetadata(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("invalid_public_metadata", "publicMetadata must be an object");
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > 4096) {
    throw new ValidationError("invalid_public_metadata", "publicMetadata is too large");
  }
  return value as Record<string, unknown>;
}

function parseStoredJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

async function runD1StorageMaintenance(env: ApiEnv): Promise<void> {
  if (!env.DB) return;
  try {
    await runContentEncryptionBackfill(env);
    await env.DB.prepare(
      `DELETE FROM connector_oauth_states
         WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
    ).run();
    await env.DB.prepare(
      `DELETE FROM webhook_deliveries
         WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)`
    )
      .bind(`-${WEBHOOK_DELIVERY_RETENTION_DAYS} days`)
      .run();
    await env.DB.prepare(
      `DELETE FROM connector_sync_attempts
         WHERE started_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
           AND id NOT IN (
             SELECT id
             FROM (
               SELECT
                 id,
                 ROW_NUMBER() OVER (
                   PARTITION BY user_id, account_id
                   ORDER BY started_at DESC, id DESC
                 ) AS row_number
               FROM connector_sync_attempts
             )
             WHERE row_number <= ?
           )`
    )
      .bind(`-${SYNC_ATTEMPT_RETENTION_DAYS} days`, SYNC_ATTEMPT_ACCOUNT_TAIL_ROWS)
      .run();
    await runVerifiedNotificationArchiveRetention(env);
    await env.DB.prepare(
      `DELETE FROM sync_changes
         WHERE cursor NOT IN (
           SELECT cursor
           FROM sync_changes
           ORDER BY cursor DESC
           LIMIT ?
         )`
    )
      .bind(SYNC_CHANGES_RETENTION_ROWS)
      .run();
  } catch (caught) {
    await sendOperationalAlert(
      env,
      "d1-maintenance-failed",
      "DentLink preview D1 maintenance failed",
      safeAlertText("D1 maintenance failed during scheduled cleanup.", caught)
    );
    throw caught;
  }
}

async function runVerifiedNotificationArchiveRetention(env: ApiEnv): Promise<{ deleted: number }> {
  if (!env.DB || env.DENTLINK_ARCHIVE_NOTIFICATION_RETENTION_ENABLED !== "true") {
    return { deleted: 0 };
  }
  const days = Math.max(
    1,
    envInteger(
      env.DENTLINK_ARCHIVE_NOTIFICATION_RETENTION_DAYS,
      DEFAULT_ARCHIVE_NOTIFICATION_RETENTION_DAYS
    )
  );
  const batchSize = Math.min(
    MAX_ARCHIVE_NOTIFICATION_RETENTION_BATCH_SIZE,
    Math.max(
      1,
      envInteger(
        env.DENTLINK_ARCHIVE_NOTIFICATION_RETENTION_BATCH_SIZE,
        DEFAULT_ARCHIVE_NOTIFICATION_RETENTION_BATCH_SIZE
      )
    )
  );
  const allowedUserIds = retentionUserIds(env.DENTLINK_ARCHIVE_NOTIFICATION_RETENTION_USER_IDS);
  if (allowedUserIds.length === 0) return { deleted: 0 };
  const allowedPlaceholders = allowedUserIds.map(() => "?").join(", ");
  const candidates = await env.DB.prepare(
    `SELECT n.id, n.user_id
       FROM notifications n
      WHERE n.user_id IN (${allowedPlaceholders})
        AND n.status IN ('done', 'dismissed')
        AND n.pinned = 0
        AND COALESCE(n.completed_at, n.dismissed_at, n.updated_at, n.created_at)
          < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
        AND EXISTS (
          SELECT 1
            FROM user_archive_objects ao
           WHERE ao.user_id = n.user_id
             AND ao.object_type = 'notification'
             AND ao.source_entity_type = 'notification'
             AND ao.source_entity_id = n.id
             AND ao.verified_at IS NOT NULL
        )
      ORDER BY COALESCE(n.completed_at, n.dismissed_at, n.updated_at, n.created_at) ASC, n.id ASC
      LIMIT ?`
  )
    .bind(...allowedUserIds, `-${days} days`, batchSize)
    .all<{ id: string; user_id: string }>();
  let deleted = 0;
  for (const candidate of candidates.results ?? []) {
    const removed = await env.DB.prepare(
      `DELETE FROM notifications
        WHERE id = ?
          AND user_id = ?
          AND status IN ('done', 'dismissed')
          AND pinned = 0
          AND COALESCE(completed_at, dismissed_at, updated_at, created_at)
            < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
          AND EXISTS (
            SELECT 1
              FROM user_archive_objects ao
             WHERE ao.user_id = notifications.user_id
               AND ao.object_type = 'notification'
               AND ao.source_entity_type = 'notification'
               AND ao.source_entity_id = notifications.id
               AND ao.verified_at IS NOT NULL
          )`
    )
      .bind(candidate.id, candidate.user_id, `-${days} days`)
      .run();
    if ((removed.meta?.changes ?? 0) !== 1) continue;
    deleted += 1;
    await env.DB.prepare(
      `INSERT INTO sync_changes (user_id, entity_type, entity_id, operation, payload_json, created_at)
       VALUES (?, 'notification', ?, 'delete', ?, ?)`
    )
      .bind(
        candidate.user_id,
        candidate.id,
        JSON.stringify({
          type: "notification",
          op: "delete",
          id: candidate.id,
          userId: candidate.user_id
        }),
        new Date().toISOString()
      )
      .run();
  }
  return { deleted };
}

type ContentEncryptionBackfillSummary = {
  table: string;
  updated: number;
};

type ContentEncryptionBackfillResult = {
  ok: true;
  enabled: boolean;
  batchSize: number;
  updated: number;
  summary: ContentEncryptionBackfillSummary[];
  scanned?: number;
  nextAfterRowid?: number;
  done?: boolean;
};

type BackfillTextSpec = {
  table: string;
  primaryKey: string[];
  textColumns: string[];
  jsonColumns?: string[];
};

type BackfillRow = Record<string, string | number | null>;

const CONTENT_ENCRYPTION_BACKFILL_SPECS: BackfillTextSpec[] = [
  { table: "folders", primaryKey: ["id"], textColumns: ["name"] },
  { table: "tags", primaryKey: ["id"], textColumns: ["name"] },
  { table: "notes", primaryKey: ["id"], textColumns: ["title", "body", "source_url"] },
  {
    table: "notifications",
    primaryKey: ["id"],
    textColumns: ["title", "summary", "body", "source_label", "source_url"],
    jsonColumns: ["email_metadata_json", "rule_metadata_json", "ai_metadata_json"]
  },
  {
    table: "connector_accounts",
    primaryKey: ["id"],
    textColumns: ["display_name", "error_message"],
    jsonColumns: ["settings_json"]
  },
  {
    table: "connector_source_records",
    primaryKey: ["id"],
    textColumns: ["error_message"],
    jsonColumns: ["normalized_payload_json"]
  },
  {
    table: "connector_sync_attempts",
    primaryKey: ["id"],
    textColumns: ["error_message"],
    jsonColumns: ["summary_json", "details_json"]
  },
  {
    table: "calendar_events",
    primaryKey: ["id"],
    textColumns: ["calendar_summary", "title", "description", "location", "source_url"]
  },
  { table: "calendar_event_annotations", primaryKey: ["id"], textColumns: ["notes"] },
  { table: "note_history", primaryKey: ["id"], textColumns: [], jsonColumns: ["snapshot_json"] },
  {
    table: "note_conflicts",
    primaryKey: ["id"],
    textColumns: [],
    jsonColumns: ["attempted_patch_json", "server_note_json"]
  },
  { table: "user_preferences", primaryKey: ["user_id", "key"], textColumns: ["value"] },
  { table: "webhook_endpoints", primaryKey: ["id"], textColumns: ["name"] }
];

async function runContentEncryptionBackfillRequest(
  request: Request,
  env: ApiEnv
): Promise<ContentEncryptionBackfillResult> {
  if (env.DENTLINK_CONTENT_ENCRYPTION_BACKFILL_ENABLED !== "true") {
    throw new StoreError("not_found", "Maintenance route is not enabled");
  }
  if (!env.DB) throw new StoreError("database_unavailable", "D1 database is not configured");
  const expectedToken = env.DENTLINK_MAINTENANCE_TOKEN?.trim();
  if (!expectedToken) {
    throw new StoreError("maintenance_token_unconfigured", "Maintenance token is not configured");
  }
  const providedToken = request.headers.get("X-DentLink-Maintenance-Token")?.trim() ?? "";
  if (!(await secureEqual(providedToken, expectedToken))) {
    throw new StoreError("unauthorized", "Maintenance token is invalid");
  }
  const url = new URL(request.url);
  if (url.searchParams.get("table") === "connector_sync_attempts") {
    return runConnectorSyncAttemptsContentEncryptionBackfill(env, {
      afterRowid: Math.max(0, envInteger(url.searchParams.get("afterRowid") ?? undefined, 0))
    });
  }
  return runContentEncryptionBackfill(env, { force: true });
}

async function runContentEncryptionBackfill(
  env: ApiEnv,
  options: { force?: boolean } = {}
): Promise<ContentEncryptionBackfillResult> {
  const batchSize = contentEncryptionBackfillBatchSize(env);
  const empty = {
    ok: true as const,
    enabled: false,
    batchSize,
    updated: 0,
    summary: []
  };
  if (!env.DB || (!options.force && env.DENTLINK_CONTENT_ENCRYPTION_BACKFILL_ENABLED !== "true")) {
    return empty;
  }
  if ((env.DENTLINK_ENV ?? "local") === "production" && env.DENTLINK_ENV !== "preview") {
    return empty;
  }
  const encryption = contentEncryption(env);
  if (!encryption.enabled) return empty;

  const summary: ContentEncryptionBackfillSummary[] = [];
  summary.push(await backfillUsersContentEncryption(env.DB, encryption, batchSize));
  for (const spec of CONTENT_ENCRYPTION_BACKFILL_SPECS) {
    summary.push(await backfillTableContentEncryption(env.DB, encryption, spec, batchSize));
  }
  return {
    ok: true,
    enabled: true,
    batchSize,
    updated: summary.reduce((total, item) => total + item.updated, 0),
    summary
  };
}

async function backfillUsersContentEncryption(
  db: D1DatabaseLike,
  encryption: ContentEncryption,
  batchSize: number
): Promise<ContentEncryptionBackfillSummary> {
  const rows = await db
    .prepare(
      `SELECT id, email, email_hash, encrypted_email
         FROM users
        WHERE COALESCE(encrypted_email, '') NOT LIKE 'dlenc:v1.%'
           OR email LIKE '%@%'
        LIMIT ?`
    )
    .bind(batchSize)
    .all<{
      id: string;
      email: string | null;
      email_hash: string | null;
      encrypted_email: string | null;
    }>();
  let updated = 0;
  for (const row of rows.results ?? []) {
    const encryptedEmail = row.encrypted_email;
    const email = isEncryptedString(encryptedEmail)
      ? await encryption.decryptString(encryptedEmail)
      : row.email;
    const normalizedEmail = email?.trim().toLowerCase();
    if (!normalizedEmail) continue;
    const emailHash = await sha256Hex(normalizedEmail);
    await db
      .prepare(
        `UPDATE users
            SET email = ?,
                email_hash = ?,
                encrypted_email = ?
          WHERE id = ?`
      )
      .bind(emailHash, emailHash, await encryption.encryptString(normalizedEmail), row.id)
      .run();
    updated += 1;
  }
  return { table: "users", updated };
}

async function backfillTableContentEncryption(
  db: D1DatabaseLike,
  encryption: ContentEncryption,
  spec: BackfillTextSpec,
  batchSize: number
): Promise<ContentEncryptionBackfillSummary> {
  const columns = [...spec.primaryKey, ...spec.textColumns, ...(spec.jsonColumns ?? [])];
  const rows = await db
    .prepare(
      `SELECT ${columns.map(quoteD1Identifier).join(", ")}
         FROM ${quoteD1Identifier(spec.table)}
        WHERE ${backfillCandidateWhere(spec)}
        LIMIT ?`
    )
    .bind(batchSize)
    .all<BackfillRow>();
  let updated = 0;
  for (const row of rows.results ?? []) {
    const patch: Record<string, string | null> = {};
    for (const column of spec.textColumns) {
      const value = row[column];
      if (typeof value === "string" && value.length > 0 && !isEncryptedString(value)) {
        patch[column] = await encryption.encryptString(value);
      }
    }
    for (const column of spec.jsonColumns ?? []) {
      const value = row[column];
      if (typeof value === "string" && value.length > 0 && !isEncryptedJsonEnvelope(value)) {
        patch[column] = await encryption.encryptJson(parseStoredJsonOrRaw(value));
      }
    }
    const assignments = Object.keys(patch);
    if (assignments.length === 0) continue;
    await db
      .prepare(
        `UPDATE ${quoteD1Identifier(spec.table)}
            SET ${assignments.map((column) => `${quoteD1Identifier(column)} = ?`).join(", ")}
          WHERE ${spec.primaryKey.map((column) => `${quoteD1Identifier(column)} = ?`).join(" AND ")}`
      )
      .bind(
        ...assignments.map((column) => patch[column] ?? null),
        ...spec.primaryKey.map((column) => row[column] ?? null)
      )
      .run();
    updated += 1;
  }
  return { table: spec.table, updated };
}

async function runConnectorSyncAttemptsContentEncryptionBackfill(
  env: ApiEnv,
  options: { afterRowid: number }
): Promise<ContentEncryptionBackfillResult> {
  const batchSize = contentEncryptionBackfillBatchSize(env);
  if (!env.DB) throw new StoreError("database_unavailable", "D1 database is not configured");
  const encryption = contentEncryption(env);
  if (!encryption.enabled) {
    throw new StoreError("missing_content_encryption_key", "Content encryption key is required");
  }
  const rows = await env.DB.prepare(
    `SELECT rowid, id, error_message, summary_json, details_json
       FROM connector_sync_attempts
      WHERE rowid > ?
      ORDER BY rowid ASC
      LIMIT ?`
  )
    .bind(options.afterRowid, batchSize)
    .all<
      BackfillRow & {
        rowid: number;
        id: string;
        error_message: string | null;
        summary_json: string | null;
        details_json: string | null;
      }
    >();
  let updated = 0;
  let nextAfterRowid = options.afterRowid;
  for (const row of rows.results ?? []) {
    nextAfterRowid = Math.max(nextAfterRowid, row.rowid);
    const patch: Record<string, string | null> = {};
    if (
      typeof row.error_message === "string" &&
      row.error_message.length > 0 &&
      !isEncryptedString(row.error_message)
    ) {
      patch.error_message = await encryption.encryptString(row.error_message);
    }
    if (
      typeof row.summary_json === "string" &&
      row.summary_json.length > 0 &&
      !isEncryptedJsonEnvelope(row.summary_json)
    ) {
      patch.summary_json = await encryption.encryptJson(parseStoredJsonOrRaw(row.summary_json));
    }
    if (
      typeof row.details_json === "string" &&
      row.details_json.length > 0 &&
      !isEncryptedJsonEnvelope(row.details_json)
    ) {
      patch.details_json = await encryption.encryptJson(parseStoredJsonOrRaw(row.details_json));
    }
    const assignments = Object.keys(patch);
    if (assignments.length === 0) continue;
    await env.DB.prepare(
      `UPDATE connector_sync_attempts
          SET ${assignments.map((column) => `${quoteD1Identifier(column)} = ?`).join(", ")}
        WHERE id = ?`
    )
      .bind(...assignments.map((column) => patch[column] ?? null), row.id)
      .run();
    updated += 1;
  }
  const scanned = rows.results?.length ?? 0;
  return {
    ok: true,
    enabled: true,
    batchSize,
    updated,
    scanned,
    nextAfterRowid,
    done: scanned < batchSize,
    summary: [{ table: "connector_sync_attempts", updated }]
  };
}

function backfillCandidateWhere(spec: BackfillTextSpec): string {
  const checks = [
    ...spec.textColumns.map(
      (column) =>
        `(COALESCE(${quoteD1Identifier(column)}, '') <> '' AND ${quoteD1Identifier(column)} NOT LIKE 'dlenc:v1.%')`
    ),
    ...(spec.jsonColumns ?? []).map(
      (column) =>
        `(COALESCE(${quoteD1Identifier(column)}, '') <> '' AND ${quoteD1Identifier(column)} NOT LIKE '%"__dentlinkEncrypted":1%')`
    )
  ];
  return checks.length > 0 ? checks.join(" OR ") : "0";
}

function isEncryptedJsonEnvelope(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed?.__dentlinkEncrypted === 1 && typeof parsed.ciphertext === "string";
  } catch {
    return false;
  }
}

function parseStoredJsonOrRaw(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function quoteD1Identifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new StoreError("invalid_identifier", "Invalid D1 identifier");
  }
  return `"${value}"`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function secureEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.byteLength !== right.byteLength) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode("dentlink-maintenance-token-compare"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const [leftMac, rightMac] = await Promise.all([
    crypto.subtle.sign("HMAC", key, left),
    crypto.subtle.sign("HMAC", key, right)
  ]);
  return bufferEqual(new Uint8Array(leftMac), new Uint8Array(rightMac));
}

function bufferEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function contentEncryptionBackfillBatchSize(env: ApiEnv): number {
  return Math.min(
    MAX_CONTENT_ENCRYPTION_BACKFILL_BATCH_SIZE,
    Math.max(
      1,
      envInteger(
        env.DENTLINK_CONTENT_ENCRYPTION_BACKFILL_BATCH_SIZE,
        DEFAULT_CONTENT_ENCRYPTION_BACKFILL_BATCH_SIZE
      )
    )
  );
}

function retentionUserIds(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^user_[A-Za-z0-9]+$/.test(item));
}

type ChallengeLoginInput = {
  email: string;
  challenge: string;
  response: string;
};

function parseLoginChallengeStart(value: unknown): { email: string } {
  const object = objectValue(value, "credentials");
  const email = stringValue(object.email, "email").trim().toLowerCase();
  validateAuthEmail(email);
  return { email };
}

function parseChallengeLogin(value: unknown): ChallengeLoginInput | null {
  const object = objectValue(value, "credentials");
  if (
    typeof object.challenge !== "string" ||
    typeof object.response !== "string" ||
    typeof object.password === "string"
  ) {
    return null;
  }
  const email = stringValue(object.email, "email").trim().toLowerCase();
  validateAuthEmail(email);
  const challenge = boundedToken(object.challenge, "challenge", 2048);
  const response = boundedToken(object.response, "response", 512);
  return { email, challenge, response };
}

function validateAuthEmail(email: string): void {
  if (email.length > 320) throw new ValidationError("invalid_email", "Email is too long");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new ValidationError("invalid_email", "Enter a valid email address");
  }
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`invalid_${field}`, `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new ValidationError(`invalid_${field}`, `${field} is required`);
  }
  return value;
}

function boundedToken(value: string, field: string, maxLength: number): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value.length === 0 || value.length > maxLength) {
    throw new ValidationError(`invalid_${field}`, `${field} is invalid`);
  }
  return value;
}

async function createAuthChallenge(env: ApiEnv, email: string, now: string): Promise<string> {
  const payload = {
    email,
    nonce: toBase64Url(crypto.getRandomValues(new Uint8Array(18))),
    expiresAt: new Date(Date.parse(now) + AUTH_CHALLENGE_TTL_MS).toISOString()
  };
  const encoded = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmacBase64Url(authChallengeKey(env), encoded);
  return `${encoded}.${signature}`;
}

async function verifyAuthChallengeLogin(
  env: ApiEnv,
  input: ChallengeLoginInput,
  passwordHash: string | null,
  now: string
): Promise<boolean> {
  const payload = await verifyAuthChallengeToken(env, input.challenge);
  if (!payload || payload.email !== input.email || Date.parse(payload.expiresAt) < Date.parse(now)) {
    return false;
  }
  if (!passwordHash) return false;
  const expected = await hmacBase64Url(fromBase64(passwordHash), input.challenge);
  return constantTimeEqual(expected, input.response);
}

async function verifyAuthChallengeToken(
  env: ApiEnv,
  challenge: string
): Promise<{ email: string; expiresAt: string } | null> {
  const parts = challenge.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = await hmacBase64Url(authChallengeKey(env), parts[0]);
  if (!constantTimeEqual(expected, parts[1])) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0]))) as {
      email?: unknown;
      expiresAt?: unknown;
    };
    return typeof payload.email === "string" && typeof payload.expiresAt === "string"
      ? { email: payload.email, expiresAt: payload.expiresAt }
      : null;
  } catch {
    return null;
  }
}

function authChallengeKey(env: ApiEnv): Uint8Array {
  const key = contentEncryptionKey(env) ?? "dentlink-local-auth-challenge-key";
  return new TextEncoder().encode(key);
}

async function hmacBase64Url(keyBytes: Uint8Array, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    bufferSource(keyBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return toBase64Url(new Uint8Array(signature));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return fromBase64(padded);
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function syncAllConnectors(
  store: DentLinkStore,
  userId: string,
  env: ApiEnv,
  now: string
): Promise<ConnectorSyncAllResult> {
  const startedAt = now;
  const results: ConnectorSyncAllResult["connectors"] = [];
  const accounts = (await store.listConnectorAccounts(userId)).accounts.filter(
    (account) => account.status === "connected" || recoverableGmailAccount(account)
  );
  const connectorTimeoutMs = envInteger(
    env.DENTLINK_SYNC_ALL_CONNECTOR_TIMEOUT_MS,
    DEFAULT_SYNC_ALL_CONNECTOR_TIMEOUT_MS
  );
  for (const account of accounts) {
    if (account.connectorKey === "gmail") {
      if (account.settings.gmailIngestionEngine === "gmail_imap") {
        results.push(pendingGmailImapSyncAllConnector(account));
        continue;
      }
      try {
        const result = await withConnectorTimeout(
          syncGmailAccount(store, userId, account.id, env, new Date().toISOString(), "refresh_all"),
          connectorTimeoutMs,
          account
        );
        results.push({
          accountId: account.id,
          provider: account.connectorKey,
          status: "success",
          engine:
            result.account.settings.gmailLastSyncEngine === "gmail_imap"
              ? "gmail_imap"
              : "gmail_api",
          created: result.summary.created,
          updated: result.summary.updated,
          duplicate: result.summary.duplicate,
          failed: result.summary.failed,
          progress: result.progress,
          message: null
        });
      } catch (caught) {
        if (caught instanceof StoreError && caught.code === "sync_in_progress") {
          results.push(skippedSyncAllConnector(account, caught.message));
          continue;
        }
        if (caught instanceof StoreError && caught.code === "sync_timeout") {
          await markTimedOutConnectorIdle(store, userId, account, caught, new Date().toISOString());
        }
        results.push(failedSyncAllConnector(account, caught));
      }
      continue;
    }
    if (account.connectorKey === "google-calendar") {
      try {
        const result = await withConnectorTimeout(
          syncGoogleCalendarAccount(store, userId, account.id, env, new Date().toISOString()),
          connectorTimeoutMs,
          account
        );
        results.push({
          accountId: account.id,
          provider: account.connectorKey,
          status: "success",
          created: result.upsertedEvents,
          updated: 0,
          duplicate: Math.max(0, result.processed - result.upsertedEvents),
          failed: 0,
          message: null
        });
      } catch (caught) {
        if (caught instanceof StoreError && caught.code === "sync_timeout") {
          await markTimedOutConnectorIdle(store, userId, account, caught, new Date().toISOString());
        }
        results.push(failedSyncAllConnector(account, caught));
      }
      continue;
    }
    results.push({
      accountId: account.id,
      provider: account.connectorKey,
      status: "skipped",
      created: 0,
      updated: 0,
      duplicate: 0,
      failed: 0,
      message: "Connector does not support manual sync yet"
    });
  }
  const failures = results.filter((result) => result.status === "failed").length;
  return {
    startedAt,
    completedAt: new Date().toISOString(),
    status: failures === 0 ? "success" : failures === results.length ? "failed" : "partial",
    connectors: results
  };
}

async function withConnectorTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  account: ConnectorAccount
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(
          () => {
            reject(
              new StoreError(
                "sync_timeout",
                `${account.displayName || account.connectorKey} sync timed out. Try again later.`
              )
            );
          },
          Math.max(1000, timeoutMs)
        );
      })
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function markTimedOutConnectorIdle(
  store: DentLinkStore,
  userId: string,
  account: ConnectorAccount,
  error: StoreError,
  now: string
): Promise<void> {
  const latest = await store.getConnectorAccount(userId, account.id);
  if (!latest || latest.syncStatus !== "syncing") return;
  await store.updateConnectorAccount(
    userId,
    latest.id,
    latest.version,
    {
      healthStatus: "degraded",
      syncStatus: "idle",
      lastHealthAt: now,
      errorCode: error.code,
      errorMessage: error.message
    },
    now
  );
}

function recoverableGmailAccount(account: ConnectorAccount): boolean {
  return (
    account.connectorKey === "gmail" &&
    account.status === "error" &&
    account.credentialStatus === "configured"
  );
}

function skippedSyncAllConnector(
  account: ConnectorAccount,
  message: string
): ConnectorSyncAllResult["connectors"][number] {
  return {
    accountId: account.id,
    provider: account.connectorKey,
    status: "skipped",
    engine:
      account.connectorKey === "gmail"
        ? account.settings.gmailIngestionEngine === "gmail_imap"
          ? "gmail_imap"
          : "gmail_api"
        : undefined,
    created: 0,
    updated: 0,
    duplicate: 0,
    failed: 0,
    message
  };
}

function pendingGmailImapSyncAllConnector(
  account: ConnectorAccount
): ConnectorSyncAllResult["connectors"][number] {
  return {
    accountId: account.id,
    provider: account.connectorKey,
    status: "skipped",
    engine: "gmail_imap",
    created: 0,
    updated: 0,
    duplicate: 0,
    failed: 0,
    progress: {
      discovered: 0,
      examined: 0,
      remaining: 1,
      hasMore: true
    },
    message: "Gmail IMAP will continue in small batches."
  };
}

function failedSyncAllConnector(
  account: ConnectorAccount,
  caught: unknown
): ConnectorSyncAllResult["connectors"][number] {
  return {
    accountId: account.id,
    provider: account.connectorKey,
    status: "failed",
    engine:
      account.connectorKey === "gmail"
        ? account.settings.gmailIngestionEngine === "gmail_imap"
          ? "gmail_imap"
          : "gmail_api"
        : undefined,
    created: 0,
    updated: 0,
    duplicate: 0,
    failed: 1,
    message: safeConnectorSyncMessage(account.connectorKey, caught)
  };
}

function safeConnectorSyncMessage(provider: string, caught: unknown): string {
  if (caught instanceof StoreError) {
    if (provider === "gmail") return `Gmail sync failed: ${caught.message}`;
    if (provider === "google-calendar") return `Google Calendar sync failed: ${caught.message}`;
    return `${provider} sync failed: ${caught.message}`;
  }
  if (caught instanceof GmailConfigError) return `Gmail sync failed: ${caught.message}`;
  if (caught instanceof Error && caught.message) {
    if (provider === "google-calendar") return "Google Calendar sync failed";
    if (provider === "gmail") return "Gmail sync failed";
  }
  return `${provider} sync failed`;
}

function eventStream(
  store: DentLinkStore,
  userId: string,
  cursor: string,
  signal: AbortSignal
): Response {
  const encoder = new TextEncoder();
  let latestCursor = cursor;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      send("ready", { cursor: latestCursor });
      while (!signal.aborted && !cancelled) {
        const response = await store.sync(userId, latestCursor);
        latestCursor = response.cursor;
        const events = changeEventsForSyncChanges(response.changes);
        for (const event of events) send("dentlink_change", event);
        await sleep(5000, signal);
      }
      if (!cancelled) controller.close();
    },
    cancel() {
      cancelled = true;
    }
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive"
    }
  });
}

function changeEventsForSyncChanges(changes: SyncChange[]): DentLinkChangeEvent[] {
  const events = new Map<string, DentLinkChangeEvent>();
  for (const change of changes) {
    const revision = Number.parseInt(change.cursor, 10);
    const event = changeEventForSyncChange(change, revision);
    const existing = events.get(event.type);
    if (!existing || existing.revision < event.revision) events.set(event.type, event);
  }
  return [...events.values()];
}

function changeEventForSyncChange(change: SyncChange, revision: number): DentLinkChangeEvent {
  if (change.type === "notification") {
    return { type: "notifications_updated", source: "dentlink", accountId: null, revision };
  }
  if (change.type === "calendar_event") {
    return { type: "calendar_updated", source: "calendar", accountId: null, revision };
  }
  if (change.type === "connector_account") {
    const accountId = change.op === "upsert" ? change.account.id : change.id;
    const source = change.op === "upsert" ? change.account.connectorKey : "connector";
    return { type: "connectors_updated", source, accountId, revision };
  }
  if (change.type === "note" || change.type === "folder" || change.type === "tag") {
    return { type: "notes_updated", source: "dentlink", accountId: null, revision };
  }
  if (change.type === "webhook") {
    return { type: "webhooks_updated", source: "webhook", accountId: null, revision };
  }
  return { type: "dentlink_updated", source: "dentlink", accountId: null, revision };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

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

function gmailEngineResponse(account: ConnectorAccount): ConnectorAccount & {
  requestedEngine: "gmail_api" | "gmail_imap";
  activeEngine: "gmail_api" | "gmail_imap";
  reconnectRequired: boolean;
  verified: boolean;
} {
  const activeEngine =
    account.settings.gmailIngestionEngine === "gmail_imap" ? "gmail_imap" : "gmail_api";
  const requestedEngine =
    account.settings.gmailRequestedIngestionEngine === "gmail_imap" || activeEngine === "gmail_imap"
      ? "gmail_imap"
      : "gmail_api";
  const verified =
    requestedEngine === "gmail_imap"
      ? activeEngine === "gmail_imap" && account.settings.gmailImapGranted === true
      : activeEngine === "gmail_api" && account.settings.gmailReadonlyGranted !== false;
  return {
    ...account,
    requestedEngine,
    activeEngine,
    reconnectRequired: account.settings.gmailReconnectRequired === true,
    verified
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

function parseEmailAiSettingsPatch(value: unknown): { enabled: boolean } {
  if (!value || typeof value !== "object") {
    throw new ValidationError("invalid_ai_settings", "AI settings payload is invalid");
  }
  const enabled = (value as { enabled?: unknown }).enabled;
  if (typeof enabled !== "boolean") {
    throw new ValidationError("invalid_ai_settings", "AI enabled must be a boolean");
  }
  return { enabled };
}

function parseAiReprocessBody(value: unknown): { timezone: string; accountId?: string | null } {
  const object =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const timezone =
    typeof object.timezone === "string" && validTimezone(object.timezone)
      ? object.timezone
      : DEFAULT_TIMEZONE;
  const accountId =
    typeof object.accountId === "string" && object.accountId.trim()
      ? object.accountId.trim()
      : null;
  return { timezone, accountId };
}

const TIMEZONE_PREFERENCE_KEY = "timezone_v1";
const EMAIL_AI_PREFERENCES_KEY = "email_ai_preferences_v1";
const APPEARANCE_PREFERENCE_KEY = "appearance_profile_v1";
const DEFAULT_TIMEZONE = "UTC";
const DEFAULT_IMPORTANCE_PROMPT =
  "Prioritize messages that need my action, affect scheduling, billing, safety, family, healthcare, work commitments, travel, or account security. Lower the score for routine marketing, receipts without action, newsletters, automated confirmations, and FYI-only updates.";
const DEFAULT_SUMMARY_PROMPT = "";
const DEFAULT_IMPORTANCE_THRESHOLD = 0;
const MAX_AI_PROMPT_CHARS = 2000;

async function getUserPreferences(
  store: DentLinkStore,
  userId: string,
  searchParams: URLSearchParams,
  now: string
): Promise<UserPreferences> {
  const detected = validTimezone(searchParams.get("detectedTimezone"))
    ? searchParams.get("detectedTimezone")
    : null;
  const timezone = timezonePreferenceFromJson(
    await store.getUserPreference(userId, TIMEZONE_PREFERENCE_KEY),
    detected
  );
  const ai = aiPreferencesFromJson(
    await store.getUserPreference(userId, EMAIL_AI_PREFERENCES_KEY),
    now
  );
  const appearance = appearancePreferenceFromJson(
    await store.getUserPreference(userId, APPEARANCE_PREFERENCE_KEY)
  );
  return { timezone, ai, appearance };
}

async function updateUserPreferences(
  store: DentLinkStore,
  userId: string,
  value: unknown,
  now: string
): Promise<UserPreferences> {
  const object =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const patch =
    typeof object.patch === "object" && object.patch !== null
      ? (object.patch as Record<string, unknown>)
      : {};
  const current = await getUserPreferences(store, userId, new URLSearchParams(), now);
  const timezonePatch =
    typeof patch.timezone === "object" && patch.timezone !== null
      ? (patch.timezone as Record<string, unknown>)
      : null;
  const aiPatch =
    typeof patch.ai === "object" && patch.ai !== null
      ? (patch.ai as Record<string, unknown>)
      : null;
  const appearancePatch =
    typeof patch.appearance === "object" && patch.appearance !== null
      ? (patch.appearance as Record<string, unknown>)
      : null;

  const timezone = timezonePatch
    ? normalizeTimezonePatch(current.timezone, timezonePatch)
    : current.timezone;
  const ai = aiPatch ? normalizeAiPreferencePatch(current.ai, aiPatch, now) : current.ai;
  const appearance = appearancePatch
    ? normalizeAppearancePreferencePatch(current.appearance, appearancePatch, now)
    : current.appearance;
  await store.setUserPreference(userId, TIMEZONE_PREFERENCE_KEY, JSON.stringify(timezone), now);
  await store.setUserPreference(userId, EMAIL_AI_PREFERENCES_KEY, JSON.stringify(ai), now);
  await store.setUserPreference(userId, APPEARANCE_PREFERENCE_KEY, JSON.stringify(appearance), now);
  return { timezone, ai, appearance };
}

function appearancePreferenceFromJson(value: string | null): UserPreferences["appearance"] {
  if (!value) return { profile: null, updatedAt: null };
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const profile =
      typeof parsed.profile === "object" && parsed.profile !== null
        ? (parsed.profile as Record<string, unknown>)
        : null;
    const updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : null;
    return { profile, updatedAt };
  } catch {
    return { profile: null, updatedAt: null };
  }
}

function normalizeAppearancePreferencePatch(
  current: UserPreferences["appearance"],
  patch: Record<string, unknown>,
  now: string
): UserPreferences["appearance"] {
  if (!("profile" in patch)) return current;
  const profile =
    typeof patch.profile === "object" && patch.profile !== null
      ? (JSON.parse(JSON.stringify(patch.profile)) as Record<string, unknown>)
      : null;
  return { profile, updatedAt: now };
}

function timezonePreferenceFromJson(
  value: string | null,
  detected: string | null
): UserPreferences["timezone"] {
  const fallback = detected ?? DEFAULT_TIMEZONE;
  try {
    const parsed = value ? (JSON.parse(value) as Record<string, unknown>) : {};
    const selected =
      typeof parsed.selected === "string" && validTimezone(parsed.selected)
        ? parsed.selected
        : fallback;
    const mode = parsed.mode === "override" ? "override" : "device";
    return { mode, detected, selected: mode === "device" ? fallback : selected };
  } catch {
    return { mode: "device", detected, selected: fallback };
  }
}

function normalizeTimezonePatch(
  current: UserPreferences["timezone"],
  patch: Record<string, unknown>
): UserPreferences["timezone"] {
  const mode =
    patch.mode === "override" ? "override" : patch.mode === "device" ? "device" : current.mode;
  const detected =
    patch.detected === null
      ? null
      : typeof patch.detected === "string" && validTimezone(patch.detected)
        ? patch.detected
        : current.detected;
  const selected =
    typeof patch.selected === "string" && validTimezone(patch.selected)
      ? patch.selected
      : current.selected;
  return { mode, detected, selected: mode === "device" ? (detected ?? selected) : selected };
}

function aiPreferencesFromJson(value: string | null, now: string): UserPreferences["ai"] {
  try {
    return normalizeAiPreferencePatch(defaultAiPreferences(), value ? JSON.parse(value) : {}, now);
  } catch {
    return defaultAiPreferences();
  }
}

function defaultAiPreferences(): UserPreferences["ai"] {
  return {
    globalPrompt: DEFAULT_IMPORTANCE_PROMPT,
    summaryPrompt: DEFAULT_SUMMARY_PROMPT,
    textReplacements: [],
    threshold: DEFAULT_IMPORTANCE_THRESHOLD,
    presets: [],
    accountOverrides: []
  };
}

function normalizeAiPreferencePatch(
  current: UserPreferences["ai"],
  patch: Record<string, unknown>,
  now: string
): UserPreferences["ai"] {
  const globalPrompt =
    typeof patch.globalPrompt === "string"
      ? boundedPrompt(patch.globalPrompt) || DEFAULT_IMPORTANCE_PROMPT
      : current.globalPrompt;
  const summaryPrompt =
    typeof patch.summaryPrompt === "string"
      ? boundedPrompt(patch.summaryPrompt)
      : current.summaryPrompt;
  const textReplacements = Array.isArray(patch.textReplacements)
    ? patch.textReplacements
        .map((replacement) => normalizeTextReplacement(replacement))
        .filter((replacement): replacement is UserPreferences["ai"]["textReplacements"][number] =>
          Boolean(replacement)
        )
        .slice(0, 50)
    : current.textReplacements;
  const threshold =
    typeof patch.threshold === "number" && Number.isFinite(patch.threshold)
      ? Math.max(0, Math.min(100, Math.round(patch.threshold)))
      : current.threshold;
  const presets = Array.isArray(patch.presets)
    ? patch.presets
        .map((preset) => normalizePreset(preset, now))
        .filter((preset): preset is UserPreferences["ai"]["presets"][number] => Boolean(preset))
    : current.presets;
  const accountOverrides = Array.isArray(patch.accountOverrides)
    ? patch.accountOverrides
        .map((override) => normalizeAccountOverride(override))
        .filter((override): override is UserPreferences["ai"]["accountOverrides"][number] =>
          Boolean(override)
        )
    : current.accountOverrides;
  return { globalPrompt, summaryPrompt, textReplacements, threshold, presets, accountOverrides };
}

function normalizeTextReplacement(
  value: unknown
): UserPreferences["ai"]["textReplacements"][number] | null {
  if (typeof value !== "object" || value === null) return null;
  const object = value as Record<string, unknown>;
  const find = typeof object.find === "string" ? boundedReplacementText(object.find).trim() : "";
  if (!find) return null;
  return {
    id: typeof object.id === "string" && object.id.trim() ? object.id : crypto.randomUUID(),
    find,
    replace: typeof object.replace === "string" ? boundedReplacementText(object.replace) : ""
  };
}

function boundedReplacementText(value: string): string {
  return Array.from(value).slice(0, 200).join("");
}

function normalizePreset(
  value: unknown,
  now: string
): UserPreferences["ai"]["presets"][number] | null {
  if (typeof value !== "object" || value === null) return null;
  const object = value as Record<string, unknown>;
  const name = typeof object.name === "string" ? object.name.trim().slice(0, 80) : "";
  const prompt = typeof object.prompt === "string" ? boundedPrompt(object.prompt) : "";
  if (!name || !prompt) return null;
  return {
    id: typeof object.id === "string" && object.id ? object.id : crypto.randomUUID(),
    name,
    prompt,
    createdAt: typeof object.createdAt === "string" ? object.createdAt : now,
    updatedAt: now
  };
}

function normalizeAccountOverride(
  value: unknown
): UserPreferences["ai"]["accountOverrides"][number] | null {
  if (typeof value !== "object" || value === null) return null;
  const object = value as Record<string, unknown>;
  if (typeof object.accountId !== "string" || !object.accountId) return null;
  const prompt = typeof object.prompt === "string" ? boundedPrompt(object.prompt) : "";
  const threshold =
    typeof object.threshold === "number" && Number.isFinite(object.threshold)
      ? Math.max(0, Math.min(100, Math.round(object.threshold)))
      : undefined;
  return {
    accountId: object.accountId,
    enabled: object.enabled === true,
    prompt,
    ...(threshold === undefined ? {} : { threshold })
  };
}

function boundedPrompt(value: string): string {
  return Array.from(value.trim()).slice(0, MAX_AI_PROMPT_CHARS).join("");
}

function validTimezone(value: string | null): boolean {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
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

async function databaseHealth(env: ApiEnv): Promise<{
  reachable: boolean;
  adapter: "d1" | "memory";
  storage?: DatabaseStorageHealth;
}> {
  if (!env.DB) return { reachable: true, adapter: "memory" };
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    return { reachable: true, adapter: "d1", storage: await databaseStorageHealth(env.DB, env) };
  } catch {
    return { reachable: false, adapter: "d1" };
  }
}

type DatabaseStorageHealth = {
  generatedAt: string;
  syncChanges: {
    rows: number;
    avgPayloadBytes: number;
    maxPayloadBytes: number;
    retentionTargetRows: number;
  };
  archiveObjects?: {
    rows: number;
    indexedBytes: number;
    maxTotalBytes: number;
  };
  tables: Array<{ name: string; rows: number }>;
};

const STORAGE_HEALTH_TABLES = [
  "users",
  "sessions",
  "notes",
  "note_history",
  "note_conflicts",
  "notifications",
  "connector_accounts",
  "connector_credentials",
  "connector_source_records",
  "connector_sync_attempts",
  "connector_oauth_states",
  "calendar_events",
  "calendar_event_annotations",
  "webhook_endpoints",
  "webhook_deliveries",
  "sync_changes",
  "system_alert_state",
  "user_archive_key_wrappers",
  "user_archive_objects"
] as const;

async function databaseStorageHealth(
  db: D1DatabaseLike,
  env: ApiEnv
): Promise<DatabaseStorageHealth> {
  const sync = await db
    .prepare(
      `SELECT
         COUNT(*) AS rows,
         COALESCE(AVG(length(payload_json)), 0) AS avg_payload_bytes,
         COALESCE(MAX(length(payload_json)), 0) AS max_payload_bytes
       FROM sync_changes`
    )
    .first<{
      rows: number;
      avg_payload_bytes: number;
      max_payload_bytes: number;
    }>();
  const tables = [];
  for (const name of STORAGE_HEALTH_TABLES) {
    if (!(await tableExists(db, name))) continue;
    const row = await db.prepare(`SELECT COUNT(*) AS rows FROM ${name}`).first<{ rows: number }>();
    tables.push({ name, rows: row?.rows ?? 0 });
  }
  const archiveObjects = (await tableExists(db, "user_archive_objects"))
    ? await archiveStorageHealth(
        db,
        envInteger(env.DENTLINK_ARCHIVE_MAX_TOTAL_BYTES, DEFAULT_ARCHIVE_MAX_TOTAL_BYTES)
      )
    : undefined;
  return {
    generatedAt: new Date().toISOString(),
    syncChanges: {
      rows: sync?.rows ?? 0,
      avgPayloadBytes: Math.round(sync?.avg_payload_bytes ?? 0),
      maxPayloadBytes: sync?.max_payload_bytes ?? 0,
      retentionTargetRows: SYNC_CHANGES_RETENTION_ROWS
    },
    archiveObjects,
    tables
  };
}

async function archiveStorageHealth(
  db: D1DatabaseLike,
  maxTotalBytes: number
): Promise<NonNullable<DatabaseStorageHealth["archiveObjects"]>> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS rows, COALESCE(SUM(size_bytes), 0) AS indexed_bytes
       FROM user_archive_objects`
    )
    .first<{ rows: number; indexed_bytes: number }>();
  return {
    rows: row?.rows ?? 0,
    indexedBytes: row?.indexed_bytes ?? 0,
    maxTotalBytes
  };
}

async function tableExists(db: D1DatabaseLike, name: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .bind(name)
    .first<{ name: string }>();
  return Boolean(row);
}

async function sendStorageHealthAlertIfNeeded(env: ApiEnv): Promise<void> {
  if (!env.DB) return;
  const health = await databaseStorageHealth(env.DB, env);
  const issues = storageHealthIssues(health, env);
  if (issues.length === 0) return;
  await sendOperationalAlert(
    env,
    "d1-storage-health",
    `DentLink ${env.DENTLINK_ENV ?? "local"} storage health issue`,
    [
      `DentLink ${env.DENTLINK_ENV ?? "local"} storage health crossed alert thresholds.`,
      "",
      ...issues.map((issue) => `- ${issue}`),
      "",
      `sync_changes rows: ${health.syncChanges.rows}`,
      `sync_changes avg payload bytes: ${health.syncChanges.avgPayloadBytes}`,
      `sync_changes max payload bytes: ${health.syncChanges.maxPayloadBytes}`
    ].join("\n")
  );
}

function storageHealthIssues(health: DatabaseStorageHealth, env: ApiEnv): string[] {
  const rowThreshold = envInteger(
    env.DENTLINK_SYNC_CHANGES_ROW_ALERT_THRESHOLD,
    DEFAULT_SYNC_CHANGES_ROW_ALERT_THRESHOLD
  );
  const avgPayloadThreshold = envInteger(
    env.DENTLINK_SYNC_CHANGES_AVG_PAYLOAD_ALERT_BYTES,
    DEFAULT_SYNC_CHANGES_AVG_PAYLOAD_ALERT_BYTES
  );
  const maxPayloadThreshold = envInteger(
    env.DENTLINK_SYNC_CHANGES_MAX_PAYLOAD_ALERT_BYTES,
    DEFAULT_SYNC_CHANGES_MAX_PAYLOAD_ALERT_BYTES
  );
  const issues = [];
  if (health.syncChanges.rows > rowThreshold) {
    issues.push(`sync_changes rows ${health.syncChanges.rows} exceed threshold ${rowThreshold}`);
  }
  if (health.syncChanges.avgPayloadBytes > avgPayloadThreshold) {
    issues.push(
      `sync_changes average payload ${health.syncChanges.avgPayloadBytes} bytes exceeds threshold ${avgPayloadThreshold}`
    );
  }
  if (health.syncChanges.maxPayloadBytes > maxPayloadThreshold) {
    issues.push(
      `sync_changes max payload ${health.syncChanges.maxPayloadBytes} bytes exceeds threshold ${maxPayloadThreshold}`
    );
  }
  if (
    health.archiveObjects &&
    health.archiveObjects.indexedBytes > Math.floor(health.archiveObjects.maxTotalBytes * 0.9)
  ) {
    issues.push(
      `archive indexed bytes ${health.archiveObjects.indexedBytes} exceed 90% of cap ${health.archiveObjects.maxTotalBytes}`
    );
  }
  return issues;
}

async function sendOperationalAlert(
  env: ApiEnv,
  key: string,
  subject: string,
  text: string
): Promise<void> {
  const to = env.DENTLINK_ALERT_EMAIL_TO || DEFAULT_ALERT_EMAIL_TO;
  const from = env.DENTLINK_ALERT_EMAIL_FROM;
  const fingerprint = await hashSessionToken(`${subject}\n${text}`);
  if (env.DB && !(await shouldSendAlert(env.DB, key, fingerprint, env))) return;
  if (!env.ALERT_EMAIL || !from) {
    logAlertEmailUnconfigured(key, subject);
    return;
  }
  try {
    await env.ALERT_EMAIL.send({
      to,
      from: { email: from, name: "DentLink" },
      subject,
      text
    });
    if (env.DB) await markAlertSent(env.DB, key, fingerprint);
  } catch (caught) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "alert_email_failed",
        alertKey: key,
        error: errorDetails(caught)
      })
    );
  }
}

async function shouldSendAlert(
  db: D1DatabaseLike,
  key: string,
  fingerprint: string,
  env: ApiEnv
): Promise<boolean> {
  if (!(await tableExists(db, "system_alert_state"))) return true;
  const row = await db
    .prepare(`SELECT fingerprint, sent_at FROM system_alert_state WHERE key = ?`)
    .bind(key)
    .first<{ fingerprint: string; sent_at: string }>();
  if (!row) return true;
  if (row.fingerprint !== fingerprint) return true;
  const cooldownMs =
    envInteger(env.DENTLINK_STORAGE_ALERT_COOLDOWN_HOURS, DEFAULT_STORAGE_ALERT_COOLDOWN_HOURS) *
    60 *
    60 *
    1000;
  return Date.now() - new Date(row.sent_at).getTime() > cooldownMs;
}

async function markAlertSent(db: D1DatabaseLike, key: string, fingerprint: string): Promise<void> {
  if (!(await tableExists(db, "system_alert_state"))) return;
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO system_alert_state (key, fingerprint, sent_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         fingerprint = excluded.fingerprint,
         sent_at = excluded.sent_at,
         updated_at = excluded.updated_at`
    )
    .bind(key, fingerprint, now, now, now)
    .run();
}

function safeAlertText(message: string, caught: unknown): string {
  const details = errorDetails(caught);
  return `${message}\n\n${details.name}: ${details.message}`;
}

function errorDetails(caught: unknown): { name: string; message: string } {
  return caught instanceof Error
    ? { name: caught.name, message: caught.message }
    : { name: typeof caught, message: "Non-Error thrown" };
}

function logAlertEmailUnconfigured(key: string, subject: string): void {
  console.warn(
    JSON.stringify({
      level: "warn",
      event: "alert_email_unconfigured",
      alertKey: key,
      subject
    })
  );
}

function envInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
    headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
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
