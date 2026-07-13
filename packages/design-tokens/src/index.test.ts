import { describe, expect, it } from "vitest";

import { designTokensPackage } from "./index";

describe("@dentlink/design-tokens", () => {
  it("declares the design-tokens package boundary", () => {
    expect(designTokensPackage.name).toBe("@dentlink/design-tokens");
  });
});
