import { webcrypto } from "node:crypto";

import { describe, expect, it } from "vitest";

import { hashPassword, hashSessionToken } from "./auth";
import { handleApiRequest } from "./index";
import { MemoryDentLinkStore } from "./storage";

import type {
  ApiErrorBody,
  AuthSession,
  ConflictResponse,
  Note,
  NoteHistoryEvent,
  NotesList,
  SyncResponse
} from "@dentlink/item-model";

Object.defineProperty(globalThis, "crypto", {
  configurable: true,
  value: webcrypto
});

describe("@dentlink/api milestone 1", () => {
  it("registers, logs in, and returns a session without accepting client user identity", async () => {
    const store = new MemoryDentLinkStore();
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
    const store = new MemoryDentLinkStore();
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

    const sessionKeys = [...debugSessions(store).keys()];
    expect(sessionKeys).not.toContain(auth.session.token);

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
    const user = store.createUser({ email: "expired@example.com", password });
    const expiredToken = "session_expired";
    store.createSession(
      user.id,
      await hashSessionToken(expiredToken),
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z"
    );
    await requestJson<ApiErrorBody>(store, "GET", "/v1/auth/session", undefined, expiredToken, 401);
  });

  it("isolates notes by authenticated session user", async () => {
    const store = new MemoryDentLinkStore();
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
    const store = new MemoryDentLinkStore();
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
    const store = new MemoryDentLinkStore();
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
    const store = new MemoryDentLinkStore();
    const auth = await register(store, "sync@example.com");
    const initial = await requestJson<SyncResponse>(
      store,
      "GET",
      "/v1/sync",
      undefined,
      auth.session.token
    );
    expect(initial.cursor).toBe("2");

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
});

async function register(store: MemoryDentLinkStore, email: string): Promise<AuthSession> {
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
  store: MemoryDentLinkStore,
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
