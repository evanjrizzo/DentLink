import type {
  ConflictResolution,
  CalendarEventAnnotation,
  CalendarEventAnnotationPatch,
  CalendarEventInput,
  CalendarEvent,
  CalendarEventPatch,
  LocalCalendarEventPatch,
  CalendarSourceFilter,
  ConnectorAccount,
  ConnectorAccountInput,
  ConnectorAccountPatch,
  ConnectorCredential,
  ConnectorCredentialKind,
  ConnectorOAuthState,
  ConnectorSyncAttempt,
  ConnectorSourceRecord,
  ConnectorSourceRecordInput,
  CurrentSession,
  EmailAiSettings,
  EntityId,
  Folder,
  FolderPatch,
  Notification,
  NotificationInput,
  NotificationPatch,
  Note,
  NoteConflict,
  NoteHistoryEvent,
  NoteInput,
  NotePatch,
  Session,
  SyncChange,
  Tag,
  TagPatch,
  User,
  WebhookEndpoint,
  WebhookEndpointInput,
  WebhookEndpointPatch,
  WebhookIngestInput
} from "@dentlink/item-model";

export type PasswordRecord = {
  hash: string;
  salt: string;
  iterations: number;
};

export type CreateUserRecord = {
  email: string;
  password: PasswordRecord;
};

export interface DentLinkStore {
  createUser(input: CreateUserRecord): Promise<User>;
  findUserByEmail(email: string): Promise<(User & { password: PasswordRecord }) | null>;
  createSession(
    userId: EntityId,
    tokenHash: string,
    now: string,
    expiresAt: string
  ): Promise<Session>;
  findSessionByTokenHash(tokenHash: string, now: string): Promise<CurrentSession | null>;
  extendSession(tokenHash: string, expiresAt: string): Promise<void>;
  deleteSessionByTokenHash(tokenHash: string): Promise<void>;
  listNotes(
    userId: EntityId,
    query: { search?: string; folderId?: string; tagIds?: string[] }
  ): Promise<{
    notes: Note[];
    folders: Folder[];
    tags: Tag[];
  }>;
  createNote(userId: EntityId, input: NoteInput, now: string): Promise<Note>;
  updateNote(
    userId: EntityId,
    noteId: EntityId,
    expectedVersion: number,
    patch: NotePatch,
    now: string
  ): Promise<Note | NoteConflict>;
  deleteNote(
    userId: EntityId,
    noteId: EntityId,
    expectedVersion: number,
    now: string
  ): Promise<Note | NoteConflict>;
  reorderNotes(
    userId: EntityId,
    noteOrders: Array<{ id: EntityId; expectedVersion: number; globalOrder: number }>,
    now: string
  ): Promise<Note[] | NoteConflict>;
  createFolder(userId: EntityId, name: string, now: string): Promise<Folder>;
  updateFolder(
    userId: EntityId,
    folderId: EntityId,
    patch: FolderPatch,
    now: string
  ): Promise<Folder>;
  deleteFolder(userId: EntityId, folderId: EntityId, now: string): Promise<void>;
  createTag(userId: EntityId, name: string, now: string): Promise<Tag>;
  updateTag(userId: EntityId, tagId: EntityId, patch: TagPatch, now: string): Promise<Tag>;
  deleteTag(userId: EntityId, tagId: EntityId, now: string): Promise<void>;
  listConnectorAccounts(userId: EntityId): Promise<{ accounts: ConnectorAccount[] }>;
  listConnectorAccountsByKey(connectorKey: string): Promise<ConnectorAccount[]>;
  createConnectorAccount(
    userId: EntityId,
    input: ConnectorAccountInput,
    now: string
  ): Promise<ConnectorAccount>;
  getConnectorAccount(userId: EntityId, accountId: EntityId): Promise<ConnectorAccount | null>;
  updateConnectorAccount(
    userId: EntityId,
    accountId: EntityId,
    expectedVersion: number,
    patch: ConnectorAccountPatch,
    now: string
  ): Promise<ConnectorAccount | null>;
  deleteConnectorAccount(
    userId: EntityId,
    accountId: EntityId,
    expectedVersion: number,
    now: string
  ): Promise<ConnectorAccount | null>;
  createConnectorSourceRecord(
    userId: EntityId,
    input: ConnectorSourceRecordInput,
    now: string
  ): Promise<ConnectorSourceRecord>;
  findConnectorSourceRecord(
    userId: EntityId,
    accountId: EntityId,
    sourceExternalId: string
  ): Promise<ConnectorSourceRecord | null>;
  createConnectorSourceRecordIfAbsent(
    userId: EntityId,
    input: ConnectorSourceRecordInput,
    now: string
  ): Promise<{ record: ConnectorSourceRecord; created: boolean }>;
  updateConnectorSourceRecordProcessing(
    userId: EntityId,
    accountId: EntityId,
    sourceExternalId: string,
    patch: {
      status: ConnectorSourceRecord["status"];
      processingReason: string;
      errorMessage?: string | null;
      normalizedPayload?: Record<string, unknown>;
      payloadHash?: string;
    },
    now: string
  ): Promise<ConnectorSourceRecord>;
  listConnectorSourceRecords(
    userId: EntityId,
    accountId: EntityId,
    limit?: number
  ): Promise<ConnectorSourceRecord[]>;
  createConnectorSyncAttempt(
    userId: EntityId,
    input: Omit<ConnectorSyncAttempt, "id" | "userId">
  ): Promise<ConnectorSyncAttempt>;
  listConnectorSyncAttempts(
    userId: EntityId,
    accountId: EntityId,
    limit?: number
  ): Promise<ConnectorSyncAttempt[]>;
  createConnectorOAuthState(
    userId: EntityId,
    input: {
      stateHash: string;
      connectorKey: string;
      reconnectAccountId?: EntityId | null;
      returnTo?: string | null;
      expiresAt: string;
    },
    now: string
  ): Promise<ConnectorOAuthState>;
  consumeConnectorOAuthState(
    stateHash: string,
    connectorKey: string,
    now: string
  ): Promise<ConnectorOAuthState | null>;
  upsertConnectorCredential(
    userId: EntityId,
    accountId: EntityId,
    input: {
      kind: ConnectorCredentialKind;
      encryptedValue: string;
      encryptionVersion: number;
    },
    now: string
  ): Promise<ConnectorCredential>;
  getConnectorCredential(
    userId: EntityId,
    accountId: EntityId,
    kind: ConnectorCredentialKind
  ): Promise<ConnectorCredential | null>;
  deleteConnectorCredentials(userId: EntityId, accountId: EntityId): Promise<void>;
  listCalendarEvents(
    userId: EntityId,
    query: {
      timeMin: string;
      timeMax: string;
      source?: CalendarSourceFilter;
      includeHidden?: boolean;
    }
  ): Promise<{ events: CalendarEvent[] }>;
  createLocalCalendarEvent(
    userId: EntityId,
    input: CalendarEventInput,
    now: string
  ): Promise<CalendarEvent>;
  getCalendarEvent(userId: EntityId, eventId: EntityId): Promise<CalendarEvent | null>;
  updateLocalCalendarEvent(
    userId: EntityId,
    eventId: EntityId,
    expectedVersion: number,
    patch: LocalCalendarEventPatch,
    now: string
  ): Promise<CalendarEvent>;
  deleteLocalCalendarEvent(
    userId: EntityId,
    eventId: EntityId,
    expectedVersion: number,
    now: string
  ): Promise<CalendarEvent>;
  upsertCalendarEventAnnotation(
    userId: EntityId,
    eventId: EntityId,
    expectedVersion: number | undefined,
    patch: CalendarEventAnnotationPatch,
    now: string
  ): Promise<CalendarEventAnnotation>;
  upsertCalendarEvent(
    userId: EntityId,
    input: Omit<
      CalendarEvent,
      "id" | "userId" | "version" | "createdAt" | "updatedAt" | "dismissedAt" | "annotation"
    >,
    now: string
  ): Promise<{ event: CalendarEvent; created: boolean }>;
  updateCalendarEvent(
    userId: EntityId,
    eventId: EntityId,
    expectedVersion: number,
    patch: CalendarEventPatch,
    now: string
  ): Promise<CalendarEvent>;
  listNotifications(userId: EntityId): Promise<{ notifications: Notification[] }>;
  createNotification(
    userId: EntityId,
    input: NotificationInput & { source?: Notification["source"]; sourceLabel?: string },
    now: string
  ): Promise<Notification>;
  updateNotification(
    userId: EntityId,
    notificationId: EntityId,
    expectedVersion: number,
    patch: NotificationPatch,
    now: string
  ): Promise<Notification>;
  reorderNotifications(
    userId: EntityId,
    notificationOrders: Array<{ id: EntityId; expectedVersion: number; globalOrder: number }>,
    now: string
  ): Promise<Notification[]>;
  recordAiUsage(
    userId: EntityId,
    input: {
      provider: "openai";
      model: string;
      inputChars: number;
      outputTokens?: number | null;
      failed: boolean;
      estimatedCostMicros?: number | null;
    },
    now: string
  ): Promise<void>;
  getAiUsageSettings(
    userId: EntityId,
    config: Pick<
      EmailAiSettings,
      | "enabled"
      | "available"
      | "provider"
      | "model"
      | "maxInputChars"
      | "unavailableReason"
      | "estimatedCostThisMonth"
    >,
    now: string
  ): Promise<EmailAiSettings>;
  getUserPreference(userId: EntityId, key: string): Promise<string | null>;
  setUserPreference(userId: EntityId, key: string, value: string, now: string): Promise<void>;
  createWebhookEndpoint(
    userId: EntityId,
    input: WebhookEndpointInput,
    secretHash: string,
    now: string
  ): Promise<WebhookEndpoint>;
  listWebhookEndpoints(userId: EntityId): Promise<WebhookEndpoint[]>;
  updateWebhookEndpoint(
    userId: EntityId,
    endpointId: EntityId,
    expectedVersion: number,
    patch: WebhookEndpointPatch,
    now: string
  ): Promise<WebhookEndpoint | null>;
  deleteWebhookEndpoint(
    userId: EntityId,
    endpointId: EntityId,
    expectedVersion: number,
    now: string
  ): Promise<WebhookEndpoint | null>;
  deliverWebhook(
    slug: string,
    secretHash: string,
    input: WebhookIngestInput,
    now: string
  ): Promise<{ endpoint: WebhookEndpoint; notification?: Notification; note?: Note } | null>;
  listConflicts(userId: EntityId): Promise<NoteConflict[]>;
  resolveConflict(
    userId: EntityId,
    conflictId: EntityId,
    expectedVersion: number,
    resolution: ConflictResolution,
    now: string
  ): Promise<NoteConflict | null>;
  sync(userId: EntityId, cursor: string): Promise<{ cursor: string; changes: SyncChange[] }>;
  listHistory(userId: EntityId, noteId: EntityId): Promise<NoteHistoryEvent[]>;
}

