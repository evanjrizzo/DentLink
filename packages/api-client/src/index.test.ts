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
});
