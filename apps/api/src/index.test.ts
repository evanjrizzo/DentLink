import { webcrypto } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { hashPassword, hashSessionToken } from "./auth";
import { D1DentLinkStore } from "./d1-storage";
import { handleApiRequest } from "./index";
import { SqliteD1TestDatabase } from "./sqlite-d1-test";
import { MemoryDentLinkStore, type DentLinkStore } from "./storage";

import type {
  ApiErrorBody,
  AuthSession,
  ConflictResponse,
  Notification,
  Note,
  NoteHistoryEvent,
  NotesList,
  SyncResponse,
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
      const db = new SqliteD1TestDatabase([schemaPath, milestone2SchemaPath]);
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

async function requestJson<T>(
  store: DentLinkStore,
  method: string,
  path: string,
  body?: unknown,
  token?: string,
  expectedStatus = 200
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
    { store }
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
