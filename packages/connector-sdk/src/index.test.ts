import { describe, expect, it } from "vitest";

import { connectorSdkPackage } from "./index";

describe("@dentlink/connector-sdk", () => {
  it("declares the connector-sdk package boundary", () => {
    expect(connectorSdkPackage.name).toBe("@dentlink/connector-sdk");
  });
});
