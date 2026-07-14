import { describe, expect, it } from "vitest";

import { NotesWorkspace } from "./index";

describe("@dentlink/ui", () => {
  it("exports the notes workspace component", () => {
    expect(NotesWorkspace).toBeTypeOf("function");
  });
});
