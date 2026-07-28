import type { CalendarEvent, Note, Notification } from "@dentlink/item-model";
import { describe, expect, it } from "vitest";

import {
  dentLinkWidgetTabs,
  dentLinkWidgetVisualContract,
  selectCalendarWidgetEvents,
  selectEmailWidgetNotifications,
  selectNotesWidgetItems
} from "./index";

describe("@dentlink/mobile widget contract", () => {
  it("defines the requested widget tabs", () => {
    expect(dentLinkWidgetTabs.map((tab) => tab.label)).toEqual(["Calendar", "Notes", "Emails"]);
  });

  it("reuses the DentLink visual contract for widget rendering", () => {
    expect(dentLinkWidgetVisualContract.brand.name).toBe("DentLink");
    expect(dentLinkWidgetVisualContract.brand.logos.dark).toBe("/icons/DentLinkDark.png");
    expect(dentLinkWidgetVisualContract.colors.accent).toBe("#7c3aed");
    expect(dentLinkWidgetVisualContract.brand.fontFamily).toContain("Inter");
  });

  it("selects active events for the Calendar tab", () => {
    const events = [
      calendarEvent({
        id: "past",
        title: "Past",
        startAt: "2026-07-22T10:00:00.000Z",
        endAt: "2026-07-22T11:00:00.000Z"
      }),
      calendarEvent({
        id: "later",
        title: "Later",
        startAt: "2026-07-24T15:00:00.000Z",
        endAt: "2026-07-24T16:00:00.000Z"
      }),
      calendarEvent({
        id: "soon",
        title: "Soon",
        startAt: "2026-07-23T15:00:00.000Z",
        endAt: "2026-07-23T16:00:00.000Z"
      }),
      calendarEvent({
        id: "dismissed",
        title: "Hidden",
        status: "dismissed",
        startAt: "2026-07-23T12:00:00.000Z",
        endAt: "2026-07-23T13:00:00.000Z"
      })
    ];

    expect(
      selectCalendarWidgetEvents(events, { now: "2026-07-23T00:00:00.000Z" }).map(
        (event) => event.id
      )
    ).toEqual(["soon", "later"]);
  });

  it("selects active notes for the Notes tab", () => {
    const notes = [
      note({ id: "low", title: "Low", globalOrder: 10 }),
      note({ id: "done", title: "Done", status: "done", globalOrder: 999 }),
      note({ id: "high", title: "High", globalOrder: 20 }),
      note({ id: "pinned", title: "Pinned", pinned: true, globalOrder: 1 })
    ];

    expect(selectNotesWidgetItems(notes).map((item) => item.id)).toEqual(["pinned", "high", "low"]);
  });

  it("selects active email notifications without calculating rank", () => {
    const notifications = [
      notification({ id: "low", title: "Low", rank: 10, globalOrder: 10 }),
      notification({
        id: "dismissed",
        title: "Dismissed",
        status: "dismissed",
        rank: 999,
        globalOrder: 999
      }),
      notification({ id: "high", title: "High", rank: 20, globalOrder: 20 }),
      notification({ id: "pinned", title: "Pinned", pinned: true, rank: 1, globalOrder: 1 })
    ];

    expect(selectEmailWidgetNotifications(notifications).map((item) => item.id)).toEqual([
      "pinned",
      "high",
      "low"
    ]);
  });
});

function notification(overrides: Partial<Notification>): Notification {
  return {
    id: "notification",
    userId: "user",
    title: "Notification",
    summary: "",
    body: "",
    source: "manual",
    sourceLabel: "Manual",
    sourceUrl: null,
    severity: "info",
    status: "active",
    pinned: false,
    rank: 0,
    globalOrder: 0,
    version: 1,
    createdAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T00:00:00.000Z",
    completedAt: null,
    dismissedAt: null,
    email: null,
    rule: null,
    ai: {
      status: "disabled",
      model: null,
      promptVersion: null,
      processedAt: null,
      inputChars: null,
      outputTokens: null,
      contentHash: null,
      summary: null,
      category: null,
      importance: null,
      requiresAction: null,
      suggestedAction: null,
      deadline: null,
      reason: null,
      errorCode: null,
      errorMessage: null
    },
    ...overrides
  };
}

function note(overrides: Partial<Note>): Note {
  return {
    id: "note",
    userId: "user",
    kind: "task",
    title: "Note",
    body: "",
    folderId: null,
    tags: [],
    dueAt: null,
    priority: "none",
    pinned: false,
    status: "active",
    globalOrder: 0,
    sourceUrl: null,
    version: 1,
    createdAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T00:00:00.000Z",
    completedAt: null,
    ...overrides
  };
}

function calendarEvent(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "event",
    userId: "user",
    source: "local",
    connectorAccountId: null,
    provider: null,
    providerEventId: null,
    calendarId: null,
    calendarSummary: "DentLink Local",
    title: "Event",
    description: "",
    location: null,
    sourceUrl: null,
    startAt: "2026-07-23T10:00:00.000Z",
    endAt: "2026-07-23T11:00:00.000Z",
    startDate: null,
    endDate: null,
    timezone: "America/New_York",
    allDay: false,
    recurrenceRule: null,
    category: null,
    color: null,
    reminderMinutes: null,
    importedUid: null,
    annotation: null,
    status: "active",
    version: 1,
    createdAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T00:00:00.000Z",
    dismissedAt: null,
    ...overrides
  };
}
