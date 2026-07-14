import type {
  ConflictResolution,
  CurrentSession,
  EntityId,
  Folder,
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
  createTag(userId: EntityId, name: string, now: string): Promise<Tag>;
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
  private notifications = new Map<EntityId, Notification>();
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
      dismissedAt: null
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
        patch.status === "dismissed" ? now : patch.status === "active" ? null : existing.dismissedAt
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
  if (change.type === "folder") return change.folder.userId === userId;
  if (change.type === "tag") return change.tag.userId === userId;
  if (change.type === "notification" && change.op === "upsert")
    return change.notification.userId === userId;
  if (change.type === "notification" && change.op === "delete") return change.userId === userId;
  if (change.type === "webhook") return change.webhook.userId === userId;
  if (change.type === "conflict") return change.conflict.userId === userId;
  return true;
}
