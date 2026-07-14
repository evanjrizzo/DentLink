#!/usr/bin/env node

const baseUrl = (process.env.DENTLINK_SMOKE_BASE_URL ?? process.argv[2] ?? "").replace(/\/$/, "");

if (!baseUrl) {
  console.error("Set DENTLINK_SMOKE_BASE_URL or pass the API base URL as the first argument.");
  process.exit(1);
}

const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const passwordA = `smoke-a-${runId}`;
const passwordB = `smoke-b-${runId}`;
const emailA = `smoke-a-${runId}@example.invalid`;
const emailB = `smoke-b-${runId}@example.invalid`;

const results = [];

function record(name) {
  results.push(name);
}

async function request(path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.headers ?? {})
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

function assert(condition, message, detail) {
  if (!condition) {
    const suffix = detail ? ` ${JSON.stringify(redact(detail))}` : "";
    throw new Error(`${message}.${suffix}`);
  }
}

function redact(value) {
  return JSON.parse(
    JSON.stringify(value, (key, innerValue) => {
      if (/token|authorization|password/i.test(key)) return "[redacted]";
      return innerValue;
    })
  );
}

async function main() {
  const health = await request("/v1/health");
  assert(health.status === 200 && health.json?.status === "ok", "health failed", health);
  record("health");

  const registeredA = await request("/v1/auth/register", {
    method: "POST",
    body: { email: emailA, password: passwordA }
  });
  assert(
    registeredA.status === 201 && registeredA.json?.session?.token,
    "register failed",
    registeredA
  );
  record("register");

  const loginA = await request("/v1/auth/login", {
    method: "POST",
    body: { email: emailA.toUpperCase(), password: passwordA }
  });
  assert(loginA.status === 200 && loginA.json?.session?.token, "login failed", loginA);
  record("login");
  const tokenA = loginA.json.session.token;

  const session = await request("/v1/auth/session", { headers: auth(tokenA) });
  assert(session.status === 200 && session.json?.user?.email === emailA, "session failed", session);
  record("session");

  const task = await request("/v1/notes", {
    method: "POST",
    headers: auth(tokenA),
    body: { kind: "task", title: `Smoke task ${runId}`, body: "create task", priority: "medium" }
  });
  assert(task.status === 201 && task.json?.id, "task create failed", task);

  const reference = await request("/v1/notes", {
    method: "POST",
    headers: auth(tokenA),
    body: { kind: "reference", title: `Smoke reference ${runId}`, body: "reference body" }
  });
  assert(reference.status === 201 && reference.json?.id, "reference create failed", reference);
  record("notes-create");

  const listed = await request("/v1/notes", { headers: auth(tokenA) });
  assert(
    listed.status === 200 && listed.json?.notes?.some((note) => note.id === task.json.id),
    "list notes failed",
    listed
  );
  record("notes-list");

  const updated = await request(`/v1/notes/${task.json.id}`, {
    method: "PATCH",
    headers: auth(tokenA),
    body: { expectedVersion: task.json.version, patch: { body: "valid update", pinned: true } }
  });
  assert(
    updated.status === 200 && updated.json?.version === task.json.version + 1,
    "update failed",
    updated
  );
  record("notes-update");

  const search = await request(`/v1/notes?search=${encodeURIComponent(runId)}`, {
    headers: auth(tokenA)
  });
  assert(search.status === 200 && search.json?.notes?.length >= 2, "search failed", search);
  record("notes-search");

  const reordered = await request("/v1/notes/reorder", {
    method: "POST",
    headers: auth(tokenA),
    body: {
      noteOrders: [
        { id: updated.json.id, expectedVersion: updated.json.version, globalOrder: 2000 },
        { id: reference.json.id, expectedVersion: reference.json.version, globalOrder: 1000 }
      ]
    }
  });
  assert(reordered.status === 200 && reordered.json?.length === 2, "reorder failed", reordered);
  record("reorder");

  const reorderedTask = reordered.json.find((note) => note.id === updated.json.id);
  const history = await request(`/v1/notes/${updated.json.id}/history`, { headers: auth(tokenA) });
  assert(history.status === 200 && history.json?.history?.length >= 2, "history failed", history);
  record("history");

  const sync = await request("/v1/sync?cursor=0", { headers: auth(tokenA) });
  assert(sync.status === 200 && sync.json?.cursor, "sync failed", sync);
  record("sync");

  const notification = await request("/v1/notifications", {
    method: "POST",
    headers: auth(tokenA),
    body: {
      title: `Smoke notification ${runId}`,
      summary: "notification summary",
      body: "notification body",
      severity: "medium"
    }
  });
  assert(
    notification.status === 201 && notification.json?.id,
    "notification create failed",
    notification
  );

  const pinnedNotification = await request(`/v1/notifications/${notification.json.id}`, {
    method: "PATCH",
    headers: auth(tokenA),
    body: { expectedVersion: notification.json.version, patch: { pinned: true } }
  });
  assert(
    pinnedNotification.status === 200 && pinnedNotification.json?.pinned === true,
    "notification pin failed",
    pinnedNotification
  );

  const doneNotification = await request(`/v1/notifications/${notification.json.id}`, {
    method: "PATCH",
    headers: auth(tokenA),
    body: { expectedVersion: pinnedNotification.json.version, patch: { status: "done" } }
  });
  assert(
    doneNotification.status === 200 && doneNotification.json?.status === "done",
    "notification done failed",
    doneNotification
  );

  const notificationReorder = await request("/v1/notifications/reorder", {
    method: "POST",
    headers: auth(tokenA),
    body: {
      noteOrders: [
        {
          id: doneNotification.json.id,
          expectedVersion: doneNotification.json.version,
          globalOrder: 1000
        }
      ]
    }
  });
  assert(
    notificationReorder.status === 200 &&
      notificationReorder.json?.[0]?.id === doneNotification.json.id,
    "notification reorder failed",
    notificationReorder
  );
  record("notifications");

  const webhook = await request("/v1/webhooks", {
    method: "POST",
    headers: auth(tokenA),
    body: {
      name: `Smoke webhook ${runId}`,
      slug: `smoke-${runId}`,
      destination: "notification",
      defaultSeverity: "high"
    }
  });
  assert(
    webhook.status === 201 &&
      webhook.json?.secret?.startsWith("webhook_") &&
      webhook.json?.webhook?.ingestUrl,
    "webhook create failed",
    webhook
  );

  const deliveredWebhook = await request(`/v1/ingest/webhooks/smoke-${runId}`, {
    method: "POST",
    headers: { "X-DentLink-Webhook-Secret": webhook.json.secret },
    body: { title: `Webhook notification ${runId}`, summary: "delivered from smoke test" }
  });
  assert(
    deliveredWebhook.status === 202 && deliveredWebhook.json?.notification?.title?.includes(runId),
    "webhook delivery failed",
    deliveredWebhook
  );
  const webhookList = await request("/v1/webhooks", { headers: auth(tokenA) });
  assert(
    webhookList.status === 200 && !JSON.stringify(webhookList.json).includes(webhook.json.secret),
    "webhook list exposed secret",
    webhookList
  );
  record("webhooks");

  const conflict = await request(`/v1/notes/${updated.json.id}`, {
    method: "PATCH",
    headers: auth(tokenA),
    body: { expectedVersion: updated.json.version, patch: { title: "stale title" } }
  });
  assert(conflict.status === 409 && conflict.json?.conflict?.id, "stale conflict failed", conflict);
  record("conflict-create");

  const resolved = await request(`/v1/conflicts/${conflict.json.conflict.id}/resolve`, {
    method: "POST",
    headers: auth(tokenA),
    body: { expectedVersion: conflict.json.conflict.version, resolution: "keep_theirs" }
  });
  assert(
    resolved.status === 200 && resolved.json?.conflict?.status === "resolved",
    "conflict resolve failed",
    resolved
  );
  record("conflict-resolve");

  const registeredB = await request("/v1/auth/register", {
    method: "POST",
    body: { email: emailB, password: passwordB }
  });
  assert(
    registeredB.status === 201 && registeredB.json?.session?.token,
    "second user register failed",
    registeredB
  );
  const tokenB = registeredB.json.session.token;

  const crossList = await request("/v1/notes", { headers: auth(tokenB) });
  assert(
    crossList.status === 200 && !JSON.stringify(crossList.json).includes(updated.json.id),
    "cross-user list leaked data",
    crossList
  );
  const crossUpdate = await request(`/v1/notes/${updated.json.id}`, {
    method: "PATCH",
    headers: auth(tokenB),
    body: { expectedVersion: reorderedTask.version, patch: { title: "cross-user" } }
  });
  assert(
    crossUpdate.status === 404,
    "cross-user update did not return safe not found",
    crossUpdate
  );
  const crossHistory = await request(`/v1/notes/${updated.json.id}/history`, {
    headers: auth(tokenB)
  });
  assert(
    crossHistory.status === 200 && crossHistory.json?.history?.length === 0,
    "cross-user history leaked",
    crossHistory
  );
  const crossConflicts = await request("/v1/conflicts", { headers: auth(tokenB) });
  assert(
    crossConflicts.status === 200 && crossConflicts.json?.length === 0,
    "cross-user conflicts leaked",
    crossConflicts
  );
  const crossSync = await request("/v1/sync?cursor=0", { headers: auth(tokenB) });
  assert(
    crossSync.status === 200 && !JSON.stringify(crossSync.json).includes(updated.json.id),
    "cross-user sync leaked",
    crossSync
  );
  const crossWebhookUpdate = await request(`/v1/webhooks/${webhook.json.webhook.id}`, {
    method: "PATCH",
    headers: auth(tokenB),
    body: { expectedVersion: webhook.json.webhook.version, patch: { enabled: false } }
  });
  assert(
    crossWebhookUpdate.status === 404,
    "cross-user webhook update did not return safe not found",
    crossWebhookUpdate
  );
  record("authorization");

  const beforeDeleteCursor = sync.json.cursor;
  const deleted = await request(`/v1/notes/${updated.json.id}`, {
    method: "DELETE",
    headers: auth(tokenA),
    body: { expectedVersion: reorderedTask.version }
  });
  assert(deleted.status === 200 && deleted.json?.status === "deleted", "delete failed", deleted);
  const deleteSync = await request(`/v1/sync?cursor=${encodeURIComponent(beforeDeleteCursor)}`, {
    headers: auth(tokenA)
  });
  assert(
    deleteSync.status === 200 &&
      deleteSync.json?.changes?.some(
        (change) =>
          change.type === "note" && change.op === "delete" && change.id === updated.json.id
      ),
    "delete tombstone missing",
    deleteSync
  );
  record("delete-tombstone");

  const logout = await request("/v1/auth/logout", { method: "POST", headers: auth(tokenA) });
  assert(logout.status === 200, "logout failed", logout);
  const afterLogout = await request("/v1/auth/session", { headers: auth(tokenA) });
  assert(afterLogout.status === 401, "logged-out token remained usable", afterLogout);
  record("logout");

  console.log(JSON.stringify({ ok: true, baseUrl, checks: results }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
