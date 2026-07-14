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
export type CalendarEventSource = "local" | "google-calendar";
export type CalendarEventStatus = "active" | "cancelled" | "dismissed" | "deleted";
export type CalendarSourceFilter = "all" | CalendarEventSource;
export type NotificationSeverity = "info" | "low" | "medium" | "high";
export type ConflictStatus = "open" | "resolved";
export type ConflictResolution = "keep_mine" | "keep_theirs" | "merge" | "keep_both";
export type WebhookDestination = "notification" | "note";
export type ConnectorKind = "email" | "calendar" | "notification" | "generic";
export type ConnectorAccountStatus = "connected" | "paused" | "error" | "deleted";
export type ConnectorHealthStatus = "unknown" | "healthy" | "degraded" | "error";
export type ConnectorSyncStatus = "idle" | "syncing" | "error";
export type ConnectorSourceRecordType = "email" | "calendar_event" | "notification" | "generic";
export type ConnectorSourceRecordStatus =
  | "pending"
  | "processed"
  | "notification_created"
  | "notification_updated"
  | "skipped"
  | "duplicate"
  | "filtered"
  | "failed";
export type ConnectorCredentialKind = "oauth_refresh_token";

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
  source: "webhook" | "manual" | "system" | "connector";
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

export type CalendarEvent = {
  id: EntityId;
  userId: EntityId;
  source: CalendarEventSource;
  connectorAccountId: EntityId | null;
  provider: "google-calendar" | null;
  providerEventId: string | null;
  calendarId: string | null;
  calendarSummary: string;
  title: string;
  description: string;
  location: string | null;
  sourceUrl: string | null;
  startAt: IsoDateTime;
  endAt: IsoDateTime;
  startDate: string | null;
  endDate: string | null;
  timezone: string | null;
  allDay: boolean;
  recurrenceRule: string | null;
  category: string | null;
  color: string | null;
  reminderMinutes: number | null;
  importedUid: string | null;
  annotation: CalendarEventAnnotation | null;
  status: CalendarEventStatus;
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  dismissedAt: IsoDateTime | null;
};

export type CalendarEventsList = {
  events: CalendarEvent[];
};

