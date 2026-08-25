#!/usr/bin/env node

const baseUrl = (
  process.env.DENTLINK_SMOKE_BASE_URL ??
  process.argv[2] ??
  "https://dentlink-api-preview.evanjrizzo.workers.dev"
).replace(/\/$/, "");

const response = await fetch(`${baseUrl}/v1/health`, {
  headers: { Accept: "application/json" }
});
const health = await response.json().catch(() => null);

if (response.status !== 200 || health?.status !== "ok") {
  fail("health endpoint failed", { status: response.status, health });
}

const runtime = health?.database?.connectorRuntime;
if (!runtime) {
  fail("health response is missing database.connectorRuntime", health);
}

if (runtime.status !== "ok") {
  fail("connector runtime health is degraded", runtime);
}

console.log(
  JSON.stringify({
    ok: true,
    baseUrl,
    generatedAt: runtime.generatedAt,
    queue: runtime.queue,
    accounts: runtime.accounts
  })
);

function fail(message, detail) {
  console.error(JSON.stringify({ ok: false, message, detail: redact(detail) }, null, 2));
  process.exit(1);
}

function redact(value) {
  return JSON.parse(
    JSON.stringify(value, (key, innerValue) => {
      if (/token|secret|password|authorization/i.test(key)) return "[redacted]";
      return innerValue;
    })
  );
}
