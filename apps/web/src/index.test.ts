import { describe, expect, it } from "vitest";

import { DentLinkNotesApp, gmailSelectedEngineForTest, nextScheduledSyncLabel } from "./notes-app";

describe("@dentlink/web", () => {
  it("exports the notes app shell", () => {
    expect(DentLinkNotesApp).toBeTypeOf("function");
  });

  it("does not show a past next scheduled sync time", () => {
    const now = new Date("2026-07-16T12:00:00.000Z");

    expect(nextScheduledSyncLabel(null, now)).toBe("Within 5 minutes after activation");
    expect(nextScheduledSyncLabel("not-a-date", now)).toBe("Within 5 minutes after activation");
    expect(nextScheduledSyncLabel("2026-07-16T11:54:59.000Z", now)).toBe("Due now");
    expect(nextScheduledSyncLabel("2026-07-16T11:58:00.000Z", now)).not.toBe("Due now");
  });

  it("prefers explicit Gmail requested engine over active engine", () => {
    expect(
      gmailSelectedEngineForTest({
        requestedEngine: "gmail_imap",
        activeEngine: "gmail_api",
        settings: { gmailIngestionEngine: "gmail_api" }
      } as never)
    ).toBe("gmail_imap");
  });
});
