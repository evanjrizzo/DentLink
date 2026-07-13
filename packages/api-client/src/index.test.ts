import { describe, expect, it } from "vitest";

import { apiClientPackage } from "./index";

describe("@dentlink/api-client", () => {
  it("declares the api-client package boundary", () => {
    expect(apiClientPackage.name).toBe("@dentlink/api-client");
  });
});
