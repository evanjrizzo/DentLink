#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { Buffer } from "node:buffer";
import { TextDecoder, TextEncoder } from "node:util";

const API_BASE_URL =
  process.env.DENTLINK_PREVIEW_API_BASE_URL ??
  "https://dentlink-api-preview.evanjrizzo.workers.dev";
const STATE_PATH =
  process.env.DENTLINK_RETENTION_SMOKE_STATE ?? "/tmp/dentlink-retention-smoke.json";
const command = process.argv[2] ?? "";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const cryptoImpl = webcrypto;

if (!["setup", "wait-deleted", "cleanup"].includes(command)) {
  fail("Usage: node scripts/preview-retention-smoke.mjs <setup|wait-deleted|cleanup>");
}

if (command === "setup") await setup();
if (command === "wait-deleted") await waitDeleted();
if (command === "cleanup") await cleanup();

async function setup() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `retention-smoke-${suffix}@example.test`;
  const auth = await request("/v1/auth/register", {
    method: "POST",
    body: { email, password: "correct horse" },
    expectedStatus: 201
  });
  const token = auth.session.token;
  const created = await request("/v1/notifications", {
    method: "POST",
    token,
    body: {
      title: `Retention smoke ${suffix}`,
      summary: "Disposable encrypted archive retention test",
      body: "This fake notification should restore from archive after D1 deletion."
    },
    expectedStatus: 201
  });
  const done = await request(`/v1/notifications/${created.id}`, {
    method: "PATCH",
    token,
    body: { expectedVersion: created.version, patch: { status: "done" } }
  });
  await createArchiveKeyWrapper(token);
  const archiveKey = await cryptoImpl.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt"
  ]);
  const rawArchiveKey = new Uint8Array(await cryptoImpl.subtle.exportKey("raw", archiveKey));
  const object = await createArchiveObject(token, archiveKey, done);
  const restored = await restoreArchiveObject(token, archiveKey, object.id);
  if (JSON.stringify(restored) !== JSON.stringify(done)) {
    fail("Archive restore did not match the fake notification before verification.");
  }
  const verified = await request(`/v1/archive/objects/${object.id}/verify`, {
    method: "POST",
    token
  });
  if (!verified.object.verifiedAt) fail("Archive object was not marked verified.");
  await setNotificationOld(done.userId, done.id);
  const state = {
    apiBaseUrl: API_BASE_URL,
    email,
    userId: done.userId,
    token,
    notificationId: done.id,
    archiveObjectId: object.id,
    r2Key: `users/${done.userId}/archive/${object.id}.json`,
    rawArchiveKeyB64: bytesToBase64(rawArchiveKey),
    createdAt: new Date().toISOString()
  };
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), { mode: 0o600 });
  await chmod(STATE_PATH, 0o600);
  console.log(
    JSON.stringify(
      {
        ok: true,
        phase: "setup",
        statePath: STATE_PATH,
        userId: state.userId,
        notificationId: state.notificationId,
        archiveObjectId: state.archiveObjectId,
        r2Key: state.r2Key
      },
      null,
      2
    )
  );
}

async function waitDeleted() {
  const state = await readState();
  const archiveKey = await importArchiveKey(state.rawArchiveKeyB64);
  const deadline = Date.now() + 7 * 60_000;
  let listed = null;
  while (Date.now() < deadline) {
    listed = await request("/v1/notifications", { token: state.token });
    if (!listed.notifications.some((notification) => notification.id === state.notificationId)) {
      const restored = await restoreArchiveObject(state.token, archiveKey, state.archiveObjectId);
      if (restored.id !== state.notificationId) {
        fail("Archive restore did not return the deleted fake notification.");
      }
      console.log(
        JSON.stringify(
          {
            ok: true,
            phase: "wait-deleted",
            notificationDeleted: true,
            restoredNotificationId: restored.id,
            archiveObjectId: state.archiveObjectId
          },
          null,
          2
        )
      );
      return;
    }
    await sleep(15_000);
  }
  fail(
    `Timed out waiting for retention to delete ${state.notificationId}; latest count for user was ${
      listed?.notifications?.length ?? "unknown"
    }.`
  );
}

