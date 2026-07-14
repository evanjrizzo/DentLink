import { describe, expect, it } from "vitest";

import { connectorByKey, connectorCatalog, connectorSdkPackage } from "./index";

describe("@dentlink/connector-sdk", () => {
  it("declares the connector-sdk package boundary", () => {
    expect(connectorSdkPackage.name).toBe("@dentlink/connector-sdk");
  });

  it("exposes Gmail and Google Calendar without adding out-of-scope providers", () => {
    expect(connectorCatalog.map((definition) => definition.key)).toEqual([
      "gmail",
      "google-calendar",
      "generic-email",
      "generic-calendar"
    ]);
    expect(connectorByKey("gmail")?.capabilities).toContain("normalize_notifications");
    expect(connectorByKey("google-calendar")?.capabilities).toContain("normalize_calendar");
    expect(connectorByKey("generic-email")?.capabilities).toContain("normalize_notifications");
    expect(connectorByKey("outlook")).toBeNull();
    expect(connectorByKey("imap")).toBeNull();
  });
});
