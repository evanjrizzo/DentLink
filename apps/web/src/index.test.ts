import { describe, expect, it } from "vitest";

import { webAppBoundary } from "./index";

describe("@dentlink/web", () => {
  it("declares the web app boundary", () => {
    expect(webAppBoundary.name).toBe("@dentlink/web");
  });
});
