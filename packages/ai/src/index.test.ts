import { describe, expect, it } from "vitest";

import { aiPackage } from "./index";

describe("@dentlink/ai", () => {
  it("declares the AI package boundary", () => {
    expect(aiPackage.name).toBe("@dentlink/ai");
  });
});
