import { describe, expect, it } from "vitest";

import { connectorByKey, connectorCatalog, connectorSdkPackage } from "./index";

describe("@dentlink/connector-sdk", () => {
  it("declares the connector-sdk package boundary", () => {
    expect(connectorSdkPackage.name).toBe("@dentlink/connector-sdk");
  });

  it("exposes Gmail as the first provider without adding other providers", () => {
    expect(connectorCatalog.map((definition) => definition.key)).toEqual([
      "gmail",
      "generic-email",
      "generic-calendar"
    ]);
    expect(connectorByKey("gmail")?.capabilities).toContain("normalize_notifications");
    expect(connectorByKey("generic-email")?.capabilities).toContain("normalize_notifications");
    expect(connectorByKey("google-calendar")).toBeNull();
    expect(connectorByKey("outlook")).toBeNull();
    expect(connectorByKey("imap")).toBeNull();
  });
});