export class MemoryDentLinkStore implements DentLinkStore {
  private users = new Map<EntityId, User & { password: PasswordRecord }>();
  private usersByEmail = new Map<string, EntityId>();
  private sessions = new Map<string, Session>();
  private notes = new Map<EntityId, Note>();
  private folders = new Map<EntityId, Folder>();
  private tags = new Map<EntityId, Tag>();
  private connectorAccounts = new Map<EntityId, ConnectorAccount>();
  private connectorSourceRecords = new Map<EntityId, ConnectorSourceRecord>();
  private connectorSyncAttempts = new Map<EntityId, ConnectorSyncAttempt>();
  private connectorOAuthStates = new Map<string, ConnectorOAuthState>();
  private connectorCredentials = new Map<EntityId, ConnectorCredential>();
  private calendarEvents = new Map<EntityId, CalendarEvent>();
  private calendarAnnotations = new Map<EntityId, CalendarEventAnnotation>();
  private notifications = new Map<EntityId, Notification>();
  private aiUsage = new Map<
    string,
    {
      id: EntityId;
      userId: EntityId;
      usageDate: string;
      provider: "openai";
      model: string;
      requests: number;
      inputChars: number;
      outputTokens: number;
      failedRequests: number;
      estimatedCostMicros: number | null;
      createdAt: string;
      updatedAt: string;
    }
  >();
  private userPreferences = new Map<string, { userId: EntityId; key: string; value: string }>();
  private webhooks = new Map<EntityId, WebhookEndpoint & { secretHash: string }>();
  private webhookDeliveries: Array<{
    id: EntityId;
    userId: EntityId;
    endpointId: EntityId;
    status: "accepted";
    message: string;
    createdAt: string;
  }> = [];
  private noteTagIds = new Map<EntityId, Set<EntityId>>();
  private conflicts = new Map<EntityId, NoteConflict>();
  private history: NoteHistoryEvent[] = [];
  private changes: SyncChange[] = [];
  private sequence = 0;

  async createUser(input: CreateUserRecord): Promise<User> {
    const email = normalizeEmail(input.email);
    if (this.usersByEmail.has(email)) {
      throw new StoreError("email_exists", "A user with that email already exists");
    }
    const user: User & { password: PasswordRecord } = {
      id: this.nextId("user"),
      email,
      password: input.password,
      createdAt: new Date().toISOString()
    };
    this.users.set(user.id, user);
    this.usersByEmail.set(email, user.id);
    return publicUser(user);
  }

  async findUserByEmail(email: string): Promise<(User & { password: PasswordRecord }) | null> {
    const id = this.usersByEmail.get(normalizeEmail(email));
    const user = id ? this.users.get(id) : undefined;
    return user ? { ...user, password: { ...user.password } } : null;
  }

  async createSession(
    userId: EntityId,
    tokenHash: string,
    now: string,
    expiresAt: string
  ): Promise<Session> {
    const session: Session = { id: this.nextId("session"), userId, createdAt: now, expiresAt };
    this.sessions.set(tokenHash, session);
    return { ...session };
  }

  async findSessionByTokenHash(tokenHash: string, now: string): Promise<CurrentSession | null> {
    const session = this.sessions.get(tokenHash);
    if (!session || session.expiresAt <= now) return null;
    const user = this.users.get(session.userId);
    if (!user) return null;
    return {
      user: publicUser(user),
      session: { expiresAt: session.expiresAt }
    };
  }

  async extendSession(tokenHash: string, expiresAt: string): Promise<void> {
    const session = this.sessions.get(tokenHash);
    if (!session) return;
    session.expiresAt = expiresAt;
  }

