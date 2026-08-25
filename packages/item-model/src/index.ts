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
export type NotificationStatus = "active" | "suppressed" | "done" | "dismissed" | "deleted";
export type CalendarEventSource = "local" | "google-calendar" | "note";
export type CalendarEventStatus = "active" | "cancelled" | "dismissed" | "deleted";
export type CalendarSourceFilter = "all" | CalendarEventSource;
export type NotificationSeverity = "info" | "low" | "medium" | "high";
export type EmailAiStatus = "disabled" | "pending" | "complete" | "failed" | "skipped";
export type EmailAiCategory =
  "action_required" | "personal" | "work" | "receipt" | "newsletter" | "system" | "other";
export type NotificationSortMode =
  "recommended" | "newest" | "oldest" | "high_priority" | "requires_action" | "deadline_soon";
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
  | "notification_suppressed"
  | "notification_grouped"
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

export type FolderPatch = {
  name?: string;
};

export type Tag = {
  id: EntityId;
  userId: EntityId;
  name: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type TagPatch = {
  name?: string;
};

export type UserPreferences = {
  timezone: {
    mode: "device" | "override";
    detected: string | null;
    selected: string;
  };
  ai: EmailAiPreferenceSettings;
  appearance: AccountAppearancePreference;
};

export type AccountAppearancePreference = {
  profile: Record<string, unknown> | null;
  updatedAt: IsoDateTime | null;
};

export type EmailAiPromptPreset = {
  id: EntityId;
  name: string;
  prompt: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type EmailAiAccountOverride = {
  accountId: EntityId;
  enabled: boolean;
  prompt: string;
  threshold?: number;
};

export type EmailAiPreferenceSettings = {
  globalPrompt: string;
  summaryPrompt: string;
  textReplacements: EmailAiTextReplacement[];
  threshold: number;
  presets: EmailAiPromptPreset[];
  accountOverrides: EmailAiAccountOverride[];
};

export type EmailAiTextReplacement = {
  id: EntityId;
  find: string;
  replace: string;
};

export type UserPreferencesPatch = {
  timezone?: {
    mode?: "device" | "override";
    detected?: string | null;
    selected?: string;
  };
  ai?: Partial<EmailAiPreferenceSettings>;
  appearance?: {
    profile?: Record<string, unknown> | null;
  };
};

export type ArchiveKeyWrapper = {
  id: EntityId;
  keyId: string;
  wrapperType: string;
  wrappingAlgorithm: string;
  wrappedKeyB64: string;
  saltB64: string | null;
  publicMetadata: Record<string, unknown>;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type ArchiveKeyWrapperInput = {
  keyId: string;
  wrapperType: string;
  wrappingAlgorithm: string;
  wrappedKeyB64: string;
  saltB64?: string | null;
  publicMetadata?: Record<string, unknown>;
};

export type ArchiveKeyWrappersList = {
  wrappers: ArchiveKeyWrapper[];
};

export type ArchiveObjectMetadata = {
  id: EntityId;
  objectType: string;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  encryptionAlgorithm: string;
  keyId: string;
  nonceB64: string;
  ciphertextSha256B64: string;
  sizeBytes: number;
  verifiedAt: IsoDateTime | null;
  publicMetadata: Record<string, unknown>;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type ArchiveObjectInput = {
  objectType: string;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  encryptionAlgorithm: string;
  keyId: string;
  nonceB64: string;
  ciphertextSha256B64: string;
  ciphertextB64: string;
  publicMetadata?: Record<string, unknown>;
};

export type ArchiveObjectEnvelope = {
  version: 1;
  id: EntityId;
  objectType: string;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  encryption: {
    algorithm: string;
    keyId: string;
    nonceB64: string;
    ciphertextSha256B64: string;
  };
  ciphertextB64: string;
  createdAt: IsoDateTime;
};

export type ArchiveObjectsList = {
  objects: ArchiveObjectMetadata[];
};

export type ArchiveObjectCreateResponse = {
  object: ArchiveObjectMetadata;
};

export type ArchiveObjectReadResponse = {
  object: ArchiveObjectMetadata;
  envelope: ArchiveObjectEnvelope;
};

export type ArchiveObjectVerifyResponse = {
  object: ArchiveObjectMetadata;
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
  email: NotificationEmailMetadata | null;
  rule: NotificationRuleMetadata | null;
  ai: NotificationAiMetadata;
};

export type EmailAttachmentMetadata = {
  filename: string | null;
  contentType: string;
  disposition: string | null;
  contentId: string | null;
  sizeBytes: number | null;
};

export type NotificationEmailMetadata = {
  accountId: EntityId;
  provider: "gmail";
  providerMessageId: string;
  messageId: string | null;
  xGmMsgId: string | null;
  senderAddress: string;
  senderDisplayName: string;
  recipients: string[];
  subject: string;
  receivedAt: IsoDateTime;
  labels: string[];
  unread: boolean;
  automatedSender: boolean;
  mailingList: boolean;
  attachments: EmailAttachmentMetadata[];
  snippet: string;
  normalizedBodyHash: string | null;
  sourceUrl: string | null;
};

export type NotificationRuleMetadata = {
  ruleId: EntityId | null;
  ruleName: string | null;
  action: GmailRuleAction;
  category: string | null;
  tag: string | null;
  explanation: string;
};

export type NotificationAiMetadata = {
  status: EmailAiStatus;
  model: string | null;
  promptVersion: string | null;
  processedAt: IsoDateTime | null;
  inputChars: number | null;
  outputTokens: number | null;
  contentHash: string | null;
  summary: string | null;
  category: EmailAiCategory | null;
  importance: number | null;
  requiresAction: boolean | null;
  suggestedAction: string | null;
  deadline: string | null;
  reason: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type NotificationInput = {
  title: string;
  summary?: string;
  body?: string;
  sourceUrl?: string | null;
  severity?: NotificationSeverity;
  pinned?: boolean;
  rank?: number;
  email?: NotificationEmailMetadata | null;
  rule?: NotificationRuleMetadata | null;
  ai?: NotificationAiMetadata;
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
  limit: number | null;
  totalReturned: number;
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

export type GmailRuleAction =
  "notify" | "suppress" | "low_priority" | "high_priority" | "assign_category" | "assign_tag";

export type GmailRule = {
  id: EntityId;
  name: string;
  enabled: boolean;
  priority?: number;
  matchMode?: "all" | "any";
  senderAddress?: string;
  senderDomain?: string;
  subjectContains?: string;
  gmailLabel?: string;
  recipient?: string;
  bodyContains?: string;
  hasAttachment?: boolean;
  unread?: boolean;
  automatedSender?: boolean;
  mailingList?: boolean;
  alwaysNotify?: boolean;
  neverNotify?: boolean;
  action: GmailRuleAction;
  category?: string;
  tag?: string;
};

export type GmailRulesResponse = {
  account: ConnectorAccount;
  rules: GmailRule[];
};

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
  progress?: ConnectorSyncProgress;
  outcomes: Array<{
    messageId: EntityId;
    status: Extract<
      ConnectorSourceRecordStatus,
      | "notification_created"
      | "notification_updated"
      | "notification_suppressed"
      | "notification_grouped"
      | "skipped"
      | "duplicate"
      | "filtered"
      | "failed"
    >;
    reason: string;
    recordId: EntityId | null;
  }>;
};

export type ConnectorSyncProgress = {
  discovered: number;
  examined: number;
  remaining: number;
  hasMore: boolean;
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

export type ConnectorSyncAttemptTrigger = "manual" | "scheduled" | "refresh_all" | "backfill";

export type ConnectorSyncAttemptStatus = "success" | "partial" | "failed" | "skipped";

export type ConnectorSyncAttempt = {
  id: EntityId;
  userId: EntityId;
  accountId: EntityId;
  connectorKey: string;
  trigger: ConnectorSyncAttemptTrigger;
  engine: "gmail_api" | "gmail_imap" | "unknown";
  status: ConnectorSyncAttemptStatus;
  startedAt: IsoDateTime;
  completedAt: IsoDateTime;
  durationMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  summary: GmailSyncSummary | null;
  details: Record<string, unknown>;
};

export type ConnectorSyncJobStatus = "queued" | "running" | "succeeded" | "failed" | "skipped";

export type ConnectorSyncJob = {
  id: EntityId;
  userId: EntityId;
  accountId: EntityId;
  connectorKey: string;
  trigger: Extract<ConnectorSyncAttemptTrigger, "manual" | "scheduled" | "refresh_all">;
  status: ConnectorSyncJobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  runAfter: IsoDateTime;
  lockedAt: IsoDateTime | null;
  lockedBy: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  completedAt: IsoDateTime | null;
};

export type ConnectorSyncJobInput = {
  accountId: EntityId;
  trigger: ConnectorSyncJob["trigger"];
  priority?: number;
  runAfter?: IsoDateTime;
  maxAttempts?: number;
};

export type GmailDiagnosticMessage = {
  messageId: EntityId;
  outcome: Extract<
    ConnectorSourceRecordStatus,
    | "notification_created"
    | "notification_updated"
    | "notification_suppressed"
    | "notification_grouped"
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
  attempts: ConnectorSyncAttempt[];
};

export type EmailAiSettings = {
  enabled: boolean;
  available: boolean;
  provider: "openai";
  model: string;
  maxInputChars: number;
  unavailableReason: string | null;
  preferences?: EmailAiPreferenceSettings;
  requestsThisMonth: number;
  inputCharsThisMonth: number;
  outputTokensThisMonth: number;
  failedRequestsThisMonth: number;
  estimatedCostThisMonth: number | null;
};

export type EmailAiReprocessResult = {
  id: EntityId;
  startedAt: IsoDateTime;
  completedAt: IsoDateTime;
  timezone: string;
  day: string;
  status: "success" | "partial" | "failed";
  processed: number;
  updated: number;
  suppressed: number;
  restored: number;
  skipped: number;
  failed: number;
  errors: Array<{
    recordId: EntityId;
    messageId: string;
    code: string;
    message: string;
  }>;
};

export type AssistantChatRequest = {
  message: string;
  timezone?: string;
  archivedNotifications?: AssistantArchivedNotificationContext[];
};

export type AssistantArchivedNotificationContext = {
  id: EntityId;
  title: string;
  summary: string;
  body: string;
  sourceLabel: string;
  severity: NotificationSeverity;
  status: Notification["status"];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  sourceTimestamp: IsoDateTime;
  sourceUrl: string | null;
};

export type AssistantChatSource = {
  id: EntityId;
  kind: "email" | "calendar_event" | "notification";
  title: string;
  subtitle: string;
  timestamp: IsoDateTime | null;
  sourceUrl: string | null;
};

export type AssistantChatResponse = {
  answer: string;
  sources: AssistantChatSource[];
  ai: {
    status: "complete";
    provider: "openai";
    model: string;
    promptVersion: string;
    outputTokens: number | null;
  };
};

export type GoogleCalendarSyncResult = {
  account: ConnectorAccount;
  processed: number;
  upsertedEvents: number;
};

export type ConnectorSyncAllResult = {
  startedAt: IsoDateTime;
  completedAt: IsoDateTime;
  status: "success" | "partial" | "failed";
  connectors: Array<{
    accountId: EntityId;
    provider: string;
    status: "success" | "failed" | "skipped" | "queued";
    engine?: "gmail_api" | "gmail_imap";
    jobId?: EntityId;
    created: number;
    updated: number;
    duplicate: number;
    failed: number;
    progress?: ConnectorSyncProgress;
    message: string | null;
  }>;
};

export type DentLinkChangeEvent = {
  type:
    | "notifications_updated"
    | "calendar_updated"
    | "connectors_updated"
    | "notes_updated"
    | "webhooks_updated"
    | "dentlink_updated";
  source: string;
  accountId: EntityId | null;
  revision: number;
};

export type ConnectorAccountsList = {
  accounts: ConnectorAccount[];
};

export type ClientType = "web" | "desktop" | "mobile" | "widget";

export type ClientFreshnessStatus = "current" | "degraded";

export type ClientFreshness = {
  id: EntityId;
  userId: EntityId;
  clientId: string;
  clientType: ClientType;
  label: string;
  buildId: string | null;
  platform: string | null;
  lastReadAt: IsoDateTime;
  lastReadRevision: SyncCursor;
  lastReadStatus: ClientFreshnessStatus;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  version: number;
};

export type ClientFreshnessInput = {
  clientId: string;
  clientType: ClientType;
  label?: string | null;
  buildId?: string | null;
  platform?: string | null;
  lastReadRevision?: SyncCursor | null;
  lastReadStatus?: ClientFreshnessStatus;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
};

export type ConnectorFreshnessStatus =
  | "fresh"
  | "syncing"
  | "queued"
  | "stale"
  | "failed"
  | "reconnect_required"
  | "unknown";

export type ConnectorFreshness = {
  accountId: EntityId;
  provider: string;
  displayName: string;
  syncStatus: ConnectorSyncStatus;
  healthStatus: ConnectorHealthStatus;
  accountStatus: ConnectorAccountStatus;
  credentialStatus: ConnectorAccount["credentialStatus"];
  freshnessStatus: ConnectorFreshnessStatus;
  lastSuccessfulSyncAt: IsoDateTime | null;
  lastAttemptAt: IsoDateTime | null;
  lastHealthAt: IsoDateTime | null;
  nextAttemptAt: IsoDateTime | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
};

export type DentLinkStatus = {
  serverTime: IsoDateTime;
  backendRevision: SyncCursor;
  buildId: string;
  clientReads: ClientFreshness[];
  connectors: ConnectorFreshness[];
};

export type SyncCursor = string;

export type SyncChange =
  | { type: "note"; op: "upsert"; note: Note; cursor: SyncCursor }
  | { type: "note"; op: "delete"; id: EntityId; userId: EntityId; cursor: SyncCursor }
  | { type: "folder"; op: "upsert"; folder: Folder; cursor: SyncCursor }
  | { type: "folder"; op: "delete"; id: EntityId; userId: EntityId; cursor: SyncCursor }
  | { type: "tag"; op: "upsert"; tag: Tag; cursor: SyncCursor }
  | { type: "tag"; op: "delete"; id: EntityId; userId: EntityId; cursor: SyncCursor }
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
