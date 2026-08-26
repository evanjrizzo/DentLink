import { webcrypto } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { hashPassword, hashSessionToken } from "./auth";
import { D1DentLinkStore, type D1DatabaseLike } from "./d1-storage";
import { createGoogleCalendarClient, type GoogleCalendarApiClient } from "./google-calendar";
import {
  createGoogleGmailClient,
  syncGmailAccount,
  syncConnectedGmailAccounts,
  type GmailApiClient,
  type GmailImapClient
} from "./gmail";
import apiDefaultForTest, { handleApiRequest, type ApiEnv } from "./index";
import { SqliteD1TestDatabase } from "./sqlite-d1-test";
import { MemoryDentLinkStore, StoreError, type DentLinkStore } from "./storage";

import type {
  ApiErrorBody,
  AssistantChatResponse,
  AuthSession,
  ClientFreshness,
  ConnectorAccount,
  DentLinkStatus,
  ConnectorSourceRecord,
  ConnectorSyncAllResult,
  ConflictResponse,
  Notification,
  GmailRule,
  CalendarEvent,
  Note,
  NoteHistoryEvent,
  NotesList,
  SyncResponse,
  Tag,
  WebhookEndpoint
} from "@dentlink/item-model";

Object.defineProperty(globalThis, "crypto", {
  configurable: true,
  value: webcrypto
});

const schemaPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../migrations/0001_auth_notes.sql"
);
const milestone2SchemaPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../migrations/0002_notifications_webhooks.sql"
);
const milestone3SchemaPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../migrations/0003_connector_framework.sql"
);
const milestone31SchemaPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../migrations/0004_gmail_connector.sql"
);
const milestone4SchemaPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../migrations/0005_google_calendar_connector.sql"
);
const milestone5SchemaPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../migrations/0006_calendar_foundation_ics.sql"
);
const milestone7SchemaPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../migrations/0007_gmail_ingestion_outcomes.sql"
);
const milestone7RulesSchemaPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../migrations/0008_gmail_rules.sql"
);
const milestone7AiSchemaPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../migrations/0009_email_sorting_ai.sql"
);
const aiPreferencesSchemaPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../migrations/0010_ai_user_preferences.sql"
);
const notificationSuppressedSchemaPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../migrations/0011_notification_suppressed_status.sql"
);
const connectorSyncAttemptsSchemaPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../migrations/0012_connector_sync_attempts.sql"
);
const d1StorageRetentionSchemaPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../migrations/0013_d1_storage_retention.sql"
);
const syncChangesTailRetentionSchemaPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../migrations/0014_sync_changes_tail_retention.sql"
);
const compactSyncChangesPayloadsSchemaPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../migrations/0015_compact_sync_changes_payloads.sql"
);
const systemAlertStateSchemaPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../migrations/0016_system_alert_state.sql"
);
const userEncryptedArchiveSchemaPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../migrations/0017_user_encrypted_archive.sql"
);
const verifiedNotificationArchiveRetentionSchemaPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../migrations/0018_verified_notification_archive_retention.sql"
);
const encryptedUserEmailsSchemaPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../migrations/0019_encrypted_user_emails.sql"
);
const clientFreshnessSchemaPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../migrations/0020_client_freshness.sql"
);
const connectorSyncJobsSchemaPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../migrations/0021_connector_sync_jobs.sql"
);

type StoreFixture = {
  name: string;
  createStore(): {
    store: DentLinkStore;
    db?: D1DatabaseLike;
    hasRawSessionToken?(token: string): Promise<boolean>;
    readSyncPayloads?(): Promise<string[]>;
  };
};

const fixtures: StoreFixture[] = [
  {
    name: "memory",
    createStore() {
      const store = new MemoryDentLinkStore();
      return {
        store,
        async hasRawSessionToken(token: string) {
          return debugSessions(store).has(token);
        }
      };
    }
  },
  {
    name: "d1",
    createStore() {
      const db = new SqliteD1TestDatabase([
        schemaPath,
        milestone2SchemaPath,
        milestone3SchemaPath,
        milestone31SchemaPath,
        milestone4SchemaPath,
        milestone5SchemaPath,
        milestone7SchemaPath,
        milestone7RulesSchemaPath,
        milestone7AiSchemaPath,
        aiPreferencesSchemaPath,
        notificationSuppressedSchemaPath,
        connectorSyncAttemptsSchemaPath,
        d1StorageRetentionSchemaPath,
        syncChangesTailRetentionSchemaPath,
        compactSyncChangesPayloadsSchemaPath,
        systemAlertStateSchemaPath,
        userEncryptedArchiveSchemaPath,
        verifiedNotificationArchiveRetentionSchemaPath,
        encryptedUserEmailsSchemaPath,
        clientFreshnessSchemaPath,
        connectorSyncJobsSchemaPath
      ]);
      return {
        db,
        store: new D1DentLinkStore(db, {
          contentEncryptionKey: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
        }),
        async hasRawSessionToken(token: string) {
          const row = await db
            .prepare("SELECT token_hash FROM sessions WHERE token_hash = ?")
            .bind(token)
            .first();
          return Boolean(row);
        },
        async readSyncPayloads() {
          const result = await db
            .prepare("SELECT payload_json FROM sync_changes ORDER BY cursor ASC")
            .all<{ payload_json: string }>();
          return (result.results ?? []).map((row) => row.payload_json);
        }
      };
    }
  }
];

