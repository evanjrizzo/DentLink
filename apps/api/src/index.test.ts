import { webcrypto } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { hashPassword, hashSessionToken } from "./auth";
import { D1DentLinkStore } from "./d1-storage";
import type { GoogleCalendarApiClient } from "./google-calendar";
import {
  createGoogleGmailClient,
  syncConnectedGmailAccounts,
  type GmailApiClient,
  type GmailImapClient
} from "./gmail";
import apiDefaultForTest, { handleApiRequest, type ApiEnv } from "./index";
import { SqliteD1TestDatabase } from "./sqlite-d1-test";
import { MemoryDentLinkStore, StoreError, type DentLinkStore } from "./storage";

import type {
  ApiErrorBody,
  AuthSession,
  ConnectorAccount,
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

type StoreFixture = {
  name: string;
  createStore(): { store: DentLinkStore; hasRawSessionToken?(token: string): Promise<boolean> };
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
        notificationSuppressedSchemaPath
      ]);
      return {
        store: new D1DentLinkStore(db),
        async hasRawSessionToken(token: string) {
          const row = await db
            .prepare("SELECT token_hash FROM sessions WHERE token_hash = ?")
            .bind(token)
            .first();
          return Boolean(row);
        }
      };
    }
  }
];

describe.each(fixtures)("@dentlink/api milestone 1 storage contract ($name)", ({ createStore }) => {
  it("serves deployment health without exposing secrets", async () => {
    const { store } = createStore();
    const response = await handleApiRequest(new Request("https://api.dentlink.test/v1/health"), {
      store,
      DENTLINK_ENV: "test",
      DENTLINK_BUILD_ID: "test-build"
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const body = (await response.json()) as {
      status: string;
      environment: string;
      build: string;
      database: { reachable: boolean };
    };
    expect(body).toEqual({
      status: "ok",
      environment: "test",
      build: "test-build",
      database: { reachable: true, adapter: "memory" }
    });
    expect(JSON.stringify(body)).not.toMatch(/token|secret|password/i);
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

    const prefs = await requestJson<{ timezone: { selected: string }; ai: { threshold: number } }>(
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
          ai: { threshold: 67, globalPrompt: "  Prioritize bills and scheduling.  " }
        }
      },
      auth.session.token
    );
    expect(prefs.timezone.selected).toBe("America/Los_Angeles");
    expect(prefs.ai.threshold).toBe(67);
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
    expect(repeat.summary).toMatchObject({ discovered: 2, examined: 1, created: 0, duplicate: 1 });
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
    const now = "2026-07-16T16:00:00.000Z";
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
      "/v1/notifications?includeSuppressed=true&search=insurance",
      undefined,
      owner.session.token
    );
    expect(searchable.notifications[0]).toMatchObject({
      id: notification.id,
      status: "suppressed",
      summary: "AI reprocessed insurance update.",
      ai: { importance: 50 }
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
      { syncStatus: "syncing" },
      "2026-07-14T20:09:00.000Z"
    );
    expect(freshSyncing).not.toBeNull();
    expect(await syncConnectedGmailAccounts(store, env, "2026-07-14T20:10:00.000Z")).toMatchObject({
      attempted: 0,
      skipped: 1
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
      { syncStatus: "syncing" },
      "2026-07-14T20:00:00.000Z"
    );
    expect(staleSyncing).not.toBeNull();
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
      gmailLastSyncCreated: 1
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
      status: "success",
      engine: "gmail_api",
      created: 1,
      failed: 0
    });
    expect(
      result.connectors.find((connector) => connector.provider === "google-calendar")
    ).toMatchObject({
      status: "success",
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

  it("returns partial Refresh All results when one connector fails", async () => {
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
    expect(result.status).toBe("partial");
    expect(result.connectors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: "gmail", status: "failed", failed: 1 }),
        expect.objectContaining({ provider: "generic-email", status: "skipped" })
      ])
    );
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
      "/v1/calendar/events",
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
      "/v1/calendar/events",
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
      "/v1/calendar/events",
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
      "/v1/calendar/events",
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
      "/v1/calendar/events",
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
      "/v1/calendar/events",
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
      { title: "Prepare estimate", body: "Use webhook body", kind: "task" },
      202
    );
    expect(deliveredNote.note?.title).toBe("Prepare estimate");
    expect(deliveredNote.note?.priority).toBe("high");

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