  async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }

  async listNotes(
    userId: EntityId,
    query: { search?: string; folderId?: string; tagIds?: string[] }
  ): Promise<{ notes: Note[]; folders: Folder[]; tags: Tag[] }> {
    const search = query.search?.trim().toLowerCase();
    const tagFilter = new Set(query.tagIds ?? []);
    const notes = [...this.notes.values()]
      .filter((note) => note.userId === userId && note.status !== "deleted")
      .filter((note) => !query.folderId || note.folderId === query.folderId)
      .filter((note) => {
        if (!search) return true;
        return `${note.title} ${note.body}`.toLowerCase().includes(search);
      })
      .filter((note) => {
        if (tagFilter.size === 0) return true;
        const ids = this.noteTagIds.get(note.id) ?? new Set();
        return [...tagFilter].every((tagId) => ids.has(tagId));
      })
      .map((note) => this.withTags(note))
      .sort(compareNotes);
    return {
      notes,
      folders: [...this.folders.values()]
        .filter((folder) => folder.userId === userId)
        .sort(compareNames),
      tags: [...this.tags.values()].filter((tag) => tag.userId === userId).sort(compareNames)
    };
  }

  async createNote(userId: EntityId, input: NoteInput, now: string): Promise<Note> {
    const note: Note = {
      id: this.nextId("note"),
      userId,
      kind: input.kind,
      title: input.title.trim(),
      body: input.body?.trim() ?? "",
      folderId: input.folderId ?? null,
      tags: [],
      dueAt: input.dueAt ?? null,
      priority: input.priority ?? "none",
      pinned: input.pinned ?? false,
      status: "active",
      globalOrder: this.nextOrder(userId),
      sourceUrl: input.sourceUrl ?? null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      completedAt: null
    };
    this.assertFolder(userId, note.folderId);
    this.setNoteTags(userId, note.id, input.tagIds ?? []);
    this.notes.set(note.id, note);
    const stored = this.withTags(note);
    this.recordHistory(userId, stored, "created", now);
    this.recordChange({ type: "note", op: "upsert", note: stored, cursor: "0" });
    return stored;
  }

  async updateNote(
    userId: EntityId,
    noteId: EntityId,
    expectedVersion: number,
    patch: NotePatch,
    now: string
  ): Promise<Note | NoteConflict> {
    const existing = this.requireNote(userId, noteId);
    if (existing.version !== expectedVersion) {
      return this.createConflict(userId, existing, expectedVersion, patch, now);
    }
    const next: Note = {
      ...existing,
      kind: patch.kind ?? existing.kind,
      title: patch.title === undefined ? existing.title : patch.title.trim(),
      body: patch.body === undefined ? existing.body : patch.body.trim(),
      folderId: patch.folderId === undefined ? existing.folderId : patch.folderId,
      dueAt: patch.dueAt === undefined ? existing.dueAt : patch.dueAt,
      priority: patch.priority ?? existing.priority,
      pinned: patch.pinned ?? existing.pinned,
      status: patch.status ?? existing.status,
      globalOrder: patch.globalOrder ?? existing.globalOrder,
      sourceUrl: patch.sourceUrl === undefined ? existing.sourceUrl : patch.sourceUrl,
      version: existing.version + 1,
      updatedAt: now,
      completedAt:
        patch.status === "done" ? now : patch.status === "active" ? null : existing.completedAt
    };
    this.assertFolder(userId, next.folderId);
    if (patch.tagIds) this.setNoteTags(userId, next.id, patch.tagIds);
    this.notes.set(next.id, next);
    const stored = this.withTags(next);
    this.recordHistory(userId, stored, actionForPatch(patch), now);
    if (stored.status === "deleted") {
      this.recordChange({ type: "note", op: "delete", id: stored.id, userId, cursor: "0" });
    } else {
      this.recordChange({ type: "note", op: "upsert", note: stored, cursor: "0" });
    }
    return stored;
  }

  async deleteNote(
    userId: EntityId,
    noteId: EntityId,
    expectedVersion: number,
    now: string
  ): Promise<Note | NoteConflict> {
    return this.updateNote(userId, noteId, expectedVersion, { status: "deleted" }, now);
  }

  async reorderNotes(
    userId: EntityId,
    noteOrders: Array<{ id: EntityId; expectedVersion: number; globalOrder: number }>,
    now: string
  ): Promise<Note[] | NoteConflict> {
    const updated: Note[] = [];
    for (const order of noteOrders) {
      const note = this.requireNote(userId, order.id);
      if (note.version !== order.expectedVersion) {
        return this.createConflict(
          userId,
          note,
          order.expectedVersion,
          { globalOrder: order.globalOrder },
          now
        );
      }
    }
    for (const order of noteOrders) {
      const note = this.requireNote(userId, order.id);
      const next = {
        ...note,
        globalOrder: order.globalOrder,
        version: note.version + 1,
        updatedAt: now
      };
      this.notes.set(next.id, next);
      const stored = this.withTags(next);
      updated.push(stored);
      this.recordHistory(userId, stored, "reordered", now);
      this.recordChange({ type: "note", op: "upsert", note: stored, cursor: "0" });
    }
    return updated.sort(compareNotes);
  }

  async createFolder(userId: EntityId, name: string, now: string): Promise<Folder> {
    const folder = {
      id: this.nextId("folder"),
      userId,
      name: name.trim(),
      createdAt: now,
      updatedAt: now
    };
    this.folders.set(folder.id, folder);
    this.recordChange({ type: "folder", op: "upsert", folder, cursor: "0" });
    return { ...folder };
  }

  async updateFolder(
    userId: EntityId,
    folderId: EntityId,
    patch: FolderPatch,
    now: string
  ): Promise<Folder> {
    const existing = this.folders.get(folderId);
    if (!existing || existing.userId !== userId)
      throw new StoreError("not_found", "Folder not found");
    const folder = { ...existing, name: patch.name?.trim() ?? existing.name, updatedAt: now };
    this.folders.set(folder.id, folder);
    this.recordChange({ type: "folder", op: "upsert", folder, cursor: "0" });
    return { ...folder };
  }

  async deleteFolder(userId: EntityId, folderId: EntityId, now: string): Promise<void> {
    const existing = this.folders.get(folderId);
    if (!existing || existing.userId !== userId)
      throw new StoreError("not_found", "Folder not found");
    this.folders.delete(folderId);
    for (const note of this.notes.values()) {
      if (note.userId === userId && note.folderId === folderId && note.status !== "deleted") {
        const next = { ...note, folderId: null, version: note.version + 1, updatedAt: now };
        this.notes.set(next.id, next);
        const stored = this.withTags(next);
        this.recordHistory(userId, stored, "updated", now);
        this.recordChange({ type: "note", op: "upsert", note: stored, cursor: "0" });
      }
    }
    this.recordChange({ type: "folder", op: "delete", id: folderId, userId, cursor: "0" });
  }

  async createTag(userId: EntityId, name: string, now: string): Promise<Tag> {
    const tag = {
      id: this.nextId("tag"),
      userId,
      name: name.trim(),
      createdAt: now,
      updatedAt: now
    };
    this.tags.set(tag.id, tag);
    this.recordChange({ type: "tag", op: "upsert", tag, cursor: "0" });
    return { ...tag };
  }

  async updateTag(userId: EntityId, tagId: EntityId, patch: TagPatch, now: string): Promise<Tag> {
    const existing = this.tags.get(tagId);
    if (!existing || existing.userId !== userId) throw new StoreError("not_found", "Tag not found");
    const tag = { ...existing, name: patch.name?.trim() ?? existing.name, updatedAt: now };
    this.tags.set(tag.id, tag);
    this.recordChange({ type: "tag", op: "upsert", tag, cursor: "0" });
    return { ...tag };
  }

  async deleteTag(userId: EntityId, tagId: EntityId): Promise<void> {
    const existing = this.tags.get(tagId);
    if (!existing || existing.userId !== userId) throw new StoreError("not_found", "Tag not found");
    this.tags.delete(tagId);
    for (const [noteId, ids] of this.noteTagIds.entries()) {
      const note = this.notes.get(noteId);
      if (note?.userId === userId) ids.delete(tagId);
    }
    this.recordChange({ type: "tag", op: "delete", id: tagId, userId, cursor: "0" });
  }

  async listConnectorAccounts(userId: EntityId): Promise<{ accounts: ConnectorAccount[] }> {
    return {
      accounts: [...this.connectorAccounts.values()]
        .filter((account) => account.userId === userId && account.status !== "deleted")
        .sort(compareConnectorAccounts)
        .map((account) => ({ ...account, settings: { ...account.settings } }))
    };
  }

  async listConnectorAccountsByKey(connectorKey: string): Promise<ConnectorAccount[]> {
    return [...this.connectorAccounts.values()]
      .filter((account) => account.connectorKey === connectorKey && account.status !== "deleted")
      .sort(compareConnectorAccounts)
      .map((account) => ({ ...account, settings: { ...account.settings } }));
  }

  async createConnectorAccount(
    userId: EntityId,
    input: ConnectorAccountInput,
    now: string
  ): Promise<ConnectorAccount> {
    if (
      [...this.connectorAccounts.values()].some(
        (account) =>
          account.userId === userId &&
          account.connectorKey === input.connectorKey &&
          account.displayName === input.displayName.trim() &&
          account.status !== "deleted"
      )
    ) {
      throw new StoreError("connector_account_exists", "Connector account already exists");
    }
    const account: ConnectorAccount = {
      id: this.nextId("connector"),
      userId,
      connectorKey: input.connectorKey,
      displayName: input.displayName.trim(),
      status: "paused",
      healthStatus: "unknown",
      syncStatus: "idle",
      settings: input.settings ?? {},
      credentialRef: input.credentialRef ?? null,
      credentialStatus: input.credentialStatus ?? "not_configured",
      syncCursor: null,
      lastSyncAt: null,
      nextSyncAt: null,
      lastHealthAt: null,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
      version: 1
    };
    this.connectorAccounts.set(account.id, account);
    this.recordChange({ type: "connector_account", op: "upsert", account, cursor: "0" });
    return { ...account, settings: { ...account.settings } };
  }

  async getConnectorAccount(
    userId: EntityId,
    accountId: EntityId
  ): Promise<ConnectorAccount | null> {
    const account = this.connectorAccounts.get(accountId);
    if (!account || account.userId !== userId || account.status === "deleted") return null;
    return { ...account, settings: { ...account.settings } };
  }

  async updateConnectorAccount(
    userId: EntityId,
    accountId: EntityId,
    expectedVersion: number,
    patch: ConnectorAccountPatch,
    now: string
  ): Promise<ConnectorAccount | null> {
    const existing = this.connectorAccounts.get(accountId);
    if (!existing || existing.userId !== userId || existing.status === "deleted") return null;
    if (existing.version !== expectedVersion) {
      throw new StoreError("version_mismatch", "Connector account changed on the server");
    }
    const next: ConnectorAccount = {
      ...existing,
      displayName:
        patch.displayName === undefined ? existing.displayName : patch.displayName.trim(),
      status: patch.status ?? existing.status,
      healthStatus: patch.healthStatus ?? existing.healthStatus,
      syncStatus: patch.syncStatus ?? existing.syncStatus,
      settings: patch.settings ?? existing.settings,
      credentialRef:
        patch.credentialRef === undefined ? existing.credentialRef : patch.credentialRef,
      credentialStatus: patch.credentialStatus ?? existing.credentialStatus,
      syncCursor: patch.syncCursor === undefined ? existing.syncCursor : patch.syncCursor,
      lastSyncAt: patch.lastSyncAt === undefined ? existing.lastSyncAt : patch.lastSyncAt,
      nextSyncAt: patch.nextSyncAt === undefined ? existing.nextSyncAt : patch.nextSyncAt,
      lastHealthAt: patch.lastHealthAt === undefined ? existing.lastHealthAt : patch.lastHealthAt,
      errorCode: patch.errorCode === undefined ? existing.errorCode : patch.errorCode,
      errorMessage: patch.errorMessage === undefined ? existing.errorMessage : patch.errorMessage,
      updatedAt: now,
      version: existing.version + 1
    };
    this.connectorAccounts.set(next.id, next);
    this.recordChange(
      next.status === "deleted"
        ? { type: "connector_account", op: "delete", id: next.id, userId, cursor: "0" }
        : { type: "connector_account", op: "upsert", account: next, cursor: "0" }
    );
    return { ...next, settings: { ...next.settings } };
  }

  async deleteConnectorAccount(
    userId: EntityId,
    accountId: EntityId,
    expectedVersion: number,
    now: string
  ): Promise<ConnectorAccount | null> {
    return this.updateConnectorAccount(
      userId,
      accountId,
      expectedVersion,
      { status: "deleted", syncStatus: "idle" },
      now
    );
  }

  async createConnectorSourceRecord(
    userId: EntityId,
    input: ConnectorSourceRecordInput,
    now: string
  ): Promise<ConnectorSourceRecord> {
    const account = this.connectorAccounts.get(input.accountId);
    if (!account || account.userId !== userId || account.status === "deleted") {
      throw new StoreError("not_found", "Connector account not found");
    }
    if (
      [...this.connectorSourceRecords.values()].some(
        (record) =>
          record.accountId === input.accountId && record.sourceExternalId === input.sourceExternalId
      )
    ) {
      throw new StoreError("connector_record_exists", "Connector source record already exists");
    }
    const record: ConnectorSourceRecord = {
      id: this.nextId("source"),
      userId,
      accountId: input.accountId,
      connectorKey: account.connectorKey,
      sourceExternalId: input.sourceExternalId,
      sourceType: input.sourceType,
      payloadHash: input.payloadHash,
      normalizedPayload: input.normalizedPayload,
      status: "pending",
      receivedAt: now,
      processedAt: null,
      processingReason: null,
      errorMessage: null,
      version: 1
    };
    this.connectorSourceRecords.set(record.id, record);
    return copyConnectorSourceRecord(record);
  }

  async findConnectorSourceRecord(
    userId: EntityId,
    accountId: EntityId,
    sourceExternalId: string
  ): Promise<ConnectorSourceRecord | null> {
    const record = [...this.connectorSourceRecords.values()].find(
      (item) =>
        item.userId === userId &&
        item.accountId === accountId &&
        item.sourceExternalId === sourceExternalId
    );
    return record ? copyConnectorSourceRecord(record) : null;
  }

  async createConnectorSourceRecordIfAbsent(
    userId: EntityId,
    input: ConnectorSourceRecordInput,
    now: string
  ): Promise<{ record: ConnectorSourceRecord; created: boolean }> {
    const existing = await this.findConnectorSourceRecord(
      userId,
      input.accountId,
      input.sourceExternalId
    );
    if (existing) return { record: existing, created: false };
    return { record: await this.createConnectorSourceRecord(userId, input, now), created: true };
  }

  async updateConnectorSourceRecordProcessing(
    userId: EntityId,
    accountId: EntityId,
    sourceExternalId: string,
    patch: {
      status: ConnectorSourceRecord["status"];
      processingReason: string;
      errorMessage?: string | null;
      normalizedPayload?: Record<string, unknown>;
      payloadHash?: string;
    },
    now: string
  ): Promise<ConnectorSourceRecord> {
    const existing = [...this.connectorSourceRecords.values()].find(
      (item) =>
        item.userId === userId &&
        item.accountId === accountId &&
        item.sourceExternalId === sourceExternalId
    );
    if (!existing) throw new StoreError("not_found", "Connector source record not found");
    const next: ConnectorSourceRecord = {
      ...existing,
      payloadHash: patch.payloadHash ?? existing.payloadHash,
      normalizedPayload: patch.normalizedPayload ?? existing.normalizedPayload,
      status: patch.status,
      processedAt: now,
      processingReason: patch.processingReason,
      errorMessage: patch.errorMessage === undefined ? null : patch.errorMessage,
      version: existing.version + 1
    };
    this.connectorSourceRecords.set(next.id, next);
    return copyConnectorSourceRecord(next);
  }

  async listConnectorSourceRecords(
    userId: EntityId,
    accountId: EntityId,
    limit?: number
  ): Promise<ConnectorSourceRecord[]> {
    const account = this.connectorAccounts.get(accountId);
    if (!account || account.userId !== userId || account.status === "deleted") return [];
    const boundedLimit =
      limit === undefined ? undefined : Math.min(Math.max(Math.floor(limit), 1), 200);
    const records = [...this.connectorSourceRecords.values()]
      .filter((record) => record.userId === userId && record.accountId === accountId)
      .sort((left, right) => left.receivedAt.localeCompare(right.receivedAt));
    return (boundedLimit === undefined ? records : records.slice(-boundedLimit))
      .map(copyConnectorSourceRecord);
  }

  async createConnectorSyncAttempt(
    userId: EntityId,
    input: Omit<ConnectorSyncAttempt, "id" | "userId">
  ): Promise<ConnectorSyncAttempt> {
    const account = await this.getConnectorAccount(userId, input.accountId);
    if (!account) throw new StoreError("not_found", "Connector account not found");
    const attempt: ConnectorSyncAttempt = {
      ...input,
      id: this.nextId("sync-attempt"),
      userId
    };
    this.connectorSyncAttempts.set(attempt.id, copyConnectorSyncAttempt(attempt));
    return copyConnectorSyncAttempt(attempt);
  }

  async listConnectorSyncAttempts(
    userId: EntityId,
    accountId: EntityId,
    limit = 50
  ): Promise<ConnectorSyncAttempt[]> {
    const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 200);
    return [...this.connectorSyncAttempts.values()]
      .filter((attempt) => attempt.userId === userId && attempt.accountId === accountId)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .slice(0, boundedLimit)
      .map(copyConnectorSyncAttempt);
  }

  async createConnectorOAuthState(
    userId: EntityId,
    input: {
      stateHash: string;
      connectorKey: string;
      reconnectAccountId?: EntityId | null;
      returnTo?: string | null;
      expiresAt: string;
    },
    now: string
  ): Promise<ConnectorOAuthState> {
    const state: ConnectorOAuthState = {
      id: this.nextId("oauth-state"),
      userId,
      stateHash: input.stateHash,
      connectorKey: input.connectorKey,
      reconnectAccountId: input.reconnectAccountId ?? null,
      returnTo: input.returnTo ?? null,
      createdAt: now,
      expiresAt: input.expiresAt
    };
    this.connectorOAuthStates.set(state.stateHash, state);
    return { ...state };
  }

  async consumeConnectorOAuthState(
    stateHash: string,
    connectorKey: string,
    now: string
  ): Promise<ConnectorOAuthState | null> {
    const state = this.connectorOAuthStates.get(stateHash);
    if (!state || state.connectorKey !== connectorKey || state.expiresAt <= now) return null;
    this.connectorOAuthStates.delete(stateHash);
    return { ...state };
  }

  async upsertConnectorCredential(
    userId: EntityId,
    accountId: EntityId,
    input: {
      kind: ConnectorCredentialKind;
      encryptedValue: string;
      encryptionVersion: number;
    },
    now: string
  ): Promise<ConnectorCredential> {
    const account = await this.getConnectorAccount(userId, accountId);
    if (!account) throw new StoreError("not_found", "Connector account not found");
    const existing = [...this.connectorCredentials.values()].find(
      (credential) =>
        credential.userId === userId &&
        credential.accountId === accountId &&
        credential.kind === input.kind
    );
    const credential: ConnectorCredential = {
      id: existing?.id ?? this.nextId("credential"),
      userId,
      accountId,
      connectorKey: account.connectorKey,
      kind: input.kind,
      encryptedValue: input.encryptedValue,
      encryptionVersion: input.encryptionVersion,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.connectorCredentials.set(credential.id, credential);
    return { ...credential };
  }

  async getConnectorCredential(
    userId: EntityId,
    accountId: EntityId,
    kind: ConnectorCredentialKind
  ): Promise<ConnectorCredential | null> {
    const credential = [...this.connectorCredentials.values()].find(
      (item) => item.userId === userId && item.accountId === accountId && item.kind === kind
    );
    return credential ? { ...credential } : null;
  }

  async deleteConnectorCredentials(userId: EntityId, accountId: EntityId): Promise<void> {
    for (const credential of this.connectorCredentials.values()) {
      if (credential.userId === userId && credential.accountId === accountId) {
        this.connectorCredentials.delete(credential.id);
      }
    }
  }

  async listCalendarEvents(
    userId: EntityId,
    query: {
      timeMin: string;
      timeMax: string;
      source?: CalendarSourceFilter;
      includeHidden?: boolean;
    }
  ): Promise<{ events: CalendarEvent[] }> {
    return {
      events: [...this.calendarEvents.values()]
        .filter(
          (event) =>
            event.userId === userId &&
            event.status !== "deleted" &&
            event.status !== "dismissed" &&
            event.endAt >= query.timeMin &&
            event.startAt <= query.timeMax &&
            (query.source === undefined ||
              query.source === "all" ||
              event.source === query.source) &&
            (query.includeHidden || !this.annotationForEvent(event.id)?.hidden)
        )
        .sort(compareCalendarEvents)
        .map(copyCalendarEvent)
    };
  }

  async createLocalCalendarEvent(
    userId: EntityId,
    input: CalendarEventInput,
    now: string
  ): Promise<CalendarEvent> {
    if (
      input.importedUid &&
      [...this.calendarEvents.values()].some(
        (event) =>
          event.userId === userId &&
          event.source === "local" &&
          event.importedUid === input.importedUid &&
          event.status !== "deleted"
      )
    ) {
      throw new StoreError("calendar_event_exists", "Calendar event already exists");
    }
    const event = this.localCalendarEventFromInput(userId, input, now);
    this.calendarEvents.set(event.id, event);
    this.recordChange({ type: "calendar_event", op: "upsert", event, cursor: "0" });
    return copyCalendarEvent(event);
  }

  async getCalendarEvent(userId: EntityId, eventId: EntityId): Promise<CalendarEvent | null> {
    const event = this.calendarEvents.get(eventId);
    if (!event || event.userId !== userId || event.status === "deleted") return null;
    return copyCalendarEvent(event);
  }

  async updateLocalCalendarEvent(
    userId: EntityId,
    eventId: EntityId,
    expectedVersion: number,
    patch: LocalCalendarEventPatch,
    now: string
  ): Promise<CalendarEvent> {
    const existing = this.calendarEvents.get(eventId);
    if (!existing || existing.userId !== userId || existing.status === "deleted") {
      throw new StoreError("not_found", "Calendar event not found");
    }
    if (existing.source !== "local") {
      throw new StoreError("provider_event_readonly", "Provider calendar events are read-only");
    }
    if (existing.version !== expectedVersion) {
      throw new StoreError("version_mismatch", "Calendar event changed on the server");
    }
    const next = this.applyLocalCalendarPatch(existing, patch, now);
    this.calendarEvents.set(next.id, next);
    this.recordChange(
      next.status === "deleted"
        ? { type: "calendar_event", op: "delete", id: next.id, userId, cursor: "0" }
        : { type: "calendar_event", op: "upsert", event: next, cursor: "0" }
    );
    return copyCalendarEvent(next);
  }

  async deleteLocalCalendarEvent(
    userId: EntityId,
    eventId: EntityId,
    expectedVersion: number,
    now: string
  ): Promise<CalendarEvent> {
    return this.updateLocalCalendarEvent(
      userId,
      eventId,
      expectedVersion,
      { status: "deleted" },
      now
    );
  }

  async upsertCalendarEventAnnotation(
    userId: EntityId,
    eventId: EntityId,
    expectedVersion: number | undefined,
    patch: CalendarEventAnnotationPatch,
    now: string
  ): Promise<CalendarEventAnnotation> {
    const event = this.calendarEvents.get(eventId);
    if (!event || event.userId !== userId || event.status === "deleted") {
      throw new StoreError("not_found", "Calendar event not found");
    }
    const existing = this.annotationForEvent(eventId);
    if (existing && expectedVersion !== undefined && existing.version !== expectedVersion) {
      throw new StoreError("version_mismatch", "Calendar annotation changed on the server");
    }
    const tagIds = patch.tagIds ?? existing?.tagIds ?? [];
    const annotation: CalendarEventAnnotation = {
      ...(existing ?? {
        id: this.nextId("calendar-annotation"),
        userId,
        eventId,
        version: 0,
        createdAt: now
      }),
      notes: patch.notes ?? existing?.notes ?? "",
      pinned: patch.pinned ?? existing?.pinned ?? false,
      completed: patch.completed ?? existing?.completed ?? false,
      hidden: patch.hidden ?? existing?.hidden ?? false,
      tagIds,
      tags: tagIds
        .map((tagId) => this.tags.get(tagId))
        .filter((tag): tag is Tag => tag !== undefined && tag.userId === userId),
      version: (existing?.version ?? 0) + 1,
      updatedAt: now
    };
    this.calendarAnnotations.set(annotation.id, annotation);
    const nextEvent = { ...event, annotation, updatedAt: now, version: event.version + 1 };
    this.calendarEvents.set(event.id, nextEvent);
    this.recordChange({ type: "calendar_event", op: "upsert", event: nextEvent, cursor: "0" });
    return copyCalendarAnnotation(annotation);
  }

  async upsertCalendarEvent(
    userId: EntityId,
    input: Omit<
      CalendarEvent,
      "id" | "userId" | "version" | "createdAt" | "updatedAt" | "dismissedAt" | "annotation"
    >,
    now: string
  ): Promise<{ event: CalendarEvent; created: boolean }> {
    if (!input.connectorAccountId) throw new StoreError("not_found", "Connector account not found");
    const account = await this.getConnectorAccount(userId, input.connectorAccountId);
    if (!account) throw new StoreError("not_found", "Connector account not found");
    const existing = [...this.calendarEvents.values()].find(
      (event) =>
        event.userId === userId &&
        event.connectorAccountId === input.connectorAccountId &&
        event.providerEventId === input.providerEventId
    );
    const event: CalendarEvent = {
      ...(existing ?? {
        id: this.nextId("calendar"),
        userId,
        createdAt: now,
        version: 0,
        dismissedAt: null
      }),
      ...input,
      source: "google-calendar",
      annotation: existing?.annotation ?? null,
      status:
        input.status === "cancelled" || existing?.status !== "dismissed"
          ? input.status
          : existing.status,
      version: (existing?.version ?? 0) + 1,
      updatedAt: now
    };
    this.calendarEvents.set(event.id, event);
    this.recordChange(
      event.status === "deleted"
        ? { type: "calendar_event", op: "delete", id: event.id, userId, cursor: "0" }
        : { type: "calendar_event", op: "upsert", event, cursor: "0" }
    );
    return { event: copyCalendarEvent(event), created: !existing };
  }

  async updateCalendarEvent(
    userId: EntityId,
    eventId: EntityId,
    expectedVersion: number,
    patch: CalendarEventPatch,
    now: string
  ): Promise<CalendarEvent> {
    const existing = this.calendarEvents.get(eventId);
    if (!existing || existing.userId !== userId || existing.status === "deleted") {
      throw new StoreError("not_found", "Calendar event not found");
    }
    if (existing.version !== expectedVersion) {
      throw new StoreError("version_mismatch", "Calendar event changed on the server");
    }
    const next: CalendarEvent = {
      ...existing,
      status: patch.status ?? existing.status,
      version: existing.version + 1,
      updatedAt: now,
      dismissedAt:
        patch.status === "dismissed" ? now : patch.status === "active" ? null : existing.dismissedAt
    };
    this.calendarEvents.set(next.id, next);
    this.recordChange(
      next.status === "deleted"
        ? { type: "calendar_event", op: "delete", id: next.id, userId, cursor: "0" }
        : { type: "calendar_event", op: "upsert", event: next, cursor: "0" }
    );
    return copyCalendarEvent(next);
  }

  async listNotifications(userId: EntityId): Promise<{ notifications: Notification[] }> {
    return {
      notifications: [...this.notifications.values()]
        .filter(
          (notification) => notification.userId === userId && notification.status !== "deleted"
        )
        .sort(compareNotifications)
        .map((notification) => ({ ...notification }))
    };
  }

  async createNotification(
    userId: EntityId,
    input: NotificationInput & { source?: Notification["source"]; sourceLabel?: string },
    now: string
  ): Promise<Notification> {
    const notification: Notification = {
      id: this.nextId("notification"),
      userId,
      title: input.title.trim(),
      summary: input.summary?.trim() ?? "",
      body: input.body?.trim() ?? "",
      source: input.source ?? "manual",
      sourceLabel: input.sourceLabel ?? "Manual",
      sourceUrl: input.sourceUrl ?? null,
      severity: input.severity ?? "info",
      status: "active",
      pinned: input.pinned ?? false,
      rank: input.rank ?? 0,
      globalOrder: this.nextNotificationOrder(userId),
      version: 1,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      dismissedAt: null,
      email: input.email ?? null,
      rule: input.rule ?? null,
      ai: input.ai ?? defaultNotificationAi()
    };
    this.notifications.set(notification.id, notification);
    this.recordChange({
      type: "notification",
      op: "upsert",
      notification,
      cursor: "0"
    });
    return { ...notification };
  }

  async updateNotification(
    userId: EntityId,
    notificationId: EntityId,
    expectedVersion: number,
    patch: NotificationPatch,
    now: string
  ): Promise<Notification> {
    const existing = this.requireNotification(userId, notificationId);
    if (existing.version !== expectedVersion) {
      throw new StoreError("version_mismatch", "Notification changed on the server");
    }
    const next: Notification = {
      ...existing,
      title: patch.title === undefined ? existing.title : patch.title.trim(),
      summary: patch.summary === undefined ? existing.summary : patch.summary.trim(),
      body: patch.body === undefined ? existing.body : patch.body.trim(),
      sourceUrl: patch.sourceUrl === undefined ? existing.sourceUrl : patch.sourceUrl,
      severity: patch.severity ?? existing.severity,
      pinned: patch.pinned ?? existing.pinned,
      rank: patch.rank ?? existing.rank,
      globalOrder: patch.globalOrder ?? existing.globalOrder,
      status: patch.status ?? existing.status,
      version: existing.version + 1,
      updatedAt: now,
      completedAt:
        patch.status === "done" ? now : patch.status === "active" ? null : existing.completedAt,
      dismissedAt:
        patch.status === "dismissed"
          ? now
          : patch.status === "active"
            ? null
            : existing.dismissedAt,
      email: patch.email === undefined ? existing.email : patch.email,
      rule: patch.rule === undefined ? existing.rule : patch.rule,
      ai: patch.ai === undefined ? existing.ai : patch.ai
    };
    this.notifications.set(next.id, next);
    this.recordChange(
      next.status === "deleted"
        ? { type: "notification", op: "delete", id: next.id, userId, cursor: "0" }
        : { type: "notification", op: "upsert", notification: next, cursor: "0" }
    );
    return { ...next };
  }

  async reorderNotifications(
    userId: EntityId,
    notificationOrders: Array<{ id: EntityId; expectedVersion: number; globalOrder: number }>,
    now: string
  ): Promise<Notification[]> {
    for (const order of notificationOrders) {
      const notification = this.requireNotification(userId, order.id);
      if (notification.version !== order.expectedVersion) {
        throw new StoreError("version_mismatch", "Notification changed on the server");
      }
    }
    const updated = [];
    for (const order of notificationOrders) {
      const notification = this.requireNotification(userId, order.id);
      const next = {
        ...notification,
        globalOrder: order.globalOrder,
        version: notification.version + 1,
        updatedAt: now
      };
      this.notifications.set(next.id, next);
      this.recordChange({ type: "notification", op: "upsert", notification: next, cursor: "0" });
      updated.push({ ...next });
    }
    return updated.sort(compareNotifications);
  }

  async recordAiUsage(
    userId: EntityId,
    input: {
      provider: "openai";
      model: string;
      inputChars: number;
      outputTokens?: number | null;
      failed: boolean;
      estimatedCostMicros?: number | null;
    },
    now: string
  ): Promise<void> {
    const usageDate = now.slice(0, 10);
    const key = `${userId}:${usageDate}:${input.provider}:${input.model}`;
    const existing = this.aiUsage.get(key);
    this.aiUsage.set(key, {
      ...(existing ?? {
        id: this.nextId("ai-usage"),
        userId,
        usageDate,
        provider: input.provider,
        model: input.model,
        requests: 0,
        inputChars: 0,
        outputTokens: 0,
        failedRequests: 0,
        estimatedCostMicros: null,
        createdAt: now
      }),
      requests: (existing?.requests ?? 0) + 1,
      inputChars: (existing?.inputChars ?? 0) + Math.max(0, input.inputChars),
      outputTokens: (existing?.outputTokens ?? 0) + Math.max(0, input.outputTokens ?? 0),
      failedRequests: (existing?.failedRequests ?? 0) + (input.failed ? 1 : 0),
      estimatedCostMicros:
        input.estimatedCostMicros === undefined
          ? (existing?.estimatedCostMicros ?? null)
          : (existing?.estimatedCostMicros ?? 0) + (input.estimatedCostMicros ?? 0),
      updatedAt: now
    });
  }

  async getAiUsageSettings(
    userId: EntityId,
    config: Pick<
      EmailAiSettings,
      | "enabled"
      | "available"
      | "provider"
      | "model"
      | "maxInputChars"
      | "unavailableReason"
      | "estimatedCostThisMonth"
    >,
    now: string
  ): Promise<EmailAiSettings> {
    const month = now.slice(0, 7);
    const rows = [...this.aiUsage.values()].filter(
      (row) => row.userId === userId && row.usageDate.startsWith(month)
    );
    return {
      ...config,
      requestsThisMonth: rows.reduce((sum, row) => sum + row.requests, 0),
      inputCharsThisMonth: rows.reduce((sum, row) => sum + row.inputChars, 0),
      outputTokensThisMonth: rows.reduce((sum, row) => sum + row.outputTokens, 0),
      failedRequestsThisMonth: rows.reduce((sum, row) => sum + row.failedRequests, 0),
      estimatedCostThisMonth:
        rows.some((row) => row.estimatedCostMicros !== null) ||
        config.estimatedCostThisMonth !== null
          ? rows.reduce((sum, row) => sum + (row.estimatedCostMicros ?? 0), 0) / 1_000_000
          : null
    };
  }

  async getUserPreference(userId: EntityId, key: string): Promise<string | null> {
    return this.userPreferences.get(`${userId}:${key}`)?.value ?? null;
  }

  async setUserPreference(
    userId: EntityId,
    key: string,
    value: string,
    now: string
  ): Promise<void> {
    void now;
    this.userPreferences.set(`${userId}:${key}`, { userId, key, value });
  }

  async createWebhookEndpoint(
    userId: EntityId,
    input: WebhookEndpointInput,
    secretHash: string,
    now: string
  ): Promise<WebhookEndpoint> {
    if (
      [...this.webhooks.values()].some(
        (webhook) => webhook.userId === userId && webhook.slug === input.slug
      )
    ) {
      throw new StoreError("webhook_exists", "A webhook with that slug already exists");
    }
    const webhook = {
      id: this.nextId("webhook"),
      userId,
      name: input.name.trim(),
      slug: input.slug,
      secretHash,
      destination: input.destination,
      enabled: input.enabled ?? true,
      defaultSeverity: input.defaultSeverity ?? "info",
      defaultPriority: input.defaultPriority ?? "none",
      createdAt: now,
      updatedAt: now,
      lastTriggeredAt: null,
      version: 1
    };
    this.webhooks.set(webhook.id, webhook);
    this.recordChange({
      type: "webhook",
      op: "upsert",
      webhook: publicWebhook(webhook),
      cursor: "0"
    });
    return publicWebhook(webhook);
  }

  async listWebhookEndpoints(userId: EntityId): Promise<WebhookEndpoint[]> {
    return [...this.webhooks.values()]
      .filter((webhook) => webhook.userId === userId)
      .sort(compareNames)
      .map(publicWebhook);
  }

  async updateWebhookEndpoint(
    userId: EntityId,
    endpointId: EntityId,
    expectedVersion: number,
    patch: WebhookEndpointPatch,
    now: string
  ): Promise<WebhookEndpoint | null> {
    const existing = this.webhooks.get(endpointId);
    if (!existing || existing.userId !== userId) return null;
    if (existing.version !== expectedVersion) {
      throw new StoreError("version_mismatch", "Webhook changed on the server");
    }
    const next = {
      ...existing,
      name: patch.name === undefined ? existing.name : patch.name.trim(),
      destination: patch.destination ?? existing.destination,
      defaultSeverity: patch.defaultSeverity ?? existing.defaultSeverity,
      defaultPriority: patch.defaultPriority ?? existing.defaultPriority,
      enabled: patch.enabled ?? existing.enabled,
      version: existing.version + 1,
      updatedAt: now
    };
    this.webhooks.set(next.id, next);
    this.recordChange({ type: "webhook", op: "upsert", webhook: publicWebhook(next), cursor: "0" });
    return publicWebhook(next);
  }

  async deleteWebhookEndpoint(
    userId: EntityId,
    endpointId: EntityId,
    expectedVersion: number,
    now: string
  ): Promise<WebhookEndpoint | null> {
    const existing = this.webhooks.get(endpointId);
    if (!existing || existing.userId !== userId) return null;
    if (existing.version !== expectedVersion) {
      throw new StoreError("version_mismatch", "Webhook changed on the server");
    }
    const deleted = { ...existing, enabled: false, version: existing.version + 1, updatedAt: now };
    this.webhooks.delete(endpointId);
    this.recordChange({ type: "webhook", op: "delete", id: endpointId, userId, cursor: "0" });
    return publicWebhook(deleted);
  }

  async deliverWebhook(
    slug: string,
    secretHash: string,
    input: WebhookIngestInput,
    now: string
  ): Promise<{ endpoint: WebhookEndpoint; notification?: Notification; note?: Note } | null> {
    const endpoint = [...this.webhooks.values()].find(
      (webhook) => webhook.slug === slug && webhook.enabled && webhook.secretHash === secretHash
    );
    if (!endpoint) return null;
    this.assertWebhookRateLimit(endpoint.id, now);
    endpoint.lastTriggeredAt = now;
    endpoint.updatedAt = now;
    this.webhooks.set(endpoint.id, endpoint);
    if (endpoint.destination === "note") {
      const note = await this.createNote(
        endpoint.userId,
        {
          kind: input.kind ?? "task",
          title: input.title,
          body: input.body ?? input.summary ?? "",
          priority: input.priority ?? endpoint.defaultPriority,
          dueAt: input.dueAt ?? null,
          sourceUrl: input.sourceUrl ?? null
        },
        now
      );
      this.recordWebhookDelivery(endpoint.userId, endpoint.id, now);
      return { endpoint: publicWebhook(endpoint), note };
    }
    const notification = await this.createNotification(
      endpoint.userId,
      {
        ...input,
        severity: input.severity ?? endpoint.defaultSeverity,
        source: "webhook",
        sourceLabel: endpoint.name
      },
      now
    );
    this.recordWebhookDelivery(endpoint.userId, endpoint.id, now);
    return { endpoint: publicWebhook(endpoint), notification };
  }

  async listConflicts(userId: EntityId): Promise<NoteConflict[]> {
    return [...this.conflicts.values()].filter(
      (conflict) => conflict.userId === userId && conflict.status === "open"
    );
  }

  async resolveConflict(
    userId: EntityId,
    conflictId: EntityId,
    expectedVersion: number,
    resolution: ConflictResolution,
    now: string
  ): Promise<NoteConflict | null> {
    const conflict = this.conflicts.get(conflictId);
    if (!conflict || conflict.userId !== userId) return null;
    if (conflict.version !== expectedVersion) {
      throw new StoreError("conflict_version_mismatch", "Conflict was already changed");
    }
    const resolved = {
      ...conflict,
      status: "resolved" as const,
      resolution,
      resolvedAt: now,
      version: conflict.version + 1
    };
    this.conflicts.set(conflictId, resolved);
    this.recordHistory(userId, conflict.serverNote, "conflict_resolved", now);
    this.recordChange({ type: "conflict", op: "upsert", conflict: resolved, cursor: "0" });
    return resolved;
  }

  async sync(userId: EntityId, cursor: string): Promise<{ cursor: string; changes: SyncChange[] }> {
    const since = Number.parseInt(cursor, 10);
    if (!/^\d+$/.test(cursor) || !Number.isSafeInteger(since)) {
      throw new StoreError("invalid_cursor", "Sync cursor is invalid");
    }
    const minCursor = since;
    const changes = this.changes.filter((change) => Number.parseInt(change.cursor, 10) > minCursor);
    return {
      cursor: String(this.sequence),
      changes: changes.filter((change) => changeBelongsTo(change, userId))
    };
  }

  async listHistory(userId: EntityId, noteId: EntityId): Promise<NoteHistoryEvent[]> {
    return this.history.filter((event) => event.userId === userId && event.noteId === noteId);
  }

  private requireNote(userId: EntityId, noteId: EntityId): Note {
    const note = this.notes.get(noteId);
    if (!note || note.userId !== userId || note.status === "deleted") {
      throw new StoreError("not_found", "Note not found");
    }
    return note;
  }

  private requireNotification(userId: EntityId, notificationId: EntityId): Notification {
    const notification = this.notifications.get(notificationId);
    if (!notification || notification.userId !== userId || notification.status === "deleted") {
      throw new StoreError("not_found", "Notification not found");
    }
    return notification;
  }

  private assertFolder(userId: EntityId, folderId: EntityId | null): void {
    if (!folderId) return;
    const folder = this.folders.get(folderId);
    if (!folder || folder.userId !== userId)
      throw new StoreError("invalid_folder", "Folder not found");
  }

  private setNoteTags(userId: EntityId, noteId: EntityId, tagIds: EntityId[]): void {
    for (const tagId of tagIds) {
      const tag = this.tags.get(tagId);
      if (!tag || tag.userId !== userId) throw new StoreError("invalid_tag", "Tag not found");
    }
    this.noteTagIds.set(noteId, new Set(tagIds));
  }

  private withTags(note: Note): Note {
    const tagIds = this.noteTagIds.get(note.id) ?? new Set();
    const tags = [...tagIds]
      .map((tagId) => this.tags.get(tagId))
      .filter((tag): tag is Tag => Boolean(tag));
    return { ...note, tags: tags.sort(compareNames) };
  }

  private createConflict(
    userId: EntityId,
    serverNote: Note,
    expectedVersion: number,
    attemptedPatch: NotePatch,
    now: string
  ): NoteConflict {
    const conflict: NoteConflict = {
      id: this.nextId("conflict"),
      userId,
      noteId: serverNote.id,
      expectedVersion,
      actualVersion: serverNote.version,
      attemptedPatch,
      serverNote: this.withTags(serverNote),
      status: "open",
      version: 1,
      createdAt: now,
      resolvedAt: null,
      resolution: null
    };
    this.conflicts.set(conflict.id, conflict);
    this.recordHistory(userId, this.withTags(serverNote), "conflict_created", now);
    this.recordChange({ type: "conflict", op: "upsert", conflict, cursor: "0" });
    return conflict;
  }

  private recordHistory(
    userId: EntityId,
    note: Note,
    action: NoteHistoryEvent["action"],
    now: string
  ): void {
    this.history.push({
      id: this.nextId("history"),
      noteId: note.id,
      userId,
      action,
      version: note.version,
      snapshot: note,
      createdAt: now
    });
  }

  private recordChange(change: SyncChange): void {
    this.sequence += 1;
    this.changes.push({ ...change, cursor: String(this.sequence) } as SyncChange);
  }

  private nextOrder(userId: EntityId): number {
    const userNotes = [...this.notes.values()].filter((note) => note.userId === userId);
    return userNotes.length === 0
      ? 1000
      : Math.max(...userNotes.map((note) => note.globalOrder)) + 1000;
  }

  private nextNotificationOrder(userId: EntityId): number {
    const userNotifications = [...this.notifications.values()].filter(
      (notification) => notification.userId === userId
    );
    return userNotifications.length === 0
      ? 1000
      : Math.max(...userNotifications.map((notification) => notification.globalOrder)) + 1000;
  }

  private nextId(prefix: string): EntityId {
    this.sequence += 1;
    return `${prefix}_${this.sequence.toString(36)}`;
  }

  private localCalendarEventFromInput(
    userId: EntityId,
    input: CalendarEventInput,
    now: string
  ): CalendarEvent {
    return {
      id: this.nextId("calendar"),
      userId,
      source: "local",
      connectorAccountId: null,
      provider: null,
      providerEventId: null,
      calendarId: null,
      calendarSummary: input.category ?? "DentLink Local",
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      location: input.location?.trim() || null,
      sourceUrl: input.sourceUrl ?? null,
      startAt: input.startAt,
      endAt: input.endAt,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      timezone: input.timezone ?? null,
      allDay: input.allDay ?? false,
      recurrenceRule: normalizeRecurrence(input.recurrenceRule),
      category: input.category?.trim() || null,
      color: input.color ?? null,
      reminderMinutes: input.reminderMinutes ?? null,
      importedUid: input.importedUid ?? null,
      annotation: null,
      status: "active",
      version: 1,
      createdAt: now,
      updatedAt: now,
      dismissedAt: null
    };
  }

  private applyLocalCalendarPatch(
    existing: CalendarEvent,
    patch: LocalCalendarEventPatch,
    now: string
  ): CalendarEvent {
    const category =
      patch.category === undefined ? existing.category : patch.category?.trim() || null;
    return {
      ...existing,
      title: patch.title === undefined ? existing.title : patch.title.trim(),
      description:
        patch.description === undefined ? existing.description : patch.description.trim(),
      location: patch.location === undefined ? existing.location : patch.location?.trim() || null,
      sourceUrl: patch.sourceUrl === undefined ? existing.sourceUrl : patch.sourceUrl,
      startAt: patch.startAt ?? existing.startAt,
      endAt: patch.endAt ?? existing.endAt,
      startDate: patch.startDate === undefined ? existing.startDate : patch.startDate,
      endDate: patch.endDate === undefined ? existing.endDate : patch.endDate,
      timezone: patch.timezone === undefined ? existing.timezone : patch.timezone,
      allDay: patch.allDay ?? existing.allDay,
      recurrenceRule:
        patch.recurrenceRule === undefined
          ? existing.recurrenceRule
          : normalizeRecurrence(patch.recurrenceRule),
      category,
      calendarSummary:
        patch.category === undefined ? existing.calendarSummary : (category ?? "DentLink Local"),
      color: patch.color === undefined ? existing.color : patch.color,
      reminderMinutes:
        patch.reminderMinutes === undefined ? existing.reminderMinutes : patch.reminderMinutes,
      importedUid: patch.importedUid === undefined ? existing.importedUid : patch.importedUid,
      status: patch.status ?? existing.status,
      version: existing.version + 1,
      updatedAt: now,
      dismissedAt: patch.status === "deleted" ? null : existing.dismissedAt
    };
  }

  private annotationForEvent(eventId: EntityId): CalendarEventAnnotation | null {
    return (
      [...this.calendarAnnotations.values()].find((annotation) => annotation.eventId === eventId) ??
      null
    );
  }

  private assertWebhookRateLimit(endpointId: EntityId, now: string): void {
    const windowStart = new Date(new Date(now).getTime() - 60_000).toISOString();
    const recentDeliveries = this.webhookDeliveries.filter(
      (delivery) => delivery.endpointId === endpointId && delivery.createdAt >= windowStart
    );
    if (recentDeliveries.length >= 60) {
      throw new StoreError("rate_limited", "Webhook rate limit exceeded");
    }
  }

  private recordWebhookDelivery(userId: EntityId, endpointId: EntityId, now: string): void {
    this.webhookDeliveries.push({
      id: this.nextId("delivery"),
      userId,
      endpointId,
      status: "accepted",
      message: "accepted",
      createdAt: now
    });
  }
}