describe.each(fixtures)("@dentlink/api milestone 1 storage contract ($name)", ({ createStore }) => {
  it("serves deployment health without exposing secrets", async () => {
    const { store, db } = createStore();
    const response = await handleApiRequest(new Request("https://api.dentlink.test/v1/health"), {
      store,
      DB: db,
      DENTLINK_ENV: "test",
      DENTLINK_BUILD_ID: "test-build"
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const body = (await response.json()) as {
      status: string;
      environment: string;
      build: string;
      database: {
        reachable: boolean;
        adapter: "memory" | "d1";
        storage?: {
          syncChanges: {
            rows: number;
            avgPayloadBytes: number;
            maxPayloadBytes: number;
            retentionTargetRows: number;
          };
          connectorRuntime?: never;
          tables: Array<{ name: string; rows: number }>;
        };
        connectorRuntime?: {
          status: "ok" | "degraded";
          queue: {
            staleQueuedJobs: number;
            staleRunningJobs: number;
          };
          accounts: {
            unhealthyConfiguredAccounts: number;
            staleConnectedAccounts: number;
          };
        };
      };
    };
    expect(body).toMatchObject({
      status: "ok",
      environment: "test",
      build: "test-build",
      database: { reachable: true, adapter: db ? "d1" : "memory" }
    });
    if (db) {
      expect(body.database).toEqual(
        expect.objectContaining({
          storage: expect.objectContaining({
            syncChanges: expect.objectContaining({
              rows: expect.any(Number),
              avgPayloadBytes: expect.any(Number),
              maxPayloadBytes: expect.any(Number),
              retentionTargetRows: 10000
            }),
            tables: expect.arrayContaining([
              expect.objectContaining({ name: "sync_changes", rows: expect.any(Number) })
            ])
          }),
          connectorRuntime: expect.objectContaining({
            status: "ok",
            queue: expect.objectContaining({
              staleQueuedJobs: 0,
              staleRunningJobs: 0
            }),
            accounts: expect.objectContaining({
              unhealthyConfiguredAccounts: 0,
              staleConnectedAccounts: 0
            })
          })
        })
      );
    }
    expect(JSON.stringify(body)).not.toMatch(/token|secret|password/i);
  });

  it("reports stale connector runtime health for external monitors", async () => {
    const { store, db } = createStore();
    if (!db) return;
    const owner = await register(store, "runtime-health@example.com");
    const account = await store.createConnectorAccount(
      owner.user.id,
      {
        connectorKey: "gmail",
        displayName: "Gmail",
        settings: { gmailEmail: "runtime-health@example.com" },
        credentialRef: "runtime-health-credential",
        credentialStatus: "configured"
      },
      "2026-08-19T16:00:00.000Z"
    );
    await store.updateConnectorAccount(
      owner.user.id,
      account.id,
      account.version,
      {
        status: "connected",
        healthStatus: "degraded",
        syncStatus: "idle",
        lastSyncAt: "2026-08-19T16:00:00.000Z",
        lastHealthAt: "2026-08-19T16:05:00.000Z"
      },
      "2026-08-19T16:05:00.000Z"
    );
    await store.enqueueConnectorSyncJob(
      owner.user.id,
      {
        accountId: account.id,
        trigger: "scheduled",
        runAfter: "2026-08-19T16:10:00.000Z"
      },
      "2026-08-19T16:10:00.000Z"
    );

    const response = await handleApiRequest(new Request("https://api.dentlink.test/v1/health"), {
      store,
      DB: db,
      DENTLINK_ENV: "test",
      DENTLINK_CONNECTOR_QUEUE_STALE_ALERT_MS: "1",
      DENTLINK_CONNECTOR_SYNC_STALE_ALERT_MS: "1"
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      database: {
        connectorRuntime: {
          status: "ok" | "degraded";
          queue: { staleQueuedJobs: number };
          accounts: {
            unhealthyConfiguredAccounts: number;
            staleConnectedAccounts: number;
            providers: Array<{
              provider: string;
              unhealthyConfiguredAccounts: number;
              staleConnectedAccounts: number;
            }>;
          };
        };
      };
    };
    expect(body.database.connectorRuntime).toMatchObject({
      status: "degraded",
      queue: { staleQueuedJobs: 1 },
      accounts: {
        unhealthyConfiguredAccounts: 1,
        staleConnectedAccounts: 1,
        providers: [
          expect.objectContaining({
            provider: "gmail",
            unhealthyConfiguredAccounts: 1,
            staleConnectedAccounts: 1
          })
        ]
      }
    });
    expect(JSON.stringify(body)).not.toMatch(/runtime-health@example.com|token|secret|password/i);
  });

  it("records client read freshness and reports connector freshness in status", async () => {
    const { store } = createStore();
    const owner = await register(store, "freshness@example.com");
    const recentSyncAt = new Date().toISOString();
    const account = await store.createConnectorAccount(
      owner.user.id,
      {
        connectorKey: "google-calendar",
        displayName: "Google Calendar",
        settings: { googleEmail: "freshness@example.com" },
        credentialRef: "calendar-credential",
        credentialStatus: "configured"
      },
      "2026-07-14T20:00:00.000Z"
    );
    await store.updateConnectorAccount(
      owner.user.id,
      account.id,
      account.version,
      {
        status: "connected",
        healthStatus: "healthy",
        syncStatus: "idle",
        lastSyncAt: recentSyncAt,
        lastHealthAt: recentSyncAt,
        nextSyncAt: null
      },
      "2026-07-14T20:04:30.000Z"
    );

    const heartbeat = await requestJson<ClientFreshness>(
      store,
      "POST",
      "/v1/client-heartbeat",
      {
        clientId: "web-test",
        clientType: "web",
        label: "Browser",
        buildId: "web-build",
        platform: "Firefox",
        lastReadRevision: "7",
        lastReadStatus: "current"
      },
      owner.session.token,
      200,
      { DENTLINK_BUILD_ID: "api-build" }
    );
    expect(heartbeat).toMatchObject({
      userId: owner.user.id,
      clientId: "web-test",
      clientType: "web",
      label: "Browser",
      buildId: "web-build",
      platform: "Firefox",
      lastReadRevision: "7",
      lastReadStatus: "current"
    });
    expect(Date.parse(heartbeat.lastReadAt)).toBeGreaterThan(0);

    const status = await requestJson<DentLinkStatus>(
      store,
      "GET",
      "/v1/status",
      undefined,
      owner.session.token,
      200,
      { DENTLINK_BUILD_ID: "api-build" }
    );
    expect(status).toMatchObject({
      buildId: "api-build",
      clientReads: [
        expect.objectContaining({
          clientId: "web-test",
          clientType: "web",
          lastReadRevision: "7"
        })
      ],
      connectors: [
        expect.objectContaining({
          accountId: account.id,
          provider: "google-calendar",
          freshnessStatus: "fresh",
          lastSuccessfulSyncAt: recentSyncAt,
          lastAttemptAt: recentSyncAt
        })
      ]
    });
    expect(Date.parse(status.serverTime)).toBeGreaterThan(0);
    expect(status.backendRevision).toMatch(/^\d+$/);
  });

  it("handles CORS preflight for configured origins", async () => {
    const { store } = createStore();
    const allowed = await handleApiRequest(
      new Request("https://api.dentlink.test/v1/notes", {
        method: "OPTIONS",
        headers: { Origin: "https://preview.example.test" }
      }),
      { store, ALLOWED_ORIGINS: "https://preview.example.test" }
    );
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("https://preview.example.test");
    expect(allowed.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");

    const denied = await handleApiRequest(
      new Request("https://api.dentlink.test/v1/notes", {
        method: "OPTIONS",
        headers: { Origin: "https://not-allowed.example.test" }
      }),
      { store, ALLOWED_ORIGINS: "https://preview.example.test" }
    );
    expect(denied.status).toBe(403);
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("keeps CORS headers on Gmail engine preflight and error responses", async () => {
    const { store } = createStore();
    const env = { store, ALLOWED_ORIGINS: "https://dentlink-web-preview.pages.dev" };
    const origin = "https://dentlink-web-preview.pages.dev";
    const preflight = await handleApiRequest(
      new Request("https://api.dentlink.test/v1/connectors/gmail/account_1/engine", {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "PUT",
          "Access-Control-Request-Headers": "authorization,content-type"
        }
      }),
      env
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toContain("PUT");
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
    expect(preflight.headers.get("Vary")).toContain("Origin");

    const unauthenticated = await handleApiRequest(
      new Request("https://api.dentlink.test/v1/connectors/gmail/account_1/engine", {
        method: "PUT",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: 1, engine: "gmail_imap" })
      }),
      env
    );
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(unauthenticated.headers.get("Access-Control-Allow-Methods")).toContain("PUT");

    const owner = await register(store, "engine-cors@example.com");
    const validation = await handleApiRequest(
      new Request("https://api.dentlink.test/v1/connectors/gmail/account_1/engine", {
        method: "PUT",
        headers: {
          Origin: origin,
          Authorization: `Bearer ${owner.session.token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ expectedVersion: 1, engine: "bad_engine" })
      }),
      env
    );
    expect(validation.status).toBe(400);
    expect(validation.headers.get("Access-Control-Allow-Origin")).toBe(origin);

    const conflictStore = Object.create(store) as DentLinkStore;
    conflictStore.getConnectorAccount = async () => ({
      id: "account_1",
      userId: owner.user.id,
      connectorKey: "gmail",
      displayName: "Gmail",
      status: "connected",
      healthStatus: "healthy",
      syncStatus: "idle",
      settings: {},
      credentialRef: null,
      credentialStatus: "not_configured",
      syncCursor: null,
      lastSyncAt: null,
      nextSyncAt: null,
      lastHealthAt: null,
      errorCode: null,
      errorMessage: null,
      createdAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:00.000Z",
      version: 2
    });
    conflictStore.updateConnectorAccount = async () => null;

    const conflict = await handleApiRequest(
      new Request("https://api.dentlink.test/v1/connectors/gmail/account_1/engine", {
        method: "PUT",
        headers: {
          Origin: origin,
          Authorization: `Bearer ${owner.session.token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ expectedVersion: 1, engine: "gmail_imap" })
      }),
      {
        ...env,
        store: conflictStore
      }
    );
    expect(conflict.status).toBe(409);
    expect(conflict.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(conflict.headers.get("Access-Control-Allow-Methods")).toContain("PUT");

    const failingStore = Object.create(store) as DentLinkStore;
    failingStore.getConnectorAccount = conflictStore.getConnectorAccount;
    failingStore.updateConnectorAccount = async () => {
      throw new Error("database unavailable");
    };
    const internal = await handleApiRequest(
      new Request("https://api.dentlink.test/v1/connectors/gmail/account_1/engine", {
        method: "PUT",
        headers: {
          Origin: origin,
          Authorization: `Bearer ${owner.session.token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ expectedVersion: 2, engine: "gmail_imap" })
      }),
      { ...env, store: failingStore }
    );
    expect(internal.status).toBe(500);
    expect(internal.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(internal.headers.get("Access-Control-Allow-Methods")).toContain("PUT");
  });

  it("registers, logs in, and returns a session without accepting client user identity", async () => {
    const { store } = createStore();
    const registered = await requestJson<AuthSession>(
      store,
      "POST",
      "/v1/auth/register",
      {
        email: "Owner@Example.com",
        password: "correct horse"
      },
      undefined,
      201
    );

    expect(registered.user.email).toBe("owner@example.com");
    expect(registered.session.token).toMatch(/^session_/);

    const loggedIn = await requestJson<AuthSession>(store, "POST", "/v1/auth/login", {
      email: "owner@example.com",
      password: "correct horse"
    });

    const session = await requestJson<AuthSession>(
      store,
      "GET",
      "/v1/auth/session",
      undefined,
      loggedIn.session.token
    );
    expect(session.user.id).toBe(registered.user.id);
    expect("token" in session.session).toBe(false);
  });

  it("handles duplicate registration, generic login errors, logout, malformed bearer tokens, and expiry", async () => {
    const { store, hasRawSessionToken } = createStore();
    const auth = await register(store, "Case@Test.example");

    const duplicate = await requestJson<ApiErrorBody>(
      store,
      "POST",
      "/v1/auth/register",
      { email: "case@test.example", password: "correct horse" },
      undefined,
      409
    );
    expect(duplicate.error.code).toBe("email_exists");

    const wrongPassword = await requestJson<ApiErrorBody>(
      store,
      "POST",
      "/v1/auth/login",
      { email: "case@test.example", password: "wrong horse" },
      undefined,
      401
    );
    const unknownEmail = await requestJson<ApiErrorBody>(
      store,
      "POST",
      "/v1/auth/login",
      { email: "unknown@test.example", password: "wrong horse" },
      undefined,
      401
    );
    expect(wrongPassword.error.code).toBe(unknownEmail.error.code);
    expect(wrongPassword.error.message).toBe(unknownEmail.error.message);

    if (hasRawSessionToken)
      await expect(hasRawSessionToken(auth.session.token)).resolves.toBe(false);

    await requestJson<{ ok: true }>(
      store,
      "POST",
      "/v1/auth/logout",
      undefined,
      auth.session.token
    );
    await requestJson<ApiErrorBody>(
      store,
      "GET",
      "/v1/auth/session",
      undefined,
      auth.session.token,
      401
    );
    await requestJson<ApiErrorBody>(
      store,
      "GET",
      "/v1/auth/session",
      undefined,
      "not-a-real-token",
      401
    );

    const password = await hashPassword("correct horse");
    const user = await store.createUser({ email: "expired@example.com", password });
    const expiredToken = "session_expired";
    await store.createSession(
      user.id,
      await hashSessionToken(expiredToken),
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z"
    );
    await requestJson<ApiErrorBody>(store, "GET", "/v1/auth/session", undefined, expiredToken, 401);
  });

  it("renews valid sessions on authenticated API use", async () => {
    const { store } = createStore();
    const password = await hashPassword("correct horse");
    const user = await store.createUser({ email: "renew@example.com", password });
    const token = "session_renew";
    const initialExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await store.createSession(
      user.id,
      await hashSessionToken(token),
      "2026-07-01T00:00:00.000Z",
      initialExpiry
    );

    const session = await requestJson<AuthSession>(
      store,
      "GET",
      "/v1/auth/session",
      undefined,
      token
    );

    expect(session.session.expiresAt).not.toBe(initialExpiry);
    expect(new Date(session.session.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("isolates notes by authenticated session user", async () => {
    const { store } = createStore();
    const first = await register(store, "first@example.com");
    const second = await register(store, "second@example.com");

    await requestJson<Note>(
      store,
      "POST",
      "/v1/notes",
      { kind: "task", title: "First private note" },
      first.session.token,
      201
    );
    await requestJson<Note>(
      store,
      "POST",
      "/v1/notes",
      { kind: "reference", title: "Second private note" },
      second.session.token,
      201
    );

    const firstList = await requestJson<NotesList>(
      store,
      "GET",
      "/v1/notes",
      undefined,
      first.session.token
    );
    const secondList = await requestJson<NotesList>(
      store,
      "GET",
      "/v1/notes",
      undefined,
      second.session.token
    );

    expect(firstList.notes.map((note) => note.title)).toEqual(["First private note"]);
    expect(secondList.notes.map((note) => note.title)).toEqual(["Second private note"]);

    const firstNote = firstList.notes[0];
    expect(firstNote).toBeDefined();
    await requestJson<ApiErrorBody>(
      store,
      "PATCH",
      `/v1/notes/${firstNote?.id}`,
      { expectedVersion: firstNote?.version, patch: { title: "Cross user edit" } },
      second.session.token,
      404
    );
    await requestJson<ApiErrorBody>(
      store,
      "DELETE",
      `/v1/notes/${firstNote?.id}`,
      { expectedVersion: firstNote?.version },
      second.session.token,
      404
    );
    await requestJson<ApiErrorBody>(
      store,
      "POST",
      "/v1/notes/reorder",
      { noteOrders: [{ id: firstNote?.id, expectedVersion: firstNote?.version, globalOrder: 1 }] },
      second.session.token,
      404
    );
    const secondSync = await requestJson<SyncResponse>(
      store,
      "GET",
      "/v1/sync?cursor=0",
      undefined,
      second.session.token
    );
    expect(JSON.stringify(secondSync)).not.toContain("First private note");
  });

  it("supports folders, tags, search, done, pin, and reorder", async () => {
    const { store } = createStore();
    const auth = await register(store, "notes@example.com");
    const folder = await requestJson<{ id: string }>(
      store,
      "POST",
      "/v1/folders",
      { name: "Home" },
      auth.session.token,
      201
    );
    const tag = await requestJson<{ id: string }>(
      store,
      "POST",
      "/v1/tags",
      { name: "Dental" },
      auth.session.token,
      201
    );
    const first = await requestJson<Note>(
      store,
      "POST",
      "/v1/notes",
      {
        kind: "task",
        title: "Call dentist",
        body: "Ask about appointment",
        folderId: folder.id,
        tagIds: [tag.id],
        priority: "high",
        pinned: true
      },
      auth.session.token,
      201
    );
    const second = await requestJson<Note>(
      store,
      "POST",
      "/v1/notes",
      { kind: "reference", title: "Insurance group number" },
      auth.session.token,
      201
    );

    const done = await requestJson<Note>(
      store,
      "PATCH",
      `/v1/notes/${first.id}`,
      { expectedVersion: first.version, patch: { status: "done" } },
      auth.session.token
    );
    expect(done.status).toBe("done");
    expect(done.completedAt).not.toBeNull();

    const reordered = await requestJson<Note[]>(
      store,
      "POST",
      "/v1/notes/reorder",
      {
        noteOrders: [
          { id: done.id, expectedVersion: done.version, globalOrder: 2000 },
          { id: second.id, expectedVersion: second.version, globalOrder: 1000 }
        ]
      },
      auth.session.token
    );
    expect(reordered.map((note) => note.id)).toEqual([done.id, second.id]);

    const search = await requestJson<NotesList>(
      store,
      "GET",
      "/v1/notes?search=dentist",
      undefined,
      auth.session.token
    );
    expect(search.notes).toHaveLength(1);
    expect(search.notes[0]?.tags[0]?.name).toBe("Dental");

    await requestJson<ApiErrorBody>(
      store,
      "POST",
      "/v1/notes",
      { kind: "task", title: "" },
      auth.session.token,
      400
    );
    await requestJson<ApiErrorBody>(
      store,
      "PATCH",
      `/v1/notes/${second.id}`,
      { expectedVersion: second.version, patch: { priority: "urgent" } },
      auth.session.token,
      400
    );
  });

  it("enforces Unicode-safe note title limits and manages folders, tags, and preferences", async () => {
    const { store } = createStore();
    const auth = await register(store, "prefs-notes@example.com");
    const longTitle = `${"A".repeat(71)}👨‍👩‍👧‍👦extra`;
    const note = await requestJson<Note>(
      store,
      "POST",
      "/v1/notes",
      { kind: "task", title: longTitle },
      auth.session.token,
      201
    );
    expect([
      ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(note.title)
    ]).toHaveLength(72);
    expect(note.title.endsWith("👨‍👩‍👧‍👦")).toBe(true);

    const folder = await requestJson<{ id: string; name: string }>(
      store,
      "POST",
      "/v1/folders",
      { name: "Projects" },
      auth.session.token,
      201
    );
    const renamed = await requestJson<{ name: string }>(
      store,
      "PATCH",
      `/v1/folders/${folder.id}`,
      { patch: { name: "Archive" } },
      auth.session.token
    );
    expect(renamed.name).toBe("Archive");
    const tag = await requestJson<{ id: string; name: string }>(
      store,
      "POST",
      "/v1/tags",
      { name: "Focus" },
      auth.session.token,
      201
    );
    const renamedTag = await requestJson<{ name: string }>(
      store,
      "PATCH",
      `/v1/tags/${tag.id}`,
      { patch: { name: "Important" } },
      auth.session.token
    );
    expect(renamedTag.name).toBe("Important");
    await requestJson<{ ok: true }>(
      store,
      "DELETE",
      `/v1/tags/${tag.id}`,
      undefined,
      auth.session.token
    );
    await requestJson<{ ok: true }>(
      store,
      "DELETE",
      `/v1/folders/${folder.id}`,
      undefined,
      auth.session.token
    );

    const prefs = await requestJson<{
      timezone: { selected: string };
      ai: {
        threshold: number;
        summaryPrompt: string;
        textReplacements: Array<{ find: string; replace: string }>;
      };
    }>(
      store,
      "PATCH",
      "/v1/preferences",
      {
        patch: {
          timezone: {
            mode: "override",
            detected: "America/New_York",
            selected: "America/Los_Angeles"
          },
          ai: {
            threshold: 67,
            globalPrompt: "  Prioritize bills and scheduling.  ",
            summaryPrompt: "Replace blocked words with neutral wording.",
            textReplacements: [{ find: "blocked clinic", replace: "clinic" }]
          }
        }
      },
      auth.session.token
    );
    expect(prefs.timezone.selected).toBe("America/Los_Angeles");
    expect(prefs.ai.threshold).toBe(67);
    expect(prefs.ai.summaryPrompt).toBe("Replace blocked words with neutral wording.");
    expect(prefs.ai.textReplacements).toEqual([
      expect.objectContaining({ find: "blocked clinic", replace: "clinic" })
    ]);
    expect(JSON.stringify(prefs)).not.toMatch(/system prompt|threshold.*AI/i);
  });

  it("manages connector accounts while rejecting out-of-scope providers", async () => {
    const { store } = createStore();
    const owner = await register(store, "connector-owner@example.com");
    const other = await register(store, "connector-other@example.com");

    const catalog = await requestJson<{ connectors: Array<{ key: string; name: string }> }>(
      store,
      "GET",
      "/v1/connectors/catalog",
      undefined,
      owner.session.token
    );
    expect(catalog.connectors.map((connector) => connector.key)).toEqual([
      "gmail",
      "google-calendar",
      "generic-email",
      "generic-calendar"
    ]);
    expect(JSON.stringify(catalog)).not.toMatch(/outlook|imap|graph|microsoft/i);

    const rejected = await requestJson<ApiErrorBody>(
      store,
      "POST",
      "/v1/connectors/accounts",
      {
        connectorKey: "outlook",
        displayName: "Outlook should wait"
      },
      owner.session.token,
      400
    );
    expect(rejected.error.code).toBe("unknown_connector");

    const account = await requestJson<ConnectorAccount>(
      store,
      "POST",
      "/v1/connectors/accounts",
      {
        connectorKey: "generic-email",
        displayName: "Personal mail",
        settings: { label: "Inbox" },
        credentialRef: "credential_ref_test",
        credentialStatus: "configured"
      },
      owner.session.token,
      201
    );
    expect(account.status).toBe("paused");
    expect(account.credentialRef).toBe("credential_ref_test");
    expect(JSON.stringify(account)).not.toMatch(/password|refresh_token|access_token/i);

    const listed = await requestJson<{ accounts: ConnectorAccount[] }>(
      store,
      "GET",
      "/v1/connectors/accounts",
      undefined,
      owner.session.token
    );
    expect(listed.accounts.map((item) => item.id)).toContain(account.id);

    const otherList = await requestJson<{ accounts: ConnectorAccount[] }>(
      store,
      "GET",
      "/v1/connectors/accounts",
      undefined,
      other.session.token
    );
    expect(otherList.accounts).toEqual([]);

    await requestJson<ApiErrorBody>(
      store,
      "PATCH",
      `/v1/connectors/accounts/${account.id}`,
      { expectedVersion: account.version, patch: { status: "connected" } },
      other.session.token,
      404
    );

    const updated = await requestJson<ConnectorAccount>(
      store,
      "PATCH",
      `/v1/connectors/accounts/${account.id}`,
      {
        expectedVersion: account.version,
        patch: {
          status: "connected",
          healthStatus: "healthy",
          syncStatus: "idle",
          syncCursor: "cursor-1",
          lastSyncAt: "2026-07-14T00:00:00.000Z"
        }
      },
      owner.session.token
    );
    expect(updated.status).toBe("connected");
    expect(updated.version).toBe(account.version + 1);

    await requestJson<ApiErrorBody>(
      store,
      "PATCH",
      `/v1/connectors/accounts/${account.id}`,
      { expectedVersion: account.version, patch: { status: "paused" } },
      owner.session.token,
      409
    );

    const record = await requestJson<ConnectorSourceRecord>(
      store,
      "POST",
      "/v1/connectors/source-records",
      {
        accountId: account.id,
        sourceExternalId: "provider-record-1",
        sourceType: "email",
        payloadHash: "sha256:test",
        normalizedPayload: {
          title: "Normalized only",
          sourceUrl: "https://source.example.test/message/1"
        }
      },
      owner.session.token,
      201
    );
    expect(record.connectorKey).toBe("generic-email");
    expect(JSON.stringify(record)).not.toMatch(/raw|password|secret|token/i);

    const records = await requestJson<{ records: ConnectorSourceRecord[] }>(
      store,
      "GET",
      `/v1/connectors/accounts/${account.id}/source-records`,
      undefined,
      owner.session.token
    );
    expect(records.records.map((item) => item.sourceExternalId)).toEqual(["provider-record-1"]);

    const crossRecords = await requestJson<{ records: ConnectorSourceRecord[] }>(
      store,
      "GET",
      `/v1/connectors/accounts/${account.id}/source-records`,
      undefined,
      other.session.token
    );
    expect(crossRecords.records).toEqual([]);

    const sync = await requestJson<SyncResponse>(
      store,
      "GET",
      "/v1/sync?cursor=0",
      undefined,
      owner.session.token
    );
    expect(sync.changes.some((change) => change.type === "connector_account")).toBe(true);

    const deleted = await requestJson<ConnectorAccount>(
      store,
      "DELETE",
      `/v1/connectors/accounts/${account.id}`,
      { expectedVersion: updated.version },
      owner.session.token
    );
    expect(deleted.status).toBe("deleted");
    const afterDelete = await requestJson<{ accounts: ConnectorAccount[] }>(
      store,
      "GET",
      "/v1/connectors/accounts",
      undefined,
      owner.session.token
    );
    expect(afterDelete.accounts.map((item) => item.id)).not.toContain(account.id);
  });

  it("links Gmail with OAuth state, encrypted credentials, idempotent sync, and disconnect", async () => {
    const { store } = createStore();
    const owner = await register(store, "gmail-owner@example.com");
    const other = await register(store, "gmail-other@example.com");
    const gmailClient = fakeGmailClient();
    const env = gmailTestEnv(gmailClient);

    const start = await requestJson<{ authorizationUrl: string; expiresAt: string }>(
      store,
      "POST",
      "/v1/connectors/gmail/start?returnTo=https%3A%2F%2Fweb.example.test%2Fconnectors",
      undefined,
      owner.session.token,
      201,
      env
    );
    const authorizationUrl = new URL(start.authorizationUrl);
    expect(authorizationUrl.origin).toBe("https://accounts.google.com");
    expect(authorizationUrl.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/gmail.readonly"
    );
    expect(authorizationUrl.searchParams.get("scope")).not.toBe(
      "https://www.googleapis.com/auth/gmail.metadata"
    );
    expect(authorizationUrl.searchParams.get("access_type")).toBe("offline");
    expect(authorizationUrl.searchParams.get("prompt")).toBe("consent");
    expect(authorizationUrl.searchParams.get("include_granted_scopes")).toBeNull();
    expect(authorizationUrl.searchParams.get("state")).toMatch(/^gmail_oauth_/);

    const bypass = await requestJson<ApiErrorBody>(
      store,
      "POST",
      "/v1/connectors/accounts",
      {
        connectorKey: "gmail",
        displayName: "Bypass",
        credentialRef: "raw-reference"
      },
      owner.session.token,
      400
    );
    expect(bypass.error.code).toBe("gmail_oauth_required");

    const callback = await handleApiRequest(
      new Request(
        `https://api.dentlink.test/v1/connectors/gmail/callback?code=valid-code&state=${authorizationUrl.searchParams.get(
          "state"
        )}`,
        { headers: { Accept: "application/json" } }
      ),
      { store, ...env }
    );
    expect(callback.status).toBe(200);
    const linked = (await callback.json()) as { account: ConnectorAccount };
    expect(linked.account.connectorKey).toBe("gmail");
    expect(linked.account.status).toBe("connected");
    expect(linked.account.credentialStatus).toBe("configured");
    expect(JSON.stringify(linked)).not.toContain("refresh-token-secret");

    const replay = await handleApiRequest(
      new Request(
        `https://api.dentlink.test/v1/connectors/gmail/callback?code=valid-code&state=${authorizationUrl.searchParams.get(
          "state"
        )}`,
        { headers: { Accept: "application/json" } }
      ),
      { store, ...env }
    );
    expect(replay.status).toBe(400);

    const sync = await requestJson<{
      account: ConnectorAccount;
      processed: number;
      createdNotifications: number;
      summary: {
        discovered: number;
        examined: number;
        created: number;
        updated: number;
        duplicate: number;
        skipped: number;
        filtered: number;
        failed: number;
      };
      outcomes: Array<{
        messageId: string;
        status: string;
        reason: string;
        recordId: string | null;
      }>;
    }>(
      store,
      "POST",
      `/v1/connectors/gmail/${linked.account.id}/sync`,
      undefined,
      owner.session.token,
      200,
      env
    );
    expect(sync.processed).toBe(1);
    expect(sync.createdNotifications).toBe(1);
    expect(sync.summary).toEqual({
      discovered: 1,
      examined: 1,
      created: 1,
      updated: 0,
      duplicate: 0,
      skipped: 0,
      filtered: 0,
      failed: 0
    });
    expect(sync.outcomes).toEqual([
      {
        messageId: "gmail-message-1",
        status: "notification_created",
        reason: "Created a Gmail notification",
        recordId: expect.any(String) as string
      }
    ]);
    expect(sync.account.syncCursor).toBe("101");
    expect(sync.account.healthStatus).toBe("healthy");

    const secondSync = await requestJson<typeof sync>(
      store,
      "POST",
      `/v1/connectors/gmail/${linked.account.id}/sync`,
      undefined,
      owner.session.token,
      200,
      env
    );
    expect(secondSync.processed).toBe(1);
    expect(secondSync.createdNotifications).toBe(0);
    expect(secondSync.summary).toEqual({
      discovered: 1,
      examined: 1,
      created: 0,
      updated: 0,
      duplicate: 1,
      skipped: 0,
      filtered: 0,
      failed: 0
    });
    expect(secondSync.outcomes).toEqual([
      {
        messageId: "gmail-message-1",
        status: "duplicate",
        reason: "Gmail message already has a source record",
        recordId: expect.any(String) as string
      }
    ]);

    const records = await requestJson<{ records: ConnectorSourceRecord[] }>(
      store,
      "GET",
      `/v1/connectors/accounts/${linked.account.id}/source-records`,
      undefined,
      owner.session.token
    );
    expect(records.records).toHaveLength(1);
    expect(records.records[0]).toMatchObject({
      status: "duplicate",
      processingReason: "Gmail message already has a source record",
      errorMessage: null
    });
    expect(records.records[0]?.processedAt).toBeTruthy();
    expect(records.records[0]?.normalizedPayload).toMatchObject({
      provider: "gmail",
      provider_item_id: "gmail-message-1",
      history_id: "101",
      thread_id: "gmail-thread-1",
      message_id: "<message-1@example.test>",
      unread: true,
      notification_id: expect.any(String),
      connector_account: linked.account.id
    });
    expect(JSON.stringify(records)).not.toContain("refresh-token-secret");

    const diagnostics = await requestJson<{
      summary: typeof sync.summary;
      messages: Array<{
        messageId: string;
        outcome: string;
        reason: string;
        processedAt: string | null;
        notificationId: string | null;
        sourceRecordId: string;
      }>;
    }>(
      store,
      "GET",
      `/v1/connectors/gmail/${linked.account.id}/diagnostics`,
      undefined,
      owner.session.token
    );
    expect(diagnostics.summary).toMatchObject({ examined: 1, duplicate: 1 });
    expect(diagnostics.messages[0]).toMatchObject({
      messageId: "gmail-message-1",
      outcome: "duplicate",
      reason: "Gmail message already has a source record",
      notificationId: expect.any(String),
      sourceRecordId: expect.any(String)
    });

    const notifications = await requestJson<{ notifications: Notification[] }>(
      store,
      "GET",
      "/v1/notifications",
      undefined,
      owner.session.token
    );
    expect(notifications.notifications).toHaveLength(1);
    expect(notifications.notifications[0]).toMatchObject({
      source: "connector",
      sourceLabel: "Gmail",
      title: "Insurance update",
      summary: "Front Desk <front@example.test> · unread"
    });

    const reconnectStart = await requestJson<{ authorizationUrl: string; expiresAt: string }>(
      store,
      "POST",
      `/v1/connectors/gmail/start?accountId=${linked.account.id}&returnTo=https%3A%2F%2Fweb.example.test%2Fconnectors`,
      undefined,
      owner.session.token,
      201,
      env
    );
    const reconnectUrl = new URL(reconnectStart.authorizationUrl);
    expect(reconnectUrl.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/gmail.readonly"
    );
    expect(reconnectUrl.searchParams.get("access_type")).toBe("offline");
    expect(reconnectUrl.searchParams.get("prompt")).toBe("consent");
    expect(reconnectUrl.searchParams.get("include_granted_scopes")).toBeNull();
    const reconnectCallback = await handleApiRequest(
      new Request(
        `https://api.dentlink.test/v1/connectors/gmail/callback?code=valid-code&state=${reconnectUrl.searchParams.get(
          "state"
        )}`,
        { headers: { Accept: "application/json" } }
      ),
      { store, ...env }
    );
    expect(reconnectCallback.status).toBe(200);
    const reconnected = (await reconnectCallback.json()) as { account: ConnectorAccount };
    expect(reconnected.account.id).toBe(linked.account.id);
    expect(reconnected.account.credentialStatus).toBe("configured");
    expect(reconnected.account.errorCode).toBeNull();
    expect(reconnected.account.errorMessage).toBeNull();
    expect(reconnected.account.settings).toMatchObject({
      gmailGrantedScopes: "https://www.googleapis.com/auth/gmail.readonly",
      gmailReadOnlyGranted: true,
      gmailReconnectRequired: false
    });
    const afterReconnectRecords = await requestJson<{ records: ConnectorSourceRecord[] }>(
      store,
      "GET",
      `/v1/connectors/accounts/${linked.account.id}/source-records`,
      undefined,
      owner.session.token
    );
    expect(afterReconnectRecords.records).toHaveLength(1);
    const afterReconnectNotifications = await requestJson<{ notifications: Notification[] }>(
      store,
      "GET",
      "/v1/notifications",
      undefined,
      owner.session.token
    );
    expect(afterReconnectNotifications.notifications).toHaveLength(1);

    await requestJson<ApiErrorBody>(
      store,
      "POST",
      `/v1/connectors/gmail/${linked.account.id}/sync`,
      undefined,
      other.session.token,
      404,
      env
    );

    const disconnected = await requestJson<ConnectorAccount>(
      store,
      "POST",
      `/v1/connectors/gmail/${linked.account.id}/disconnect`,
      undefined,
      owner.session.token
    );
    expect(disconnected.credentialStatus).toBe("not_configured");
    expect(disconnected.credentialRef).toBeNull();

    await requestJson<ApiErrorBody>(
      store,
      "POST",
      `/v1/connectors/gmail/${linked.account.id}/sync`,
      undefined,
      owner.session.token,
      409,
      env
    );
  });

  it("bounds Gmail diagnostics history so encrypted records do not exhaust Worker CPU", async () => {
    const { store } = createStore();
    const owner = await register(store, "gmail-diagnostics-bounds@example.com");
    const now = new Date("2026-01-01T00:00:00.000Z");
    const account = await store.createConnectorAccount(
      owner.user.id,
      {
        connectorKey: "gmail",
        displayName: "Gmail diagnostics bounds",
        settings: { googleEmail: "gmail-diagnostics-bounds@example.com" },
        credentialStatus: "configured"
      },
      now.toISOString()
    );

    for (let index = 0; index < 30; index += 1) {
      const at = new Date(now.getTime() + index * 1000).toISOString();
      await store.createConnectorSourceRecord(
        owner.user.id,
        {
          accountId: account.id,
          sourceExternalId: `gmail-diagnostic-${index}`,
          sourceType: "email",
          payloadHash: `hash-${index}`,
          normalizedPayload: { provider: "gmail", notification_id: `notification-${index}` }
        },
        at
      );
      await store.updateConnectorSourceRecordProcessing(
        owner.user.id,
        account.id,
        `gmail-diagnostic-${index}`,
        {
          status: "notification_created",
          processingReason: "Created notification"
        },
        at
      );
    }

    for (let index = 0; index < 12; index += 1) {
      const at = new Date(now.getTime() + index * 1000).toISOString();
      await store.createConnectorSyncAttempt(owner.user.id, {
        accountId: account.id,
        connectorKey: "gmail",
        trigger: "manual",
        engine: "gmail_api",
        status: "success",
        startedAt: at,
        completedAt: at,
        durationMs: index,
        errorCode: null,
        errorMessage: null,
        summary: {
          discovered: index,
          examined: index,
          created: index,
          updated: 0,
          duplicate: 0,
          skipped: 0,
          filtered: 0,
          failed: 0
        },
        details: { index }
      });
    }

    const diagnostics = await requestJson<{
      messages: Array<{ messageId: string }>;
      attempts: Array<{ details: Record<string, unknown> }>;
    }>(
      store,
      "GET",
      `/v1/connectors/gmail/${account.id}/diagnostics`,
      undefined,
      owner.session.token
    );
    expect(diagnostics.messages).toHaveLength(25);
    expect(diagnostics.messages[0]?.messageId).toBe("gmail-diagnostic-29");
    expect(diagnostics.messages.at(-1)?.messageId).toBe("gmail-diagnostic-5");
    expect(diagnostics.attempts).toHaveLength(10);
    expect(diagnostics.attempts[0]?.details).toMatchObject({ index: 11 });
    expect(diagnostics.attempts.at(-1)?.details).toMatchObject({ index: 2 });
  });

  it("applies deterministic Gmail rules before notification creation", async () => {
    const { store } = createStore();
    const owner = await register(store, "gmail-rules@example.com");
    const gmailClient = fakeGmailClient();
    const env = gmailTestEnv(gmailClient);
    const start = await requestJson<{ authorizationUrl: string }>(
      store,
      "POST",
      "/v1/connectors/gmail/start",
      undefined,
      owner.session.token,
      201,
      env
    );
    const authorizationUrl = new URL(start.authorizationUrl);
    const callback = await handleApiRequest(
      new Request(
        `https://api.dentlink.test/v1/connectors/gmail/callback?code=valid-code&state=${authorizationUrl.searchParams.get(
          "state"
        )}`,
        { headers: { Accept: "application/json" } }
      ),
      { store, ...env }
    );
    const linked = (await callback.json()) as { account: ConnectorAccount };
    const suppressRule: GmailRule = {
      id: "rule-suppress-front-desk",
      name: "Suppress front desk",
      enabled: true,
      senderDomain: "example.test",
      action: "suppress"
    };
    const rules = await requestJson<{ account: ConnectorAccount; rules: GmailRule[] }>(
      store,
      "PUT",
      `/v1/connectors/gmail/${linked.account.id}/rules`,
      { rules: [suppressRule] },
      owner.session.token,
      200,
      env
    );
    expect(rules.rules).toEqual([
      {
        ...suppressRule,
        priority: 1,
        matchMode: "all"
      }
    ]);

    const sync = await requestJson<{
      summary: { examined: number; created: number; filtered: number };
      outcomes: Array<{ messageId: string; status: string; reason: string; recordId: string }>;
    }>(
      store,
      "POST",
      `/v1/connectors/gmail/${linked.account.id}/sync`,
      undefined,
      owner.session.token,
      200,
      env
    );
    expect(sync.summary).toMatchObject({ examined: 1, created: 0, filtered: 1 });
    expect(sync.outcomes).toEqual([
      {
        messageId: "gmail-message-1",
        status: "notification_suppressed",
        reason: "Suppressed by Gmail rule: Suppress front desk",
        recordId: expect.any(String) as string
      }
    ]);
    const notifications = await requestJson<{ notifications: Notification[] }>(
      store,
      "GET",
      "/v1/notifications",
      undefined,
      owner.session.token
    );
    expect(notifications.notifications).toHaveLength(0);
    const records = await requestJson<{ records: ConnectorSourceRecord[] }>(
      store,
      "GET",
      `/v1/connectors/accounts/${linked.account.id}/source-records`,
      undefined,
      owner.session.token
    );
    expect(records.records[0]).toMatchObject({
      status: "notification_suppressed",
      normalizedPayload: {
        matched_rule_id: "rule-suppress-front-desk",
        matched_rule_name: "Suppress front desk",
        matched_rule_action: "suppress"
      }
    });
  });

  it("syncs Gmail through IMAP behind the per-account ingestion engine flag", async () => {
    const { store } = createStore();
    const owner = await register(store, "gmail-imap@example.com");
    const env = gmailTestEnv(fakeGmailClient(), fakeGmailImapClient());
    const start = await requestJson<{ authorizationUrl: string }>(
      store,
      "POST",
      "/v1/connectors/gmail/start",
      undefined,
      owner.session.token,
      201,
      env
    );
    const startUrl = new URL(start.authorizationUrl);
    const callback = await handleApiRequest(
      new Request(
        `https://api.dentlink.test/v1/connectors/gmail/callback?code=valid-code&state=${startUrl.searchParams.get(
          "state"
        )}`,
        { headers: { Accept: "application/json" } }
      ),
      { store, ...env }
    );
    const linked = (await callback.json()) as { account: ConnectorAccount };
    const pendingEngine = await requestJson<
      ConnectorAccount & {
        requestedEngine: "gmail_api" | "gmail_imap";
        activeEngine: "gmail_api" | "gmail_imap";
        reconnectRequired: boolean;
        verified: boolean;
      }
    >(
      store,
      "PUT",
      `/v1/connectors/gmail/${linked.account.id}/engine`,
      { expectedVersion: linked.account.version, engine: "gmail_imap", comparisonMode: true },
      owner.session.token,
      200,
      env
    );
    expect(pendingEngine).toMatchObject({
      requestedEngine: "gmail_imap",
      activeEngine: "gmail_api",
      reconnectRequired: true,
      verified: false
    });
    expect(pendingEngine.settings).toMatchObject({
      gmailIngestionEngine: "gmail_api",
      gmailRequestedIngestionEngine: "gmail_imap",
      gmailImapComparisonMode: true,
      gmailReconnectRequired: true
    });

    const reloadedPending = await requestJson<{ accounts: ConnectorAccount[] }>(
      store,
      "GET",
      "/v1/connectors/accounts",
      undefined,
      owner.session.token,
      200,
      env
    );
    expect(reloadedPending.accounts[0]?.settings).toMatchObject({
      gmailIngestionEngine: "gmail_api",
      gmailRequestedIngestionEngine: "gmail_imap",
      gmailReconnectRequired: true
    });

    const granted = await store.updateConnectorAccount(
      owner.user.id,
      linked.account.id,
      pendingEngine.version,
      {
        settings: {
          ...pendingEngine.settings,
          gmailGrantedScopes: "https://mail.google.com/",
          gmailImapGranted: true,
          gmailReconnectRequired: false
        }
      },
      "2026-07-14T20:00:00.000Z"
    );
    expect(granted).toBeTruthy();
    const engine = await requestJson<ConnectorAccount>(
      store,
      "PUT",
      `/v1/connectors/gmail/${linked.account.id}/engine`,
      { expectedVersion: granted?.version, engine: "gmail_imap", comparisonMode: true },
      owner.session.token,
      200,
      env
    );
    expect(engine.settings).toMatchObject({
      gmailIngestionEngine: "gmail_imap",
      gmailRequestedIngestionEngine: "gmail_imap",
      gmailImapComparisonMode: true,
      gmailReconnectRequired: false
    });

    const sync = await requestJson<{
      account: ConnectorAccount;
      summary: {
        discovered: number;
        examined: number;
        created: number;
        duplicate: number;
        failed: number;
      };
      createdNotifications: number;
      outcomes: Array<{ messageId: string; status: string; recordId: string | null }>;
    }>(
      store,
      "POST",
      `/v1/connectors/gmail/${linked.account.id}/sync`,
      undefined,
      owner.session.token,
      200,
      env
    );
    expect(sync.summary).toMatchObject({ discovered: 2, examined: 1, created: 1, failed: 0 });
    expect(sync.createdNotifications).toBe(1);
    expect(sync.account.settings).toMatchObject({
      gmailLastImapStatus: "success",
      gmailLastImapDiscovered: 2,
      gmailLastImapExamined: 1,
      gmailLastImapCreated: 1,
      gmailLastSyncEngine: "gmail_imap",
      gmailLastSyncScanned: 2,
      gmailLastSyncProcessed: 1,
      gmailLastSyncCreated: 1,
      gmailExpectedMessages: 2,
      gmailActualNotifications: 1,
      gmailMissingMessageDifference: 1,
      gmailLastImapUidValidity: "999",
      gmailLastImapUid: "10",
      gmailLastComparisonApiDiscovered: 1,
      gmailLastComparisonImapDiscovered: 2,
      gmailLastComparisonMismatch: true
    });
    expect(sync.outcomes[0]).toMatchObject({
      messageId: "x-gm-msgid:imap-gm-1",
      status: "notification_created"
    });

    const records = await requestJson<{ records: ConnectorSourceRecord[] }>(
      store,
      "GET",
      `/v1/connectors/accounts/${linked.account.id}/source-records`,
      undefined,
      owner.session.token
    );
    expect(records.records[0]?.sourceExternalId).toBe("x-gm-msgid:imap-gm-1");
    expect(records.records[0]?.normalizedPayload).toMatchObject({
      provider: "gmail",
      provider_item_id: "x-gm-msgid:imap-gm-1",
      message_id: "<imap-message@example.test>",
      imap_uid: "10",
      imap_uid_validity: "999",
      has_attachment: true,
      connector_account: linked.account.id
    });

    const repeat = await requestJson<typeof sync>(
      store,
      "POST",
      `/v1/connectors/gmail/${linked.account.id}/sync`,
      undefined,
      owner.session.token,
      200,
      env
    );
    expect(repeat.summary).toMatchObject({ discovered: 0, examined: 0, created: 0, duplicate: 0 });
  });

  it("runs deterministic rules before IMAP Gmail notification creation", async () => {
    const { store } = createStore();
    const owner = await register(store, "gmail-imap-rules@example.com");
    const env = gmailTestEnv(fakeGmailClient(), fakeGmailImapClient());
    const start = await requestJson<{ authorizationUrl: string }>(
      store,
      "POST",
      "/v1/connectors/gmail/start",
      undefined,
      owner.session.token,
      201,
      env
    );
    const startUrl = new URL(start.authorizationUrl);
    const callback = await handleApiRequest(
      new Request(
        `https://api.dentlink.test/v1/connectors/gmail/callback?code=valid-code&state=${startUrl.searchParams.get(
          "state"
        )}`,
        { headers: { Accept: "application/json" } }
      ),
      { store, ...env }
    );
    const linked = (await callback.json()) as { account: ConnectorAccount };
    const granted = await store.updateConnectorAccount(
      owner.user.id,
      linked.account.id,
      linked.account.version,
      {
        settings: {
          ...linked.account.settings,
          gmailIngestionEngine: "gmail_imap",
          gmailGrantedScopes: "https://mail.google.com/",
          gmailImapGranted: true,
          gmailReconnectRequired: false
        }
      },
      "2026-07-14T20:00:00.000Z"
    );
    expect(granted).toBeTruthy();
    await requestJson<ConnectorAccount>(
      store,
      "PUT",
      `/v1/connectors/gmail/${linked.account.id}/engine`,
      { expectedVersion: granted?.version, engine: "gmail_imap" },
      owner.session.token,
      200,
      env
    );
    await requestJson(
      store,
      "PUT",
      `/v1/connectors/gmail/${linked.account.id}/rules`,
      {
        rules: [
          {
            id: "suppress-news",
            name: "Suppress newsletters",
            enabled: true,
            mailingList: true,
            action: "suppress"
          }
        ]
      },
      owner.session.token,
      200,
      env
    );

    const sync = await requestJson<{
      summary: { created: number; filtered: number };
      outcomes: Array<{ status: string; reason: string }>;
    }>(
      store,
      "POST",
      `/v1/connectors/gmail/${linked.account.id}/sync`,
      undefined,
      owner.session.token,
      200,
      env
    );
    expect(sync.summary).toMatchObject({ created: 0, filtered: 1 });
    expect(sync.outcomes[0]).toMatchObject({
      status: "notification_suppressed",
      reason: "Suppressed by Gmail rule: Suppress newsletters"
    });
    const notifications = await requestJson<{ notifications: Notification[] }>(
      store,
      "GET",
      "/v1/notifications",
      undefined,
      owner.session.token
    );
    expect(notifications.notifications).toEqual([]);
  });

  it("stores optional AI summaries for IMAP Gmail notifications without making AI required", async () => {
    const { store } = createStore();
    const owner = await register(store, "gmail-imap-ai@example.com");
    let aiCalls = 0;
    const env = {
      ...gmailTestEnv(fakeGmailClient(), fakeGmailImapClient()),
      OPENAI_API_KEY: "test-openai-key",
      DENTLINK_AI_MODEL: "gpt-test-mini",
      emailAiClient: {
        async summarizeEmail() {
          aiCalls += 1;
          return {
            summary: "AI says this insurance update needs review.",
            importance: 90,
            category: "action_required" as const,
            requiresAction: true,
            suggestedAction: "Review",
            deadline: null,
            reason: "The message references an insurance update.",
            outputTokens: 42
          };
        }
      }
    };
    const linked = await connectImapGmailForTest(store, owner, env);
    const sync = await requestJson<{ summary: { created: number } }>(
      store,
      "POST",
      `/v1/connectors/gmail/${linked.id}/sync`,
      undefined,
      owner.session.token,
      200,
      env
    );
    expect(sync.summary.created).toBe(1);
    expect(aiCalls).toBe(1);
    const notifications = await requestJson<{ notifications: Notification[] }>(
      store,
      "GET",
      "/v1/notifications",
      undefined,
      owner.session.token
    );
    expect(notifications.notifications[0]).toMatchObject({
      summary: "AI says this insurance update needs review.",
      severity: "high",
      email: {
        provider: "gmail",
        senderAddress: "clinic@example.test",
        attachments: [{ filename: "statement.pdf" }]
      },
      rule: {
        action: "notify"
      },
      ai: {
        status: "complete",
        model: "gpt-test-mini",
        category: "action_required",
        requiresAction: true
      }
    });
    const settings = await requestJson(
      store,
      "GET",
      "/v1/ai/settings",
      undefined,
      owner.session.token,
      200,
      env
    );
    expect(settings).toMatchObject({
      enabled: true,
      available: true,
      provider: "openai",
      model: "gpt-test-mini",
      requestsThisMonth: 1,
      failedRequestsThisMonth: 0
    });
    expect(JSON.stringify(settings)).not.toMatch(/test-openai-key|Plain text/);
  });

  it("extracts Gmail API message bodies before optional AI processing", async () => {
    const { store } = createStore();
    const owner = await register(store, "gmail-api-ai@example.com");
    let aiCalls = 0;
    const gmailClient: GmailApiClient = {
      ...fakeGmailClient(),
      async getMessage(_accessToken, messageId) {
        expect(messageId).toBe("gmail-message-1");
        return {
          id: "gmail-message-1",
          threadId: "gmail-thread-1",
          historyId: "101",
          internalDate: "1783980000000",
          labelIds: ["INBOX", "UNREAD"],
          payload: {
            mimeType: "multipart/alternative",
            headers: [
              { name: "From", value: "Tester <tester@example.test>" },
              { name: "Subject", value: "Written body" },
              { name: "Date", value: "Tue, 14 Jul 2026 10:00:00 -0400" },
              { name: "Message-ID", value: "<written-body@example.test>" }
            ],
            parts: [
              {
                mimeType: "text/plain",
                body: { data: gmailBodyData("Please review the written body from Gmail API.") }
              },
              {
                mimeType: "text/html",
                body: { data: gmailBodyData("<p>HTML fallback</p>") }
              }
            ]
          }
        };
      }
    };
    const env = {
      ...gmailTestEnv(gmailClient),
      OPENAI_API_KEY: "test-openai-key",
      emailAiClient: {
        async summarizeEmail(
          input: Parameters<NonNullable<ApiEnv["emailAiClient"]>["summarizeEmail"]>[0]
        ) {
          aiCalls += 1;
          expect(input.body).toContain("written body from Gmail API");
          return {
            summary: "AI summarized the Gmail API body.",
            importance: 88,
            category: "action_required" as const,
            requiresAction: true,
            suggestedAction: "Review",
            deadline: null,
            reason: "The fetched Gmail API body requested review.",
            outputTokens: 21
          };
        }
      }
    };
    const linked = await connectGmailForTest(store, owner, env);
    await requestJson(
      store,
      "POST",
      `/v1/connectors/gmail/${linked.id}/sync`,
      undefined,
      owner.session.token,
      200,
      env
    );
    expect(aiCalls).toBe(1);
    const records = await requestJson<{ records: ConnectorSourceRecord[] }>(
      store,
      "GET",
      `/v1/connectors/accounts/${linked.id}/source-records`,
      undefined,
      owner.session.token
    );
    expect(records.records[0]?.normalizedPayload).toMatchObject({
      snippet: "Please review the written body from Gmail API."
    });
    expect(records.records[0]?.normalizedPayload).not.toHaveProperty("normalized_body");
    const notifications = await requestJson<{ notifications: Notification[] }>(
      store,
      "GET",
      "/v1/notifications",
      undefined,
      owner.session.token
    );
    expect(notifications.notifications[0]).toMatchObject({
      summary: "AI summarized the Gmail API body.",
      ai: { status: "complete", requiresAction: true }
    });
  });

  it("persists an explicit per-user AI opt-out while leaving AI available", async () => {
    const { store } = createStore();
    const owner = await register(store, "gmail-imap-ai-optout@example.com");
    let aiCalls = 0;
    const env = {
      ...gmailTestEnv(fakeGmailClient(), fakeGmailImapClient()),
      OPENAI_API_KEY: "test-openai-key",
      emailAiClient: {
        async summarizeEmail() {
          aiCalls += 1;
          return {
            summary: "Should not run.",
            importance: 90,
            category: "other" as const,
            requiresAction: false,
            suggestedAction: "Ignore",
            deadline: null,
            reason: "Opted out.",
            outputTokens: 1
          };
        }
      }
    };
    const updated = await requestJson(
      store,
      "PATCH",
      "/v1/ai/settings",
      { enabled: false },
      owner.session.token,
      200,
      env
    );
    expect(updated).toMatchObject({ enabled: false, available: true });
    const linked = await connectImapGmailForTest(store, owner, env);
    await requestJson(
      store,
      "POST",
      `/v1/connectors/gmail/${linked.id}/sync`,
      undefined,
      owner.session.token,
      200,
      env
    );
    expect(aiCalls).toBe(0);
    const notifications = await requestJson<{ notifications: Notification[] }>(
      store,
      "GET",
      "/v1/notifications",
      undefined,
      owner.session.token
    );
    expect(notifications.notifications[0]?.ai).toMatchObject({ status: "disabled" });
  });

  it("applies per-account AI overrides, suppresses below-threshold notifications, and reprocesses same-day stored data idempotently", async () => {
    const { store } = createStore();
    const owner = await register(store, "gmail-ai-reprocess@example.com");
    const now = new Date().toISOString();
    const account = await store.createConnectorAccount(
      owner.user.id,
      {
        connectorKey: "gmail",
        displayName: "Gmail owner@example.test",
        settings: { googleEmail: "owner@example.test" },
        credentialRef: "credential_ref_test",
        credentialStatus: "configured"
      },
      now
    );
    const notification = await store.createNotification(
      owner.user.id,
      {
        title: "Insurance update",
        summary: "Stored body",
        body: "Created from stored normalized data",
        source: "connector",
        sourceLabel: "Gmail",
        severity: "medium",
        email: {
          accountId: account.id,
          provider: "gmail",
          providerMessageId: "message-1",
          messageId: "<message-1@example.test>",
          xGmMsgId: null,
          senderAddress: "clinic@example.test",
          senderDisplayName: "Clinic",
          recipients: ["owner@example.test"],
          subject: "Insurance update",
          receivedAt: now,
          labels: ["INBOX"],
          unread: true,
          automatedSender: false,
          mailingList: false,
          attachments: [],
          snippet: "Please review your insurance update.",
          normalizedBodyHash: null,
          sourceUrl: "https://mail.google.com/mail/u/0/#inbox/message-1"
        }
      },
      now
    );
    await store.createConnectorSourceRecord(
      owner.user.id,
      {
        accountId: account.id,
        sourceExternalId: "message-1",
        sourceType: "email",
        payloadHash: "hash-1",
        normalizedPayload: {
          provider: "gmail",
          provider_item_id: "message-1",
          received_at: now,
          labels: ["INBOX"],
          unread: true,
          sender: "Clinic <clinic@example.test>",
          sender_address: "clinic@example.test",
          subject: "Insurance update",
          recipients: ["owner@example.test"],
          normalized_body: "Please review your insurance update.",
          notification_id: notification.id,
          connector_account: account.id
        }
      },
      now
    );

    await requestJson(
      store,
      "PATCH",
      "/v1/preferences",
      {
        patch: {
          ai: {
            globalPrompt: "Global billing guidance",
            summaryPrompt: "Replace blocked clinic nicknames with neutral wording.",
            textReplacements: [
              { find: "Insurance", replace: "Benefits" },
              { find: "insurance", replace: "benefits" }
            ],
            threshold: 80,
            accountOverrides: [
              {
                accountId: account.id,
                enabled: true,
                prompt: "Account-specific insurance guidance",
                threshold: 60
              }
            ]
          }
        }
      },
      owner.session.token
    );

    const aiInputs: unknown[] = [];
    const env: Partial<ApiEnv> = {
      OPENAI_API_KEY: "test-openai-key",
      DENTLINK_AI_MODEL: "gpt-test-mini",
      emailAiClient: {
        async summarizeEmail(input) {
          aiInputs.push(input);
          return {
            summary: "AI reprocessed insurance update.",
            importance: 50,
            category: "action_required" as const,
            requiresAction: true,
            suggestedAction: "Review",
            deadline: null,
            reason: "Stored source record requested review.",
            outputTokens: 9
          };
        }
      }
    };

    const reprocessed = await requestJson<{
      status: string;
      updated: number;
      suppressed: number;
      failed: number;
      errors: unknown[];
    }>(
      store,
      "POST",
      "/v1/ai/reprocess",
      { timezone: "UTC", accountId: account.id },
      owner.session.token,
      202,
      env
    );
    expect(reprocessed.errors).toEqual([]);
    expect(reprocessed).toMatchObject({ status: "success", updated: 1, suppressed: 1, failed: 0 });
    expect(aiInputs).toHaveLength(1);
    expect(JSON.stringify(aiInputs[0])).toContain("Account-specific insurance guidance");
    expect(JSON.stringify(aiInputs[0])).toContain(
      "Replace blocked clinic nicknames with neutral wording."
    );
    expect(JSON.stringify(aiInputs[0])).not.toMatch(/threshold|60|80/i);

    const normalInbox = await requestJson<{ notifications: Notification[] }>(
      store,
      "GET",
      "/v1/notifications",
      undefined,
      owner.session.token
    );
    expect(normalInbox.notifications).toEqual([]);
    const searchable = await requestJson<{ notifications: Notification[] }>(
      store,
      "GET",
      "/v1/notifications?includeSuppressed=true&search=benefits",
      undefined,
      owner.session.token
    );
    expect(searchable.notifications[0]).toMatchObject({
      id: notification.id,
      status: "suppressed",
      title: "Benefits update",
      email: expect.objectContaining({ subject: "Benefits update" }),
      summary: "AI reprocessed benefits update.",
      ai: { summary: "AI reprocessed benefits update.", importance: 50 }
    });

    await requestJson(
      store,
      "POST",
      "/v1/ai/reprocess",
      { timezone: "UTC", accountId: account.id },
      owner.session.token,
      202,
      env
    );
    expect(aiInputs).toHaveLength(1);
  });

  it("answers assistant questions with owned Gmail and calendar context", async () => {
    const { store } = createStore();
    const owner = await register(store, "assistant-owner@example.com");
    const other = await register(store, "assistant-other@example.com");
    const now = "2026-07-16T14:00:00.000Z";
    const ownerAccount = await store.createConnectorAccount(
      owner.user.id,
      {
        connectorKey: "gmail",
        displayName: "Personal Gmail",
        settings: { googleEmail: "owner@example.test" },
        credentialRef: "owner_credential",
        credentialStatus: "configured"
      },
      now
    );
    const otherAccount = await store.createConnectorAccount(
      other.user.id,
      {
        connectorKey: "gmail",
        displayName: "Other Gmail",
        settings: { googleEmail: "other@example.test" },
        credentialRef: "other_credential",
        credentialStatus: "configured"
      },
      now
    );
    const ownerRecord = await store.createConnectorSourceRecord(
      owner.user.id,
      {
        accountId: ownerAccount.id,
        sourceExternalId: "owner-message-1",
        sourceType: "email",
        payloadHash: "owner-hash",
        normalizedPayload: {
          provider: "gmail",
          sender: "Chris Biancone <chris@example.test>",
          sender_address: "chris@example.test",
          subject: "Permit update",
          received_at: "2026-07-16T13:25:00.000Z",
          snippet: "The permit was approved.",
          normalized_body: "The permit was approved and the next filing is due tomorrow.",
          permalink: "https://mail.google.com/mail/u/0/#inbox/owner-message-1"
        }
      },
      now
    );
    await store.createConnectorSourceRecord(
      other.user.id,
      {
        accountId: otherAccount.id,
        sourceExternalId: "other-message-1",
        sourceType: "email",
        payloadHash: "other-hash",
        normalizedPayload: {
          provider: "gmail",
          sender: "Chris Biancone <private-other@example.test>",
          sender_address: "private-other@example.test",
          subject: "Other user's private email",
          received_at: "2026-07-16T13:30:00.000Z",
          normalized_body: "This must not be visible."
        }
      },
      now
    );
    const event = await store.createLocalCalendarEvent(
      owner.user.id,
      {
        title: "Implant consult",
        description: "Review chart",
        startAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        endAt: new Date(Date.now() + 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
        timezone: "America/New_York",
        location: "Operatory 2"
      },
      now
    );
    let sawContext = false;
    const env: Partial<ApiEnv> = {
      OPENAI_API_KEY: "test-key",
      assistantAiClient: {
        async answer(input) {
          sawContext = true;
          expect(input.question).toContain("Chris");
          expect(input.context.emails).toHaveLength(1);
          expect(input.context.emails[0]).toMatchObject({
            senderAddress: "chris@example.test",
            subject: "Permit update"
          });
          expect(JSON.stringify(input.context)).not.toContain("private-other@example.test");
          expect(input.context.calendarEvents).toEqual(
            expect.arrayContaining([expect.objectContaining({ title: "Implant consult" })])
          );
          return {
            answer: "Chris said the permit was approved. You also have Implant consult tomorrow.",
            sourceIds: [ownerRecord.id, event.id],
            outputTokens: 42
          };
        }
      }
    };

    const response = await requestJson<AssistantChatResponse>(
      store,
      "POST",
      "/v1/assistant/chat",
      { message: "What was the last thing Chris Biancone sent me?", timezone: "America/New_York" },
      owner.session.token,
      200,
      env
    );
    expect(sawContext).toBe(true);
    expect(response.answer).toContain("permit was approved");
    expect(response.sources.map((source) => source.id)).toEqual([ownerRecord.id, event.id]);
    expect(response.ai).toMatchObject({
      status: "complete",
      model: "gpt-4.1-mini",
      promptVersion: "assistant-readonly-v1"
    });
  });

  it("treats latest email questions as received-time queries instead of subject searches", async () => {
    const { store } = createStore();
    const owner = await register(store, "assistant-latest@example.com");
    const now = "2026-07-16T16:00:00.000Z";
    const account = await store.createConnectorAccount(
      owner.user.id,
      {
        connectorKey: "gmail",
        displayName: "Personal Gmail",
        settings: { googleEmail: "owner@example.test" },
        credentialRef: "credential",
        credentialStatus: "configured"
      },
      now
    );
    const created: ConnectorSourceRecord[] = [];
    for (const [index, receivedAt] of [
      "2026-07-16T15:05:00.000Z",
      "2026-07-16T15:04:00.000Z",
      "2026-07-16T15:03:00.000Z",
      "2026-07-16T15:02:00.000Z",
      "2026-07-16T15:01:00.000Z",
      "2026-07-13T06:39:18.000Z"
    ].entries()) {
      created.push(
        await store.createConnectorSourceRecord(
          owner.user.id,
          {
            accountId: account.id,
            sourceExternalId: `message-${index}`,
            sourceType: "email",
            payloadHash: `hash-${index}`,
            normalizedPayload: {
              provider: "gmail",
              sender: `Sender ${index} <sender${index}@example.test>`,
              sender_address: `sender${index}@example.test`,
              subject: index === 5 ? "Here's your latest Credit Summary" : `Inbox item ${index}`,
              received_at: receivedAt,
              snippet: `Snippet ${index}`,
              normalized_body: `Body ${index}`
            }
          },
          now
        )
      );
    }
    const env: Partial<ApiEnv> = {
      OPENAI_API_KEY: "test-key",
      assistantAiClient: {
        async answer(input) {
          expect(input.context.emails.map((email) => email.subject)).toEqual([
            "Inbox item 0",
            "Inbox item 1",
            "Inbox item 2",
            "Inbox item 3",
            "Inbox item 4"
          ]);
          expect(JSON.stringify(input.context)).not.toContain("Credit Summary");
          return {
            answer: "Here are the latest 5.",
            sourceIds: created.slice(0, 5).map((record) => record.id),
            outputTokens: 12
          };
        }
      }
    };

    const response = await requestJson<AssistantChatResponse>(
      store,
      "POST",
      "/v1/assistant/chat",
      { message: "just give me the latest 5", timezone: "America/New_York" },
      owner.session.token,
      200,
      env
    );
    expect(response.sources.map((source) => source.title)).toEqual([
      "Inbox item 0",
      "Inbox item 1",
      "Inbox item 2",
      "Inbox item 3",
      "Inbox item 4"
    ]);
  });

  it("passes latest notifications newest-first and sorts notification previews newest-first", async () => {
    const { store } = createStore();
    const owner = await register(store, "assistant-notifications@example.com");
    const older = await store.createNotification(
      owner.user.id,
      {
        title: "Older notification",
        summary: "Older",
        source: "system",
        sourceLabel: "System"
      },
      "2026-07-16T12:00:00.000Z"
    );
    const newest = await store.createNotification(
      owner.user.id,
      {
        title: "Newest notification",
        summary: "Newest",
        source: "system",
        sourceLabel: "System"
      },
      "2026-07-16T15:00:00.000Z"
    );
    const middle = await store.createNotification(
      owner.user.id,
      {
        title: "Middle notification",
        summary: "Middle",
        source: "system",
        sourceLabel: "System"
      },
      "2026-07-16T13:00:00.000Z"
    );
    await store.createNotification(
      owner.user.id,
      {
        title: "Fourth notification",
        summary: "Fourth",
        source: "system",
        sourceLabel: "System"
      },
      "2026-07-16T11:00:00.000Z"
    );
    await store.createNotification(
      owner.user.id,
      {
        title: "Fifth notification",
        summary: "Fifth",
        source: "system",
        sourceLabel: "System"
      },
      "2026-07-16T10:00:00.000Z"
    );
    await store.createNotification(
      owner.user.id,
      {
        title: "Sixth notification",
        summary: "Sixth",
        source: "system",
        sourceLabel: "System"
      },
      "2026-07-16T09:00:00.000Z"
    );
    const env: Partial<ApiEnv> = {
      OPENAI_API_KEY: "test-key",
      assistantAiClient: {
        async answer(input) {
          expect(input.context.notifications.map((notification) => notification.title)).toEqual([
            "Newest notification",
            "Middle notification",
            "Older notification",
            "Fourth notification",
            "Fifth notification"
          ]);
          expect(JSON.stringify(input.context)).not.toContain("Sixth notification");
          return {
            answer: "Newest, then middle, then older.",
            sourceIds: [older.id, newest.id, middle.id],
            outputTokens: 10
          };
        }
      }
    };

    const response = await requestJson<AssistantChatResponse>(
      store,
      "POST",
      "/v1/assistant/chat",
      { message: "what are my latest notifications?", timezone: "America/New_York" },
      owner.session.token,
      200,
      env
    );
    expect(response.sources.map((source) => source.title)).toEqual([
      "Newest notification",
      "Middle notification",
      "Older notification"
    ]);
  });

  it("answers assistant questions with client-decrypted archived notification context", async () => {
    const { store } = createStore();
    const owner = await register(store, "assistant-archive@example.com");
    const archivedId = "notification_clown_archive_test_1785345010";
    let sawArchiveContext = false;
    const env: Partial<ApiEnv> = {
      OPENAI_API_KEY: "test-key",
      assistantAiClient: {
        async answer(input) {
          sawArchiveContext = true;
          expect(input.context.notifications).toHaveLength(1);
          expect(input.context.notifications[0]).toMatchObject({
            id: `archive:${archivedId}`,
            title: "Killer clowns on the rampage at the Cincinnati Zoo",
            sourceLabel: "Archive - Archive Assistant Test",
            status: "done"
          });
          return {
            answer: "The clown alert is a fake archived notification.",
            sourceIds: [`archive:${archivedId}`],
            outputTokens: 9
          };
        }
      }
    };

    const response = await requestJson<AssistantChatResponse>(
      store,
      "POST",
      "/v1/assistant/chat",
      {
        message: "can you find any clowns?",
        timezone: "America/New_York",
        archivedNotifications: [
          {
            id: archivedId,
            title: "Killer clowns on the rampage at the Cincinnati Zoo",
            summary: "Fake archive assistant test about killer clowns at the Cincinnati Zoo.",
            body: "This is not a real alert.",
            sourceLabel: "Archive Assistant Test",
            severity: "medium",
            status: "done",
            createdAt: "2026-07-29T17:14:50.220Z",
            updatedAt: "2026-07-29T17:14:50.220Z",
            sourceTimestamp: "2026-07-27T00:00:00.000Z",
            sourceUrl: null
          }
        ]
      },
      owner.session.token,
      200,
      env
    );

    expect(sawArchiveContext).toBe(true);
    expect(response.answer).toContain("fake archived notification");
    expect(response.sources).toEqual([
      expect.objectContaining({
        id: `archive:${archivedId}`,
        kind: "notification",
        title: "Killer clowns on the rampage at the Cincinnati Zoo",
        subtitle: "Archive - Archive Assistant Test - done"
      })
    ]);
  });

  it("sorts calendar source previews earliest upcoming first", async () => {
    const { store } = createStore();
    const owner = await register(store, "assistant-calendar-order@example.com");
    const later = await store.createLocalCalendarEvent(
      owner.user.id,
      {
        title: "Later event",
        startAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        endAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
        timezone: "America/New_York"
      },
      "2026-07-29T12:00:00.000Z"
    );
    const earlier = await store.createLocalCalendarEvent(
      owner.user.id,
      {
        title: "Earlier event",
        startAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        endAt: new Date(Date.now() + 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
        timezone: "America/New_York"
      },
      "2026-07-29T12:00:00.000Z"
    );
    const env: Partial<ApiEnv> = {
      OPENAI_API_KEY: "test-key",
      assistantAiClient: {
        async answer(input) {
          expect(input.context.calendarEvents.map((event) => event.title)).toEqual([
            "Earlier event",
            "Later event"
          ]);
          return {
            answer: "Earlier, then later.",
            sourceIds: [later.id, earlier.id],
            outputTokens: 10
          };
        }
      }
    };

    const response = await requestJson<AssistantChatResponse>(
      store,
      "POST",
      "/v1/assistant/chat",
      { message: "what do I have going on this week?", timezone: "America/New_York" },
      owner.session.token,
      200,
      env
    );
    expect(response.sources.map((source) => source.title)).toEqual([
      "Earlier event",
      "Later event"
    ]);
  });

  it("passes built-in DentLink usage help to assistant questions", async () => {
    const { store } = createStore();
    const owner = await register(store, "assistant-help@example.com");
    let sawHelpContext = false;
    const env: Partial<ApiEnv> = {
      OPENAI_API_KEY: "test-key",
      assistantAiClient: {
        async answer(input) {
          sawHelpContext = true;
          expect(input.context.help).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                topic: "Notifications",
                guidance: expect.arrayContaining([expect.stringContaining("review active items")])
              }),
              expect.objectContaining({
                topic: "Settings and connections",
                guidance: expect.arrayContaining([expect.stringContaining("Refresh All")])
              })
            ])
          );
          return {
            answer:
              "Use Home for assistant questions, Notifications for incoming items, Notes for tasks, Calendar for events, and Settings -> Connections for sync setup.",
            sourceIds: [],
            outputTokens: 14
          };
        }
      }
    };

    const response = await requestJson<AssistantChatResponse>(
      store,
      "POST",
      "/v1/assistant/chat",
      { message: "tell me how to use dentlink", timezone: "America/New_York" },
      owner.session.token,
      200,
      env
    );
    expect(sawHelpContext).toBe(true);
    expect(response.answer).toContain("Notifications");
    expect(response.sources).toEqual([]);
  });

  it("returns a stable assistant error when AI is unavailable", async () => {
    const { store } = createStore();
    const owner = await register(store, "assistant-no-ai@example.com");
    const response = await requestJson<ApiErrorBody>(
      store,
      "POST",
      "/v1/assistant/chat",
      { message: "What do I have this week?", timezone: "America/New_York" },
      owner.session.token,
      503
    );
    expect(response.error.code).toBe("missing_api_key");
  });

  it("creates IMAP notifications with fallback content when AI is disabled", async () => {
    const { store } = createStore();
    const owner = await register(store, "gmail-imap-no-ai@example.com");
    const env = gmailTestEnv(fakeGmailClient(), fakeGmailImapClient());
    const settings = await requestJson(
      store,
      "GET",
      "/v1/ai/settings",
      undefined,
      owner.session.token,
      200,
      env
    );
    expect(settings).toMatchObject({
      enabled: false,
      available: false,
      unavailableReason: "missing_api_key"
    });
    const linked = await connectImapGmailForTest(store, owner, env);
    await requestJson(
      store,
      "POST",
      `/v1/connectors/gmail/${linked.id}/sync`,
      undefined,
      owner.session.token,
      200,
      env
    );
    const notifications = await requestJson<{ notifications: Notification[] }>(
      store,
      "GET",
      "/v1/notifications",
      undefined,
      owner.session.token
    );
    expect(notifications.notifications[0]?.ai).toMatchObject({ status: "disabled" });
    expect(notifications.notifications[0]?.summary).toContain("Plain text");
  });

  it("requests mail.google.com and verifies IMAP capability during IMAP reconnect", async () => {
    const { store } = createStore();
    const owner = await register(store, "gmail-imap-reconnect@example.com");
    const initialEnv = gmailTestEnv(fakeGmailClient());
    const start = await requestJson<{ authorizationUrl: string }>(
      store,
      "POST",
      "/v1/connectors/gmail/start",
      undefined,
      owner.session.token,
      201,
      initialEnv
    );
    const startUrl = new URL(start.authorizationUrl);
    const callback = await handleApiRequest(
      new Request(
        `https://api.dentlink.test/v1/connectors/gmail/callback?code=valid-code&state=${startUrl.searchParams.get(
          "state"
        )}`,
        { headers: { Accept: "application/json" } }
      ),
      { store, ...initialEnv }
    );
    const linked = (await callback.json()) as { account: ConnectorAccount };
    const pending = await requestJson<ConnectorAccount>(
      store,
      "PUT",
      `/v1/connectors/gmail/${linked.account.id}/engine`,
      { expectedVersion: linked.account.version, engine: "gmail_imap", comparisonMode: true },
      owner.session.token,
      200,
      initialEnv
    );
    expect(pending.settings).toMatchObject({
      gmailIngestionEngine: "gmail_api",
      gmailRequestedIngestionEngine: "gmail_imap",
      gmailImapComparisonMode: true,
      gmailReconnectRequired: true
    });
    const reconnectEnv = gmailTestEnv(
      fakeGmailClientWithMailScope("imap-refresh-token-secret"),
      fakeGmailImapClient()
    );
    const reconnectStart = await requestJson<{ authorizationUrl: string }>(
      store,
      "POST",
      `/v1/connectors/gmail/start?accountId=${linked.account.id}`,
      undefined,
      owner.session.token,
      201,
      reconnectEnv
    );
    const reconnectUrl = new URL(reconnectStart.authorizationUrl);
    expect(reconnectUrl.searchParams.get("scope")).toBe("https://mail.google.com/");
    expect(reconnectUrl.searchParams.get("access_type")).toBe("offline");
    expect(reconnectUrl.searchParams.get("prompt")).toBe("consent");

    const reconnected = await handleApiRequest(
      new Request(
        `https://api.dentlink.test/v1/connectors/gmail/callback?code=valid-code&state=${reconnectUrl.searchParams.get(
          "state"
        )}`,
        { headers: { Accept: "application/json" } }
      ),
      { store, ...reconnectEnv }
    );
    expect(reconnected.status).toBe(200);
    const body = (await reconnected.json()) as { account: ConnectorAccount };
    expect(body.account.settings).toMatchObject({
      gmailIngestionEngine: "gmail_imap",
      gmailGrantedScopes: "https://mail.google.com/",
      gmailImapGranted: true,
      gmailReconnectRequired: false
    });
    expect(body.account.errorCode).toBeNull();
    expect(body.account.errorMessage).toBeNull();
  });

  it("runs scheduled incremental Gmail sync for connected accounts", async () => {
    const { store } = createStore();
    const owner = await register(store, "gmail-scheduled@example.com");
    const gmailClient = fakeGmailClient();
    const env = gmailTestEnv(gmailClient);
    const start = await requestJson<{ authorizationUrl: string }>(
      store,
      "POST",
      "/v1/connectors/gmail/start",
      undefined,
      owner.session.token,
      201,
      env
    );
    const authorizationUrl = new URL(start.authorizationUrl);
    await handleApiRequest(
      new Request(
        `https://api.dentlink.test/v1/connectors/gmail/callback?code=valid-code&state=${authorizationUrl.searchParams.get(
          "state"
        )}`,
        { headers: { Accept: "application/json" } }
      ),
      { store, ...env }
    );

    const pending: Array<Promise<unknown>> = [];
    apiDefaultForTest.scheduled(
      { scheduledTime: Date.parse("2026-07-14T20:00:00.000Z"), cron: "*/5 * * * *" },
      { store, ...env },
      { waitUntil: (promise) => pending.push(promise) }
    );
    await Promise.all(pending);

    const notifications = await requestJson<{ notifications: Notification[] }>(
      store,
      "GET",
      "/v1/notifications",
      undefined,
      owner.session.token
    );
    expect(notifications.notifications).toHaveLength(1);
    const secondPending: Array<Promise<unknown>> = [];
    apiDefaultForTest.scheduled(
      { scheduledTime: Date.parse("2026-07-14T20:05:00.000Z"), cron: "*/5 * * * *" },
      { store, ...env },
      { waitUntil: (promise) => secondPending.push(promise) }
    );
    await Promise.all(secondPending);
    const afterDuplicate = await requestJson<{ notifications: Notification[] }>(
      store,
      "GET",
      "/v1/notifications",
      undefined,
      owner.session.token
    );
    expect(afterDuplicate.notifications).toHaveLength(1);
  });

  it("retries scheduled Gmail sync for configured accounts left in error state", async () => {
    const { store } = createStore();
    const owner = await register(store, "gmail-recoverable-scheduled@example.com");
    const env = gmailTestEnv(fakeGmailClient());
    const linked = await connectGmailForTest(store, owner, env);
    const recoverable = await store.updateConnectorAccount(
      owner.user.id,
      linked.id,
      linked.version,
      {
        status: "error",
        healthStatus: "error",
        syncStatus: "idle",
        errorCode: "gmail_auth_failed",
        errorMessage: "Gmail authentication failed. Reconnect the account."
      },
      "2026-07-14T20:00:00.000Z"
    );
    expect(recoverable?.credentialStatus).toBe("configured");

    await expect(
      syncConnectedGmailAccounts(store, env, "2026-07-14T20:05:00.000Z")
    ).resolves.toMatchObject({
      attempted: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0
    });

    const notifications = await requestJson<{ notifications: Notification[] }>(
      store,
      "GET",
      "/v1/notifications",
      undefined,
      owner.session.token
    );
    expect(notifications.notifications).toHaveLength(1);
    const account = await store.getConnectorAccount(owner.user.id, linked.id);
    expect(account).toMatchObject({
      status: "connected",
      healthStatus: "healthy",
      syncStatus: "idle",
      errorCode: null,
      errorMessage: null
    });
  });

  it("runs scheduled Gmail IMAP sync for IMAP-enabled accounts", async () => {
    const { store } = createStore();
    const owner = await register(store, "gmail-scheduled-imap@example.com");
    const env = gmailTestEnv(fakeGmailClient(), fakeGmailImapClient());
    const start = await requestJson<{ authorizationUrl: string }>(
      store,
      "POST",
      "/v1/connectors/gmail/start",
      undefined,
      owner.session.token,
      201,
      env
    );
    const authorizationUrl = new URL(start.authorizationUrl);
    const callback = await handleApiRequest(
      new Request(
        `https://api.dentlink.test/v1/connectors/gmail/callback?code=valid-code&state=${authorizationUrl.searchParams.get(
          "state"
        )}`,
        { headers: { Accept: "application/json" } }
      ),
      { store, ...env }
    );
    const linked = (await callback.json()) as { account: ConnectorAccount };
    const granted = await store.updateConnectorAccount(
      owner.user.id,
      linked.account.id,
      linked.account.version,
      {
        settings: {
          ...linked.account.settings,
          gmailGrantedScopes: "https://mail.google.com/",
          gmailImapGranted: true,
          gmailReconnectRequired: false
        }
      },
      "2026-07-14T20:00:00.000Z"
    );
    await requestJson<ConnectorAccount>(
      store,
      "PUT",
      `/v1/connectors/gmail/${linked.account.id}/engine`,
      { expectedVersion: granted?.version, engine: "gmail_imap" },
      owner.session.token,
      200,
      env
    );

    const pending: Array<Promise<unknown>> = [];
    apiDefaultForTest.scheduled(
      { scheduledTime: Date.parse("2026-07-14T20:10:00.000Z"), cron: "*/5 * * * *" },
      { store, ...env },
      { waitUntil: (promise) => pending.push(promise) }
    );
    await Promise.all(pending);

    const notifications = await requestJson<{ notifications: Notification[] }>(
      store,
      "GET",
      "/v1/notifications",
      undefined,
      owner.session.token
    );
    expect(notifications.notifications).toHaveLength(1);
    const accounts = await requestJson<{ accounts: ConnectorAccount[] }>(
      store,
      "GET",
      "/v1/connectors/accounts",
      undefined,
      owner.session.token
    );
    expect(accounts.accounts[0]?.settings).toMatchObject({
      gmailIngestionEngine: "gmail_imap",
      gmailLastSyncEngine: "gmail_imap",
      gmailLastSyncCreated: 1
    });
  });

  it("runs scheduled Google Calendar sync for connected accounts", async () => {
    const { store } = createStore();
    const owner = await register(store, "calendar-scheduled@example.com");
    const env = googleCalendarTestEnv(fakeGoogleCalendarClient());
    const start = await requestJson<{ authorizationUrl: string }>(
      store,
      "POST",
      "/v1/connectors/google-calendar/start",
      undefined,
      owner.session.token,
      201,
      env
    );
    const authorizationUrl = new URL(start.authorizationUrl);
    const callback = await handleApiRequest(
      new Request(
        `https://api.dentlink.test/v1/connectors/google-calendar/callback?code=valid-code&state=${authorizationUrl.searchParams.get(
          "state"
        )}`,
        { headers: { Accept: "application/json" } }
      ),
      { store, ...env }
    );
    const linked = (await callback.json()) as {
      account: ConnectorAccount;
      initialSync: { account: ConnectorAccount };
    };
    expect(linked.initialSync.account.syncCursor).toBe("calendar-sync-1");

    const pending: Array<Promise<unknown>> = [];
    apiDefaultForTest.scheduled(
      { scheduledTime: Date.parse("2026-07-14T20:10:00.000Z"), cron: "*/5 * * * *" },
      { store, ...env },
      { waitUntil: (promise) => pending.push(promise) }
    );
    await Promise.all(pending);

    const account = await store.getConnectorAccount(owner.user.id, linked.account.id);
    expect(account).toMatchObject({
      connectorKey: "google-calendar",
      status: "connected",
      healthStatus: "healthy",
      syncStatus: "idle",
      syncCursor: "calendar-sync-2",
      lastSyncAt: "2026-07-14T20:10:00.000Z"
    });
  });

  it("recovers stale running connector sync jobs before claiming due work", async () => {
    const { store } = createStore();
    const owner = await register(store, "stale-sync-job@example.com");
    const account = await store.createConnectorAccount(
      owner.user.id,
      {
        connectorKey: "gmail",
        displayName: "Gmail",
        settings: { gmailEmail: "stale-sync-job@example.com" },
        credentialRef: "credential-stale-job",
        credentialStatus: "configured"
      },
      "2026-08-06T19:00:00.000Z"
    );
    const retryable = await store.enqueueConnectorSyncJob(
      owner.user.id,
      { accountId: account.id, trigger: "scheduled", runAfter: "2026-08-06T19:00:00.000Z" },
      "2026-08-06T19:00:00.000Z"
    );
    await store.claimConnectorSyncJobs("2026-08-06T19:00:01.000Z", 1, "worker:dead");

    const claimed = await store.claimConnectorSyncJobs(
      "2026-08-06T19:20:30.000Z",
      1,
      "worker:recovery"
    );
    expect(claimed).toEqual([
      expect.objectContaining({
        id: retryable.id,
        status: "running",
        attempts: 2,
        lockedBy: "worker:recovery",
        lastErrorCode: "sync_job_timeout"
      })
    ]);

    const exhausted = await store.enqueueConnectorSyncJob(
      owner.user.id,
      {
        accountId: account.id,
        trigger: "manual",
        runAfter: "2026-08-06T19:00:00.000Z",
        maxAttempts: 1
      },
      "2026-08-06T19:00:00.000Z"
    );
    await store.claimConnectorSyncJobs("2026-08-06T19:00:01.000Z", 1, "worker:dead");
    const secondClaim = await store.claimConnectorSyncJobs(
      "2026-08-06T19:20:30.000Z",
      10,
      "worker:recovery"
    );
    expect(secondClaim.some((job) => job.id === exhausted.id)).toBe(false);
    await expect(
      store.completeConnectorSyncJob(exhausted.id, "failed", "2026-08-06T19:21:00.000Z")
    ).resolves.toMatchObject({
      id: exhausted.id,
      status: "failed"
    });
  });

  it("drains connector sync jobs one at a time within a scheduled invocation", async () => {
    const { store } = createStore();
    const owner = await register(store, "single-sync-job-claim@example.com");
    const accounts: ConnectorAccount[] = [];
    for (let index = 0; index < 3; index += 1) {
      accounts.push(
        await store.createConnectorAccount(
          owner.user.id,
          {
            connectorKey: "generic-email",
            displayName: `Generic ${index}`,
            settings: {},
            credentialRef: null,
            credentialStatus: "not_configured"
          },
          "2026-08-06T19:00:00.000Z"
        )
      );
    }
    await Promise.all(
      accounts.map((account) =>
        store.enqueueConnectorSyncJob(
          owner.user.id,
          {
            accountId: account.id,
            trigger: "manual",
            priority: 100,
            runAfter: "2026-08-06T19:00:00.000Z"
          },
          "2026-08-06T19:00:00.000Z"
        )
      )
    );

    const pending: Array<Promise<unknown>> = [];
    apiDefaultForTest.scheduled(
      { scheduledTime: Date.parse("2026-08-06T19:00:12.000Z"), cron: "*/5 * * * *" },
      { store },
      { waitUntil: (promise) => pending.push(promise) }
    );
    await Promise.all(pending);

    const remaining = await store.claimConnectorSyncJobs(
      "2026-08-06T19:00:30.000Z",
      10,
      "worker:remaining"
    );
    expect(remaining.map((job) => job.id).sort()).toEqual([]);
  });

  it("retries failed connector sync jobs with bounded backoff", async () => {
    const { store } = createStore();
    const owner = await register(store, "retry-sync-job@example.com");
    const account = await store.createConnectorAccount(
      owner.user.id,
      {
        connectorKey: "google-calendar",
        displayName: "Google Calendar",
        settings: { googleEmail: "retry-sync-job@example.com" },
        credentialRef: null,
        credentialStatus: "configured"
      },
      "2026-08-06T19:00:00.000Z"
    );
    await store.enqueueConnectorSyncJob(
      owner.user.id,
      {
        accountId: account.id,
        trigger: "manual",
        priority: 100,
        runAfter: "2026-08-06T19:00:00.000Z"
      },
      "2026-08-06T19:00:00.000Z"
    );

    const pending: Array<Promise<unknown>> = [];
    apiDefaultForTest.scheduled(
      { scheduledTime: Date.parse("2026-08-06T19:00:12.000Z"), cron: "*/5 * * * *" },
      { store },
      { waitUntil: (promise) => pending.push(promise) }
    );
    await Promise.all(pending);

    const tooEarly = await store.claimConnectorSyncJobs(
      "2026-08-06T19:00:30.000Z",
      10,
      "worker:too-early"
    );
    expect(tooEarly).toEqual([]);

    const retried = await store.claimConnectorSyncJobs(
      "2026-08-06T19:00:42.000Z",
      10,
      "worker:retry"
    );
    expect(retried).toEqual([
      expect.objectContaining({
        accountId: account.id,
        connectorKey: "google-calendar",
        trigger: "manual",
        status: "running",
        attempts: 1,
        maxAttempts: 2,
        runAfter: "2026-08-06T19:00:42.000Z"
      })
    ]);
  });

  it("retries stale Gmail IMAP sync locks while skipping fresh in-progress syncs", async () => {
    const { store } = createStore();
    const owner = await register(store, "gmail-stale-imap@example.com");
    const env = gmailTestEnv(fakeGmailClient(), fakeGmailImapClient());
    const start = await requestJson<{ authorizationUrl: string }>(
      store,
      "POST",
      "/v1/connectors/gmail/start",
      undefined,
      owner.session.token,
      201,
      env
    );
    const authorizationUrl = new URL(start.authorizationUrl);
    const callback = await handleApiRequest(
      new Request(
        `https://api.dentlink.test/v1/connectors/gmail/callback?code=valid-code&state=${authorizationUrl.searchParams.get(
          "state"
        )}`,
        { headers: { Accept: "application/json" } }
      ),
      { store, ...env }
    );
    const linked = (await callback.json()) as { account: ConnectorAccount };
    const granted = await store.updateConnectorAccount(
      owner.user.id,
      linked.account.id,
      linked.account.version,
      {
        settings: {
          ...linked.account.settings,
          gmailGrantedScopes: "https://mail.google.com/",
          gmailImapGranted: true,
          gmailReconnectRequired: false
        }
      },
      "2026-07-14T20:00:00.000Z"
    );
    const imap = await requestJson<ConnectorAccount>(
      store,
      "PUT",
      `/v1/connectors/gmail/${linked.account.id}/engine`,
      { expectedVersion: granted?.version, engine: "gmail_imap" },
      owner.session.token,
      200,
      env
    );

    const freshSyncing = await store.updateConnectorAccount(
      owner.user.id,
      imap.id,
      imap.version,
      { syncStatus: "syncing", lastHealthAt: "2026-07-14T20:09:00.000Z" },
      "2026-07-14T20:09:00.000Z"
    );
    expect(freshSyncing).not.toBeNull();
    expect(await syncConnectedGmailAccounts(store, env, "2026-07-14T20:10:00.000Z")).toMatchObject({
      attempted: 0,
      skipped: 1
    });
    const skippedAttempts = await store.listConnectorSyncAttempts(owner.user.id, imap.id, 10);
    expect(skippedAttempts[0]).toMatchObject({
      trigger: "scheduled",
      engine: "gmail_imap",
      status: "skipped",
      errorCode: "sync_in_progress",
      errorMessage: "Gmail sync is already in progress"
    });
    expect(skippedAttempts[0]?.details).toMatchObject({
      operation: "incremental",
      skippedReason: "fresh_sync_in_progress",
      lockReferenceAt: "2026-07-14T20:09:00.000Z",
      lockAgeMs: 60_000,
      staleAfterMs: 300_000
    });
    expect(
      (
        await requestJson<{ notifications: Notification[] }>(
          store,
          "GET",
          "/v1/notifications",
          undefined,
          owner.session.token
        )
      ).notifications
    ).toHaveLength(0);

    const latest = await store.getConnectorAccount(owner.user.id, imap.id);
    expect(latest).not.toBeNull();
    const staleSyncing = await store.updateConnectorAccount(
      owner.user.id,
      imap.id,
      latest?.version ?? 0,
      { syncStatus: "syncing", lastHealthAt: "2026-07-14T20:00:00.000Z" },
      "2026-07-14T20:00:00.000Z"
    );
    expect(staleSyncing).not.toBeNull();
    await expect(
      syncGmailAccount(
        store,
        owner.user.id,
        imap.id,
        env,
        "2026-07-14T20:02:00.000Z",
        "refresh_all"
      )
    ).resolves.toMatchObject({
      account: {
        settings: {
          gmailLastSyncEngine: "gmail_imap"
        }
      },
      createdNotifications: 1,
      summary: {
        created: 1
      }
    });

    const latestAfterRefreshAll = await store.getConnectorAccount(owner.user.id, imap.id);
    expect(latestAfterRefreshAll).not.toBeNull();
    const staleForScheduled = await store.updateConnectorAccount(
      owner.user.id,
      imap.id,
      latestAfterRefreshAll?.version ?? 0,
      { syncStatus: "syncing" },
      "2026-07-14T20:19:00.000Z"
    );
    expect(staleForScheduled).not.toBeNull();
    expect(await syncConnectedGmailAccounts(store, env, "2026-07-14T20:20:00.000Z")).toMatchObject({
      attempted: 1,
      succeeded: 1
    });

    const notifications = await requestJson<{ notifications: Notification[] }>(
      store,
      "GET",
      "/v1/notifications",
      undefined,
      owner.session.token
    );
    expect(notifications.notifications).toHaveLength(1);
    const accounts = await requestJson<{ accounts: ConnectorAccount[] }>(
      store,
      "GET",
      "/v1/connectors/accounts",
      undefined,
      owner.session.token
    );
    expect(accounts.accounts[0]?.syncStatus).toBe("idle");
    expect(accounts.accounts[0]?.settings).toMatchObject({
      gmailIngestionEngine: "gmail_imap",
      gmailLastSyncEngine: "gmail_imap",
      gmailLastSyncDuplicate: 0
    });
  });

  it("syncs all connected services and streams DentLink change metadata", async () => {
    const { store } = createStore();
    const owner = await register(store, "sync-all@example.com");
    const env = {
      ...gmailTestEnv(fakeGmailClient()),
      ...googleCalendarTestEnv(fakeGoogleCalendarClient())
    };

    const gmailStart = await requestJson<{ authorizationUrl: string }>(
      store,
      "POST",
      "/v1/connectors/gmail/start",
      undefined,
      owner.session.token,
      201,
      env
    );
    const gmailUrl = new URL(gmailStart.authorizationUrl);
    await handleApiRequest(
      new Request(
        `https://api.dentlink.test/v1/connectors/gmail/callback?code=valid-code&state=${gmailUrl.searchParams.get(
          "state"
        )}`,
        { headers: { Accept: "application/json" } }
      ),
      { store, ...env }
    );

    const calendarStart = await requestJson<{ authorizationUrl: string }>(
      store,
      "POST",
      "/v1/connectors/google-calendar/start",
      undefined,
      owner.session.token,
      201,
      env
    );
    const calendarUrl = new URL(calendarStart.authorizationUrl);
    await handleApiRequest(
      new Request(
        `https://api.dentlink.test/v1/connectors/google-calendar/callback?code=valid-code&state=${calendarUrl.searchParams.get(
          "state"
        )}`,
        { headers: { Accept: "application/json" } }
      ),
      { store, ...env }
    );

    const result = await requestJson<ConnectorSyncAllResult>(
      store,
      "POST",
      "/v1/connectors/sync-all",
      undefined,
      owner.session.token,
      200,
      env
    );
    expect(result.status).toBe("success");
    expect(result.connectors.map((connector) => connector.provider).sort()).toEqual([
      "gmail",
      "google-calendar"
    ]);
    expect(result.connectors.find((connector) => connector.provider === "gmail")).toMatchObject({
      status: "queued",
      engine: "gmail_api",
      jobId: expect.any(String),
      created: 0,
      failed: 0
    });
    expect(
      result.connectors.find((connector) => connector.provider === "google-calendar")
    ).toMatchObject({
      status: "queued",
      jobId: expect.any(String),
      failed: 0
    });
    const streamedNotification = await requestJson<Notification>(
      store,
      "POST",
      "/v1/notifications",
      { title: "Streamed notification", summary: "SSE should report this change" },
      owner.session.token,
      201,
      env
    );
    await requestJson<Notification>(
      store,
      "PATCH",
      `/v1/notifications/${streamedNotification.id}`,
      { expectedVersion: streamedNotification.version, patch: { pinned: true } },
      owner.session.token,
      200,
      env
    );

    const stream = await handleApiRequest(
      new Request("https://api.dentlink.test/v1/events?cursor=0", {
        headers: { Authorization: `Bearer ${owner.session.token}` }
      }),
      { store, ...env }
    );
    expect(stream.status).toBe(200);
    expect(stream.headers.get("Content-Type")).toContain("text/event-stream");
    const reader = stream.body?.getReader();
    expect(reader).toBeDefined();
    let text = "";
    for (
      let index = 0;
      index < 8 && (!text.includes("calendar_updated") || !text.includes("notifications_updated"));
      index += 1
    ) {
      const chunk = await reader?.read();
      text += new TextDecoder().decode(chunk?.value);
    }
    await reader?.cancel();
    expect(text).toContain("event: dentlink_change");
    expect(text).toContain("notifications_updated");
    expect(text).toContain("calendar_updated");
  });

  it("queues Gmail IMAP Refresh All without doing IMAP work inline", async () => {
    const { store } = createStore();
    const owner = await register(store, "sync-all-imap@example.com");
    let polled = false;
    const baseImapClient = fakeGmailImapClient();
    const env = gmailTestEnv(fakeGmailClient(), {
      async verify(options) {
        return baseImapClient.verify(options);
      },
      async poll(options) {
        polled = true;
        return baseImapClient.poll(options);
      }
    });
    await connectImapGmailForTest(store, owner, env);

    const result = await requestJson<ConnectorSyncAllResult>(
      store,
      "POST",
      "/v1/connectors/sync-all",
      undefined,
      owner.session.token,
      200,
      env
    );

    expect(polled).toBe(false);
    expect(result.status).toBe("success");
    expect(result.connectors).toEqual([
      expect.objectContaining({
        provider: "gmail",
        status: "queued",
        engine: "gmail_imap",
        created: 0,
        failed: 0,
        jobId: expect.any(String),
        message: expect.stringContaining("queued")
      })
    ]);
  });

  it("includes recoverable Gmail error accounts in Refresh All", async () => {
    const { store } = createStore();
    const owner = await register(store, "sync-all-gmail-recoverable@example.com");
    const env = gmailTestEnv(fakeGmailClient());
    const linked = await connectGmailForTest(store, owner, env);
    const recoverable = await store.updateConnectorAccount(
      owner.user.id,
      linked.id,
      linked.version,
      {
        status: "error",
        healthStatus: "error",
        syncStatus: "idle",
        errorCode: "gmail_auth_failed",
        errorMessage: "Gmail authentication failed. Reconnect the account."
      },
      "2026-07-14T20:20:00.000Z"
    );
    expect(recoverable?.credentialStatus).toBe("configured");

    const result = await requestJson<ConnectorSyncAllResult>(
      store,
      "POST",
      "/v1/connectors/sync-all",
      undefined,
      owner.session.token,
      200,
      env
    );
    expect(result.status).toBe("success");
    expect(result.connectors).toEqual([
      expect.objectContaining({
        provider: "gmail",
        status: "queued",
        created: 0,
        jobId: expect.any(String),
        failed: 0
      })
    ]);
  });

  it("queues supported Refresh All connectors and skips unsupported connectors", async () => {
    const { store } = createStore();
    const owner = await register(store, "sync-all-partial@example.com");
    const gmail = await store.createConnectorAccount(
      owner.user.id,
      {
        connectorKey: "gmail",
        displayName: "Gmail",
        settings: {},
        credentialRef: "missing",
        credentialStatus: "configured"
      },
      "2026-07-14T20:20:00.000Z"
    );
    await store.updateConnectorAccount(
      owner.user.id,
      gmail.id,
      gmail.version,
      { status: "connected", healthStatus: "healthy", syncStatus: "idle" },
      "2026-07-14T20:20:01.000Z"
    );
    const generic = await store.createConnectorAccount(
      owner.user.id,
      {
        connectorKey: "generic-email",
        displayName: "Generic",
        settings: {},
        credentialRef: null,
        credentialStatus: "not_configured"
      },
      "2026-07-14T20:20:00.000Z"
    );
    await store.updateConnectorAccount(
      owner.user.id,
      generic.id,
      generic.version,
      { status: "connected", healthStatus: "healthy", syncStatus: "idle" },
      "2026-07-14T20:20:01.000Z"
    );

    const result = await requestJson<ConnectorSyncAllResult>(
      store,
      "POST",
      "/v1/connectors/sync-all",
      undefined,
      owner.session.token
    );
    expect(result.status).toBe("success");
    expect(result.connectors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: "gmail", status: "queued", jobId: expect.any(String) }),
        expect.objectContaining({ provider: "generic-email", status: "skipped" })
      ])
    );
  });

  it("queues Refresh All connector work instead of hanging on slow connectors", async () => {
    const { store } = createStore();
    const owner = await register(store, "sync-all-timeout@example.com");
    const account = await connectGmailForTest(store, owner, gmailTestEnv(hangingGmailClient()));

    const result = await requestJson<ConnectorSyncAllResult>(
      store,
      "POST",
      "/v1/connectors/sync-all",
      undefined,
      owner.session.token,
      200,
      {
        ...gmailTestEnv(hangingGmailClient()),
        DENTLINK_SYNC_ALL_CONNECTOR_TIMEOUT_MS: "10"
      }
    );

    expect(result.status).toBe("success");
    expect(result.connectors).toEqual([
      expect.objectContaining({
        provider: "gmail",
        status: "queued",
        failed: 0,
        jobId: expect.any(String),
        message: expect.stringContaining("queued")
      })
    ]);
    await expect(store.getConnectorAccount(owner.user.id, account.id)).resolves.toMatchObject({
      syncStatus: "idle"
    });
  });

  it("records Gmail per-message outcomes and keeps partial sync failures observable", async () => {
    const { store } = createStore();
    const owner = await register(store, "gmail-outcomes@example.com");
    const gmailClient = fakeGmailClientWithPartialFailure();
    const env = gmailTestEnv(gmailClient);
    const start = await requestJson<{ authorizationUrl: string; expiresAt: string }>(
      store,
      "POST",
      "/v1/connectors/gmail/start",
      undefined,
      owner.session.token,
      201,
      env
    );
    const authorizationUrl = new URL(start.authorizationUrl);
    const callback = await handleApiRequest(
      new Request(
        `https://api.dentlink.test/v1/connectors/gmail/callback?code=valid-code&state=${authorizationUrl.searchParams.get(
          "state"
        )}`,
        { headers: { Accept: "application/json" } }
      ),
      { store, ...env }
    );
    const linked = (await callback.json()) as { account: ConnectorAccount };

    const sync = await requestJson<{
      account: ConnectorAccount;
      processed: number;
      createdNotifications: number;
      summary: {
        discovered: number;
        examined: number;
        created: number;
        updated: number;
        duplicate: number;
        skipped: number;
        filtered: number;
        failed: number;
      };
      outcomes: Array<{ messageId: string; status: string; reason: string; recordId: string }>;
    }>(
      store,
      "POST",
      `/v1/connectors/gmail/${linked.account.id}/sync`,
      undefined,
      owner.session.token,
      200,
      env
    );

    expect(sync.processed).toBe(2);
    expect(sync.createdNotifications).toBe(1);
    expect(sync.summary).toEqual({
      discovered: 2,
      examined: 2,
      created: 1,
      updated: 0,
      duplicate: 0,
      skipped: 0,
      filtered: 0,
      failed: 1
    });
    expect(sync.account.healthStatus).toBe("degraded");
    expect(sync.account.errorCode).toBe("gmail_partial_sync_failed");
    expect(sync.account.syncCursor).toBe("100");
    expect(sync.outcomes.map((outcome) => outcome.status)).toEqual([
      "notification_created",
      "failed"
    ]);
    expect(sync.outcomes[1]).toMatchObject({
      messageId: "gmail-message-failure",
      reason: "Gmail API request failed"
    });

    const records = await requestJson<{ records: ConnectorSourceRecord[] }>(
      store,
      "GET",
      `/v1/connectors/accounts/${linked.account.id}/source-records`,
      undefined,
      owner.session.token
    );
    expect(records.records.map((record) => record.status).sort()).toEqual([
      "failed",
      "notification_created"
    ]);
    expect(records.records.find((record) => record.status === "failed")).toMatchObject({
      processingReason: "Gmail API request failed",
      errorMessage: "Gmail API request failed"
    });

    const diagnostics = await requestJson<{
      attempts: Array<{
        trigger: string;
        engine: string;
        status: string;
        errorCode: string | null;
        errorMessage: string | null;
        summary: typeof sync.summary | null;
        details: Record<string, unknown>;
      }>;
    }>(
      store,
      "GET",
      `/v1/connectors/gmail/${linked.account.id}/diagnostics`,
      undefined,
      owner.session.token
    );
    expect(diagnostics.attempts[0]).toMatchObject({
      trigger: "manual",
      engine: "gmail_api",
      status: "partial",
      errorCode: "gmail_partial_sync_failed",
      summary: sync.summary
    });
    expect(diagnostics.attempts[0]?.details).toMatchObject({
      operation: "incremental",
      cursorAdvanced: false,
      cursorBeforePresent: true,
      cursorAfterPresent: true
    });
  });

  it("summarizes multi-page Gmail synchronization", async () => {
    const { store } = createStore();
    const owner = await register(store, "gmail-multipage@example.com");
    const gmailClient = fakeGmailClientWithMultiPageMessages();
    const env = gmailTestEnv(gmailClient);
    const start = await requestJson<{ authorizationUrl: string; expiresAt: string }>(
      store,
      "POST",
      "/v1/connectors/gmail/start",
      undefined,
      owner.session.token,
      201,
      env
    );
    const authorizationUrl = new URL(start.authorizationUrl);
    const callback = await handleApiRequest(
      new Request(
        `https://api.dentlink.test/v1/connectors/gmail/callback?code=valid-code&state=${authorizationUrl.searchParams.get(
          "state"
        )}`,
        { headers: { Accept: "application/json" } }
      ),
      { store, ...env }
    );
    const linked = (await callback.json()) as { account: ConnectorAccount };

    const sync = await requestJson<{
      account: ConnectorAccount;
      summary: {
        discovered: number;
        examined: number;
        created: number;
        updated: number;
        duplicate: number;
        skipped: number;
        filtered: number;
        failed: number;
      };
      outcomes: Array<{ status: string }>;
    }>(
      store,
      "POST",
      `/v1/connectors/gmail/${linked.account.id}/sync`,
      undefined,
      owner.session.token,
      200,
      env
    );

    expect(sync.summary).toEqual({
      discovered: 3,
      examined: 3,
      created: 3,
      updated: 0,
      duplicate: 0,
      skipped: 0,
      filtered: 0,
      failed: 0
    });
    expect(sync.outcomes.map((outcome) => outcome.status)).toEqual([
      "notification_created",
      "notification_created",
      "notification_created"
    ]);
    expect(sync.account.syncCursor).toBe("203");

    const diagnostics = await requestJson<{
      summary: typeof sync.summary;
      messages: Array<{ messageId: string; outcome: string; notificationId: string | null }>;
    }>(
      store,
      "GET",
      `/v1/connectors/gmail/${linked.account.id}/diagnostics`,
      undefined,
      owner.session.token
    );
    expect(diagnostics.summary).toMatchObject({ examined: 3, created: 3 });
    expect(diagnostics.messages.map((message) => message.messageId).sort()).toEqual([
      "gmail-page-1",
      "gmail-page-2",
      "gmail-page-3"
    ]);
    expect(diagnostics.messages.every((message) => message.notificationId)).toBe(true);
  });

  it("backfills recent Gmail messages without resetting history checkpoints or duplicating notifications", async () => {
    const { store } = createStore();
    const owner = await register(store, "gmail-backfill@example.com");
    const gmailClient = fakeGmailClientForBackfill();
    const env = gmailTestEnv(gmailClient);
    const start = await requestJson<{ authorizationUrl: string; expiresAt: string }>(
      store,
      "POST",
      "/v1/connectors/gmail/start",
      undefined,
      owner.session.token,
      201,
      env
    );
    const authorizationUrl = new URL(start.authorizationUrl);
    const callback = await handleApiRequest(
      new Request(
        `https://api.dentlink.test/v1/connectors/gmail/callback?code=valid-code&state=${authorizationUrl.searchParams.get(
          "state"
        )}`,
        { headers: { Accept: "application/json" } }
      ),
      { store, ...env }
    );
    const linked = (await callback.json()) as { account: ConnectorAccount };
    expect(linked.account.syncCursor).toBe("history-checkpoint-500");

    const firstBackfill = await requestJson<{
      account: ConnectorAccount;
      summary: {
        discovered: number;
        examined: number;
        created: number;
        updated: number;
        duplicate: number;
        skipped: number;
        filtered: number;
        failed: number;
      };
      outcomes: Array<{ messageId: string; status: string }>;
    }>(
      store,
      "POST",
      `/v1/connectors/gmail/${linked.account.id}/backfill`,
      undefined,
      owner.session.token,
      200,
      env
    );

    expect(firstBackfill.account.syncCursor).toBe("history-checkpoint-500");
    expect(firstBackfill.summary).toEqual({
      discovered: 2,
      examined: 2,
      created: 2,
      updated: 0,
      duplicate: 0,
      skipped: 0,
      filtered: 0,
      failed: 0
    });
    expect(firstBackfill.outcomes.map((outcome) => outcome.messageId).sort()).toEqual([
      "gmail-backfill-1",
      "gmail-backfill-2"
    ]);

    const afterCreate = await requestJson<{ notifications: Notification[] }>(
      store,
      "GET",
      "/v1/notifications",
      undefined,
      owner.session.token
    );
    expect(afterCreate.notifications.map((notification) => notification.title).sort()).toEqual([
      "Historical message 1",
      "Historical message 2"
    ]);

    const secondBackfill = await requestJson<typeof firstBackfill>(
      store,
      "POST",
      `/v1/connectors/gmail/${linked.account.id}/backfill`,
      undefined,
      owner.session.token,
      200,
      env
    );
    expect(secondBackfill.account.syncCursor).toBe("history-checkpoint-500");
    expect(secondBackfill.summary).toMatchObject({ examined: 2, created: 0, duplicate: 2 });

    const afterDuplicate = await requestJson<{ notifications: Notification[] }>(
      store,
      "GET",
      "/v1/notifications",
      undefined,
      owner.session.token
    );
    expect(afterDuplicate.notifications).toHaveLength(2);
  });

  it("preserves the last incremental Gmail summary when backfill list fails", async () => {
    const { store } = createStore();
    const owner = await register(store, "gmail-backfill-failure@example.com");
    const gmailClient = fakeGmailClientForBackfillListFailure();
    const env = gmailTestEnv(gmailClient);
    const start = await requestJson<{ authorizationUrl: string; expiresAt: string }>(
      store,
      "POST",
      "/v1/connectors/gmail/start",
      undefined,
      owner.session.token,
      201,
      env
    );
    const authorizationUrl = new URL(start.authorizationUrl);
    const callback = await handleApiRequest(
      new Request(
        `https://api.dentlink.test/v1/connectors/gmail/callback?code=valid-code&state=${authorizationUrl.searchParams.get(
          "state"
        )}`,
        { headers: { Accept: "application/json" } }
      ),
      { store, ...env }
    );
    const linked = (await callback.json()) as { account: ConnectorAccount };

    const sync = await requestJson<{ account: ConnectorAccount }>(
      store,
      "POST",
      `/v1/connectors/gmail/${linked.account.id}/sync`,
      undefined,
      owner.session.token,
      200,
      env
    );
    expect(sync.account.settings.gmailLastIncrementalStatus).toBe("success");
    expect(sync.account.settings.gmailLastIncrementalExamined).toBe(1);
    expect(sync.account.settings.gmailLastIncrementalCreated).toBe(1);

    const failedBackfill = await requestJson<ApiErrorBody>(
      store,
      "POST",
      `/v1/connectors/gmail/${linked.account.id}/backfill`,
      undefined,
      owner.session.token,
      502,
      env
    );
    expect(failedBackfill.error.code).toBe("gmail_query_invalid");
    expect(failedBackfill.error.message).toBe(
      "Backfill failed because Gmail rejected the mailbox search query."
    );

    const accounts = await requestJson<{ accounts: ConnectorAccount[] }>(
      store,
      "GET",
      "/v1/connectors/accounts",
      undefined,
      owner.session.token
    );
    const account = accounts.accounts.find((item) => item.id === linked.account.id);
    expect(account).toBeDefined();
    expect(account?.status).toBe("connected");
    expect(account?.healthStatus).toBe("degraded");
    expect(account?.settings.gmailLastIncrementalStatus).toBe("success");
    expect(account?.settings.gmailLastIncrementalCreated).toBe(1);
    expect(account?.settings.gmailLastBackfillStatus).toBe("failed");
    expect(account?.settings.gmailLastBackfillErrorCode).toBe("gmail_query_invalid");
    expect(account?.settings.gmailLastBackfillErrorMessage).toBe(
      "Backfill failed because Gmail rejected the mailbox search query."
    );
  });

  it("marks old Gmail metadata-scope credentials as reconnect-required for backfill", async () => {
    const { store } = createStore();
    const owner = await register(store, "gmail-old-scope@example.com");
    const gmailClient = fakeGmailClient();
    const env = gmailTestEnv(gmailClient);
    const start = await requestJson<{ authorizationUrl: string; expiresAt: string }>(
      store,
      "POST",
      "/v1/connectors/gmail/start",
      undefined,
      owner.session.token,
      201,
      env
    );
    const authorizationUrl = new URL(start.authorizationUrl);
    const callback = await handleApiRequest(
      new Request(
        `https://api.dentlink.test/v1/connectors/gmail/callback?code=valid-code&state=${authorizationUrl.searchParams.get(
          "state"
        )}`,
        { headers: { Accept: "application/json" } }
      ),
      { store, ...env }
    );
    const linked = (await callback.json()) as { account: ConnectorAccount };
    const legacyAccount = await store.updateConnectorAccount(
      owner.user.id,
      linked.account.id,
      linked.account.version,
      {
        settings: {
          ...linked.account.settings,
          gmailGrantedScopes: "https://www.googleapis.com/auth/gmail.metadata",
          gmailReadOnlyGranted: false,
          gmailReconnectRequired: true
        }
      },
      new Date().toISOString()
    );
    expect(legacyAccount?.settings).toMatchObject({
      gmailGrantedScopes: "https://www.googleapis.com/auth/gmail.metadata",
      gmailReadOnlyGranted: false,
      gmailReconnectRequired: true
    });

    const sync = await requestJson<{ account: ConnectorAccount }>(
      store,
      "POST",
      `/v1/connectors/gmail/${linked.account.id}/sync`,
      undefined,
      owner.session.token,
      200,
      env
    );
    expect(sync.account.status).toBe("connected");
    expect(sync.account.healthStatus).toBe("healthy");

    const failedBackfill = await requestJson<ApiErrorBody>(
      store,
      "POST",
      `/v1/connectors/gmail/${linked.account.id}/backfill`,
      undefined,
      owner.session.token,
      403,
      env
    );
    expect(failedBackfill.error.code).toBe("gmail_permission_denied");
    expect(failedBackfill.error.message).toBe(
      "Reconnect Gmail to grant read-only mailbox access required for backfill."
    );

    const accounts = await requestJson<{ accounts: ConnectorAccount[] }>(
      store,
      "GET",
      "/v1/connectors/accounts",
      undefined,
      owner.session.token
    );
    const account = accounts.accounts.find((item) => item.id === linked.account.id);
    expect(account).toMatchObject({
      status: "connected",
      healthStatus: "degraded",
      syncStatus: "idle",
      errorCode: "gmail_permission_denied",
      errorMessage: "Reconnect Gmail to grant read-only mailbox access required for backfill."
    });
    expect(account?.settings).toMatchObject({
      gmailReconnectRequired: true,
      gmailLastBackfillStatus: "failed",
      gmailLastBackfillErrorCode: "gmail_permission_denied",
      gmailLastBackfillErrorMessage:
        "Reconnect Gmail to grant read-only mailbox access required for backfill."
    });

    const reconnectClient = fakeGmailClientWithRefreshToken("upgraded-refresh-token-secret");
    const reconnectEnv = gmailTestEnv(reconnectClient);
    const reconnectStart = await requestJson<{ authorizationUrl: string; expiresAt: string }>(
      store,
      "POST",
      `/v1/connectors/gmail/start?accountId=${linked.account.id}`,
      undefined,
      owner.session.token,
      201,
      reconnectEnv
    );
    const reconnectUrl = new URL(reconnectStart.authorizationUrl);
    const reconnectCallback = await handleApiRequest(
      new Request(
        `https://api.dentlink.test/v1/connectors/gmail/callback?code=valid-code&state=${reconnectUrl.searchParams.get(
          "state"
        )}`,
        { headers: { Accept: "application/json" } }
      ),
      { store, ...reconnectEnv }
    );
    expect(reconnectCallback.status).toBe(200);
    const reconnected = (await reconnectCallback.json()) as { account: ConnectorAccount };
    expect(reconnected.account.id).toBe(linked.account.id);
    expect(reconnected.account.settings).toMatchObject({
      gmailGrantedScopes: "https://www.googleapis.com/auth/gmail.readonly",
      gmailReadOnlyGranted: true,
      gmailReconnectRequired: false,
      gmailLastBackfillStatus: "failed"
    });
    expect(reconnected.account.errorCode).toBeNull();
    expect(reconnected.account.errorMessage).toBeNull();

    const backfill = await requestJson<{
      account: ConnectorAccount;
      summary: { examined: number; created: number; duplicate: number; failed: number };
    }>(
      store,
      "POST",
      `/v1/connectors/gmail/${linked.account.id}/backfill`,
      undefined,
      owner.session.token,
      200,
      reconnectEnv
    );
    expect(backfill.account.status).toBe("connected");
    expect(backfill.summary).toMatchObject({ examined: 1, failed: 0 });
  });

  it("does not falsely complete Gmail reconnect without an upgraded refresh token", async () => {
    const { store } = createStore();
    const owner = await register(store, "gmail-no-refresh@example.com");
    const initialEnv = gmailTestEnv(fakeGmailClient());
    const start = await requestJson<{ authorizationUrl: string; expiresAt: string }>(
      store,
      "POST",
      "/v1/connectors/gmail/start",
      undefined,
      owner.session.token,
      201,
      initialEnv
    );
    const startUrl = new URL(start.authorizationUrl);
    const callback = await handleApiRequest(
      new Request(
        `https://api.dentlink.test/v1/connectors/gmail/callback?code=valid-code&state=${startUrl.searchParams.get(
          "state"
        )}`,
        { headers: { Accept: "application/json" } }
      ),
      { store, ...initialEnv }
    );
    const linked = (await callback.json()) as { account: ConnectorAccount };
    await store.updateConnectorAccount(
      owner.user.id,
      linked.account.id,
      linked.account.version,
      {
        settings: {
          ...linked.account.settings,
          gmailGrantedScopes: "https://www.googleapis.com/auth/gmail.metadata",
          gmailReadOnlyGranted: false,
          gmailReconnectRequired: true
        }
      },
      new Date().toISOString()
    );
    const oldCredential = await store.getConnectorCredential(
      owner.user.id,
      linked.account.id,
      "oauth_refresh_token"
    );

    const reconnectEnv = gmailTestEnv(fakeGmailClientWithoutRefreshToken());
    const reconnectStart = await requestJson<{ authorizationUrl: string; expiresAt: string }>(
      store,
      "POST",
      `/v1/connectors/gmail/start?accountId=${linked.account.id}`,
      undefined,
      owner.session.token,
      201,
      reconnectEnv
    );
    const reconnectUrl = new URL(reconnectStart.authorizationUrl);
    const failed = await handleApiRequest(
      new Request(
        `https://api.dentlink.test/v1/connectors/gmail/callback?code=valid-code&state=${reconnectUrl.searchParams.get(
          "state"
        )}`,
        { headers: { Accept: "application/json" } }
      ),
      { store, ...reconnectEnv }
    );
    expect(failed.status).toBe(409);
    const body = (await failed.json()) as ApiErrorBody;
    expect(body.error.code).toBe("missing_refresh_token");
    expect(body.error.message).toContain("upgraded offline Gmail credential");
    const credential = await store.getConnectorCredential(
      owner.user.id,
      linked.account.id,
      "oauth_refresh_token"
    );
    expect(credential?.encryptedValue).toBe(oldCredential?.encryptedValue);
    const account = await store.getConnectorAccount(owner.user.id, linked.account.id);
    expect(account?.settings.gmailReconnectRequired).toBe(true);
  });

  it("does not persist Gmail reconnect when readonly scope or capability verification fails", async () => {
    const { store } = createStore();
    const owner = await register(store, "gmail-verify-failure@example.com");
    const initialEnv = gmailTestEnv(fakeGmailClient());
    const start = await requestJson<{ authorizationUrl: string; expiresAt: string }>(
      store,
      "POST",
      "/v1/connectors/gmail/start",
      undefined,
      owner.session.token,
      201,
      initialEnv
    );
    const startUrl = new URL(start.authorizationUrl);
    const callback = await handleApiRequest(
      new Request(
        `https://api.dentlink.test/v1/connectors/gmail/callback?code=valid-code&state=${startUrl.searchParams.get(
          "state"
        )}`,
        { headers: { Accept: "application/json" } }
      ),
      { store, ...initialEnv }
    );
    const linked = (await callback.json()) as { account: ConnectorAccount };
    await store.updateConnectorAccount(
      owner.user.id,
      linked.account.id,
      linked.account.version,
      {
        settings: {
          ...linked.account.settings,
          gmailGrantedScopes: "https://www.googleapis.com/auth/gmail.metadata",
          gmailReadOnlyGranted: false,
          gmailReconnectRequired: true
        }
      },
      new Date().toISOString()
    );
    const oldCredential = await store.getConnectorCredential(
      owner.user.id,
      linked.account.id,
      "oauth_refresh_token"
    );

    for (const reconnectClient of [
      fakeGmailClientWithGrantedScope("https://www.googleapis.com/auth/gmail.metadata"),
      fakeGmailClientWithCapabilityFailure()
    ]) {
      const reconnectEnv = gmailTestEnv(reconnectClient);
      const reconnectStart = await requestJson<{ authorizationUrl: string; expiresAt: string }>(
        store,
        "POST",
        `/v1/connectors/gmail/start?accountId=${linked.account.id}`,
        undefined,
        owner.session.token,
        201,
        reconnectEnv
      );
      const reconnectUrl = new URL(reconnectStart.authorizationUrl);
      const failed = await handleApiRequest(
        new Request(
          `https://api.dentlink.test/v1/connectors/gmail/callback?code=valid-code&state=${reconnectUrl.searchParams.get(
            "state"
          )}`,
          { headers: { Accept: "application/json" } }
        ),
        { store, ...reconnectEnv }
      );
      expect(failed.status).toBe(403);
      const credential = await store.getConnectorCredential(
        owner.user.id,
        linked.account.id,
        "oauth_refresh_token"
      );
      expect(credential?.encryptedValue).toBe(oldCredential?.encryptedValue);
      const account = await store.getConnectorAccount(owner.user.id, linked.account.id);
      expect(account?.settings.gmailReconnectRequired).toBe(true);
    }
  });

  it("maps Gmail upstream failures to safe DentLink errors", async () => {
    const cases: Array<{
      status: number;
      reason: string;
      message: string;
      expectedCode: string;
      expectedMessage: string;
    }> = [
      {
        status: 400,
        reason: "invalidArgument",
        message: "Invalid query: newer:1780000000",
        expectedCode: "gmail_query_invalid",
        expectedMessage: "Backfill failed because Gmail rejected the mailbox search query."
      },
      {
        status: 401,
        reason: "authError",
        message: "Invalid Credentials",
        expectedCode: "gmail_auth_failed",
        expectedMessage: "Gmail authentication failed. Reconnect the account."
      },
      {
        status: 403,
        reason: "insufficientPermissions",
        message: "Insufficient Permission",
        expectedCode: "gmail_permission_denied",
        expectedMessage: "Reconnect Gmail to grant read-only mailbox access required for backfill."
      },
      {
        status: 429,
        reason: "rateLimitExceeded",
        message: "Rate Limit Exceeded",
        expectedCode: "gmail_rate_limited",
        expectedMessage: "Gmail rate limited this request. Try again later."
      },
      {
        status: 503,
        reason: "backendError",
        message: "Backend Error",
        expectedCode: "gmail_upstream_failed",
        expectedMessage: "Gmail is temporarily unavailable. Try again later."
      }
    ];

    for (const item of cases) {
      const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
        const url = new URL(input.toString());
        expect(url.href).toContain("https://gmail.googleapis.com/gmail/v1/users/me/messages");
        expect(url.searchParams.get("q")).toBe("after:1780000000");
        return new Response(
          JSON.stringify({
            error: {
              code: item.status,
              message: item.message,
              errors: [{ reason: item.reason }]
            }
          }),
          { status: item.status, headers: { "Content-Type": "application/json" } }
        );
      };
      const client = createGoogleGmailClient("client-id", "client-secret", fetchImpl);
      await expect(
        client.listMessages("access-token-secret", { query: "after:1780000000" })
      ).rejects.toMatchObject({
        code: item.expectedCode,
        message: item.expectedMessage
      });
    }
  });

  it("passes abort signals through Google Calendar token and event requests", async () => {
    const controller = new AbortController();
    const seenSignals: Array<AbortSignal | null | undefined> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      seenSignals.push(init?.signal);
      const url = new URL(input.toString());
      if (url.origin === "https://oauth2.googleapis.com") {
        return new Response(JSON.stringify({ access_token: "calendar-access-token" }), {
          headers: { "Content-Type": "application/json" }
        });
      }
      expect(url.href).toContain("https://www.googleapis.com/calendar/v3/calendars/primary/events");
      return new Response(JSON.stringify({ items: [], nextSyncToken: "calendar-sync-token" }), {
        headers: { "Content-Type": "application/json" }
      });
    };
    const client = createGoogleCalendarClient("client-id", "client-secret", fetchImpl);

    await client.refreshAccessToken("calendar-refresh-token", controller.signal);
    await client.listEvents(
      "calendar-access-token",
      "primary",
      { syncToken: "calendar-sync-token" },
      controller.signal
    );

    expect(seenSignals).toEqual([controller.signal, controller.signal]);
  });

  it("links Google Calendar, syncs agenda events, supports dismissal, and isolates users", async () => {
    const { store } = createStore();
    const owner = await register(store, "calendar-owner@example.com");
    const other = await register(store, "calendar-other@example.com");
    const googleCalendarClient = fakeGoogleCalendarClient();
    const env = googleCalendarTestEnv(googleCalendarClient);

    const start = await requestJson<{ authorizationUrl: string; expiresAt: string }>(
      store,
      "POST",
      "/v1/connectors/google-calendar/start?returnTo=https%3A%2F%2Fweb.example.test%2Fagenda",
      undefined,
      owner.session.token,
      201,
      env
    );
    const authorizationUrl = new URL(start.authorizationUrl);
    expect(authorizationUrl.origin).toBe("https://accounts.google.com");
    expect(authorizationUrl.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/calendar.readonly"
    );
    expect(authorizationUrl.searchParams.get("state")).toMatch(/^google_calendar_oauth_/);

    const bypass = await requestJson<ApiErrorBody>(
      store,
      "POST",
      "/v1/connectors/accounts",
      {
        connectorKey: "google-calendar",
        displayName: "Bypass"
      },
      owner.session.token,
      400
    );
    expect(bypass.error.code).toBe("google_calendar_oauth_required");

    const callback = await handleApiRequest(
      new Request(
        `https://api.dentlink.test/v1/connectors/google-calendar/callback?code=valid-code&state=${authorizationUrl.searchParams.get(
          "state"
        )}`,
        { headers: { Accept: "application/json" } }
      ),
      { store, ...env }
    );
    expect(callback.status).toBe(200);
    const linked = (await callback.json()) as {
      account: ConnectorAccount;
      initialSync: {
        account: ConnectorAccount;
        processed: number;
        upsertedEvents: number;
      };
    };
    expect(linked.account.connectorKey).toBe("google-calendar");
    expect(linked.account.status).toBe("connected");
    expect(linked.initialSync.processed).toBe(3);
    expect(linked.initialSync.upsertedEvents).toBe(3);
    expect(linked.initialSync.account.syncCursor).toBe("calendar-sync-1");
    expect(linked.account.settings).toMatchObject({
      googleCalendarId: "primary",
      googleCalendarSummary: "Primary calendar"
    });
    expect(JSON.stringify(linked)).not.toContain("calendar-refresh-token");

    const agenda = await requestJson<{ events: CalendarEvent[] }>(
      store,
      "GET",
      "/v1/calendar/events?timeMin=2026-07-01T00%3A00%3A00.000Z&timeMax=2026-08-01T00%3A00%3A00.000Z",
      undefined,
      owner.session.token
    );
    expect(agenda.events.map((event) => event.title)).toEqual([
      "All-day planning",
      "Patient consult",
      "Cancelled review"
    ]);
    expect(agenda.events.every((event) => event.source === "google-calendar")).toBe(true);
    expect(agenda.events[0]).toMatchObject({
      source: "google-calendar",
      allDay: true,
      startDate: "2026-07-15",
      endDate: "2026-07-16",
      sourceUrl: "https://calendar.google.com/event?eid=all-day"
    });
    expect(agenda.events[1]).toMatchObject({
      allDay: false,
      location: "Operatory 2"
    });
    expect(agenda.events[2]).toMatchObject({
      source: "google-calendar",
      status: "cancelled"
    });

    const repeatSync = await requestJson<{
      account: ConnectorAccount;
      processed: number;
      upsertedEvents: number;
    }>(
      store,
      "POST",
      `/v1/connectors/google-calendar/${linked.account.id}/sync`,
      undefined,
      owner.session.token,
      200,
      env
    );
    expect(repeatSync.processed).toBe(0);
    expect(repeatSync.upsertedEvents).toBe(0);
    expect(repeatSync.account.syncCursor).toBe("calendar-sync-2");
    const repeatedAgenda = await requestJson<{ events: CalendarEvent[] }>(
      store,
      "GET",
      "/v1/calendar/events?timeMin=2026-07-01T00%3A00%3A00.000Z&timeMax=2026-08-01T00%3A00%3A00.000Z",
      undefined,
      owner.session.token
    );
    expect(repeatedAgenda.events).toHaveLength(3);
    expect(repeatedAgenda.events.every((event) => event.source === "google-calendar")).toBe(true);
    expect(repeatedAgenda.events.find((event) => event.status === "cancelled")?.source).toBe(
      "google-calendar"
    );

    const records = await requestJson<{ records: ConnectorSourceRecord[] }>(
      store,
      "GET",
      `/v1/connectors/accounts/${linked.account.id}/source-records`,
      undefined,
      owner.session.token
    );
    expect(records.records).toHaveLength(3);
    expect(records.records[0]?.sourceType).toBe("calendar_event");
    expect(JSON.stringify(records)).not.toContain("calendar-refresh-token");

    const dismissed = await requestJson<CalendarEvent>(
      store,
      "PATCH",
      `/v1/calendar/events/${agenda.events[1]?.id}`,
      { expectedVersion: agenda.events[1]?.version, patch: { status: "dismissed" } },
      owner.session.token
    );
    expect(dismissed.status).toBe("dismissed");
    expect(dismissed.dismissedAt).toBeTruthy();
    const afterDismiss = await requestJson<{ events: CalendarEvent[] }>(
      store,
      "GET",
      "/v1/calendar/events?timeMin=2026-07-01T00%3A00%3A00.000Z&timeMax=2026-08-01T00%3A00%3A00.000Z",
      undefined,
      owner.session.token
    );
    expect(afterDismiss.events.map((event) => event.title)).not.toContain("Patient consult");

    const secondSync = await requestJson<typeof repeatSync>(
      store,
      "POST",
      `/v1/connectors/google-calendar/${linked.account.id}/sync`,
      undefined,
      owner.session.token,
      200,
      env
    );
    expect(secondSync.account.syncCursor).toBe("calendar-sync-2");

    const otherAgenda = await requestJson<{ events: CalendarEvent[] }>(
      store,
      "GET",
      "/v1/calendar/events?timeMin=2026-07-01T00%3A00%3A00.000Z&timeMax=2026-08-01T00%3A00%3A00.000Z",
      undefined,
      other.session.token
    );
    expect(otherAgenda.events).toEqual([]);
    await requestJson<ApiErrorBody>(
      store,
      "POST",
      `/v1/connectors/google-calendar/${linked.account.id}/sync`,
      undefined,
      other.session.token,
      404,
      env
    );
    await requestJson<ApiErrorBody>(
      store,
      "PATCH",
      `/v1/calendar/events/${agenda.events[0]?.id}`,
      { expectedVersion: agenda.events[0]?.version, patch: { status: "dismissed" } },
      other.session.token,
      404
    );

    const syncChanges = await requestJson<SyncResponse>(
      store,
      "GET",
      "/v1/sync?cursor=0",
      undefined,
      owner.session.token
    );
    expect(syncChanges.changes.some((change) => change.type === "calendar_event")).toBe(true);

    const disconnected = await requestJson<ConnectorAccount>(
      store,
      "POST",
      `/v1/connectors/google-calendar/${linked.account.id}/disconnect`,
      undefined,
      owner.session.token
    );
    expect(disconnected.credentialStatus).toBe("not_configured");
    expect(disconnected.credentialRef).toBeNull();
  });

  it("redirects cleanly after Google Calendar OAuth success and keeps repeats safe", async () => {
    const { store } = createStore();
    const owner = await register(store, "calendar-redirect@example.com");
    const googleCalendarClient = fakeGoogleCalendarClient();
    const env = googleCalendarTestEnv(googleCalendarClient);

    const start = await requestJson<{ authorizationUrl: string; expiresAt: string }>(
      store,
      "POST",
      "/v1/connectors/google-calendar/start?returnTo=https%3A%2F%2Fweb.example.test%2Fagenda",
      undefined,
      owner.session.token,
      201,
      env
    );
    const state = new URL(start.authorizationUrl).searchParams.get("state");

    const callback = await handleApiRequest(
      new Request(
        `https://api.dentlink.test/v1/connectors/google-calendar/callback?code=valid-code&state=${state}`
      ),
      { store, ...env }
    );
    expect(callback.status).toBe(303);
    expect(callback.headers.get("Location")).toBe(
      "https://web.example.test/agenda?calendar=connected"
    );
    expect(await callback.text()).toBe("");

    const accounts = await requestJson<{ accounts: ConnectorAccount[] }>(
      store,
      "GET",
      "/v1/connectors/accounts",
      undefined,
      owner.session.token
    );
    expect(accounts.accounts).toHaveLength(1);
    expect(accounts.accounts[0]).toMatchObject({
      connectorKey: "google-calendar",
      status: "connected",
      syncStatus: "idle",
      syncCursor: "calendar-sync-1"
    });

    const agenda = await requestJson<{ events: CalendarEvent[] }>(
      store,
      "GET",
      "/v1/calendar/events?timeMin=2026-07-01T00%3A00%3A00.000Z&timeMax=2026-08-01T00%3A00%3A00.000Z",
      undefined,
      owner.session.token
    );
    expect(agenda.events.map((event) => event.title)).toEqual([
      "All-day planning",
      "Patient consult",
      "Cancelled review"
    ]);

    const repeatedCallback = await handleApiRequest(
      new Request(
        `https://api.dentlink.test/v1/connectors/google-calendar/callback?code=valid-code&state=${state}`,
        { headers: { Accept: "application/json" } }
      ),
      { store, ...env }
    );
    expect(repeatedCallback.status).toBe(400);
    const repeatedBody = (await repeatedCallback.json()) as ApiErrorBody;
    expect(repeatedBody.error.code).toBe("invalid_oauth_state");

    const afterRepeatAccounts = await requestJson<{ accounts: ConnectorAccount[] }>(
      store,
      "GET",
      "/v1/connectors/accounts",
      undefined,
      owner.session.token
    );
    expect(afterRepeatAccounts.accounts).toHaveLength(1);
    const afterRepeatAgenda = await requestJson<{ events: CalendarEvent[] }>(
      store,
      "GET",
      "/v1/calendar/events?timeMin=2026-07-01T00%3A00%3A00.000Z&timeMax=2026-08-01T00%3A00%3A00.000Z",
      undefined,
      owner.session.token
    );
    expect(afterRepeatAgenda.events).toHaveLength(3);
  });

  it("supports local calendar CRUD, annotations, filters, sync, and ICS import/export", async () => {
    const { store } = createStore();
    const owner = await register(store, "calendar-local@example.com");
    const other = await register(store, "calendar-local-other@example.com");
    const googleCalendarClient = fakeGoogleCalendarClient();
    const env = googleCalendarTestEnv(googleCalendarClient);

    const local = await requestJson<CalendarEvent>(
      store,
      "POST",
      "/v1/calendar/events",
      {
        title: "Local consult",
        description: "DentLink-owned event",
        startAt: "2026-07-20T14:00:00.000Z",
        endAt: "2026-07-20T14:30:00.000Z",
        timezone: "America/New_York",
        location: "Operatory 1",
        sourceUrl: "https://example.test/consult",
        recurrenceRule: "FREQ=WEEKLY;COUNT=2",
        category: "Clinic",
        color: "#2f855a",
        reminderMinutes: 15
      },
      owner.session.token,
      201
    );
    expect(local).toMatchObject({
      source: "local",
      provider: null,
      title: "Local consult",
      recurrenceRule: "RRULE:FREQ=WEEKLY;COUNT=2",
      category: "Clinic",
      reminderMinutes: 15
    });

    const updated = await requestJson<CalendarEvent>(
      store,
      "PATCH",
      `/v1/calendar/local-events/${local.id}`,
      { expectedVersion: local.version, patch: { title: "Local consult updated" } },
      owner.session.token
    );
    expect(updated.title).toBe("Local consult updated");
    await requestJson<ApiErrorBody>(
      store,
      "PATCH",
      `/v1/calendar/local-events/${local.id}`,
      { expectedVersion: local.version, patch: { title: "Stale" } },
      owner.session.token,
      409
    );

    await requestJson<ApiErrorBody>(
      store,
      "GET",
      `/v1/calendar/events/${local.id}`,
      undefined,
      other.session.token,
      404
    );

    const start = await requestJson<{ authorizationUrl: string; expiresAt: string }>(
      store,
      "POST",
      "/v1/connectors/google-calendar/start?returnTo=https%3A%2F%2Fweb.example.test%2Fagenda",
      undefined,
      owner.session.token,
      201,
      env
    );
    const state = new URL(start.authorizationUrl).searchParams.get("state");
    await handleApiRequest(
      new Request(
        `https://api.dentlink.test/v1/connectors/google-calendar/callback?code=valid-code&state=${state}`,
        { headers: { Accept: "application/json" } }
      ),
      { store, ...env }
    );
    const googleOnly = await requestJson<{ events: CalendarEvent[] }>(
      store,
      "GET",
      "/v1/calendar/events?source=google-calendar&timeMin=2026-07-01T00%3A00%3A00.000Z&timeMax=2026-08-01T00%3A00%3A00.000Z",
      undefined,
      owner.session.token
    );
    expect(googleOnly.events.every((event) => event.source === "google-calendar")).toBe(true);
    await requestJson<ApiErrorBody>(
      store,
      "PATCH",
      `/v1/calendar/local-events/${googleOnly.events[0]?.id}`,
      { expectedVersion: googleOnly.events[0]?.version, patch: { title: "No writeback" } },
      owner.session.token,
      409
    );

    const tag = await requestJson<Tag>(
      store,
      "POST",
      "/v1/tags",
      { name: "Follow up" },
      owner.session.token,
      201
    );
    const annotation = await requestJson<{ notes: string; hidden: boolean; tagIds: string[] }>(
      store,
      "PATCH",
      `/v1/calendar/events/${googleOnly.events[0]?.id}/annotation`,
      { patch: { notes: "DentLink-only note", pinned: true, completed: true, tagIds: [tag.id] } },
      owner.session.token
    );
    expect(annotation).toMatchObject({
      notes: "DentLink-only note",
      hidden: false,
      tagIds: [tag.id]
    });

    const accounts = await requestJson<{ accounts: ConnectorAccount[] }>(
      store,
      "GET",
      "/v1/connectors/accounts",
      undefined,
      owner.session.token
    );
    await requestJson(
      store,
      "POST",
      `/v1/connectors/google-calendar/${accounts.accounts[0]?.id}/sync`,
      undefined,
      owner.session.token,
      200,
      env
    );
    const afterSync = await requestJson<{ events: CalendarEvent[] }>(
      store,
      "GET",
      "/v1/calendar/events?source=google-calendar&timeMin=2026-07-01T00%3A00%3A00.000Z&timeMax=2026-08-01T00%3A00%3A00.000Z",
      undefined,
      owner.session.token
    );
    expect(
      afterSync.events.find((event) => event.id === googleOnly.events[0]?.id)?.annotation
    )?.toMatchObject({ notes: "DentLink-only note", pinned: true, completed: true });

    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:ics-1@example.test",
      "SUMMARY:ICS timed event",
      "DTSTART;TZID=America/New_York:20260721T090000",
      "DTEND;TZID=America/New_York:20260721T093000",
      "RRULE:FREQ=DAILY;COUNT=2",
      "LOCATION:Room 2",
      "URL:https://example.test/ics",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:ics-all-day@example.test",
      "SUMMARY:ICS all-day event",
      "DTSTART;VALUE=DATE:20260722",
      "DTEND;VALUE=DATE:20260723",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");
    const imported = await requestJson<{
      imported: number;
      skippedDuplicates: number;
      events: CalendarEvent[];
    }>(store, "POST", "/v1/calendar/ics/import", { ics }, owner.session.token, 201);
    expect(imported.imported).toBe(2);
    expect(imported.events.every((event) => event.source === "local")).toBe(true);
    expect(imported.events[0]).toMatchObject({
      source: "local",
      importedUid: "ics-1@example.test",
      recurrenceRule: "RRULE:FREQ=DAILY;COUNT=2",
      timezone: "America/New_York"
    });
    const duplicate = await requestJson<{ imported: number; skippedDuplicates: number }>(
      store,
      "POST",
      "/v1/calendar/ics/import",
      { ics },
      owner.session.token,
      201
    );
    expect(duplicate).toMatchObject({ imported: 0, skippedDuplicates: 2 });

    const exportResponse = await handleApiRequest(
      new Request(
        "https://api.dentlink.test/v1/calendar/ics/export?timeMin=2026-07-01T00%3A00%3A00.000Z&timeMax=2026-08-01T00%3A00%3A00.000Z",
        { headers: { Authorization: `Bearer ${owner.session.token}` } }
      ),
      { store }
    );
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers.get("Content-Type")).toContain("text/calendar");
    const exported = await exportResponse.text();
    expect(exported).toContain("BEGIN:VCALENDAR");
    expect(exported).toContain("SUMMARY:Local consult updated");
    expect(exported).toContain("SUMMARY:ICS timed event");
    expect(exported).not.toContain("Patient consult");

    const deleted = await requestJson<CalendarEvent>(
      store,
      "DELETE",
      `/v1/calendar/local-events/${updated.id}`,
      { expectedVersion: updated.version },
      owner.session.token
    );
    expect(deleted.status).toBe("deleted");
    const syncChanges = await requestJson<SyncResponse>(
      store,
      "GET",
      "/v1/sync?cursor=0",
      undefined,
      owner.session.token
    );
    expect(syncChanges.changes.some((change) => change.type === "calendar_event")).toBe(true);
  });

  it("persists and resolves conflicts with version checks and history", async () => {
    const { store } = createStore();
    const auth = await register(store, "conflict@example.com");
    const other = await register(store, "other-conflict@example.com");
    const note = await requestJson<Note>(
      store,
      "POST",
      "/v1/notes",
      { kind: "task", title: "Draft" },
      auth.session.token,
      201
    );
    await requestJson<Note>(
      store,
      "PATCH",
      `/v1/notes/${note.id}`,
      { expectedVersion: note.version, patch: { title: "Server edit" } },
      auth.session.token
    );

    const conflictResponse = await requestJson<ConflictResponse>(
      store,
      "PATCH",
      `/v1/notes/${note.id}`,
      { expectedVersion: note.version, patch: { title: "Stale edit" } },
      auth.session.token,
      409
    );

    const conflicts = await requestJson<ConflictResponse[]>(
      store,
      "GET",
      "/v1/conflicts",
      undefined,
      auth.session.token
    );
    expect(conflictResponse.conflict.expectedVersion).toBe(1);
    expect(conflictResponse.conflict.version).toBe(1);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.conflict.serverNote.title).toBe("Server edit");

    const afterConflict = await requestJson<NotesList>(
      store,
      "GET",
      "/v1/notes",
      undefined,
      auth.session.token
    );
    expect(afterConflict.notes[0]?.title).toBe("Server edit");

    const history = await requestJson<{ history: NoteHistoryEvent[] }>(
      store,
      "GET",
      `/v1/notes/${note.id}/history`,
      undefined,
      auth.session.token
    );
    expect(history.history.map((event) => event.action)).toContain("conflict_created");

    const otherHistory = await requestJson<{ history: NoteHistoryEvent[] }>(
      store,
      "GET",
      `/v1/notes/${note.id}/history`,
      undefined,
      other.session.token
    );
    expect(otherHistory.history).toEqual([]);
    const otherConflicts = await requestJson<ConflictResponse[]>(
      store,
      "GET",
      "/v1/conflicts",
      undefined,
      other.session.token
    );
    expect(otherConflicts).toEqual([]);
    await requestJson<ApiErrorBody>(
      store,
      "POST",
      `/v1/conflicts/${conflictResponse.conflict.id}/resolve`,
      { expectedVersion: conflictResponse.conflict.version, resolution: "keep_theirs" },
      other.session.token,
      404
    );

    await requestJson<ApiErrorBody>(
      store,
      "POST",
      `/v1/conflicts/${conflictResponse.conflict.id}/resolve`,
      { expectedVersion: 99, resolution: "keep_theirs" },
      auth.session.token,
      409
    );
    const resolved = await requestJson<ConflictResponse>(
      store,
      "POST",
      `/v1/conflicts/${conflictResponse.conflict.id}/resolve`,
      { expectedVersion: conflictResponse.conflict.version, resolution: "keep_theirs" },
      auth.session.token
    );
    expect(resolved.conflict.status).toBe("resolved");
    expect(resolved.conflict.version).toBe(2);
  });

  it("syncs create, update, delete tombstones, empty increments, and invalid cursors safely", async () => {
    const { store } = createStore();
    const auth = await register(store, "sync@example.com");
    const initial = await requestJson<SyncResponse>(
      store,
      "GET",
      "/v1/sync",
      undefined,
      auth.session.token
    );
    expect(Number.parseInt(initial.cursor, 10)).toBeGreaterThanOrEqual(0);

    const note = await requestJson<Note>(
      store,
      "POST",
      "/v1/notes",
      { kind: "task", title: "Sync me" },
      auth.session.token,
      201
    );
    const afterCreate = await requestJson<SyncResponse>(
      store,
      "GET",
      `/v1/sync?cursor=${initial.cursor}`,
      undefined,
      auth.session.token
    );
    expect(afterCreate.changes.map((change) => change.type)).toContain("note");

    const updated = await requestJson<Note>(
      store,
      "PATCH",
      `/v1/notes/${note.id}`,
      { expectedVersion: note.version, patch: { pinned: true, dueAt: "2026-08-01T12:00:00.000Z" } },
      auth.session.token
    );
    await requestJson<Note>(
      store,
      "DELETE",
      `/v1/notes/${updated.id}`,
      { expectedVersion: updated.version },
      auth.session.token
    );
    const afterDelete = await requestJson<SyncResponse>(
      store,
      "GET",
      `/v1/sync?cursor=${afterCreate.cursor}`,
      undefined,
      auth.session.token
    );
    expect(
      afterDelete.changes.some((change) => change.type === "note" && change.op === "delete")
    ).toBe(true);

    const empty = await requestJson<SyncResponse>(
      store,
      "GET",
      `/v1/sync?cursor=${afterDelete.cursor}`,
      undefined,
      auth.session.token
    );
    expect(empty.changes).toEqual([]);
    await requestJson<ApiErrorBody>(
      store,
      "GET",
      "/v1/sync?cursor=abc",
      undefined,
      auth.session.token,
      400
    );
    await requestJson<ApiErrorBody>(
      store,
      "POST",
      "/v1/notes/reorder",
      {
        noteOrders: [
          { id: updated.id, expectedVersion: updated.version, globalOrder: 1000 },
          { id: updated.id, expectedVersion: updated.version, globalOrder: 1000 }
        ]
      },
      auth.session.token,
      400
    );
  });

  it("keeps D1 sync cursor payloads compact while preserving sync responses", async () => {
    const fixture = createStore();
    if (!fixture.readSyncPayloads) return;
    const auth = await register(fixture.store, "compact-sync@example.com");
    const notification = await requestJson<Notification>(
      fixture.store,
      "POST",
      "/v1/notifications",
      {
        title: "Private dental billing issue",
        summary: "This summary must not be copied into sync_changes",
        body: "This full body must only live in the authoritative notification row",
        sourceLabel: "Billing"
      },
      auth.session.token,
      201
    );
    const sync = await requestJson<SyncResponse>(
      fixture.store,
      "GET",
      "/v1/sync?cursor=0",
      undefined,
      auth.session.token
    );
    expect(
      sync.changes.some(
        (change) =>
          change.type === "notification" &&
          change.op === "upsert" &&
          change.notification.id === notification.id &&
          change.notification.summary === "This summary must not be copied into sync_changes"
      )
    ).toBe(true);

    const payloads = await fixture.readSyncPayloads();
    const serialized = payloads.join("\n");
    expect(payloads.length).toBeGreaterThan(0);
    expect(serialized).not.toContain("Private dental billing issue");
    expect(serialized).not.toContain("This summary must not be copied into sync_changes");
    expect(serialized).not.toContain("This full body must only live");
    expect(
      payloads.some(
        (payload) =>
          payload ===
          JSON.stringify({
            type: "notification",
            op: "upsert",
            id: notification.id,
            userId: auth.user.id
          })
      )
    ).toBe(true);
  });

  it("encrypts D1 user content at rest while preserving authenticated reads", async () => {
    const fixture = createStore();
    if (!fixture.db) return;
    const auth = await register(fixture.store, "encrypted-d1-content@example.com");
    const account = await fixture.store.createConnectorAccount(
      auth.user.id,
      {
        connectorKey: "gmail",
        displayName: "Encrypted Gmail",
        settings: { googleEmail: "encrypted@example.test" },
        credentialRef: "credential",
        credentialStatus: "configured"
      },
      "2026-07-29T18:00:00.000Z"
    );

    const note = await requestJson<Note>(
      fixture.store,
      "POST",
      "/v1/notes",
      {
        kind: "task",
        title: "Encrypt this note title",
        body: "Encrypt this note body",
        sourceUrl: "https://example.test/private-note"
      },
      auth.session.token,
      201
    );
    const notification = await requestJson<Notification>(
      fixture.store,
      "POST",
      "/v1/notifications",
      {
        title: "Encrypt this notification title",
        summary: "Encrypt this notification summary",
        body: "Encrypt this notification body",
        sourceLabel: "Private Source"
      },
      auth.session.token,
      201
    );
    const calendar = await requestJson<CalendarEvent>(
      fixture.store,
      "POST",
      "/v1/calendar/events",
      {
        title: "Encrypt this calendar title",
        description: "Encrypt this calendar description",
        startAt: "2026-07-30T15:00:00.000Z",
        endAt: "2026-07-30T15:30:00.000Z",
        timezone: "America/New_York",
        location: "Private operatory"
      },
      auth.session.token,
      201
    );
    const record = await fixture.store.createConnectorSourceRecord(
      auth.user.id,
      {
        accountId: account.id,
        sourceExternalId: "encrypted-message-1",
        sourceType: "email",
        payloadHash: "encrypted-payload-hash",
        normalizedPayload: {
          provider: "gmail",
          subject: "Encrypt this email subject",
          snippet: "Encrypt this email snippet"
        }
      },
      "2026-07-29T18:00:00.000Z"
    );

    expect(note.title).toBe("Encrypt this note title");
    expect(notification.summary).toBe("Encrypt this notification summary");
    expect(calendar.title).toBe("Encrypt this calendar title");
    expect(record.normalizedPayload.subject).toBe("Encrypt this email subject");

    const raw = await fixture.db
      .prepare(
        `SELECT
           (SELECT title || ' ' || body || ' ' || COALESCE(source_url, '') FROM notes WHERE id = ?) AS note_text,
           (SELECT title || ' ' || summary || ' ' || body || ' ' || source_label FROM notifications WHERE id = ?) AS notification_text,
           (SELECT title || ' ' || description || ' ' || COALESCE(location, '') FROM calendar_events WHERE id = ?) AS calendar_text,
           (SELECT normalized_payload_json FROM connector_source_records WHERE id = ?) AS source_text,
           (SELECT email || ' ' || COALESCE(encrypted_email, '') FROM users WHERE id = ?) AS user_text`
      )
      .bind(note.id, notification.id, calendar.id, record.id, auth.user.id)
      .first<{
        note_text: string;
        notification_text: string;
        calendar_text: string;
        source_text: string;
        user_text: string;
      }>();
    const serialized = JSON.stringify(raw);
    expect(serialized).toContain("dlenc:v1.");
    expect(serialized).not.toContain("Encrypt this note title");
    expect(serialized).not.toContain("Encrypt this notification summary");
    expect(serialized).not.toContain("Encrypt this calendar title");
    expect(serialized).not.toContain("Encrypt this email subject");
    expect(serialized).not.toContain("Private Source");
    expect(serialized).not.toContain("encrypted-d1-content@example.com");
  });

  it("backfills legacy plaintext D1 content without changing API reads", async () => {
    const fixture = createStore();
    if (!fixture.db) return;
    const userId = "user_legacycontent";
    const timestamp = "2026-07-29T18:30:00.000Z";
    const password = await hashPassword("correct horse");
    await fixture.db
      .prepare(
        `INSERT INTO users
           (id, email, password_hash, password_salt, password_iterations, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        userId,
        "legacy-content@example.com",
        password.hash,
        password.salt,
        password.iterations,
        timestamp
      )
      .run();
    await fixture.db
      .prepare(
        `INSERT INTO notes
           (id, user_id, kind, title, body, folder_id, due_at, priority, pinned, status,
            global_order, source_url, version, created_at, updated_at, completed_at)
         VALUES ('note_legacycontent', ?, 'task', 'Legacy note title', 'Legacy note body',
                 NULL, NULL, 'none', 0, 'active', 0, 'https://example.test/legacy-note',
                 1, ?, ?, NULL)`
      )
      .bind(userId, timestamp, timestamp)
      .run();
    await fixture.db
      .prepare(
        `INSERT INTO notifications
           (id, user_id, title, summary, body, source, source_label, source_url, severity,
            status, pinned, rank, global_order, version, created_at, updated_at,
            completed_at, dismissed_at, email_metadata_json, rule_metadata_json, ai_metadata_json)
         VALUES ('notification_legacycontent', ?, 'Legacy notification title',
                 'Legacy notification summary', 'Legacy notification body', 'manual',
                 'Legacy source', 'https://example.test/legacy-notification', 'info',
                 'active', 0, 0, 0, 1, ?, ?, NULL, NULL,
                 '{"subject":"Legacy email subject"}', NULL, NULL)`
      )
      .bind(userId, timestamp, timestamp)
      .run();

    const backfill = await handleApiRequest(
      new Request("https://api.dentlink.test/v1/maintenance/content-encryption/backfill", {
        method: "POST",
        headers: { "X-DentLink-Maintenance-Token": "test-maintenance-token" }
      }),
      {
        DB: fixture.db,
        DENTLINK_ENV: "test",
        DENTLINK_CONTENT_ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
        DENTLINK_CONTENT_ENCRYPTION_BACKFILL_ENABLED: "true",
        DENTLINK_MAINTENANCE_TOKEN: "test-maintenance-token"
      }
    );
    expect(backfill.status).toBe(200);
    expect(((await backfill.json()) as { updated: number }).updated).toBeGreaterThanOrEqual(3);

    const store = new D1DentLinkStore(fixture.db, {
      contentEncryptionKey: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
    });
    const auth = await requestJson<AuthSession>(store, "POST", "/v1/auth/login", {
      email: "legacy-content@example.com",
      password: "correct horse"
    });
    const notes = await requestJson<NotesList>(
      store,
      "GET",
      "/v1/notes",
      undefined,
      auth.session.token
    );
    const notifications = await requestJson<{ notifications: Notification[] }>(
      store,
      "GET",
      "/v1/notifications",
      undefined,
      auth.session.token
    );
    expect(notes.notes.find((note) => note.id === "note_legacycontent")?.title).toBe(
      "Legacy note title"
    );
    expect(
      notifications.notifications.find(
        (notification) => notification.id === "notification_legacycontent"
      )?.summary
    ).toBe("Legacy notification summary");

    const raw = await fixture.db
      .prepare(
        `SELECT
           (SELECT email || ' ' || COALESCE(encrypted_email, '') FROM users WHERE id = ?) AS user_text,
           (SELECT title || ' ' || body || ' ' || source_url FROM notes WHERE id = 'note_legacycontent') AS note_text,
           (SELECT title || ' ' || summary || ' ' || body || ' ' || source_label || ' ' ||
                   COALESCE(email_metadata_json, '')
              FROM notifications WHERE id = 'notification_legacycontent') AS notification_text`
      )
      .bind(userId)
      .first<{ user_text: string; note_text: string; notification_text: string }>();
    const serialized = JSON.stringify(raw);
    expect(serialized).toContain("dlenc:v1.");
    expect(serialized).not.toContain("legacy-content@example.com");
    expect(serialized).not.toContain("Legacy note title");
    expect(serialized).not.toContain("Legacy notification summary");
    expect(serialized).not.toContain("Legacy email subject");
  });

  it("sends storage health alerts with cooldown when D1 thresholds are crossed", async () => {
    const fixture = createStore();
    if (!fixture.db) return;
    const auth = await register(fixture.store, "storage-alert@example.com");
    await requestJson<Note>(
      fixture.store,
      "POST",
      "/v1/notes",
      { kind: "task", title: "Storage alert row one" },
      auth.session.token,
      201
    );
    await requestJson<Notification>(
      fixture.store,
      "POST",
      "/v1/notifications",
      { title: "Storage alert row two", summary: "aggregate only" },
      auth.session.token,
      201
    );

    const sent: unknown[] = [];
    const env: ApiEnv = {
      store: fixture.store,
      DB: fixture.db,
      DENTLINK_ENV: "test",
      DENTLINK_ALERT_EMAIL_FROM: "alerts@dentlabs.net",
      DENTLINK_SYNC_CHANGES_ROW_ALERT_THRESHOLD: "1",
      ALERT_EMAIL: {
        async send(input) {
          sent.push(input);
        }
      }
    };
    const runScheduled = async () => {
      const promises: Promise<unknown>[] = [];
      apiDefaultForTest.scheduled({ scheduledTime: Date.now(), cron: "*/5 * * * *" }, env, {
        waitUntil: (promise) => promises.push(promise)
      });
      await Promise.all(promises);
    };

    await runScheduled();
    await runScheduled();

    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0])).toContain("evanjrizzo@gmail.com");
    expect(JSON.stringify(sent[0])).toContain("storage health");
    expect(JSON.stringify(sent[0])).not.toContain("Storage alert row one");
    expect(JSON.stringify(sent[0])).not.toContain("Storage alert row two");
    expect(JSON.stringify(sent[0])).not.toMatch(/token|secret|password/i);
  });

  it("sends connector runtime alerts when configured connectors are stale or degraded", async () => {
    const fixture = createStore();
    if (!fixture.db) return;
    const owner = await register(fixture.store, "connector-runtime-alert@example.com");
    const account = await fixture.store.createConnectorAccount(
      owner.user.id,
      {
        connectorKey: "google-calendar",
        displayName: "Google Calendar",
        settings: { googleEmail: "connector-runtime-alert@example.com" },
        credentialRef: "calendar-runtime-alert-credential",
        credentialStatus: "configured"
      },
      "2026-08-19T15:00:00.000Z"
    );
    await fixture.store.updateConnectorAccount(
      owner.user.id,
      account.id,
      account.version,
      {
        status: "error",
        healthStatus: "error",
        syncStatus: "error",
        lastSyncAt: "2026-08-19T15:00:00.000Z",
        lastHealthAt: "2026-08-19T15:05:00.000Z",
        errorCode: "google_token_error",
        errorMessage: "Token refresh failed"
      },
      "2026-08-19T15:05:00.000Z"
    );

    const sent: unknown[] = [];
    const env: ApiEnv = {
      store: fixture.store,
      DB: fixture.db,
      DENTLINK_ENV: "test",
      DENTLINK_ALERT_EMAIL_FROM: "alerts@dentlabs.net",
      DENTLINK_SYNC_CHANGES_ROW_ALERT_THRESHOLD: "999999",
      DENTLINK_CONNECTOR_SYNC_STALE_ALERT_MS: "1",
      ALERT_EMAIL: {
        async send(input) {
          sent.push(input);
        }
      }
    };
    const pending: Array<Promise<unknown>> = [];
    apiDefaultForTest.scheduled(
      { scheduledTime: Date.parse("2026-08-19T16:00:00.000Z"), cron: "*/5 * * * *" },
      env,
      { waitUntil: (promise) => pending.push(promise) }
    );
    await Promise.all(pending);

    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0])).toContain("connector runtime");
    expect(JSON.stringify(sent[0])).toContain("google-calendar");
    expect(JSON.stringify(sent[0])).not.toMatch(
      /connector-runtime-alert@example.com|Token refresh failed|token|secret|password/i
    );
  });

  it("stores encrypted archive objects and key wrappers by authenticated user only", async () => {
    const fixture = createStore();
    if (!fixture.db) return;
    const first = await register(fixture.store, "archive-first@example.com");
    const second = await register(fixture.store, "archive-second@example.com");
    const storedObjects = new Map<string, string>();
    const archiveEnv: Partial<ApiEnv> = {
      DB: fixture.db,
      ARCHIVE_BUCKET: {
        async put(key, value) {
          storedObjects.set(key, value);
        },
        async get(key) {
          const value = storedObjects.get(key);
          return value === undefined
            ? null
            : {
                async text() {
                  return value;
                }
              };
        }
      }
    };

    const plaintext = "patient should not be readable by backend storage metadata";
    const ciphertextB64 = btoa("opaque encrypted bytes only");
    const wrapper = await requestJson<{ wrapper: { keyId: string; wrappedKeyB64: string } }>(
      fixture.store,
      "POST",
      "/v1/archive/key-wrappers",
      {
        keyId: "archive-key-v1",
        wrapperType: "device-passkey",
        wrappingAlgorithm: "AES-GCM",
        wrappedKeyB64: btoa("wrapped-key-ciphertext"),
        publicMetadata: { label: "Pixel" }
      },
      first.session.token,
      201,
      archiveEnv
    );
    expect(wrapper.wrapper).toMatchObject({
      keyId: "archive-key-v1",
      wrappedKeyB64: btoa("wrapped-key-ciphertext")
    });

    const created = await requestJson<{
      object: { id: string; keyId: string; objectType: string; sizeBytes: number };
    }>(
      fixture.store,
      "POST",
      "/v1/archive/objects",
      {
        objectType: "notification",
        sourceEntityType: "notification",
        sourceEntityId: "notification_private",
        encryptionAlgorithm: "AES-GCM",
        keyId: "archive-key-v1",
        nonceB64: btoa("unique nonce"),
        ciphertextSha256B64: btoa("hash bytes"),
        ciphertextB64,
        publicMetadata: { schema: 1 }
      },
      first.session.token,
      201,
      archiveEnv
    );
    expect(created.object).toMatchObject({
      keyId: "archive-key-v1",
      objectType: "notification",
      sizeBytes: expect.any(Number)
    });

    const listedFirst = await requestJson<{ objects: Array<{ id: string }> }>(
      fixture.store,
      "GET",
      "/v1/archive/objects",
      undefined,
      first.session.token,
      200,
      archiveEnv
    );
    expect(listedFirst.objects.map((object) => object.id)).toContain(created.object.id);
    const listedSecond = await requestJson<{ objects: Array<{ id: string }> }>(
      fixture.store,
      "GET",
      "/v1/archive/objects",
      undefined,
      second.session.token,
      200,
      archiveEnv
    );
    expect(listedSecond.objects).toHaveLength(0);
    await requestJson<ApiErrorBody>(
      fixture.store,
      "GET",
      `/v1/archive/objects/${created.object.id}`,
      undefined,
      second.session.token,
      404,
      archiveEnv
    );

    const rawD1 = await fixture.db
      .prepare(
        `SELECT group_concat(public_metadata_json || ' ' || r2_key || ' ' || key_id, ' ')
         AS serialized
         FROM user_archive_objects`
      )
      .first<{ serialized: string }>();
    expect(rawD1?.serialized ?? "").not.toContain(plaintext);
    expect([...storedObjects.values()].join("\n")).not.toContain(plaintext);
  });

  it("refuses encrypted archive writes before the configured storage cap is exceeded", async () => {
    const fixture = createStore();
    if (!fixture.db) return;
    const auth = await register(fixture.store, "archive-quota@example.com");
    let putCount = 0;
    const archiveEnv: Partial<ApiEnv> = {
      DB: fixture.db,
      DENTLINK_ARCHIVE_MAX_TOTAL_BYTES: "1",
      ARCHIVE_BUCKET: {
        async put() {
          putCount += 1;
        },
        async get() {
          return null;
        }
      }
    };

    const rejected = await requestJson<ApiErrorBody>(
      fixture.store,
      "POST",
      "/v1/archive/objects",
      {
        objectType: "notification",
        encryptionAlgorithm: "AES-GCM",
        keyId: "archive-key-v1",
        nonceB64: btoa("unique nonce"),
        ciphertextSha256B64: btoa("hash bytes"),
        ciphertextB64: btoa("opaque encrypted bytes only")
      },
      auth.session.token,
      413,
      archiveEnv
    );

    expect(rejected.error.code).toBe("archive_quota_exceeded");
    expect(putCount).toBe(0);
    const rows = await fixture.db
      .prepare("SELECT COUNT(*) AS rows FROM user_archive_objects")
      .first<{ rows: number }>();
    expect(rows?.rows).toBe(0);
  });

  it("retains notifications unless an old completed or dismissed row has a same-user verified archive", async () => {
    const fixture = createStore();
    if (!fixture.db) return;
    const owner = await register(fixture.store, "archive-retention@example.com");
    const other = await register(fixture.store, "archive-retention-other@example.com");
    const storedObjects = new Map<string, string>();
    const archiveEnv: Partial<ApiEnv> = {
      DB: fixture.db,
      ARCHIVE_BUCKET: {
        async put(key, value) {
          storedObjects.set(key, value);
        },
        async get(key) {
          const value = storedObjects.get(key);
          return value === undefined
            ? null
            : {
                async text() {
                  return value;
                }
              };
        }
      }
    };
    const oldVerified = await createNotificationForRetention(
      fixture.store,
      fixture.db,
      owner.session.token,
      "old verified",
      { status: "done", age: "old" }
    );
    const oldUnverified = await createNotificationForRetention(
      fixture.store,
      fixture.db,
      owner.session.token,
      "old unverified",
      { status: "done", age: "old" }
    );
    const oldPinned = await createNotificationForRetention(
      fixture.store,
      fixture.db,
      owner.session.token,
      "old pinned",
      { status: "done", age: "old", pinned: true }
    );
    const recentVerified = await createNotificationForRetention(
      fixture.store,
      fixture.db,
      owner.session.token,
      "recent verified",
      { status: "dismissed", age: "recent" }
    );
    const activeVerified = await createNotificationForRetention(
      fixture.store,
      fixture.db,
      owner.session.token,
      "active verified",
      { status: "active", age: "old" }
    );
    const otherUserArchiveOnly = await createNotificationForRetention(
      fixture.store,
      fixture.db,
      owner.session.token,
      "other user archive only",
      { status: "done", age: "old" }
    );

    await createAndVerifyArchiveObject(
      fixture.store,
      owner.session.token,
      oldVerified.id,
      archiveEnv
    );
    await createAndVerifyArchiveObject(
      fixture.store,
      owner.session.token,
      oldPinned.id,
      archiveEnv
    );
    await createAndVerifyArchiveObject(
      fixture.store,
      owner.session.token,
      recentVerified.id,
      archiveEnv
    );
    await createAndVerifyArchiveObject(
      fixture.store,
      owner.session.token,
      activeVerified.id,
      archiveEnv
    );
    await createAndVerifyArchiveObject(
      fixture.store,
      other.session.token,
      otherUserArchiveOnly.id,
      archiveEnv
    );
    await createArchiveObjectForNotification(
      fixture.store,
      owner.session.token,
      oldUnverified.id,
      archiveEnv
    );

    const cursorBeforeRetention = await fixture.db
      .prepare("SELECT COALESCE(MAX(cursor), 0) AS cursor FROM sync_changes")
      .first<{ cursor: number }>();
    await runScheduledForTest({
      store: fixture.store,
      DB: fixture.db,
      ...archiveEnv
    });
    expect(await notificationExists(fixture.db, owner.user.id, oldVerified.id)).toBe(true);

    await runScheduledForTest({
      store: fixture.store,
      DB: fixture.db,
      DENTLINK_ARCHIVE_NOTIFICATION_RETENTION_ENABLED: "true",
      DENTLINK_ARCHIVE_NOTIFICATION_RETENTION_DAYS: "30",
      DENTLINK_ARCHIVE_NOTIFICATION_RETENTION_BATCH_SIZE: "10",
      ...archiveEnv
    });
    expect(await notificationExists(fixture.db, owner.user.id, oldVerified.id)).toBe(true);

    await runScheduledForTest({
      store: fixture.store,
      DB: fixture.db,
      DENTLINK_ARCHIVE_NOTIFICATION_RETENTION_ENABLED: "true",
      DENTLINK_ARCHIVE_NOTIFICATION_RETENTION_DAYS: "30",
      DENTLINK_ARCHIVE_NOTIFICATION_RETENTION_BATCH_SIZE: "10",
      DENTLINK_ARCHIVE_NOTIFICATION_RETENTION_USER_IDS: owner.user.id,
      ...archiveEnv
    });

    expect(await notificationExists(fixture.db, owner.user.id, oldVerified.id)).toBe(false);
    expect(await notificationExists(fixture.db, owner.user.id, oldUnverified.id)).toBe(true);
    expect(await notificationExists(fixture.db, owner.user.id, oldPinned.id)).toBe(true);
    expect(await notificationExists(fixture.db, owner.user.id, recentVerified.id)).toBe(true);
    expect(await notificationExists(fixture.db, owner.user.id, activeVerified.id)).toBe(true);
    expect(await notificationExists(fixture.db, owner.user.id, otherUserArchiveOnly.id)).toBe(true);

    const sync = await requestJson<SyncResponse>(
      fixture.store,
      "GET",
      `/v1/sync?cursor=${cursorBeforeRetention?.cursor ?? 0}`,
      undefined,
      owner.session.token,
      200,
      { DB: fixture.db }
    );
    expect(
      sync.changes.some(
        (change) =>
          change.type === "notification" && change.op === "delete" && change.id === oldVerified.id
      )
    ).toBe(true);
  });

  it("supports user-isolated notifications and versioned notification actions", async () => {
    const { store } = createStore();
    const first = await register(store, "notifications@example.com");
    const second = await register(store, "other-notifications@example.com");

    const created = await requestJson<Notification>(
      store,
      "POST",
      "/v1/notifications",
      {
        title: "Review webhook alert",
        summary: "Patient request",
        severity: "high",
        rank: 42
      },
      first.session.token,
      201
    );
    expect(created.userId).toBe(first.user.id);
    expect(created.status).toBe("active");

    const otherList = await requestJson<{ notifications: Notification[] }>(
      store,
      "GET",
      "/v1/notifications",
      undefined,
      second.session.token
    );
    expect(otherList.notifications).toEqual([]);

    const pinned = await requestJson<Notification>(
      store,
      "PATCH",
      `/v1/notifications/${created.id}`,
      { expectedVersion: created.version, patch: { pinned: true } },
      first.session.token
    );
    expect(pinned.pinned).toBe(true);

    await requestJson<ApiErrorBody>(
      store,
      "PATCH",
      `/v1/notifications/${created.id}`,
      { expectedVersion: created.version, patch: { title: "stale" } },
      first.session.token,
      409
    );
    await requestJson<ApiErrorBody>(
      store,
      "PATCH",
      `/v1/notifications/${created.id}`,
      { expectedVersion: pinned.version, patch: { status: "done" } },
      second.session.token,
      404
    );

    const dismissed = await requestJson<Notification>(
      store,
      "PATCH",
      `/v1/notifications/${created.id}`,
      { expectedVersion: pinned.version, patch: { status: "dismissed" } },
      first.session.token
    );
    expect(dismissed.status).toBe("dismissed");
    expect(dismissed.dismissedAt).toBeTruthy();

    const sync = await requestJson<SyncResponse>(
      store,
      "GET",
      "/v1/sync?cursor=0",
      undefined,
      first.session.token
    );
    expect(sync.changes.some((change) => change.type === "notification")).toBe(true);
  });

  it("creates named webhooks, accepts secret deliveries, and rejects cross-user access", async () => {
    const { store } = createStore();
    const owner = await register(store, "webhook-owner@example.com");
    const other = await register(store, "webhook-other@example.com");

    const created = await requestJson<{
      webhook: WebhookEndpoint & { ingestUrl: string };
      secret: string;
    }>(
      store,
      "POST",
      "/v1/webhooks",
      {
        name: "Front desk",
        slug: "front-desk",
        destination: "notification",
        defaultSeverity: "medium"
      },
      owner.session.token,
      201
    );
    expect(created.secret).toMatch(/^webhook_/);
    expect(created.webhook.ingestUrl).toBe(
      "https://api.dentlink.test/v1/ingest/webhooks/front-desk"
    );

    const listed = await requestJson<{ webhooks: Array<WebhookEndpoint & { ingestUrl: string }> }>(
      store,
      "GET",
      "/v1/webhooks",
      undefined,
      owner.session.token
    );
    expect(JSON.stringify(listed)).not.toContain(created.secret);

    await requestJson<ApiErrorBody>(
      store,
      "PATCH",
      `/v1/webhooks/${created.webhook.id}`,
      { expectedVersion: created.webhook.version, patch: { enabled: false } },
      other.session.token,
      404
    );

    const missingSecret = await handleApiRequest(
      new Request("https://api.dentlink.test/v1/ingest/webhooks/front-desk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "No secret" })
      }),
      { store }
    );
    expect(missingSecret.status).toBe(401);

    const denied = await deliverWebhook(
      store,
      "front-desk",
      "wrong-secret",
      { title: "Should not appear" },
      404
    );
    expect(denied.error.code).toBe("not_found");

    const delivered = await deliverWebhook(
      store,
      "front-desk",
      created.secret,
      { title: "New patient callback", summary: "Call before 5", severity: "high" },
      202
    );
    expect(delivered.accepted).toBe(true);
    expect(delivered.notification?.title).toBe("New patient callback");
    expect(delivered.notification?.sourceLabel).toBe("Front desk");

    const ownerNotifications = await requestJson<{ notifications: Notification[] }>(
      store,
      "GET",
      "/v1/notifications",
      undefined,
      owner.session.token
    );
    expect(ownerNotifications.notifications.map((item) => item.title)).toContain(
      "New patient callback"
    );

    const disabled = await requestJson<WebhookEndpoint & { ingestUrl: string }>(
      store,
      "PATCH",
      `/v1/webhooks/${created.webhook.id}`,
      { expectedVersion: created.webhook.version, patch: { enabled: false } },
      owner.session.token
    );
    expect(disabled.enabled).toBe(false);
    await deliverWebhook(store, "front-desk", created.secret, { title: "Disabled endpoint" }, 404);
    const reenabled = await requestJson<WebhookEndpoint & { ingestUrl: string }>(
      store,
      "PATCH",
      `/v1/webhooks/${created.webhook.id}`,
      { expectedVersion: disabled.version, patch: { enabled: true } },
      owner.session.token
    );
    expect(reenabled.enabled).toBe(true);

    const deleted = await requestJson<WebhookEndpoint & { ingestUrl: string }>(
      store,
      "DELETE",
      `/v1/webhooks/${created.webhook.id}`,
      { expectedVersion: reenabled.version },
      owner.session.token
    );
    expect(deleted.enabled).toBe(false);
    await deliverWebhook(store, "front-desk", created.secret, { title: "Deleted endpoint" }, 404);

    const noteWebhook = await requestJson<{
      webhook: WebhookEndpoint & { ingestUrl: string };
      secret: string;
    }>(
      store,
      "POST",
      "/v1/webhooks",
      {
        name: "Tasks",
        slug: "tasks",
        destination: "note",
        defaultPriority: "high"
      },
      owner.session.token,
      201
    );
    const deliveredNote = await deliverWebhook(
      store,
      "tasks",
      noteWebhook.secret,
      { title: "Prepare estimate", body: "Use webhook body", kind: "task", pinned: true },
      202
    );
    expect(deliveredNote.note?.title).toBe("Prepare estimate");
    expect(deliveredNote.note?.priority).toBe("high");
    expect(deliveredNote.note?.pinned).toBe(true);

    const watchWebhook = await requestJson<{
      webhook: WebhookEndpoint & { ingestUrl: string };
      secret: string;
    }>(
      store,
      "POST",
      "/v1/webhooks",
      {
        name: "Watch Voice Notes",
        slug: "watch-voice-notes-test",
        destination: "note"
      },
      owner.session.token,
      201
    );
    const deliveredWatchNote = await deliverWebhook(
      store,
      "watch-voice-notes-test",
      watchWebhook.secret,
      { title: "Watch note", kind: "task" },
      202
    );
    expect(deliveredWatchNote.note?.pinned).toBe(true);

    for (let index = 0; index < 59; index += 1) {
      await deliverWebhook(
        store,
        "tasks",
        noteWebhook.secret,
        { title: `Rate ${index}`, kind: "task" },
        202
      );
    }
    const rateLimited = await deliverWebhook<ApiErrorBody>(
      store,
      "tasks",
      noteWebhook.secret,
      { title: "Too many", kind: "task" },
      429
    );
    expect(rateLimited.error.code).toBe("rate_limited");
  });
});

async function register(store: DentLinkStore, email: string): Promise<AuthSession> {
  return requestJson<AuthSession>(
    store,
    "POST",
    "/v1/auth/register",
    {
      email,
      password: "correct horse"
    },
    undefined,
    201
  );
}

async function runScheduledForTest(env: ApiEnv): Promise<void> {
  const promises: Promise<unknown>[] = [];
  apiDefaultForTest.scheduled({ scheduledTime: Date.now(), cron: "*/5 * * * *" }, env, {
    waitUntil: (promise) => promises.push(promise)
  });
  await Promise.all(promises);
}

async function createNotificationForRetention(
  store: DentLinkStore,
  db: D1DatabaseLike,
  token: string,
  title: string,
  options: {
    status: "active" | "done" | "dismissed";
    age: "old" | "recent";
    pinned?: boolean;
  }
): Promise<Notification> {
  const created = await requestJson<Notification>(
    store,
    "POST",
    "/v1/notifications",
    {
      title,
      summary: `${title} summary`,
      pinned: options.pinned ?? false
    },
    token,
    201
  );
  const current =
    options.status === "active"
      ? created
      : await requestJson<Notification>(
          store,
          "PATCH",
          `/v1/notifications/${created.id}`,
          { expectedVersion: created.version, patch: { status: options.status } },
          token
        );
  const reference = options.age === "old" ? "2026-06-01T00:00:00.000Z" : new Date().toISOString();
  await db
    .prepare(
      `UPDATE notifications
       SET updated_at = ?,
           completed_at = CASE WHEN status = 'done' THEN ? ELSE completed_at END,
           dismissed_at = CASE WHEN status = 'dismissed' THEN ? ELSE dismissed_at END
       WHERE id = ? AND user_id = ?`
    )
    .bind(reference, reference, reference, current.id, current.userId)
    .run();
  return { ...current, updatedAt: reference };
}

async function createAndVerifyArchiveObject(
  store: DentLinkStore,
  token: string,
  notificationId: string,
  env: Partial<ApiEnv>
): Promise<{ object: { id: string; verifiedAt: string | null } }> {
  const created = await createArchiveObjectForNotification(store, token, notificationId, env);
  return requestJson<{ object: { id: string; verifiedAt: string | null } }>(
    store,
    "POST",
    `/v1/archive/objects/${created.object.id}/verify`,
    undefined,
    token,
    200,
    env
  );
}

async function createArchiveObjectForNotification(
  store: DentLinkStore,
  token: string,
  notificationId: string,
  env: Partial<ApiEnv>
): Promise<{ object: { id: string; verifiedAt: string | null } }> {
  return requestJson<{ object: { id: string; verifiedAt: string | null } }>(
    store,
    "POST",
    "/v1/archive/objects",
    {
      objectType: "notification",
      sourceEntityType: "notification",
      sourceEntityId: notificationId,
      encryptionAlgorithm: "AES-GCM",
      keyId: "archive-key-v1",
      nonceB64: btoa(`nonce-${notificationId}`),
      ciphertextSha256B64: btoa(`hash-${notificationId}`),
      ciphertextB64: btoa(`opaque encrypted ${notificationId}`),
      publicMetadata: { schema: 1 }
    },
    token,
    201,
    env
  );
}

async function notificationExists(
  db: D1DatabaseLike,
  userId: string,
  notificationId: string
): Promise<boolean> {
  const row = await db
    .prepare("SELECT id FROM notifications WHERE user_id = ? AND id = ?")
    .bind(userId, notificationId)
    .first<{ id: string }>();
  return Boolean(row);
}

function debugSessions(store: MemoryDentLinkStore): Map<string, unknown> {
  return (store as unknown as { sessions: Map<string, unknown> }).sessions;
}

function gmailTestEnv(
  gmailClient: GmailApiClient,
  gmailImapClient?: GmailImapClient
): Partial<ApiEnv> {
  return {
    GOOGLE_CLIENT_ID: "test-client-id",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
    GOOGLE_REDIRECT_URI: "https://api.dentlink.test/v1/connectors/gmail/callback",
    GMAIL_CREDENTIAL_ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    DENTLINK_WEB_ORIGIN: "https://web.example.test",
    gmailClient,
    gmailImapClient
  };
}

async function connectGmailForTest(
  store: DentLinkStore,
  owner: AuthSession,
  env: Partial<ApiEnv>
): Promise<ConnectorAccount> {
  const start = await requestJson<{ authorizationUrl: string }>(
    store,
    "POST",
    "/v1/connectors/gmail/start",
    undefined,
    owner.session.token,
    201,
    env
  );
  const startUrl = new URL(start.authorizationUrl);
  const callback = await handleApiRequest(
    new Request(
      `https://api.dentlink.test/v1/connectors/gmail/callback?code=valid-code&state=${startUrl.searchParams.get(
        "state"
      )}`,
      { headers: { Accept: "application/json" } }
    ),
    { store, ...env }
  );
  expect(callback.status).toBe(200);
  const linked = (await callback.json()) as { account: ConnectorAccount };
  return linked.account;
}

async function connectImapGmailForTest(
  store: DentLinkStore,
  owner: AuthSession,
  env: Partial<ApiEnv>
): Promise<ConnectorAccount> {
  const start = await requestJson<{ authorizationUrl: string }>(
    store,
    "POST",
    "/v1/connectors/gmail/start",
    undefined,
    owner.session.token,
    201,
    env
  );
  const startUrl = new URL(start.authorizationUrl);
  const callback = await handleApiRequest(
    new Request(
      `https://api.dentlink.test/v1/connectors/gmail/callback?code=valid-code&state=${startUrl.searchParams.get(
        "state"
      )}`,
      { headers: { Accept: "application/json" } }
    ),
    { store, ...env }
  );
  const linked = (await callback.json()) as { account: ConnectorAccount };
  const granted = await store.updateConnectorAccount(
    owner.user.id,
    linked.account.id,
    linked.account.version,
    {
      settings: {
        ...linked.account.settings,
        gmailIngestionEngine: "gmail_imap",
        gmailGrantedScopes: "https://mail.google.com/",
        gmailImapGranted: true,
        gmailReconnectRequired: false
      }
    },
    "2026-07-14T20:00:00.000Z"
  );
  if (!granted) throw new Error("Expected Gmail account to be granted");
  return requestJson<ConnectorAccount>(
    store,
    "PUT",
    `/v1/connectors/gmail/${linked.account.id}/engine`,
    { expectedVersion: granted.version, engine: "gmail_imap" },
    owner.session.token,
    200,
    env
  );
}

function gmailBodyData(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function googleCalendarTestEnv(googleCalendarClient: GoogleCalendarApiClient): Partial<ApiEnv> {
  return {
    GOOGLE_CLIENT_ID: "test-client-id",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
    GOOGLE_CALENDAR_REDIRECT_URI:
      "https://api.dentlink.test/v1/connectors/google-calendar/callback",
    GMAIL_CREDENTIAL_ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    DENTLINK_WEB_ORIGIN: "https://web.example.test",
    googleCalendarClient
  };
}

function fakeGmailClient(): GmailApiClient {
  return fakeGmailClientWithRefreshToken("refresh-token-secret");
}

function fakeGmailClientWithRefreshToken(refreshTokenValue: string): GmailApiClient {
  return {
    async exchangeCode(code) {
      expect(code).toBe("valid-code");
      return {
        accessToken: "access-token",
        refreshToken: refreshTokenValue,
        scope: "https://www.googleapis.com/auth/gmail.readonly"
      };
    },
    async refreshAccessToken(refreshToken) {
      expect(refreshToken).toBe(refreshTokenValue);
      return { accessToken: "access-token-refreshed" };
    },
    async getAccessTokenScopes() {
      return ["https://www.googleapis.com/auth/gmail.readonly"];
    },
    async getProfile() {
      return { emailAddress: "owner.gmail@example.test", historyId: "100" };
    },
    async listMessages(_accessToken, options) {
      if (options) {
        expect(typeof options).toBe("object");
        const parsed = typeof options === "object" ? options : {};
        expect(parsed.query).toMatch(/^after:\d+$/);
      }
      return { messages: [{ id: "gmail-message-1", threadId: "gmail-thread-1" }] };
    },
    async listHistory(_accessToken, startHistoryId) {
      if (startHistoryId === "100" || startHistoryId === "101") {
        return {
          historyId: "101",
          history: [
            {
              id: "101",
              messagesAdded: [{ message: { id: "gmail-message-1", threadId: "gmail-thread-1" } }]
            }
          ]
        };
      }
      return { historyId: startHistoryId, history: [] };
    },
    async getMessage(_accessToken, messageId) {
      expect(messageId).toBe("gmail-message-1");
      return {
        id: "gmail-message-1",
        threadId: "gmail-thread-1",
        historyId: "101",
        internalDate: "1783980000000",
        labelIds: ["INBOX", "UNREAD"],
        payload: {
          headers: [
            { name: "From", value: "Front Desk <front@example.test>" },
            { name: "Subject", value: "Insurance update" },
            { name: "Date", value: "Tue, 14 Jul 2026 10:00:00 -0400" },
            { name: "Message-ID", value: "<message-1@example.test>" }
          ]
        }
      };
    }
  };
}

function hangingGmailClient(): GmailApiClient {
  return {
    async exchangeCode(code) {
      expect(code).toBe("valid-code");
      return {
        accessToken: "access-token",
        refreshToken: "hanging-refresh-token-secret",
        scope: "https://www.googleapis.com/auth/gmail.readonly"
      };
    },
    async refreshAccessToken() {
      return new Promise(() => undefined);
    },
    async getAccessTokenScopes() {
      return ["https://www.googleapis.com/auth/gmail.readonly"];
    },
    async getProfile() {
      return { emailAddress: "owner.gmail@example.test", historyId: "100" };
    },
    async listMessages() {
      return { messages: [] };
    },
    async listHistory() {
      return { history: [] };
    },
    async getMessage() {
      throw new Error("Message should not be fetched when token refresh hangs");
    }
  };
}

function fakeGmailClientWithMailScope(refreshTokenValue: string): GmailApiClient {
  return {
    async exchangeCode(code) {
      expect(code).toBe("valid-code");
      return {
        accessToken: "access-token",
        refreshToken: refreshTokenValue,
        scope: "https://mail.google.com/"
      };
    },
    async refreshAccessToken(refreshToken) {
      expect(refreshToken).toBe(refreshTokenValue);
      return { accessToken: "access-token-refreshed" };
    },
    async getAccessTokenScopes() {
      return ["https://mail.google.com/"];
    },
    async getProfile() {
      return { emailAddress: "owner.gmail@example.test", historyId: "100" };
    },
    async listMessages() {
      return { messages: [{ id: "gmail-message-1", threadId: "gmail-thread-1" }] };
    },
    async listHistory() {
      return { historyId: "101", history: [] };
    },
    async getMessage() {
      throw new Error("Gmail API messages should not be fetched during IMAP reconnect");
    }
  };
}

function fakeGmailImapClient(): GmailImapClient {
  return {
    async poll(options) {
      expect(options.user).toBe("owner.gmail@example.test");
      expect(options.accessToken).toBe("access-token-refreshed");
      expect(options.recentWindowDays).toBeGreaterThan(0);
      expect(options.maxMessages).toBeGreaterThan(0);
      if (options.newerThanUid) {
        expect(options.newerThanUid).toBe("10");
        expect(options.expectedUidValidity).toBe("999");
        return {
          mailboxMessageCount: 10,
          uidValidity: "999",
          discoveredUids: [],
          messages: []
        };
      }
      return {
        mailboxMessageCount: 10,
        uidValidity: "999",
        discoveredUids: ["10", "11"],
        messages: [
          {
            uid: "10",
            sourceExternalId: "x-gm-msgid:imap-gm-1",
            identifiers: {
              xGmMsgId: "imap-gm-1",
              messageId: "<imap-message@example.test>",
              uid: "10",
              uidValidity: "999",
              internalDate: "14-Jul-2026 12:00:00 -0400"
            },
            parsed: {
              subject: "IMAP insurance update",
              from: "Clinic Desk <clinic@example.test>",
              to: "owner.gmail@example.test",
              cc: null,
              date: "Tue, 14 Jul 2026 12:00:00 -0400",
              messageId: "<imap-message@example.test>",
              plainText: "Plain text",
              html: "<p>Plain text</p>",
              attachments: [
                {
                  filename: "statement.pdf",
                  contentType: "application/pdf",
                  disposition: "attachment",
                  contentId: null,
                  sizeBytes: 123
                }
              ],
              headers: new Map([
                ["list-id", "updates.example.test"],
                ["from", "Clinic Desk <clinic@example.test>"],
                ["subject", "IMAP insurance update"]
              ])
            },
            rawSizeBytes: 512
          }
        ]
      };
    },
    async verify(options) {
      expect(options.user).toBe("owner.gmail@example.test");
      expect(options.accessToken).toBe("access-token");
    }
  };
}

function fakeGmailClientWithoutRefreshToken(): GmailApiClient {
  return {
    async exchangeCode(code) {
      expect(code).toBe("valid-code");
      return {
        accessToken: "access-token",
        scope: "https://www.googleapis.com/auth/gmail.readonly"
      };
    },
    async refreshAccessToken() {
      throw new Error("Refresh should not be used before credential persistence");
    },
    async getAccessTokenScopes() {
      return ["https://www.googleapis.com/auth/gmail.readonly"];
    },
    async getProfile() {
      throw new Error("Profile should not be loaded without a refresh token");
    },
    async listMessages() {
      return { messages: [] };
    },
    async listHistory() {
      return { history: [] };
    },
    async getMessage() {
      throw new Error("Message should not be fetched during reconnect verification");
    }
  };
}

function fakeGmailClientWithGrantedScope(scope: string): GmailApiClient {
  return {
    async exchangeCode(code) {
      expect(code).toBe("valid-code");
      return {
        accessToken: "access-token",
        refreshToken: "replacement-refresh-token-secret",
        scope
      };
    },
    async refreshAccessToken() {
      throw new Error("Refresh should not be used before credential persistence");
    },
    async getAccessTokenScopes() {
      return normalizeTestScopes(scope);
    },
    async getProfile() {
      throw new Error("Profile should not be loaded without readonly scope");
    },
    async listMessages() {
      throw new Error("Capability should not run without readonly scope");
    },
    async listHistory() {
      return { history: [] };
    },
    async getMessage() {
      throw new Error("Message should not be fetched during reconnect verification");
    }
  };
}

function fakeGmailClientWithCapabilityFailure(): GmailApiClient {
  return {
    async exchangeCode(code) {
      expect(code).toBe("valid-code");
      return {
        accessToken: "access-token",
        refreshToken: "replacement-refresh-token-secret",
        scope: "https://www.googleapis.com/auth/gmail.readonly"
      };
    },
    async refreshAccessToken() {
      throw new Error("Refresh should not be used before credential persistence");
    },
    async getAccessTokenScopes() {
      return ["https://www.googleapis.com/auth/gmail.readonly"];
    },
    async getProfile() {
      throw new Error("Profile should not be loaded before capability succeeds");
    },
    async listMessages() {
      throw new StoreError(
        "gmail_permission_denied",
        "Reconnect Gmail to grant read-only mailbox access required for backfill."
      );
    },
    async listHistory() {
      return { history: [] };
    },
    async getMessage() {
      throw new Error("Message should not be fetched during reconnect verification");
    }
  };
}

function normalizeTestScopes(scope: string): string[] {
  return scope
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function fakeGmailClientWithPartialFailure(): GmailApiClient {
  return {
    async exchangeCode(code) {
      expect(code).toBe("valid-code");
      return { accessToken: "access-token", refreshToken: "refresh-token-secret" };
    },
    async refreshAccessToken(refreshToken) {
      expect(refreshToken).toBe("refresh-token-secret");
      return { accessToken: "access-token-refreshed" };
    },
    async getAccessTokenScopes() {
      return ["https://www.googleapis.com/auth/gmail.readonly"];
    },
    async getProfile() {
      return { emailAddress: "owner.gmail@example.test", historyId: "100" };
    },
    async listMessages() {
      return { messages: [] };
    },
    async listHistory(_accessToken, startHistoryId) {
      return {
        historyId: "102",
        history: [
          {
            id: startHistoryId === "100" ? "101" : startHistoryId,
            messagesAdded: [
              { message: { id: "gmail-message-ok", threadId: "gmail-thread-ok" } },
              { message: { id: "gmail-message-failure", threadId: "gmail-thread-failure" } }
            ]
          }
        ]
      };
    },
    async getMessage(_accessToken, messageId) {
      if (messageId === "gmail-message-failure") {
        throw new Error("Gmail API request failed");
      }
      return {
        id: "gmail-message-ok",
        threadId: "gmail-thread-ok",
        historyId: "101",
        internalDate: "1783980000000",
        labelIds: ["INBOX"],
        payload: {
          headers: [
            { name: "From", value: "Front Desk <front@example.test>" },
            { name: "Subject", value: "Successful message" },
            { name: "Date", value: "Tue, 14 Jul 2026 10:00:00 -0400" },
            { name: "Message-ID", value: "<message-ok@example.test>" }
          ]
        }
      };
    }
  };
}

function fakeGmailClientWithMultiPageMessages(): GmailApiClient {
  return {
    async exchangeCode(code) {
      expect(code).toBe("valid-code");
      return { accessToken: "access-token", refreshToken: "refresh-token-secret" };
    },
    async refreshAccessToken(refreshToken) {
      expect(refreshToken).toBe("refresh-token-secret");
      return { accessToken: "access-token-refreshed" };
    },
    async getAccessTokenScopes() {
      return ["https://www.googleapis.com/auth/gmail.readonly"];
    },
    async getProfile() {
      return { emailAddress: "owner.gmail@example.test" };
    },
    async listMessages(_accessToken, pageToken) {
      if (typeof pageToken === "object" && pageToken?.maxResults === 1) {
        return { messages: [] };
      }
      if (!pageToken) {
        return {
          messages: [
            { id: "gmail-page-1", threadId: "gmail-thread-page-1" },
            { id: "gmail-page-2", threadId: "gmail-thread-page-2" }
          ],
          nextPageToken: "page-2"
        };
      }
      expect(pageToken).toBe("page-2");
      return {
        messages: [{ id: "gmail-page-3", threadId: "gmail-thread-page-3" }]
      };
    },
    async listHistory() {
      return { history: [] };
    },
    async getMessage(_accessToken, messageId) {
      const sequence = messageId.at(-1) ?? "1";
      return {
        id: messageId,
        threadId: `gmail-thread-page-${sequence}`,
        historyId: `20${sequence}`,
        internalDate: "1783980000000",
        labelIds: ["INBOX"],
        payload: {
          headers: [
            { name: "From", value: "Front Desk <front@example.test>" },
            { name: "Subject", value: `Paged message ${sequence}` },
            { name: "Date", value: "Tue, 14 Jul 2026 10:00:00 -0400" },
            { name: "Message-ID", value: `<message-page-${sequence}@example.test>` }
          ]
        }
      };
    }
  };
}

function fakeGmailClientForBackfill(): GmailApiClient {
  return {
    async exchangeCode(code) {
      expect(code).toBe("valid-code");
      return { accessToken: "access-token", refreshToken: "refresh-token-secret" };
    },
    async refreshAccessToken(refreshToken) {
      expect(refreshToken).toBe("refresh-token-secret");
      return { accessToken: "access-token-refreshed" };
    },
    async getAccessTokenScopes() {
      return ["https://www.googleapis.com/auth/gmail.readonly"];
    },
    async getProfile() {
      return { emailAddress: "owner.gmail@example.test", historyId: "history-checkpoint-500" };
    },
    async listMessages(_accessToken, options) {
      expect(typeof options).toBe("object");
      const parsed = typeof options === "object" && options ? options : {};
      if (parsed.maxResults === 1) return { messages: [] };
      expect(parsed.query).toMatch(/^after:\d+$/);
      if (!parsed.pageToken) {
        return {
          messages: [{ id: "gmail-backfill-1", threadId: "gmail-thread-backfill-1" }],
          nextPageToken: "backfill-page-2"
        };
      }
      expect(parsed.pageToken).toBe("backfill-page-2");
      return {
        messages: [{ id: "gmail-backfill-2", threadId: "gmail-thread-backfill-2" }]
      };
    },
    async listHistory() {
      throw new Error("Backfill must not use Gmail history sync");
    },
    async getMessage(_accessToken, messageId) {
      const sequence = messageId.endsWith("2") ? "2" : "1";
      return {
        id: messageId,
        threadId: `gmail-thread-backfill-${sequence}`,
        historyId: `history-backfill-${sequence}`,
        internalDate: "1783980000000",
        labelIds: ["INBOX"],
        payload: {
          headers: [
            { name: "From", value: "Archive <archive@example.test>" },
            { name: "Subject", value: `Historical message ${sequence}` },
            { name: "Date", value: "Tue, 14 Jul 2026 10:00:00 -0400" },
            { name: "Message-ID", value: `<historical-${sequence}@example.test>` }
          ]
        }
      };
    }
  };
}

function fakeGmailClientForBackfillListFailure(): GmailApiClient {
  return {
    async exchangeCode(code) {
      expect(code).toBe("valid-code");
      return { accessToken: "access-token", refreshToken: "refresh-token-secret" };
    },
    async refreshAccessToken(refreshToken) {
      expect(refreshToken).toBe("refresh-token-secret");
      return { accessToken: "access-token-refreshed" };
    },
    async getAccessTokenScopes() {
      return ["https://www.googleapis.com/auth/gmail.readonly"];
    },
    async getProfile() {
      return { emailAddress: "owner.gmail@example.test", historyId: "history-checkpoint-700" };
    },
    async listMessages(_accessToken, options) {
      expect(typeof options).toBe("object");
      if (typeof options === "object" && options?.maxResults === 1) return { messages: [] };
      throw new StoreError(
        "gmail_query_invalid",
        "Backfill failed because Gmail rejected the mailbox search query."
      );
    },
    async listHistory(_accessToken, startHistoryId) {
      expect(startHistoryId).toBe("history-checkpoint-700");
      return {
        historyId: "history-checkpoint-701",
        history: [
          {
            id: "history-checkpoint-701",
            messagesAdded: [{ message: { id: "gmail-incremental-ok" } }]
          }
        ]
      };
    },
    async getMessage() {
      return {
        id: "gmail-incremental-ok",
        threadId: "gmail-thread-incremental-ok",
        historyId: "history-checkpoint-701",
        internalDate: "1783980000000",
        labelIds: ["INBOX"],
        payload: {
          headers: [
            { name: "From", value: "Front Desk <front@example.test>" },
            { name: "Subject", value: "Incremental message" },
            { name: "Date", value: "Tue, 14 Jul 2026 10:00:00 -0400" },
            { name: "Message-ID", value: "<incremental@example.test>" }
          ]
        }
      };
    }
  };
}

function fakeGoogleCalendarClient(): GoogleCalendarApiClient {
  return {
    async exchangeCode(code) {
      expect(code).toBe("valid-code");
      return { accessToken: "calendar-access-token", refreshToken: "calendar-refresh-token" };
    },
    async refreshAccessToken(refreshToken) {
      expect(refreshToken).toBe("calendar-refresh-token");
      return { accessToken: "calendar-access-token-refreshed" };
    },
    async listCalendars() {
      return {
        items: [{ id: "primary", summary: "Primary calendar", primary: true }]
      };
    },
    async listEvents(_accessToken, calendarId, options) {
      expect(calendarId).toBe("primary");
      if (options.syncToken) {
        return {
          items: [],
          nextSyncToken:
            options.syncToken === "calendar-sync-1" ? "calendar-sync-2" : options.syncToken
        };
      }
      return {
        nextSyncToken: "calendar-sync-1",
        items: [
          {
            id: "calendar-event-all-day",
            status: "confirmed",
            summary: "All-day planning",
            htmlLink: "https://calendar.google.com/event?eid=all-day",
            start: { date: "2026-07-15" },
            end: { date: "2026-07-16" }
          },
          {
            id: "calendar-event-timed",
            status: "confirmed",
            summary: "Patient consult",
            location: "Operatory 2",
            htmlLink: "https://calendar.google.com/event?eid=timed",
            start: {
              dateTime: "2026-07-15T14:00:00-04:00",
              timeZone: "America/New_York"
            },
            end: {
              dateTime: "2026-07-15T14:30:00-04:00",
              timeZone: "America/New_York"
            }
          },
          {
            id: "calendar-event-cancelled",
            status: "cancelled",
            summary: "Cancelled review",
            htmlLink: "https://calendar.google.com/event?eid=cancelled",
            start: {
              dateTime: "2026-07-15T16:00:00-04:00",
              timeZone: "America/New_York"
            },
            end: {
              dateTime: "2026-07-15T16:30:00-04:00",
              timeZone: "America/New_York"
            }
          }
        ]
      };
    }
  };
}

async function requestJson<T>(
  store: DentLinkStore,
  method: string,
  path: string,
  body?: unknown,
  token?: string,
  expectedStatus = 200,
  env: Partial<ApiEnv> = {}
): Promise<T> {
  const headers = new Headers();
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await handleApiRequest(
    new Request(`https://api.dentlink.test${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    }),
    { store, ...env }
  );
  expect(response.status).toBe(expectedStatus);
  return (await response.json()) as T;
}

async function deliverWebhook<
  T = {
    accepted?: boolean;
    notification?: Notification;
    note?: Note;
    error: { code: string };
  }
>(
  store: DentLinkStore,
  slug: string,
  secret: string,
  body: unknown,
  expectedStatus: number
): Promise<T> {
  const response = await handleApiRequest(
    new Request(`https://api.dentlink.test/v1/ingest/webhooks/${slug}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-DentLink-Webhook-Secret": secret
      },
      body: JSON.stringify(body)
    }),
    { store }
  );
  expect(response.status).toBe(expectedStatus);
  return (await response.json()) as T;
}