export type CalendarEventAnnotation = {
  id: EntityId;
  userId: EntityId;
  eventId: EntityId;
  notes: string;
  pinned: boolean;
  completed: boolean;
  hidden: boolean;
  tagIds: EntityId[];
  tags: Tag[];
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type CalendarEventInput = {
  title: string;
  description?: string;
  startAt: IsoDateTime;
  endAt: IsoDateTime;
  startDate?: string | null;
  endDate?: string | null;
  timezone?: string | null;
  allDay?: boolean;
  location?: string | null;
  sourceUrl?: string | null;
  recurrenceRule?: string | null;
  category?: string | null;
  color?: string | null;
  reminderMinutes?: number | null;
  importedUid?: string | null;
};

export type CalendarEventPatch = Partial<CalendarEventInput> & {
  status?: Extract<CalendarEventStatus, "active" | "dismissed">;
};

export type LocalCalendarEventPatch = Partial<CalendarEventInput> & {
  status?: Extract<CalendarEventStatus, "active" | "deleted">;
};

export type CalendarEventAnnotationPatch = {
  notes?: string;
  pinned?: boolean;
  completed?: boolean;
  hidden?: boolean;
  tagIds?: EntityId[];
};

export type CalendarIcsImportResult = {
  imported: number;
  skippedDuplicates: number;
  events: CalendarEvent[];
  warnings: string[];
};

export type WebhooksList = {
  webhooks: Array<WebhookEndpoint & { ingestUrl: string }>;
};

export type ConnectorAccount = {
  id: EntityId;
  userId: EntityId;
  connectorKey: string;
  displayName: string;
  status: ConnectorAccountStatus;
  healthStatus: ConnectorHealthStatus;
  syncStatus: ConnectorSyncStatus;
  settings: Record<string, string | number | boolean | null>;
  credentialRef: string | null;
  credentialStatus: "not_configured" | "configured";
  syncCursor: string | null;
  lastSyncAt: IsoDateTime | null;
  nextSyncAt: IsoDateTime | null;
  lastHealthAt: IsoDateTime | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  version: number;
};

export type ConnectorAccountInput = {
  connectorKey: string;
  displayName: string;
  settings?: Record<string, string | number | boolean | null>;
  credentialRef?: string | null;
  credentialStatus?: "not_configured" | "configured";
};

export type ConnectorAccountPatch = Partial<
  Pick<
    ConnectorAccount,
    | "displayName"
    | "status"
    | "healthStatus"
    | "syncStatus"
    | "settings"
    | "credentialRef"
    | "credentialStatus"
    | "syncCursor"
    | "lastSyncAt"
    | "nextSyncAt"
    | "lastHealthAt"
    | "errorCode"
    | "errorMessage"
  >
>;

export type ConnectorSourceRecord = {
  id: EntityId;
  userId: EntityId;
  accountId: EntityId;
  connectorKey: string;
  sourceExternalId: string;
  sourceType: ConnectorSourceRecordType;
  payloadHash: string;
  normalizedPayload: Record<string, unknown>;
  status: ConnectorSourceRecordStatus;
  receivedAt: IsoDateTime;
  processedAt: IsoDateTime | null;
  processingReason: string | null;
  errorMessage: string | null;
  version: number;
};

export type ConnectorSourceRecordInput = {
  accountId: EntityId;
  sourceExternalId: string;
  sourceType: ConnectorSourceRecordType;
  payloadHash: string;
  normalizedPayload: Record<string, unknown>;
};

export type ConnectorCredential = {
  id: EntityId;
  userId: EntityId;
  accountId: EntityId;
  connectorKey: string;
  kind: ConnectorCredentialKind;
  encryptedValue: string;
  encryptionVersion: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type ConnectorOAuthState = {
  id: EntityId;
  userId: EntityId;
  stateHash: string;
  connectorKey: string;
  reconnectAccountId: EntityId | null;
  returnTo: string | null;
  createdAt: IsoDateTime;
  expiresAt: IsoDateTime;
};

export type GmailSyncResult = {
  account: ConnectorAccount;
  processed: number;
  createdNotifications: number;
  summary: GmailSyncSummary;
  outcomes: Array<{
    messageId: EntityId;
    status: Extract<
      ConnectorSourceRecordStatus,
      | "notification_created"
      | "notification_updated"
      | "skipped"
      | "duplicate"
      | "filtered"
      | "failed"
    >;
    reason: string;
    recordId: EntityId | null;
  }>;
};

export type GmailSyncSummary = {
  discovered: number;
  examined: number;
  created: number;
  updated: number;
  duplicate: number;
  skipped: number;
  filtered: number;
  failed: number;
};

export type GmailDiagnosticMessage = {
  messageId: EntityId;
  outcome: Extract<
    ConnectorSourceRecordStatus,
    | "notification_created"
    | "notification_updated"
    | "skipped"
    | "duplicate"
    | "filtered"
    | "failed"
  >;
  reason: string;
  processedAt: IsoDateTime | null;
  notificationId: EntityId | null;
  sourceRecordId: EntityId;
};

export type GmailDiagnostics = {
  account: ConnectorAccount;
  summary: GmailSyncSummary;
  messages: GmailDiagnosticMessage[];
};

export type GoogleCalendarSyncResult = {
  account: ConnectorAccount;
  processed: number;
  upsertedEvents: number;
};

export type ConnectorAccountsList = {
  accounts: ConnectorAccount[];
};

export type SyncCursor = string;

export type SyncChange =
  | { type: "note"; op: "upsert"; note: Note; cursor: SyncCursor }
  | { type: "note"; op: "delete"; id: EntityId; userId: EntityId; cursor: SyncCursor }
  | { type: "folder"; op: "upsert"; folder: Folder; cursor: SyncCursor }
  | { type: "tag"; op: "upsert"; tag: Tag; cursor: SyncCursor }
  | { type: "notification"; op: "upsert"; notification: Notification; cursor: SyncCursor }
  | { type: "notification"; op: "delete"; id: EntityId; userId: EntityId; cursor: SyncCursor }
  | { type: "calendar_event"; op: "upsert"; event: CalendarEvent; cursor: SyncCursor }
  | { type: "calendar_event"; op: "delete"; id: EntityId; userId: EntityId; cursor: SyncCursor }
  | { type: "webhook"; op: "upsert"; webhook: WebhookEndpoint; cursor: SyncCursor }
  | { type: "webhook"; op: "delete"; id: EntityId; userId: EntityId; cursor: SyncCursor }
  | { type: "connector_account"; op: "upsert"; account: ConnectorAccount; cursor: SyncCursor }
  | { type: "connector_account"; op: "delete"; id: EntityId; userId: EntityId; cursor: SyncCursor }
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
