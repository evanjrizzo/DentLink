import { describe, expect, it } from "vitest";

import { DentLinkNotesApp } from "./notes-app";

describe("@dentlink/web", () => {
  it("exports the notes app shell", () => {
    expect(DentLinkNotesApp).toBeTypeOf("function");
  });
});
