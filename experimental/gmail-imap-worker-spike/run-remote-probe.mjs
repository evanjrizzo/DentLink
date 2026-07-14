#!/usr/bin/env node

const endpoint = process.env.SPIKE_RUN_URL;
const adminKey = process.env.SPIKE_ADMIN_KEY;
const runs = Number(process.env.SPIKE_RUNS || "10");

if (!endpoint || !adminKey) {
  console.error("SPIKE_RUN_URL and SPIKE_ADMIN_KEY are required");
  process.exit(1);
}

const results = [];
for (let index = 0; index < runs; index += 1) {
  const started = Date.now();
  try {
    const response = await fetch(endpoint, {
      headers: { authorization: `Bearer ${adminKey}` }
    });
    const payload = await response.json();
    results.push({
      run: index + 1,
      ok: Boolean(payload.ok),
      status: response.status,
      stage: payload.stage ?? payload.error?.stage ?? "unknown",
      totalMs: payload.timings?.totalMs ?? Date.now() - started,
      connectMs: payload.timings?.connectMs ?? null,
      authMs: payload.timings?.authenticateMs ?? null,
      searchMs: payload.timings?.searchMs ?? null,
      fetchHeadersMs: payload.timings?.fetchHeadersMs ?? null,
      fetchMimeMs: payload.timings?.fetchMimeMs ?? null,
      uidCount: payload.uidCount ?? null,
      messageCount: payload.messageCount ?? null,
      fullMimeFetched: Boolean(payload.fullMimeFetched),
      identifiers: payload.identifiers ?? null,
      errorCode: payload.error?.code ?? null
    });
  } catch (error) {
    results.push({
      run: index + 1,
      ok: false,
      status: 0,
      stage: "client_request",
      totalMs: Date.now() - started,
      connectMs: null,
      authMs: null,
      searchMs: null,
      fetchHeadersMs: null,
      fetchMimeMs: null,
      uidCount: null,
      messageCount: null,
      fullMimeFetched: false,
      identifiers: null,
      errorCode: error instanceof Error ? error.name : "request_failed"
    });
  }
}

const successful = results.filter((result) => result.ok);
const totals = successful.map((result) => Number(result.totalMs)).filter(Number.isFinite);
const averageTotalMs =
  totals.length > 0
    ? Math.round((totals.reduce((sum, value) => sum + value, 0) / totals.length) * 100) / 100
    : null;

console.log(
  JSON.stringify(
    {
      endpoint,
      runs,
      successful: successful.length,
      failed: results.length - successful.length,
      averageTotalMs,
      results
    },
    null,
    2
  )
);
