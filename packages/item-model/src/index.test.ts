import { describe, expect, it } from "vitest";

import { itemModelPackage } from "./index";

describe("@dentlink/item-model", () => {
  it("declares the item-model package boundary", () => {
    expect(itemModelPackage.name).toBe("@dentlink/item-model");
  });
});
