import { generateSessionToken, hashPassword, hashSessionToken, verifyPassword } from "./auth";
import { MemoryDentLinkStore, StoreError, type DentLinkStore } from "./storage";
import {
  parseCredentials,
  parseConflictResolution,
  parseCursor,
  parseExpectedVersion,
  parseName,
  parseNoteInput,
  parseNotePatch,
  parseReorder,
  parseSearch,
  ValidationError
} from "./validation";

import type { AuthSession, NoteConflict } from "@dentlink/item-model";

export type ApiEnv = {
  store?: DentLinkStore;
};

const defaultStore = new MemoryDentLinkStore();

export async function handleApiRequest(request: Request, env: ApiEnv = {}): Promise<Response> {
  const store = env.store ?? defaultStore;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const now = new Date().toISOString();

  try {
    if (method === "POST" && path === "/v1/auth/register") {
      const credentials = parseCredentials(await readJson(request));
      const password = await hashPassword(credentials.password);
      const user = store.createUser({ email: credentials.email, password });
      const token = generateSessionToken();
      const session = store.createSession(
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
      const user = store.findUserByEmail(credentials.email);
      if (!user || !(await verifyPassword(credentials.password, user.password))) {
        return error("invalid_credentials", "Email or password is incorrect", 401);
      }
      const token = generateSessionToken();
      const session = store.createSession(
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

    const token = bearerToken(request);
    const tokenHash = token ? await hashSessionToken(token) : null;
    const auth = tokenHash ? store.findSessionByTokenHash(tokenHash, now) : null;
    if (method === "GET" && path === "/v1/auth/session") {
      if (!auth) return error("unauthorized", "Authentication required", 401);
      return json(auth);
    }
    if (method === "POST" && path === "/v1/auth/logout") {
      if (tokenHash) store.deleteSessionByTokenHash(tokenHash);
      return json({ ok: true });
    }
    if (!auth) return error("unauthorized", "Authentication required", 401);

    if (method === "GET" && path === "/v1/notes") {
      return json(
        store.listNotes(auth.user.id, {
          search: parseSearch(url.searchParams.get("search")),
          folderId: url.searchParams.get("folderId") ?? undefined,
          tagIds: url.searchParams.getAll("tagId")
        })
      );
    }
    if (method === "POST" && path === "/v1/notes") {
      return json(
        store.createNote(auth.user.id, parseNoteInput(await readJson(request)), now),
        201
      );
    }
    if (method === "POST" && path === "/v1/notes/reorder") {
      return noteResult(
        store.reorderNotes(auth.user.id, parseReorder(await readJson(request)), now)
      );
    }

    const noteMatch = path.match(/^\/v1\/notes\/([^/]+)$/);
    if (noteMatch && method === "PATCH") {
      const { expectedVersion, patch } = parseNotePatch(await readJson(request));
      return noteResult(
        store.updateNote(auth.user.id, noteMatch[1] ?? "", expectedVersion, patch, now)
      );
    }
    if (noteMatch && method === "DELETE") {
      return noteResult(
        store.deleteNote(
          auth.user.id,
          noteMatch[1] ?? "",
          parseExpectedVersion(await readJson(request)),
          now
        )
      );
    }

    if (method === "POST" && path === "/v1/folders") {
      return json(store.createFolder(auth.user.id, parseName(await readJson(request)), now), 201);
    }
    if (method === "POST" && path === "/v1/tags") {
      return json(store.createTag(auth.user.id, parseName(await readJson(request)), now), 201);
    }
    if (method === "GET" && path === "/v1/sync") {
      return json(store.sync(auth.user.id, parseCursor(url.searchParams.get("cursor"))));
    }
    const historyMatch = path.match(/^\/v1\/notes\/([^/]+)\/history$/);
    if (historyMatch && method === "GET") {
      return json({ history: store.listHistory(auth.user.id, historyMatch[1] ?? "") });
    }
    if (method === "GET" && path === "/v1/conflicts") {
      return json(store.listConflicts(auth.user.id).map((conflict) => ({ conflict })));
    }
    const conflictMatch = path.match(/^\/v1\/conflicts\/([^/]+)\/resolve$/);
    if (conflictMatch && method === "POST") {
      const body = parseConflictResolution(await readJson(request));
      const conflict = store.resolveConflict(
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
    if (caught instanceof StoreError) {
      const status =
        caught.code === "not_found" ? 404 : caught.code === "invalid_cursor" ? 400 : 409;
      return error(caught.code, caught.message, status);
    }
    return error("internal_error", "Unexpected server error", 500);
  }
}

export const apiAppBoundary = {
  name: "@dentlink/api",
  responsibility: "Backend API and ingestion boundary"
} as const;

function noteResult(value: unknown): Response {
  if (isConflict(value)) return json({ conflict: value }, 409);
  return json(value);
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

function sessionExpiry(now: string): string {
  return new Date(new Date(now).getTime() + 1000 * 60 * 60 * 24 * 30).toISOString();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function error(code: string, message: string, status: number): Response {
  return json(
    {
      error: {
        code,
        message,
        requestId: crypto.randomUUID()
      }
    },
    status
  );
}

export type { AuthSession };
