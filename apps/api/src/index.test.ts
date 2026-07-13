import { describe, expect, it } from "vitest";

import { apiAppBoundary } from "./index";

describe("@dentlink/api", () => {
  it("declares the API app boundary", () => {
    expect(apiAppBoundary.name).toBe("@dentlink/api");
  });
});
