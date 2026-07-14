import { describe, expect, it } from "vitest";

import type { NoteInput } from "./index";

describe("@dentlink/item-model", () => {
  it("models task and reference note inputs", () => {
    const task: NoteInput = { kind: "task", title: "File insurance", tagIds: [] };
    const reference: NoteInput = { kind: "reference", title: "Policy number" };

    expect(task.kind).toBe("task");
    expect(reference.kind).toBe("reference");
  });
});
