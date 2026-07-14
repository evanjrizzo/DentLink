import { describe, expect, it } from "vitest";

import { DentLinkSyncEngine } from "./index";

describe("@dentlink/sync-engine", () => {
  it("advances the cursor after sync", async () => {
    const engine = new DentLinkSyncEngine({
      sync: async () => ({ cursor: "2", changes: [] })
    });

    await engine.pull();

    expect(engine.getCursor()).toBe("2");
  });
});
