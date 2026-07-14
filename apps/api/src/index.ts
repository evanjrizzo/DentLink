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
  parseCredentials,
  parseConflictResolution,
  parseCursor,
  parseExpectedVersion,
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

import type { AuthSession, NoteConflict } from "@dentlink/item-model";

export type ApiEnv = {
  store?: DentLinkStore;
  DB?: D1DatabaseLike;
  DENTLINK_ENV?: string;
  ALLOWED_ORIGINS?: string;
  DENTLINK_BUILD_ID?: string;
};

const defaultStore = new MemoryDentLinkStore();

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
    if (caught instanceof StoreError) {
      const status =
        caught.code === "not_found"
          ? 404
          : caught.code === "invalid_cursor"
            ? 400
            : caught.code === "rate_limited"
              ? 429
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
  }
};

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

function webhookIngestUrl(url: URL, slug: string): string {
  return `${url.origin}/v1/ingest/webhooks/${slug}`;
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