export class StoreError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "StoreError";
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function publicUser(user: User & { password: PasswordRecord }): User {
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}

function compareNames(left: { name: string }, right: { name: string }): number {
  return left.name.localeCompare(right.name);
}

function compareNotes(left: Note, right: Note): number {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  return left.globalOrder - right.globalOrder || left.updatedAt.localeCompare(right.updatedAt);
}

function compareNotifications(left: Notification, right: Notification): number {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  return (
    right.rank - left.rank ||
    left.globalOrder - right.globalOrder ||
    left.updatedAt.localeCompare(right.updatedAt)
  );
}

function defaultNotificationAi(): Notification["ai"] {
  return {
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
  };
}

function compareCalendarEvents(left: CalendarEvent, right: CalendarEvent): number {
  return left.startAt.localeCompare(right.startAt) || left.title.localeCompare(right.title);
}

function compareConnectorAccounts(left: ConnectorAccount, right: ConnectorAccount): number {
  return left.displayName.localeCompare(right.displayName);
}

function publicWebhook(webhook: WebhookEndpoint & { secretHash?: string }): WebhookEndpoint {
  return {
    id: webhook.id,
    userId: webhook.userId,
    name: webhook.name,
    slug: webhook.slug,
    destination: webhook.destination,
    enabled: webhook.enabled,
    defaultSeverity: webhook.defaultSeverity,
    defaultPriority: webhook.defaultPriority,
    createdAt: webhook.createdAt,
    updatedAt: webhook.updatedAt,
    lastTriggeredAt: webhook.lastTriggeredAt,
    version: webhook.version
  };
}

