import { describe, expect, it } from "vitest";

import { uiPackage } from "./index";

describe("@dentlink/ui", () => {
  it("declares the UI package boundary", () => {
    expect(uiPackage.name).toBe("@dentlink/ui");
  });
});
