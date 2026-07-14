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
});