function actionForPatch(patch: NotePatch): NoteHistoryEvent["action"] {
  if (patch.status === "deleted") return "deleted";
  if (patch.status === "done") return "done";
  if (patch.status === "active") return "reopened";
  if (patch.globalOrder !== undefined) return "reordered";
  return "updated";
}

function changeBelongsTo(change: SyncChange, userId: EntityId): boolean {
  if (change.type === "note" && change.op === "upsert") return change.note.userId === userId;
  if (change.type === "note" && change.op === "delete") return change.userId === userId;
  if (change.type === "folder" && change.op === "upsert") return change.folder.userId === userId;
  if (change.type === "folder" && change.op === "delete") return change.userId === userId;
  if (change.type === "tag" && change.op === "upsert") return change.tag.userId === userId;
  if (change.type === "tag" && change.op === "delete") return change.userId === userId;
  if (change.type === "notification" && change.op === "upsert")
    return change.notification.userId === userId;
  if (change.type === "notification" && change.op === "delete") return change.userId === userId;
  if (change.type === "calendar_event" && change.op === "upsert")
    return change.event.userId === userId;
  if (change.type === "calendar_event" && change.op === "delete") return change.userId === userId;
  if (change.type === "webhook" && change.op === "upsert") return change.webhook.userId === userId;
  if (change.type === "webhook" && change.op === "delete") return change.userId === userId;
  if (change.type === "connector_account" && change.op === "upsert")
    return change.account.userId === userId;
  if (change.type === "connector_account" && change.op === "delete")
    return change.userId === userId;
  if (change.type === "conflict") return change.conflict.userId === userId;
  return true;
}

function copyConnectorSourceRecord(record: ConnectorSourceRecord): ConnectorSourceRecord {
  return {
    ...record,
    normalizedPayload: JSON.parse(JSON.stringify(record.normalizedPayload)) as Record<
      string,
      unknown
    >
  };
}

function copyConnectorSyncAttempt(attempt: ConnectorSyncAttempt): ConnectorSyncAttempt {
  return {
    ...attempt,
    summary: attempt.summary ? { ...attempt.summary } : null,
    details: JSON.parse(JSON.stringify(attempt.details)) as Record<string, unknown>
  };
}

function copyCalendarEvent(event: CalendarEvent): CalendarEvent {
  return {
    ...event,
    annotation: event.annotation ? copyCalendarAnnotation(event.annotation) : null
  };
}

function copyCalendarAnnotation(annotation: CalendarEventAnnotation): CalendarEventAnnotation {
  return {
    ...annotation,
    tagIds: [...annotation.tagIds],
    tags: annotation.tags.map((tag) => ({ ...tag }))
  };
}

function normalizeRecurrence(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.toUpperCase().startsWith("RRULE:") ? value : `RRULE:${value}`;
}
