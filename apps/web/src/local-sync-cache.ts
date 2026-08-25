import type {
  CalendarEvent,
  CalendarSourceFilter,
  ConnectorAccount,
  EntityId,
  Note,
  NotesList,
  Notification,
  SyncChange,
  SyncCursor,
  WebhookEndpoint
} from "@dentlink/item-model";

export type LocalCalendarQuery = {
  mode: string;
  date: string;
  source: CalendarSourceFilter;
  timeMin: string;
  timeMax: string;
};

export type LocalSyncCacheSnapshot = {
  version: 2;
  userId: EntityId;
  cursor: SyncCursor;
  notesList: NotesList;
  notifications: Notification[];
  calendarEvents: CalendarEvent[];
  calendarQuery: LocalCalendarQuery | null;
  webhooks: Array<WebhookEndpoint & { ingestUrl: string }>;
  connectorAccounts: ConnectorAccount[];
  updatedAt: string;
};

const DB_NAME = "dentlink-local-sync-cache";
const DB_VERSION = 2;
const STORE_NAME = "snapshots";

export function localSyncCacheEnabled(value: unknown): boolean {
  if (typeof value !== "string") return true;
  const normalized = value.trim().toLowerCase();
  return normalized !== "false" && normalized !== "0" && normalized !== "off";
}

export function localSyncCacheSupported(): boolean {
  return typeof indexedDB !== "undefined";
}

export function emptyLocalSyncCacheSnapshot(
  userId: EntityId,
  cursor: SyncCursor,
  now: string
): LocalSyncCacheSnapshot {
  return {
    version: 2,
    userId,
    cursor,
    notesList: { notes: [], folders: [], tags: [] },
    notifications: [],
    calendarEvents: [],
    calendarQuery: null,
    webhooks: [],
    connectorAccounts: [],
    updatedAt: now
  };
}

export function applyLocalSyncChanges(
  snapshot: LocalSyncCacheSnapshot,
  changes: SyncChange[],
  cursor: SyncCursor,
  now: string
): LocalSyncCacheSnapshot {
  let notes = snapshot.notesList.notes;
  let folders = snapshot.notesList.folders;
  let tags = snapshot.notesList.tags;
  let notifications = snapshot.notifications;
  let calendarEvents = snapshot.calendarEvents;
  let webhooks = snapshot.webhooks;
  let connectorAccounts = snapshot.connectorAccounts;

  for (const change of changes) {
    if (change.type === "note") {
      notes =
        change.op === "upsert"
          ? upsertById(notes, change.note)
          : notes.filter((item) => item.id !== change.id);
      continue;
    }
    if (change.type === "folder") {
      folders =
        change.op === "upsert"
          ? upsertById(folders, change.folder)
          : folders.filter((item) => item.id !== change.id);
      continue;
    }
    if (change.type === "tag") {
      tags =
        change.op === "upsert"
          ? upsertById(tags, change.tag)
          : tags.filter((item) => item.id !== change.id);
      continue;
    }
    if (change.type === "notification") {
      notifications =
        change.op === "upsert"
          ? upsertById(notifications, change.notification)
          : notifications.filter((item) => item.id !== change.id);
      continue;
    }
    if (change.type === "calendar_event") {
      calendarEvents =
        change.op === "upsert"
          ? upsertById(calendarEvents, change.event)
          : calendarEvents.filter((item) => item.id !== change.id);
      continue;
    }
    if (change.type === "webhook") {
      webhooks =
        change.op === "upsert"
          ? upsertById(
              webhooks,
              {
                ...change.webhook,
                ingestUrl:
                  webhooks.find((item) => item.id === change.webhook.id)?.ingestUrl ??
                  `${globalThis.location?.origin ?? ""}/v1/ingest/webhooks/${change.webhook.slug}`
              }
            )
          : webhooks.filter((item) => item.id !== change.id);
      continue;
    }
    if (change.type === "connector_account") {
      connectorAccounts =
        change.op === "upsert"
          ? upsertConnectorAccount(connectorAccounts, change.account)
          : connectorAccounts.filter((item) => item.id !== change.id);
    }
  }

  return {
    ...snapshot,
    cursor,
    notesList: {
      notes: sortNotes(notes),
      folders: sortNamed(folders),
      tags: sortNamed(tags)
    },
    notifications: sortNotifications(notifications),
    calendarEvents: sortCalendarEvents(calendarEvents),
    webhooks: sortNamed(webhooks),
    connectorAccounts: sortNamed(connectorAccounts),
    updatedAt: now
  };
}

export async function loadLocalSyncCache(
  userId: EntityId
): Promise<LocalSyncCacheSnapshot | null> {
  if (!localSyncCacheSupported()) return null;
  const db = await openCacheDb();
  return requestToPromise<LocalSyncCacheSnapshot | undefined>(
    db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(userId)
  ).then((snapshot) => (snapshot?.version === 2 && snapshot.userId === userId ? snapshot : null));
}

export async function saveLocalSyncCache(snapshot: LocalSyncCacheSnapshot): Promise<void> {
  if (!localSyncCacheSupported()) return;
  const db = await openCacheDb();
  await requestToPromise(
    db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(snapshot, snapshot.userId)
  );
}

export async function clearLocalSyncCache(userId: EntityId): Promise<void> {
  if (!localSyncCacheSupported()) return;
  const db = await openCacheDb();
  await requestToPromise(
    db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(userId)
  );
}

function upsertById<T extends { id: EntityId; version?: number }>(items: T[], item: T): T[] {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index === -1) return [...items, item];
  const existing = items[index];
  if (existing?.version !== undefined && item.version !== undefined && existing.version > item.version) {
    return items;
  }
  const next = [...items];
  next[index] = item;
  return next;
}

function upsertConnectorAccount(
  items: ConnectorAccount[],
  account: ConnectorAccount
): ConnectorAccount[] {
  const next = upsertById(items, account).filter((item) => item.status !== "deleted");
  return next;
}

function sortNamed<T extends { name?: string; displayName?: string }>(items: T[]): T[] {
  return [...items].sort((left, right) =>
    (left.name ?? left.displayName ?? "").localeCompare(right.name ?? right.displayName ?? "")
  );
}

function sortNotes(notes: Note[]): Note[] {
  return [...notes]
    .filter((note) => note.status !== "deleted")
    .sort(
      (left, right) =>
        Number(right.pinned) - Number(left.pinned) ||
        left.globalOrder - right.globalOrder ||
        right.updatedAt.localeCompare(left.updatedAt)
    );
}

function sortNotifications(notifications: Notification[]): Notification[] {
  return [...notifications]
    .filter((notification) => notification.status !== "deleted")
    .sort(
      (left, right) =>
        Number(right.pinned) - Number(left.pinned) ||
        right.rank - left.rank ||
        left.globalOrder - right.globalOrder ||
        left.updatedAt.localeCompare(right.updatedAt)
    );
}

function sortCalendarEvents(events: CalendarEvent[]): CalendarEvent[] {
  return [...events]
    .filter((event) => event.status !== "deleted")
    .sort((left, right) => left.startAt.localeCompare(right.startAt));
}

function openCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open DentLink cache"));
  });
}

function requestToPromise<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("DentLink cache request failed"));
  });
}
