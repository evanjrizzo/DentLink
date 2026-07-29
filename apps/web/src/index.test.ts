import { describe, expect, it } from "vitest";

import {
  connectorReconnectWarningsForTest,
  DentLinkNotesApp,
  gmailSelectedEngineForTest,
  nextScheduledSyncLabel,
  reconnectWarningExtraTextForTest
} from "./notes-app";

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

  it("describes Gmail accounts that require reconnect", () => {
    const warnings = connectorReconnectWarningsForTest([
      {
        id: "account_1",
        connectorKey: "gmail",
        displayName: "Gmail",
        status: "connected",
        settings: {
          googleEmail: "office@example.com",
          gmailReconnectRequired: true,
          gmailIngestionEngine: "gmail_api"
        },
        errorMessage: "Reconnect Gmail to grant mail access."
      } as never
    ]);

    expect(warnings).toEqual([
      {
        accountId: "account_1",
        title: "Gmail (office@example.com) needs to be reconnected",
        message: "Reconnect Gmail to grant mail access."
      }
    ]);
  });

  it("describes non-Gmail connector errors that require reconnect", () => {
    const warnings = connectorReconnectWarningsForTest([
      {
        id: "calendar_1",
        connectorKey: "google-calendar",
        displayName: "Google Calendar",
        status: "error",
        credentialStatus: "configured",
        settings: { googleEmail: "frontdesk@example.com" },
        errorMessage: null
      } as never
    ]);

    expect(warnings[0]).toMatchObject({
      accountId: "calendar_1",
      title: "Google Calendar (frontdesk@example.com) needs to be reconnected",
      message:
        "Google Calendar (frontdesk@example.com) cannot sync until you reconnect this source."
    });
  });

  it("names additional accounts in the reconnect header summary", () => {
    expect(
      reconnectWarningExtraTextForTest([
        { title: "Gmail (office@example.com) needs to be reconnected" },
        { title: "Google Calendar (frontdesk@example.com) needs to be reconnected" },
        { title: "Gmail (billing@example.com) needs to be reconnected" }
      ])
    ).toBe("Google Calendar (frontdesk@example.com), Gmail (billing@example.com)");
  });
});
