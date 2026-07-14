export type EntityId = string;
export type IsoDateTime = string;

export type User = {
  id: EntityId;
  email: string;
  createdAt: IsoDateTime;
};

export type Session = {
  id: EntityId;
  userId: EntityId;
  expiresAt: IsoDateTime;
  createdAt: IsoDateTime;
};

export type AuthSession = {
  user: User;
  session: {
    token: string;
    expiresAt: IsoDateTime;
  };
};

export type CurrentSession = {
  user: User;
  session: {
    expiresAt: IsoDateTime;
  };
};

export type NoteKind = "task" | "reference";
export type NoteStatus = "active" | "done" | "deleted";
export type NotePriority = "none" | "low" | "medium" | "high";
export type NotificationStatus = "active" | "done" | "dismissed" | "deleted";
export type NotificationSeverity = "info" | "low" | "medium" | "high";
export type ConflictStatus = "open" | "resolved";
export type ConflictResolution = "keep_mine" | "keep_theirs" | "merge" | "keep_both";
export type WebhookDestination = "notification" | "note";

export type Folder = {
  id: EntityId;
  userId: EntityId;
  name: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type Tag = {
  id: EntityId;
  userId: EntityId;
  name: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type Note = {
  id: EntityId;
  userId: EntityId;
  kind: NoteKind;
  title: string;
  body: string;
  folderId: EntityId | null;
  tags: Tag[];
  dueAt: IsoDateTime | null;
  priority: NotePriority;
  pinned: boolean;
  status: NoteStatus;
  globalOrder: number;
  sourceUrl: string | null;
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  completedAt: IsoDateTime | null;
};

export type NoteInput = {
  kind: NoteKind;
  title: string;
  body?: string;
  folderId?: EntityId | null;
  tagIds?: EntityId[];
  dueAt?: IsoDateTime | null;
  priority?: NotePriority;
  pinned?: boolean;
  sourceUrl?: string | null;
};

export type NotePatch = Partial<NoteInput> & {
  status?: NoteStatus;
  globalOrder?: number;
};

export type NoteHistoryAction =
  | "created"
  | "updated"
  | "done"
  | "reopened"
  | "deleted"
  | "reordered"
  | "conflict_created"
  | "conflict_resolved";

export type NoteHistoryEvent = {
  id: EntityId;
  noteId: EntityId;
  userId: EntityId;
  action: NoteHistoryAction;
  version: number;
  snapshot: Note;
  createdAt: IsoDateTime;
};

export type NoteConflict = {
  id: EntityId;
  userId: EntityId;
  noteId: EntityId;
  expectedVersion: number;
  actualVersion: number;
  attemptedPatch: NotePatch;
  serverNote: Note;
  status: ConflictStatus;
  version: number;
  createdAt: IsoDateTime;
  resolvedAt: IsoDateTime | null;
  resolution: ConflictResolution | null;
};

export type NotesList = {
  notes: Note[];
  folders: Folder[];
  tags: Tag[];
};

export type Notification = {
  id: EntityId;
  userId: EntityId;
  title: string;
  summary: string;
  body: string;
  source: "webhook" | "manual" | "system";
  sourceLabel: string;
  sourceUrl: string | null;
  severity: NotificationSeverity;
  status: NotificationStatus;
  pinned: boolean;
  rank: number;
  globalOrder: number;
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  completedAt: IsoDateTime | null;
  dismissedAt: IsoDateTime | null;
};

export type NotificationInput = {
  title: string;
  summary?: string;
  body?: string;
  sourceUrl?: string | null;
  severity?: NotificationSeverity;
  pinned?: boolean;
  rank?: number;
};

export type NotificationPatch = Partial<NotificationInput> & {
  status?: NotificationStatus;
  globalOrder?: number;
};

export type WebhookEndpoint = {
  id: EntityId;
  userId: EntityId;
  name: string;
  slug: string;
  destination: WebhookDestination;
  enabled: boolean;
  defaultSeverity: NotificationSeverity;
  defaultPriority: NotePriority;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  lastTriggeredAt: IsoDateTime | null;
  version: number;
};

export type WebhookEndpointInput = {
  name: string;
  slug: string;
  destination: WebhookDestination;
  defaultSeverity?: NotificationSeverity;
  defaultPriority?: NotePriority;
  enabled?: boolean;
};

export type WebhookEndpointPatch = Partial<
  Pick<
    WebhookEndpointInput,
    "name" | "destination" | "defaultSeverity" | "defaultPriority" | "enabled"
  >
>;

export type WebhookDelivery = {
  id: EntityId;
  userId: EntityId;
  endpointId: EntityId;
  status: "accepted" | "rejected";
  message: string;
  createdAt: IsoDateTime;
};

export type WebhookIngestInput = NotificationInput & {
  kind?: NoteKind;
  priority?: NotePriority;
  dueAt?: IsoDateTime | null;
};

export type NotificationsList = {
  notifications: Notification[];
};

export type WebhooksList = {
  webhooks: Array<WebhookEndpoint & { ingestUrl: string }>;
};

export type SyncCursor = string;

export type SyncChange =
  | { type: "note"; op: "upsert"; note: Note; cursor: SyncCursor }
  | { type: "note"; op: "delete"; id: EntityId; userId: EntityId; cursor: SyncCursor }
  | { type: "folder"; op: "upsert"; folder: Folder; cursor: SyncCursor }
  | { type: "tag"; op: "upsert"; tag: Tag; cursor: SyncCursor }
  | { type: "notification"; op: "upsert"; notification: Notification; cursor: SyncCursor }
  | { type: "notification"; op: "delete"; id: EntityId; userId: EntityId; cursor: SyncCursor }
  | { type: "webhook"; op: "upsert"; webhook: WebhookEndpoint; cursor: SyncCursor }
  | { type: "conflict"; op: "upsert"; conflict: NoteConflict; cursor: SyncCursor };

export type SyncResponse = {
  cursor: SyncCursor;
  changes: SyncChange[];
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
};

export type ConflictResponse = {
  conflict: NoteConflict;
};
