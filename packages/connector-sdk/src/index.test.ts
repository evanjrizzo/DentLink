import { describe, expect, it } from "vitest";

import { connectorByKey, connectorCatalog, connectorSdkPackage } from "./index";

describe("@dentlink/connector-sdk", () => {
  it("declares the connector-sdk package boundary", () => {
    expect(connectorSdkPackage.name).toBe("@dentlink/connector-sdk");
  });

  it("exposes provider-neutral connector definitions without real providers", () => {
    expect(connectorCatalog.map((definition) => definition.key)).toEqual([
      "generic-email",
      "generic-calendar"
    ]);
    expect(connectorByKey("generic-email")?.capabilities).toContain("normalize_notifications");
    expect(connectorByKey("gmail")).toBeNull();
  });
});