async function cleanup() {
  const state = await readState();
  runWrangler([
    "r2",
    "object",
    "delete",
    `dentlink-user-archive-preview/${state.r2Key}`,
    "--remote"
  ]);
  runWrangler([
    "d1",
    "execute",
    "dentlink-preview",
    "--env",
    "preview",
    "--remote",
    "--command",
    [
      `DELETE FROM user_archive_objects WHERE user_id = '${sqlQuote(state.userId)}';`,
      `DELETE FROM user_archive_key_wrappers WHERE user_id = '${sqlQuote(state.userId)}';`,
      `DELETE FROM sync_changes WHERE user_id = '${sqlQuote(state.userId)}';`,
      `DELETE FROM notifications WHERE user_id = '${sqlQuote(state.userId)}';`,
      `DELETE FROM sessions WHERE user_id = '${sqlQuote(state.userId)}';`,
      `DELETE FROM users WHERE id = '${sqlQuote(state.userId)}';`
    ].join(" ")
  ]);
  console.log(
    JSON.stringify(
      {
        ok: true,
        phase: "cleanup",
        userId: state.userId,
        archiveObjectId: state.archiveObjectId
      },
      null,
      2
    )
  );
}

async function createArchiveKeyWrapper(token) {
  const key = await cryptoImpl.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt"
  ]);
  const wrappingKey = await cryptoImpl.subtle.generateKey({ name: "AES-KW", length: 256 }, true, [
    "wrapKey",
    "unwrapKey"
  ]);
  const rawWrappingKey = new Uint8Array(await cryptoImpl.subtle.exportKey("raw", wrappingKey));
  const wrapped = new Uint8Array(
    await cryptoImpl.subtle.wrapKey("raw", key, wrappingKey, "AES-KW")
  );
  await request("/v1/archive/key-wrappers", {
    method: "POST",
    token,
    expectedStatus: 201,
    body: {
      keyId: "retention-smoke-account-key",
      wrapperType: "retention-smoke",
      wrappingAlgorithm: "AES-KW",
      wrappedKeyB64: bytesToBase64(wrapped),
      saltB64: bytesToBase64(rawWrappingKey.slice(0, 16)),
      publicMetadata: { disposable: true }
    }
  });
}

async function createArchiveObject(token, archiveKey, notification) {
  const plaintext = JSON.stringify({ version: 1, type: "notification", notification });
  const nonce = cryptoImpl.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await cryptoImpl.subtle.encrypt(
      { name: "AES-GCM", iv: arrayBuffer(nonce) },
      archiveKey,
      arrayBuffer(encoder.encode(plaintext))
    )
  );
  const hash = new Uint8Array(await cryptoImpl.subtle.digest("SHA-256", arrayBuffer(ciphertext)));
  const created = await request("/v1/archive/objects", {
    method: "POST",
    token,
    expectedStatus: 201,
    body: {
      objectType: "notification",
      sourceEntityType: "notification",
      sourceEntityId: notification.id,
      encryptionAlgorithm: "AES-GCM-256",
      keyId: "retention-smoke-account-key",
      nonceB64: bytesToBase64(nonce),
      ciphertextSha256B64: bytesToBase64(hash),
      ciphertextB64: bytesToBase64(ciphertext),
      publicMetadata: { disposable: true, schema: "dentlink.notification.archive.v1" }
    }
  });
  return created.object;
}

async function restoreArchiveObject(token, archiveKey, objectId) {
  const fetched = await request(`/v1/archive/objects/${objectId}`, { token });
  const plaintext = await cryptoImpl.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: arrayBuffer(base64ToBytes(fetched.envelope.encryption.nonceB64))
    },
    archiveKey,
    arrayBuffer(base64ToBytes(fetched.envelope.ciphertextB64))
  );
  const parsed = JSON.parse(decoder.decode(plaintext));
  if (parsed.type !== "notification" || !parsed.notification) {
    fail("Restored archive payload was not a notification.");
  }
  return parsed.notification;
}

async function setNotificationOld(userId, notificationId) {
  runWrangler([
    "d1",
    "execute",
    "dentlink-preview",
    "--env",
    "preview",
    "--remote",
    "--command",
    `UPDATE notifications
     SET updated_at = '2026-06-01T00:00:00.000Z',
         completed_at = '2026-06-01T00:00:00.000Z'
     WHERE user_id = '${sqlQuote(userId)}' AND id = '${sqlQuote(notificationId)}';`
  ]);
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  if (response.status !== (options.expectedStatus ?? 200)) {
    const text = await response.text();
    fail(`${options.method ?? "GET"} ${path} returned ${response.status}: ${text}`);
  }
  return response.json();
}

async function readState() {
  return JSON.parse(await readFile(STATE_PATH, "utf8"));
}

async function importArchiveKey(rawB64) {
  return cryptoImpl.subtle.importKey(
    "raw",
    arrayBuffer(base64ToBytes(rawB64)),
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

function runWrangler(args) {
  const result = spawnSync("pnpm", ["exec", "wrangler", ...args], {
    cwd: process.cwd(),
    stdio: "inherit"
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) fail(`wrangler exited with ${result.status}`);
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(value) {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function arrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function sqlQuote(value) {
  return String(value).replaceAll("'", "''");
}

function sleep(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
