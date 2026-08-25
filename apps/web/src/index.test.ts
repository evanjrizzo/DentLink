import { describe, expect, it } from "vitest";

import {
  automaticSyncMessage,
  connectorFreshnessForTest,
  connectorReconnectWarningsForTest,
  DentLinkNotesApp,
  filterVisibleNotesForTest,
  gmailSelectedEngineForTest,
  nextScheduledSyncLabel,
  partialReloadMessageForTest,
  reconnectWarningExtraTextForTest,
  sameCalendarQueryForTest
} from "./notes-app";
import { applyLocalSyncChanges, emptyLocalSyncCacheSnapshot } from "./local-sync-cache";

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

  it("summarizes automatic sync outcomes without noisy success text", () => {
    expect(
      automaticSyncMessage({
        startedAt: "2026-07-16T12:00:00.000Z",
        completedAt: "2026-07-16T12:00:01.000Z",
        status: "success",
        connectors: []
      })
    ).toBeNull();

    expect(
      automaticSyncMessage({
        startedAt: "2026-07-16T12:00:00.000Z",
        completedAt: "2026-07-16T12:00:01.000Z",
        status: "success",
        connectors: [
          {
            accountId: "gmail_1",
            provider: "gmail",
            status: "success",
            engine: "gmail_imap",
            created: 1,
            updated: 0,
            duplicate: 0,
            failed: 0,
            progress: { discovered: 5, examined: 1, remaining: 4, hasMore: true },
            message: null
          }
        ]
      })
    ).toBe("Auto sync paused with 4 Gmail messages left.");

    expect(
      automaticSyncMessage({
        startedAt: "2026-07-16T12:00:00.000Z",
        completedAt: "2026-07-16T12:00:01.000Z",
        status: "partial",
        connectors: []
      })
    ).toBe("Auto sync completed with warnings.");
  });

  it("names the sections that did not reload", () => {
    expect(partialReloadMessageForTest(["calendar"])).toBe(
      "Some DentLink data did not reload: calendar."
    );
    expect(partialReloadMessageForTest(["connections", "calendar"])).toBe(
      "Some DentLink data did not reload: connections and calendar."
    );
    expect(partialReloadMessageForTest(["connections", "calendar", "webhooks"])).toBe(
      "Some DentLink data did not reload: connections, calendar, and webhooks."
    );
  });

  it("applies local sync deltas without replacing the whole notification cache", () => {
    const baseNotification = {
      id: "notification_old",
      userId: "user_1",
      title: "Old",
      summary: "Keep this",
      body: "",
      source: "manual",
      sourceLabel: "Manual",
      sourceUrl: null,
      severity: "info",
      status: "active",
      pinned: false,
      rank: 10,
      globalOrder: 1000,
      createdAt: "2026-08-06T19:00:00.000Z",
      updatedAt: "2026-08-06T19:00:00.000Z",
      completedAt: null,
      dismissedAt: null,
      version: 1
    } as any;
    const snapshot = {
      ...emptyLocalSyncCacheSnapshot("user_1", "10", "2026-08-06T20:00:00.000Z"),
      notifications: [
        baseNotification,
        {
          id: "notification_delete",
          userId: "user_1",
          title: "Delete",
          summary: "Remove this",
          body: "",
          source: "manual",
          sourceLabel: "Manual",
          sourceUrl: null,
          severity: "info",
          status: "active",
          pinned: false,
          rank: 1,
          globalOrder: 2000,
          createdAt: "2026-08-06T19:00:00.000Z",
          updatedAt: "2026-08-06T19:00:00.000Z",
          completedAt: null,
          dismissedAt: null,
          version: 1
        } as never
      ]
    };
    const next = applyLocalSyncChanges(
      snapshot,
      [
        {
          type: "notification",
          op: "upsert",
          cursor: "11",
          notification: {
            ...baseNotification,
            title: "Updated",
            updatedAt: "2026-08-06T20:01:00.000Z",
            version: 2
          }
        },
        {
          type: "notification",
          op: "delete",
          id: "notification_delete",
          userId: "user_1",
          cursor: "12"
        }
      ],
      "12",
      "2026-08-06T20:01:00.000Z"
    );

    expect(next.cursor).toBe("12");
    expect(next.notifications.map((notification) => notification.id)).toEqual(["notification_old"]);
    expect(next.notifications[0]?.title).toBe("Updated");
  });

  it("keeps all synced notes while deriving filtered note views locally", () => {
    const notes = [
      {
        id: "note_watch",
        userId: "user_1",
        kind: "task",
        title: "Watch note",
        body: "Synced from webhook",
        folderId: null,
        tags: [],
        dueAt: null,
        priority: "none",
        pinned: true,
        status: "active",
        globalOrder: 1000,
        sourceUrl: null,
        version: 1,
        createdAt: "2026-08-07T05:00:00.000Z",
        updatedAt: "2026-08-07T05:00:00.000Z",
        completedAt: null
      },
      {
        id: "note_tagged",
        userId: "user_1",
        kind: "task",
        title: "Tagged note",
        body: "",
        folderId: null,
        tags: [{ id: "tag_1", userId: "user_1", name: "Office", createdAt: "", updatedAt: "" }],
        dueAt: null,
        priority: "none",
        pinned: false,
        status: "active",
        globalOrder: 2000,
        sourceUrl: null,
        version: 1,
        createdAt: "2026-08-07T04:00:00.000Z",
        updatedAt: "2026-08-07T04:00:00.000Z",
        completedAt: null
      }
    ] as any[];

    expect(filterVisibleNotesForTest(notes, "", null, [])).toHaveLength(2);
    expect(filterVisibleNotesForTest(notes, "", null, ["tag_1"]).map((note) => note.id)).toEqual([
      "note_tagged"
    ]);
    expect(filterVisibleNotesForTest(notes, "watch", null, []).map((note) => note.id)).toEqual([
      "note_watch"
    ]);
  });

  it("requires matching calendar query before using cached events", () => {
    const query = {
      mode: "week",
      date: "2026-08-06",
      source: "all" as const,
      timeMin: "2026-08-02T00:00:00.000Z",
      timeMax: "2026-08-09T00:00:00.000Z"
    };
    expect(sameCalendarQueryForTest(query, { ...query })).toBe(true);
    expect(sameCalendarQueryForTest(query, { ...query, date: "2026-08-07" })).toBe(false);
  });

  it("finds connector freshness by account id", () => {
    expect(
      connectorFreshnessForTest(
        {
          serverTime: "2026-07-14T20:05:00.000Z",
          backendRevision: "7",
          buildId: "api-build",
          clientReads: [],
          connectors: [
            {
              accountId: "account_1",
              provider: "gmail",
              displayName: "Gmail",
              syncStatus: "idle",
              healthStatus: "healthy",
              accountStatus: "connected",
              credentialStatus: "configured",
              freshnessStatus: "fresh",
              lastSuccessfulSyncAt: "2026-07-14T20:04:00.000Z",
              lastAttemptAt: "2026-07-14T20:04:30.000Z",
              lastHealthAt: "2026-07-14T20:04:30.000Z",
              nextAttemptAt: "2026-07-14T20:10:00.000Z",
              lastErrorCode: null,
              lastErrorMessage: null
            }
          ]
        },
        "account_1"
      )
    ).toMatchObject({ accountId: "account_1", freshnessStatus: "fresh" });
    expect(connectorFreshnessForTest(null, "account_1")).toBeNull();
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
