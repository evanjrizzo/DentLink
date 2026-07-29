import { describe, expect, it } from "vitest";

import { DentLinkApiClient } from "./index";

describe("@dentlink/api-client", () => {
  it("sends bearer auth for notes requests", async () => {
    const seenHeaders: string[] = [];
    const client = new DentLinkApiClient({
      token: "session-token",
      fetchImpl: async (_url, init) => {
        seenHeaders.push(new Headers(init?.headers).get("Authorization") ?? "");
        return new Response(JSON.stringify({ notes: [], folders: [], tags: [] }), {
          headers: { "Content-Type": "application/json" }
        });
      }
    });

    await client.listNotes();

    expect(seenHeaders).toEqual(["Bearer session-token"]);
  });

  it("turns conflict payloads into explicit client errors", async () => {
    const client = new DentLinkApiClient({
      fetchImpl: async () =>
        new Response(JSON.stringify({ conflict: { id: "conflict_1" } }), {
          status: 409,
          headers: { "Content-Type": "application/json" }
        })
    });

    await expect(client.updateNote("note_1", 1, { title: "Stale" })).rejects.toMatchObject({
      code: "conflict",
      status: 409
    });
  });

  it("maps fetch rejections to network_unreachable errors", async () => {
    const client = new DentLinkApiClient({
      baseUrl: "https://dentlink-api-preview.evanjrizzo.workers.dev",
      fetchImpl: async (url) => {
        expect(url).toBe(
          "https://dentlink-api-preview.evanjrizzo.workers.dev/v1/connectors/gmail/account_1/engine"
        );
        throw new TypeError("NetworkError when attempting to fetch resource");
      }
    });

    await expect(
      client.updateGmailEngine("account_1", { expectedVersion: 1, engine: "gmail_imap" })
    ).rejects.toMatchObject({
      code: "network_unreachable",
      status: 0,
      message: "DentLink could not reach the preview API. Your request was not saved."
    });
  });

  it("posts Refresh All to the sync-all endpoint", async () => {
    const client = new DentLinkApiClient({
      baseUrl: "https://dentlink-api-preview.evanjrizzo.workers.dev",
      fetchImpl: async (url, init) => {
        expect(url).toBe(
          "https://dentlink-api-preview.evanjrizzo.workers.dev/v1/connectors/sync-all"
        );
        expect(init?.method).toBe("POST");
        return new Response(
          JSON.stringify({
            startedAt: "2026-07-14T20:00:00.000Z",
            completedAt: "2026-07-14T20:00:01.000Z",
            status: "success",
            connectors: []
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    });

    await expect(client.syncAllConnectors()).resolves.toMatchObject({ status: "success" });
  });

  it("loads email AI settings without exposing provider secrets", async () => {
    const client = new DentLinkApiClient({
      fetchImpl: async (url) => {
        expect(url).toBe("/v1/ai/settings");
        return new Response(
          JSON.stringify({
            enabled: false,
            available: false,
            provider: "openai",
            model: "gpt-4.1-mini",
            maxInputChars: 6000,
            unavailableReason: "missing_api_key",
            requestsThisMonth: 0,
            inputCharsThisMonth: 0,
            outputTokensThisMonth: 0,
            failedRequestsThisMonth: 0,
            estimatedCostThisMonth: null
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    });

    await expect(client.getEmailAiSettings()).resolves.toMatchObject({
      enabled: false,
      available: false,
      model: "gpt-4.1-mini"
    });
  });

  it("patches email AI enabled preference", async () => {
    const client = new DentLinkApiClient({
      fetchImpl: async (url, init) => {
        expect(url).toBe("/v1/ai/settings");
        expect(init?.method).toBe("PATCH");
        expect(init?.body).toBe(JSON.stringify({ enabled: false }));
        return new Response(
          JSON.stringify({
            enabled: false,
            available: true,
            provider: "openai",
            model: "gpt-4.1-mini",
            maxInputChars: 6000,
            unavailableReason: null,
            requestsThisMonth: 0,
            inputCharsThisMonth: 0,
            outputTokensThisMonth: 0,
            failedRequestsThisMonth: 0,
            estimatedCostThisMonth: null
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    });

    await expect(client.updateEmailAiSettings({ enabled: false })).resolves.toMatchObject({
      enabled: false,
      available: true
    });
  });

  it("posts assistant chat requests", async () => {
    const client = new DentLinkApiClient({
      fetchImpl: async (url, init) => {
        expect(url).toBe("/v1/assistant/chat");
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe(
          JSON.stringify({ message: "What is this week?", timezone: "America/New_York" })
        );
        return new Response(
          JSON.stringify({
            answer: "You have one event this week.",
            sources: [],
            ai: {
              status: "complete",
              provider: "openai",
              model: "gpt-4.1-mini",
              promptVersion: "assistant-readonly-v1",
              outputTokens: 20
            }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    });

    await expect(
      client.askAssistant({ message: "What is this week?", timezone: "America/New_York" })
    ).resolves.toMatchObject({ answer: "You have one event this week." });
  });

  it("uses archive endpoints for wrapped account keys and encrypted objects", async () => {
    const seen: Array<{ url: string; method: string; body: string | null }> = [];
    const client = new DentLinkApiClient({
      token: "session-token",
      fetchImpl: async (url, init) => {
        seen.push({
          url: String(url),
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null
        });
        if (url === "/v1/archive/key-wrappers" && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              wrapper: {
                id: "wrapper_1",
                keyId: "account-archive-v1",
                wrapperType: "recovery-secret",
                wrappingAlgorithm: "PBKDF2-SHA-256+A256KW",
                wrappedKeyB64: "d3JhcHBlZA==",
                saltB64: "c2FsdA==",
                publicMetadata: {},
                createdAt: "2026-07-29T00:00:00.000Z",
                updatedAt: "2026-07-29T00:00:00.000Z"
              }
            }),
            { headers: { "Content-Type": "application/json" } }
          );
        }
        if (url === "/v1/archive/objects" && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              object: {
                id: "archive_object_1",
                objectType: "notification",
                sourceEntityType: "notification",
                sourceEntityId: "notification_1",
                encryptionAlgorithm: "AES-GCM-256",
                keyId: "account-archive-v1",
                nonceB64: "bm9uY2U=",
                ciphertextSha256B64: "aGFzaA==",
                sizeBytes: 64,
                verifiedAt: null,
                publicMetadata: {},
                createdAt: "2026-07-29T00:00:00.000Z",
                updatedAt: "2026-07-29T00:00:00.000Z"
              }
            }),
            { headers: { "Content-Type": "application/json" } }
          );
        }
        if (url === "/v1/archive/objects/archive_object_1/verify" && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              object: {
                id: "archive_object_1",
                objectType: "notification",
                sourceEntityType: "notification",
                sourceEntityId: "notification_1",
                encryptionAlgorithm: "AES-GCM-256",
                keyId: "account-archive-v1",
                nonceB64: "bm9uY2U=",
                ciphertextSha256B64: "aGFzaA==",
                sizeBytes: 64,
                verifiedAt: "2026-07-29T00:00:00.000Z",
                publicMetadata: {},
                createdAt: "2026-07-29T00:00:00.000Z",
                updatedAt: "2026-07-29T00:00:00.000Z"
              }
            }),
            { headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(JSON.stringify({ wrappers: [], objects: [] }), {
          headers: { "Content-Type": "application/json" }
        });
      }
    });

    await expect(
      client.createArchiveKeyWrapper({
        keyId: "account-archive-v1",
        wrapperType: "recovery-secret",
        wrappingAlgorithm: "PBKDF2-SHA-256+A256KW",
        wrappedKeyB64: "d3JhcHBlZA==",
        saltB64: "c2FsdA=="
      })
    ).resolves.toMatchObject({ wrapper: { keyId: "account-archive-v1" } });
    await expect(
      client.createArchiveObject({
        objectType: "notification",
        sourceEntityType: "notification",
        sourceEntityId: "notification_1",
        encryptionAlgorithm: "AES-GCM-256",
        keyId: "account-archive-v1",
        nonceB64: "bm9uY2U=",
        ciphertextSha256B64: "aGFzaA==",
        ciphertextB64: "Y2lwaGVydGV4dA=="
      })
    ).resolves.toMatchObject({ object: { id: "archive_object_1" } });
    await expect(client.verifyArchiveObject("archive_object_1")).resolves.toMatchObject({
      object: { id: "archive_object_1", verifiedAt: "2026-07-29T00:00:00.000Z" }
    });

    expect(seen.map((request) => `${request.method} ${request.url}`)).toEqual([
      "POST /v1/archive/key-wrappers",
      "POST /v1/archive/objects",
      "POST /v1/archive/objects/archive_object_1/verify"
    ]);
    expect(
      seen.every((request) => request.body === null || !request.body.includes("plaintext"))
    ).toBe(true);
  });
});
