import { dentLinkWidgetTokens } from "@dentlink/design-tokens";
import type { CalendarEvent, Note, Notification } from "@dentlink/item-model";

export type DentLinkWidgetTabId = "calendar" | "notes" | "emails";

export type DentLinkWidgetTab = {
  id: DentLinkWidgetTabId;
  label: string;
  desktopView: "agenda" | "notes" | "notifications";
};

export const dentLinkWidgetTabs = [
  {
    id: "calendar",
    label: "Calendar",
    desktopView: "agenda"
  },
  {
    id: "notes",
    label: "Notes",
    desktopView: "notes"
  },
  {
    id: "emails",
    label: "Emails",
    desktopView: "notifications"
  }
] as const satisfies readonly DentLinkWidgetTab[];

export const dentLinkWidgetVisualContract = {
  brand: dentLinkWidgetTokens.brand,
  colors: dentLinkWidgetTokens.colors,
  radius: dentLinkWidgetTokens.radius,
  typography: dentLinkWidgetTokens.typography
} as const;

export function selectCalendarWidgetEvents(
  events: readonly CalendarEvent[],
  options: { now?: string; limit?: number } = {}
): CalendarEvent[] {
  const now = options.now ?? new Date().toISOString();
  const limit = options.limit ?? 5;

  return [...events]
    .filter((event) => event.status === "active" && event.endAt >= now)
    .sort(
      (left, right) =>
        left.startAt.localeCompare(right.startAt) || left.title.localeCompare(right.title)
    )
    .slice(0, limit);
}

export function selectNotesWidgetItems(
  notes: readonly Note[],
  options: { limit?: number } = {}
): Note[] {
  const limit = options.limit ?? 5;

  return [...notes]
    .filter((note) => note.status === "active")
    .sort(
      (left, right) =>
        Number(right.pinned) - Number(left.pinned) ||
        right.globalOrder - left.globalOrder ||
        (left.dueAt ?? "9999-12-31T23:59:59.999Z").localeCompare(
          right.dueAt ?? "9999-12-31T23:59:59.999Z"
        ) ||
        left.title.localeCompare(right.title)
    )
    .slice(0, limit);
}

export function selectEmailWidgetNotifications(
  notifications: readonly Notification[],
  options: { limit?: number } = {}
): Notification[] {
  const limit = options.limit ?? 5;

  return [...notifications]
    .filter((notification) => notification.status === "active")
    .sort(comparePriorityInboxNotifications)
    .slice(0, limit);
}

function comparePriorityInboxNotifications(left: Notification, right: Notification): number {
  return (
    Number(right.pinned) - Number(left.pinned) ||
    right.globalOrder - left.globalOrder ||
    right.rank - left.rank ||
    right.createdAt.localeCompare(left.createdAt) ||
    left.title.localeCompare(right.title)
  );
}
