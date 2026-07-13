import { describe, expect, it } from "vitest";

import { syncEnginePackage } from "./index";

describe("@dentlink/sync-engine", () => {
  it("declares the sync-engine package boundary", () => {
    expect(syncEnginePackage.name).toBe("@dentlink/sync-engine");
  });
});
