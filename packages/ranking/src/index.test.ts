import { describe, expect, it } from "vitest";

import { rankingPackage } from "./index";

describe("@dentlink/ranking", () => {
  it("declares the ranking package boundary", () => {
    expect(rankingPackage.name).toBe("@dentlink/ranking");
  });
});
