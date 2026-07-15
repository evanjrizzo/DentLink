import {
  StoreError,
  type CreateUserRecord,
  type DentLinkStore,
  type PasswordRecord
} from "./storage";

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
  ConnectorSourceRecord,
  ConnectorSourceRecordInput,
  CurrentSession,
  EmailAiSettings,
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

type Primitive = string | number | null;
type SyncPayload =
  | Omit<Extract<SyncChange, { type: "note"; op: "upsert" }>, "cursor">
  | Omit<Extract<SyncChange, { type: "note"; op: "delete" }>, "cursor">
  | Omit<Extract<SyncChange, { type: "folder" }>, "cursor">
  | Omit<Extract<SyncChange, { type: "tag" }>, "cursor">
  | Omit<Extract<SyncChange, { type: "notification"; op: "upsert" }>, "cursor">
  | Omit<Extract<SyncChange, { type: "notification"; op: "delete" }>, "cursor">
  | Omit<Extract<SyncChange, { type: "calendar_event"; op: "upsert" }>, "cursor">
  | Omit<Extract<SyncChange, { type: "calendar_event"; op: "delete" }>, "cursor">
  | Omit<Extract<SyncChange, { type: "webhook"; op: "upsert" }>, "cursor">
  | Omit<Extract<SyncChange, { type: "webhook"; op: "delete" }>, "cursor">
  | Omit<Extract<SyncChange, { type: "connector_account"; op: "upsert" }>, "cursor">
  | Omit<Extract<SyncChange, { type: "connector_account"; op: "delete" }>, "cursor">
  | Omit<Extract<SyncChange, { type: "conflict" }>, "cursor">;

export type D1Result<T = unknown> = {
  results?: T[];
  success?: boolean;
  meta?: { changes?: number; last_row_id?: number };
};

export type D1PreparedStatement = {
  bind(...values: Primitive[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run<T = unknown>(): Promise<D1Result<T>>;
};

export type D1DatabaseLike = {
  prepare(sql: string): D1PreparedStatement;
  batch?<T = unknown>(statements: D1PreparedStatement[]): Promise<Array<D1Result<T>>>;
};

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  created_at: string;
};

type SessionRow = {
  id: string;
  user_id: string;
  expires_at: string;
  created_at: string;
};

type FolderRow = {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

type TagRow = FolderRow;

type NoteRow = {
  id: string;
  user_id: string;
  kind: "task" | "reference";
  title: string;
  body: string;
  folder_id: string | null;
  due_at: string | null;
  priority: "none" | "low" | "medium" | "high";
  pinned: number;
  status: "active" | "done" | "deleted";
  global_order: number;
  source_url: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type ConflictRow = {
  id: string;
  user_id: string;
  note_id: string;
  expected_version: number;
  actual_version: number;
  attempted_patch_json: string;
  server_note_json: string;
  status: "open" | "resolved";
  version: number;
  resolution: ConflictResolution | null;
  created_at: string;
  resolved_at: string | null;
};

type HistoryRow = {
  id: string;
  user_id: string;
  note_id: string;
  action: NoteHistoryEvent["action"];
  version: number;
  snapshot_json: string;
  created_at: string;
};

type SyncRow = {
  cursor: number;
  payload_json: string;
};

type NotificationRow = {
  id: string;
  user_id: string;
  title: string;
  summary: string;
  body: string;
  source: Notification["source"];
  source_label: string;
  source_url: string | null;
  severity: "info" | "low" | "medium" | "high";
  status: "active" | "done" | "dismissed" | "deleted";
  pinned: number;
  rank: number;
  global_order: number;
  version: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  dismissed_at: string | null;
  email_metadata_json?: string | null;
  rule_metadata_json?: string | null;
  ai_metadata_json?: string | null;
};

type AiUsageRow = {
  requests: number;
  input_chars: number;
  output_tokens: number;
  failed_requests: number;
  estimated_cost_micros: number | null;
};

type WebhookRow = {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  secret_hash: string;
  destination: "notification" | "note";
  enabled: number;
  default_severity: "info" | "low" | "medium" | "high";
  default_priority: "none" | "low" | "medium" | "high";
  created_at: string;
  updated_at: string;
  last_triggered_at: string | null;
  version: number;
};

type ConnectorAccountRow = {
  id: string;
  user_id: string;
  connector_key: string;
  display_name: string;
  status: ConnectorAccount["status"];
  health_status: ConnectorAccount["healthStatus"];
  sync_status: ConnectorAccount["syncStatus"];
  settings_json: string;
  credential_ref: string | null;
  credential_status: ConnectorAccount["credentialStatus"];
  sync_cursor: string | null;
  last_sync_at: string | null;
  next_sync_at: string | null;
  last_health_at: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

type ConnectorSourceRecordRow = {
  id: string;
  user_id: string;
  account_id: string;
  connector_key: string;
  source_external_id: string;
  source_type: ConnectorSourceRecord["sourceType"];
  payload_hash: string;
  normalized_payload_json: string;
  status: ConnectorSourceRecord["status"];
  received_at: string;
  processed_at: string | null;
  processing_reason: string | null;
  error_message: string | null;
  version: number;
};

type ConnectorOAuthStateRow = {
  id: string;
  user_id: string;
  state_hash: string;
  connector_key: string;
  reconnect_account_id: string | null;
  return_to: string | null;
  created_at: string;
  expires_at: string;
};

type ConnectorCredentialRow = {
  id: string;
  user_id: string;
  account_id: string;
  connector_key: string;
  kind: ConnectorCredentialKind;
  encrypted_value: string;
  encryption_version: number;
  created_at: string;
  updated_at: string;
};

type CalendarEventRow = {
  id: string;
  user_id: string;
  source: CalendarEvent["source"];
  connector_account_id: string | null;
  provider: "google-calendar" | null;
  provider_event_id: string | null;
  calendar_id: string | null;
  calendar_summary: string;
  title: string;
  description: string;
  location: string | null;
  source_url: string | null;
  start_at: string;
  end_at: string;
  start_date: string | null;
  end_date: string | null;
  timezone: string | null;
  all_day: number;
  recurrence_rule: string | null;
  category: string | null;
  color: string | null;
  reminder_minutes: number | null;
  imported_uid: string | null;
  status: CalendarEvent["status"];
  version: number;
  created_at: string;
  updated_at: string;
  dismissed_at: string | null;
};

type CalendarAnnotationRow = {
  id: string;
  user_id: string;
  event_id: string;
  notes: string;
  pinned: number;
  completed: number;
  hidden: number;
  tag_ids_json: string;
  version: number;
  created_at: string;
  updated_at: string;
};

export class D1DentLinkStore implements DentLinkStore {
  constructor(private readonly db: D1DatabaseLike) {}

  async createUser(input: CreateUserRecord): Promise<User> {
    const user = {
      id: nextId("user"),
      email: normalizeEmail(input.email),
      createdAt: new Date().toISOString()
    };
    try {
      await this.db
        .prepare(
          `INSERT INTO users (id, email, password_hash, password_salt, password_iterations, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(
          user.id,
          user.email,
          input.password.hash,
          input.password.salt,
          input.password.iterations,
          user.createdAt
        )
        .run();
    } catch (error) {
      throw mapConstraintError(error, "email_exists", "A user with that email already exists");
    }
    return user;
  }

  async findUserByEmail(email: string): Promise<(User & { password: PasswordRecord }) | null> {
    const row = await this.db
      .prepare(
        `SELECT id, email, password_hash, password_salt, password_iterations, created_at
         FROM users
         WHERE email = ?`
      )
      .bind(normalizeEmail(email))
      .first<UserRow>();
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      createdAt: row.created_at,
      password: {
        hash: row.password_hash,
        salt: row.password_salt,
        iterations: row.password_iterations
      }
    };
  }

  async createSession(
    userId: EntityId,
    tokenHash: string,
    now: string,
    expiresAt: string
  ): Promise<Session> {
    const session = { id: nextId("session"), userId, createdAt: now, expiresAt };
    await this.db
      .prepare(
        `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(session.id, userId, tokenHash, expiresAt, now)
      .run();
    return session;
  }

  async findSessionByTokenHash(tokenHash: string, now: string): Promise<CurrentSession | null> {
    const row = await this.db
      .prepare(
        `SELECT s.id, s.user_id, s.expires_at, s.created_at,
                u.email, u.created_at AS user_created_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?
           AND s.expires_at > ?
           AND s.revoked_at IS NULL`
      )
      .bind(tokenHash, now)
      .first<SessionRow & { email: string; user_created_at: string }>();
    if (!row) return null;
    return {
      user: { id: row.user_id, email: row.email, createdAt: row.user_created_at },
      session: { expiresAt: row.expires_at }
    };
  }

  async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
    await this.db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(tokenHash).run();
  }

  async listNotes(
    userId: EntityId,
    query: { search?: string; folderId?: string; tagIds?: string[] }
  ): Promise<{ notes: Note[]; folders: Folder[]; tags: Tag[] }> {
    const where = ["user_id = ?", "status != 'deleted'"];
    const values: Primitive[] = [userId];
    if (query.folderId) {
      where.push("folder_id = ?");
      values.push(query.folderId);
    }
    if (query.search) {
      where.push("(lower(title) LIKE ? OR lower(body) LIKE ?)");
      const search = `%${query.search.toLowerCase()}%`;
      values.push(search, search);
    }
    for (const tagId of query.tagIds ?? []) {
      where.push(
        `EXISTS (
          SELECT 1 FROM note_tags nt
          WHERE nt.note_id = notes.id
            AND nt.user_id = notes.user_id
            AND nt.tag_id = ?
        )`
      );
      values.push(tagId);
    }
    const notes = await this.noteRows(
      `SELECT * FROM notes WHERE ${where.join(" AND ")}
       ORDER BY pinned DESC, global_order ASC, updated_at ASC`,
      values
    );
    const folders = await this.all<FolderRow>(
      `SELECT * FROM folders WHERE user_id = ? ORDER BY name ASC`,
      [userId]
    );
    const tags = await this.all<TagRow>(`SELECT * FROM tags WHERE user_id = ? ORDER BY name ASC`, [
      userId
    ]);
    return {
      notes,
      folders: folders.map(folderFromRow),
      tags: tags.map(tagFromRow)
    };
  }

  async createNote(userId: EntityId, input: NoteInput, now: string): Promise<Note> {
    await this.assertFolder(userId, input.folderId ?? null);
    const tagIds = input.tagIds ?? [];
    await this.assertTags(userId, tagIds);
    const note = await this.toStoredNote(
      {
        id: nextId("note"),
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
        globalOrder: await this.nextOrder(userId),
        sourceUrl: input.sourceUrl ?? null,
        version: 1,
        createdAt: now,
        updatedAt: now,
        completedAt: null
      },
      tagIds
    );
    const statements = [
      this.db
        .prepare(
          `INSERT INTO notes
           (id, user_id, kind, title, body, folder_id, due_at, priority, pinned, status,
            global_order, source_url, version, created_at, updated_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          note.id,
          note.userId,
          note.kind,
          note.title,
          note.body,
          note.folderId,
          note.dueAt,
          note.priority,
          bool(note.pinned),
          note.status,
          note.globalOrder,
          note.sourceUrl,
          note.version,
          note.createdAt,
          note.updatedAt,
          note.completedAt
        ),
      ...tagIds.map((tagId) =>
        this.db
          .prepare(`INSERT INTO note_tags (note_id, tag_id, user_id) VALUES (?, ?, ?)`)
          .bind(note.id, tagId, userId)
      ),
      this.historyStatement(userId, note, "created", now),
      this.changeStatement(userId, "note", note.id, "upsert", { type: "note", op: "upsert", note })
    ];
    await this.batch(statements);
    return note;
  }

  async updateNote(
    userId: EntityId,
    noteId: EntityId,
    expectedVersion: number,
    patch: NotePatch,
    now: string
  ): Promise<Note | NoteConflict> {
    const existing = await this.requireNote(userId, noteId);
    await this.assertFolder(
      userId,
      patch.folderId === undefined ? existing.folderId : patch.folderId
    );
    if (patch.tagIds) await this.assertTags(userId, patch.tagIds);
    const next = await this.toStoredNote(
      {
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
      },
      patch.tagIds ?? existing.tags.map((tag) => tag.id)
    );
    const update = await this.db
      .prepare(
        `UPDATE notes
         SET kind = ?, title = ?, body = ?, folder_id = ?, due_at = ?, priority = ?, pinned = ?,
             status = ?, global_order = ?, source_url = ?, version = ?, updated_at = ?, completed_at = ?
         WHERE id = ?
           AND user_id = ?
           AND status != 'deleted'
           AND version = ?`
      )
      .bind(
        next.kind,
        next.title,
        next.body,
        next.folderId,
        next.dueAt,
        next.priority,
        bool(next.pinned),
        next.status,
        next.globalOrder,
        next.sourceUrl,
        next.version,
        next.updatedAt,
        next.completedAt,
        noteId,
        userId,
        expectedVersion
      )
      .run();
    if ((update.meta?.changes ?? 0) !== 1) {
      const current = await this.requireNote(userId, noteId);
      return this.createConflict(userId, current, expectedVersion, patch, now);
    }
    const tagStatements =
      patch.tagIds === undefined
        ? []
        : [
            this.db
              .prepare(`DELETE FROM note_tags WHERE note_id = ? AND user_id = ?`)
              .bind(noteId, userId),
            ...patch.tagIds.map((tagId) =>
              this.db
                .prepare(`INSERT INTO note_tags (note_id, tag_id, user_id) VALUES (?, ?, ?)`)
                .bind(noteId, tagId, userId)
            )
          ];
    await this.batch([
      ...tagStatements,
      this.historyStatement(userId, next, actionForPatch(patch), now),
      this.changeStatement(
        userId,
        "note",
        next.id,
        next.status === "deleted" ? "delete" : "upsert",
        next.status === "deleted"
          ? { type: "note", op: "delete", id: next.id, userId }
          : { type: "note", op: "upsert", note: next }
      )
    ]);
    return next;
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
    const existing = new Map<string, Note>();
    for (const order of noteOrders) {
      existing.set(order.id, await this.requireNote(userId, order.id));
    }
    const updates = [];
    for (const order of noteOrders) {
      const note = existing.get(order.id);
      if (!note) throw new StoreError("not_found", "Note not found");
      if (note.version !== order.expectedVersion) {
        return this.createConflict(
          userId,
          note,
          order.expectedVersion,
          { globalOrder: order.globalOrder },
          now
        );
      }
      updates.push(
        this.db
          .prepare(
            `UPDATE notes
             SET global_order = ?, version = version + 1, updated_at = ?
             WHERE id = ?
               AND user_id = ?
               AND status != 'deleted'
               AND version = ?`
          )
          .bind(order.globalOrder, now, order.id, userId, order.expectedVersion)
      );
    }
    const results = await this.batch(updates);
    const failed = results.findIndex((result) => (result.meta?.changes ?? 0) !== 1);
    if (failed !== -1) {
      const order = noteOrders[failed];
      const note = await this.requireNote(userId, order?.id ?? "");
      return this.createConflict(
        userId,
        note,
        order?.expectedVersion ?? 0,
        { globalOrder: order?.globalOrder },
        now
      );
    }
    const notes = [];
    for (const order of noteOrders) {
      const note = await this.requireNote(userId, order.id);
      await this.batch([
        this.historyStatement(userId, note, "reordered", now),
        this.changeStatement(userId, "note", note.id, "upsert", {
          type: "note",
          op: "upsert",
          note
        })
      ]);
      notes.push(note);
    }
    return notes.sort(compareNotes);
  }

  async createFolder(userId: EntityId, name: string, now: string): Promise<Folder> {
    const folder = {
      id: nextId("folder"),
      userId,
      name: name.trim(),
      createdAt: now,
      updatedAt: now
    };
    await this.batch([
      this.db
        .prepare(
          `INSERT INTO folders (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
        )
        .bind(folder.id, folder.userId, folder.name, folder.createdAt, folder.updatedAt),
      this.changeStatement(userId, "folder", folder.id, "upsert", {
        type: "folder",
        op: "upsert",
        folder
      })
    ]);
    return folder;
  }

  async createTag(userId: EntityId, name: string, now: string): Promise<Tag> {
    const tag = { id: nextId("tag"), userId, name: name.trim(), createdAt: now, updatedAt: now };
    await this.batch([
      this.db
        .prepare(
          `INSERT INTO tags (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
        )
        .bind(tag.id, tag.userId, tag.name, tag.createdAt, tag.updatedAt),
      this.changeStatement(userId, "tag", tag.id, "upsert", { type: "tag", op: "upsert", tag })
    ]);
    return tag;
  }

  async listConnectorAccounts(userId: EntityId): Promise<{ accounts: ConnectorAccount[] }> {
    const rows = await this.all<ConnectorAccountRow>(
      `SELECT * FROM connector_accounts
       WHERE user_id = ? AND status != 'deleted'
       ORDER BY display_name ASC`,
      [userId]
    );
    return { accounts: rows.map(connectorAccountFromRow) };
  }

  async listConnectorAccountsByKey(connectorKey: string): Promise<ConnectorAccount[]> {
    const rows = await this.all<ConnectorAccountRow>(
      `SELECT * FROM connector_accounts
       WHERE connector_key = ? AND status != 'deleted'
       ORDER BY display_name ASC`,
      [connectorKey]
    );
    return rows.map(connectorAccountFromRow);
  }

  async createConnectorAccount(
    userId: EntityId,
    input: ConnectorAccountInput,
    now: string
  ): Promise<ConnectorAccount> {
    const account: ConnectorAccount = {
      id: nextId("connector"),
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
    try {
      await this.batch([
        this.db
          .prepare(
            `INSERT INTO connector_accounts
             (id, user_id, connector_key, display_name, status, health_status, sync_status,
              settings_json, credential_ref, credential_status, sync_cursor, last_sync_at,
              next_sync_at, last_health_at, error_code, error_message, created_at, updated_at,
              version)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            account.id,
            userId,
            account.connectorKey,
            account.displayName,
            account.status,
            account.healthStatus,
            account.syncStatus,
            JSON.stringify(account.settings),
            account.credentialRef,
            account.credentialStatus,
            account.syncCursor,
            account.lastSyncAt,
            account.nextSyncAt,
            account.lastHealthAt,
            account.errorCode,
            account.errorMessage,
            account.createdAt,
            account.updatedAt,
            account.version
          ),
        this.changeStatement(userId, "connector_account", account.id, "upsert", {
          type: "connector_account",
          op: "upsert",
          account
        })
      ]);
    } catch (error) {
      throw mapConstraintError(
        error,
        "connector_account_exists",
        "Connector account already exists"
      );
    }
    return account;
  }

  async getConnectorAccount(
    userId: EntityId,
    accountId: EntityId
  ): Promise<ConnectorAccount | null> {
    const row = await this.db
      .prepare(`SELECT * FROM connector_accounts WHERE id = ? AND user_id = ?`)
      .bind(accountId, userId)
      .first<ConnectorAccountRow>();
    return row ? connectorAccountFromRow(row) : null;
  }

  async updateConnectorAccount(
    userId: EntityId,
    accountId: EntityId,
    expectedVersion: number,
    patch: ConnectorAccountPatch,
    now: string
  ): Promise<ConnectorAccount | null> {
    const existing = await this.getConnectorAccount(userId, accountId);
    if (!existing || existing.status === "deleted") return null;
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
    const result = await this.db
      .prepare(
        `UPDATE connector_accounts
         SET display_name = ?, status = ?, health_status = ?, sync_status = ?,
             settings_json = ?, credential_ref = ?, credential_status = ?, sync_cursor = ?,
             last_sync_at = ?, next_sync_at = ?, last_health_at = ?, error_code = ?,
             error_message = ?, updated_at = ?, version = ?
         WHERE id = ? AND user_id = ? AND version = ? AND status != 'deleted'`
      )
      .bind(
        next.displayName,
        next.status,
        next.healthStatus,
        next.syncStatus,
        JSON.stringify(next.settings),
        next.credentialRef,
        next.credentialStatus,
        next.syncCursor,
        next.lastSyncAt,
        next.nextSyncAt,
        next.lastHealthAt,
        next.errorCode,
        next.errorMessage,
        next.updatedAt,
        next.version,
        accountId,
        userId,
        expectedVersion
      )
      .run();
    if ((result.meta?.changes ?? 0) !== 1) {
      throw new StoreError("version_mismatch", "Connector account changed on the server");
    }
    await this.batch([
      this.changeStatement(
        userId,
        "connector_account",
        next.id,
        next.status === "deleted" ? "delete" : "upsert",
        next.status === "deleted"
          ? { type: "connector_account", op: "delete", id: next.id, userId }
          : { type: "connector_account", op: "upsert", account: next }
      )
    ]);
    return next;
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
    const account = await this.getConnectorAccount(userId, input.accountId);
    if (!account || account.status === "deleted") {
      throw new StoreError("not_found", "Connector account not found");
    }
    const record: ConnectorSourceRecord = {
      id: nextId("source"),
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
    try {
      await this.db
        .prepare(
          `INSERT INTO connector_source_records
           (id, user_id, account_id, connector_key, source_external_id, source_type,
            payload_hash, normalized_payload_json, status, received_at, processed_at,
            processing_reason, error_message, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          record.id,
          userId,
          record.accountId,
          record.connectorKey,
          record.sourceExternalId,
          record.sourceType,
          record.payloadHash,
          JSON.stringify(record.normalizedPayload),
          record.status,
          record.receivedAt,
          record.processedAt,
          record.processingReason,
          record.errorMessage,
          record.version
        )
        .run();
    } catch (error) {
      throw mapConstraintError(
        error,
        "connector_record_exists",
        "Connector source record already exists"
      );
    }
    return record;
  }

  async findConnectorSourceRecord(
    userId: EntityId,
    accountId: EntityId,
    sourceExternalId: string
  ): Promise<ConnectorSourceRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM connector_source_records
         WHERE user_id = ? AND account_id = ? AND source_external_id = ?`
      )
      .bind(userId, accountId, sourceExternalId)
      .first<ConnectorSourceRecordRow>();
    return row ? connectorSourceRecordFromRow(row) : null;
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
    try {
      return { record: await this.createConnectorSourceRecord(userId, input, now), created: true };
    } catch (error) {
      if (error instanceof StoreError && error.code === "connector_record_exists") {
        const record = await this.findConnectorSourceRecord(
          userId,
          input.accountId,
          input.sourceExternalId
        );
        if (record) return { record, created: false };
      }
      throw error;
    }
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
    const existing = await this.findConnectorSourceRecord(userId, accountId, sourceExternalId);
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
    await this.db
      .prepare(
        `UPDATE connector_source_records
         SET payload_hash = ?, normalized_payload_json = ?, status = ?, processed_at = ?,
             processing_reason = ?, error_message = ?, version = ?
         WHERE user_id = ? AND account_id = ? AND source_external_id = ?`
      )
      .bind(
        next.payloadHash,
        JSON.stringify(next.normalizedPayload),
        next.status,
        next.processedAt,
        next.processingReason,
        next.errorMessage,
        next.version,
        userId,
        accountId,
        sourceExternalId
      )
      .run();
    return next;
  }

  async listConnectorSourceRecords(
    userId: EntityId,
    accountId: EntityId
  ): Promise<ConnectorSourceRecord[]> {
    const account = await this.getConnectorAccount(userId, accountId);
    if (!account || account.status === "deleted") return [];
    const rows = await this.all<ConnectorSourceRecordRow>(
      `SELECT * FROM connector_source_records
       WHERE user_id = ? AND account_id = ?
       ORDER BY received_at ASC, id ASC`,
      [userId, accountId]
    );
    return rows.map(connectorSourceRecordFromRow);
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
      id: nextId("oauth-state"),
      userId,
      stateHash: input.stateHash,
      connectorKey: input.connectorKey,
      reconnectAccountId: input.reconnectAccountId ?? null,
      returnTo: input.returnTo ?? null,
      createdAt: now,
      expiresAt: input.expiresAt
    };
    await this.db
      .prepare(
        `INSERT INTO connector_oauth_states
         (id, user_id, state_hash, connector_key, reconnect_account_id, return_to, created_at,
          expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        state.id,
        state.userId,
        state.stateHash,
        state.connectorKey,
        state.reconnectAccountId,
        state.returnTo,
        state.createdAt,
        state.expiresAt
      )
      .run();
    return state;
  }

  async consumeConnectorOAuthState(
    stateHash: string,
    connectorKey: string,
    now: string
  ): Promise<ConnectorOAuthState | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM connector_oauth_states
         WHERE state_hash = ? AND connector_key = ? AND expires_at > ?`
      )
      .bind(stateHash, connectorKey, now)
      .first<ConnectorOAuthStateRow>();
    if (!row) return null;
    await this.db.prepare(`DELETE FROM connector_oauth_states WHERE id = ?`).bind(row.id).run();
    return connectorOAuthStateFromRow(row);
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
    if (!account || account.status === "deleted") {
      throw new StoreError("not_found", "Connector account not found");
    }
    const existing = await this.getConnectorCredential(userId, accountId, input.kind);
    const credential: ConnectorCredential = {
      id: existing?.id ?? nextId("credential"),
      userId,
      accountId,
      connectorKey: account.connectorKey,
      kind: input.kind,
      encryptedValue: input.encryptedValue,
      encryptionVersion: input.encryptionVersion,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    await this.db
      .prepare(
        `INSERT INTO connector_credentials
         (id, user_id, account_id, connector_key, kind, encrypted_value, encryption_version,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, kind)
         DO UPDATE SET encrypted_value = excluded.encrypted_value,
                       encryption_version = excluded.encryption_version,
                       updated_at = excluded.updated_at`
      )
      .bind(
        credential.id,
        credential.userId,
        credential.accountId,
        credential.connectorKey,
        credential.kind,
        credential.encryptedValue,
        credential.encryptionVersion,
        credential.createdAt,
        credential.updatedAt
      )
      .run();
    return credential;
  }

  async getConnectorCredential(
    userId: EntityId,
    accountId: EntityId,
    kind: ConnectorCredentialKind
  ): Promise<ConnectorCredential | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM connector_credentials
         WHERE user_id = ? AND account_id = ? AND kind = ?`
      )
      .bind(userId, accountId, kind)
      .first<ConnectorCredentialRow>();
    return row ? connectorCredentialFromRow(row) : null;
  }

  async deleteConnectorCredentials(userId: EntityId, accountId: EntityId): Promise<void> {
    await this.db
      .prepare(`DELETE FROM connector_credentials WHERE user_id = ? AND account_id = ?`)
      .bind(userId, accountId)
      .run();
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
    const where = [
      "e.user_id = ?",
      "e.status NOT IN ('deleted', 'dismissed')",
      "e.end_at >= ?",
      "e.start_at <= ?"
    ];
    const values: Primitive[] = [userId, query.timeMin, query.timeMax];
    if (query.source && query.source !== "all") {
      where.push("e.source = ?");
      values.push(query.source);
    }
    if (!query.includeHidden) where.push("COALESCE(a.hidden, 0) = 0");
    const rows = await this.all<CalendarEventRow & CalendarAnnotationSelectRow>(
      `SELECT e.*, ${calendarAnnotationSelectColumns()}
       FROM calendar_events e
       LEFT JOIN calendar_event_annotations a ON a.event_id = e.id AND a.user_id = e.user_id
       WHERE ${where.join(" AND ")}
       ORDER BY e.start_at ASC, e.title ASC`,
      values
    );
    return { events: rows.map(calendarEventWithAnnotationFromRow) };
  }

  async createLocalCalendarEvent(
    userId: EntityId,
    input: CalendarEventInput,
    now: string
  ): Promise<CalendarEvent> {
    const event = localCalendarEventFromInput(userId, input, now);
    try {
      await this.batch([
        this.insertCalendarEventStatement(event),
        this.changeStatement(userId, "calendar_event", event.id, "upsert", {
          type: "calendar_event",
          op: "upsert",
          event
        })
      ]);
    } catch (error) {
      throw mapConstraintError(error, "calendar_event_exists", "Calendar event already exists");
    }
    return event;
  }

  async getCalendarEvent(userId: EntityId, eventId: EntityId): Promise<CalendarEvent | null> {
    const row = await this.db
      .prepare(
        `SELECT e.*, ${calendarAnnotationSelectColumns()}
         FROM calendar_events e
         LEFT JOIN calendar_event_annotations a ON a.event_id = e.id AND a.user_id = e.user_id
         WHERE e.id = ? AND e.user_id = ? AND e.status != 'deleted'`
      )
      .bind(eventId, userId)
      .first<CalendarEventRow & CalendarAnnotationSelectRow>();
    return row ? calendarEventWithAnnotationFromRow(row) : null;
  }

  async updateLocalCalendarEvent(
    userId: EntityId,
    eventId: EntityId,
    expectedVersion: number,
    patch: LocalCalendarEventPatch,
    now: string
  ): Promise<CalendarEvent> {
    const existing = await this.getCalendarEvent(userId, eventId);
    if (!existing) throw new StoreError("not_found", "Calendar event not found");
    if (existing.source !== "local") {
      throw new StoreError("provider_event_readonly", "Provider calendar events are read-only");
    }
    const next = applyLocalCalendarPatch(existing, patch, now);
    const result = await this.db
      .prepare(
        `UPDATE calendar_events
         SET calendar_summary = ?, title = ?, description = ?, location = ?, source_url = ?,
             start_at = ?, end_at = ?, start_date = ?, end_date = ?, timezone = ?, all_day = ?,
             recurrence_rule = ?, category = ?, color = ?, reminder_minutes = ?, imported_uid = ?,
             status = ?, version = ?, updated_at = ?, dismissed_at = ?
         WHERE id = ? AND user_id = ? AND source = 'local' AND version = ? AND status != 'deleted'`
      )
      .bind(
        next.calendarSummary,
        next.title,
        next.description,
        next.location,
        next.sourceUrl,
        next.startAt,
        next.endAt,
        next.startDate,
        next.endDate,
        next.timezone,
        bool(next.allDay),
        next.recurrenceRule,
        next.category,
        next.color,
        next.reminderMinutes,
        next.importedUid,
        next.status,
        next.version,
        next.updatedAt,
        next.dismissedAt,
        eventId,
        userId,
        expectedVersion
      )
      .run();
    if ((result.meta?.changes ?? 0) !== 1) {
      throw new StoreError("version_mismatch", "Calendar event changed on the server");
    }
    await this.batch([
      this.changeStatement(
        userId,
        "calendar_event",
        next.id,
        next.status === "deleted" ? "delete" : "upsert",
        next.status === "deleted"
          ? { type: "calendar_event", op: "delete", id: next.id, userId }
          : { type: "calendar_event", op: "upsert", event: next }
      )
    ]);
    return next;
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
    const event = await this.getCalendarEvent(userId, eventId);
    if (!event) throw new StoreError("not_found", "Calendar event not found");
    const existing = await this.getCalendarAnnotation(userId, eventId);
    if (existing && expectedVersion !== undefined && existing.version !== expectedVersion) {
      throw new StoreError("version_mismatch", "Calendar annotation changed on the server");
    }
    const tagIds = patch.tagIds ?? existing?.tagIds ?? [];
    const annotation: CalendarEventAnnotation = {
      ...(existing ?? {
        id: nextId("calendar-annotation"),
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
      tags: await this.tagsForIds(userId, tagIds),
      version: (existing?.version ?? 0) + 1,
      updatedAt: now
    };
    await this.batch([
      this.db
        .prepare(
          `INSERT INTO calendar_event_annotations
           (id, user_id, event_id, notes, pinned, completed, hidden, tag_ids_json, version,
            created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, event_id) DO UPDATE SET
             notes = excluded.notes,
             pinned = excluded.pinned,
             completed = excluded.completed,
             hidden = excluded.hidden,
             tag_ids_json = excluded.tag_ids_json,
             version = excluded.version,
             updated_at = excluded.updated_at`
        )
        .bind(
          annotation.id,
          userId,
          eventId,
          annotation.notes,
          bool(annotation.pinned),
          bool(annotation.completed),
          bool(annotation.hidden),
          JSON.stringify(annotation.tagIds),
          annotation.version,
          annotation.createdAt,
          annotation.updatedAt
        ),
      this.changeStatement(userId, "calendar_event", event.id, "upsert", {
        type: "calendar_event",
        op: "upsert",
        event: { ...event, annotation, version: event.version + 1, updatedAt: now }
      })
    ]);
    return annotation;
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
    const existing = await this.db
      .prepare(
        `SELECT * FROM calendar_events
         WHERE user_id = ? AND connector_account_id = ? AND provider_event_id = ?`
      )
      .bind(userId, input.connectorAccountId, input.providerEventId)
      .first<CalendarEventRow>();
    const event: CalendarEvent = {
      ...(existing
        ? calendarEventFromRow(existing)
        : {
            id: nextId("calendar"),
            userId,
            createdAt: now,
            version: 0,
            dismissedAt: null,
            annotation: null
          }),
      ...input,
      source: "google-calendar",
      recurrenceRule: input.recurrenceRule ?? null,
      category: input.category ?? null,
      color: input.color ?? null,
      reminderMinutes: input.reminderMinutes ?? null,
      importedUid: input.importedUid ?? null,
      annotation: existing ? calendarEventFromRow(existing).annotation : null,
      status:
        input.status === "cancelled" || !existing || existing.status !== "dismissed"
          ? input.status
          : "dismissed",
      version: existing ? existing.version + 1 : 1,
      updatedAt: now
    };
    await this.batch([
      this.db
        .prepare(
          `INSERT INTO calendar_events
           (id, user_id, source, connector_account_id, provider, provider_event_id, calendar_id,
            calendar_summary, title, description, location, source_url, start_at, end_at,
            start_date, end_date, timezone, all_day, recurrence_rule, category, color,
            reminder_minutes, imported_uid, status, version, created_at, updated_at, dismissed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(connector_account_id, provider_event_id) DO UPDATE SET
             calendar_id = excluded.calendar_id,
             calendar_summary = excluded.calendar_summary,
             title = excluded.title,
             description = excluded.description,
             location = excluded.location,
             source_url = excluded.source_url,
             start_at = excluded.start_at,
             end_at = excluded.end_at,
             start_date = excluded.start_date,
             end_date = excluded.end_date,
             timezone = excluded.timezone,
             all_day = excluded.all_day,
             recurrence_rule = excluded.recurrence_rule,
             category = excluded.category,
             color = excluded.color,
             reminder_minutes = excluded.reminder_minutes,
             imported_uid = excluded.imported_uid,
             status = excluded.status,
             version = excluded.version,
             updated_at = excluded.updated_at,
             dismissed_at = excluded.dismissed_at`
        )
        .bind(
          event.id,
          userId,
          event.source,
          event.connectorAccountId,
          event.provider,
          event.providerEventId,
          event.calendarId,
          event.calendarSummary,
          event.title,
          event.description,
          event.location,
          event.sourceUrl,
          event.startAt,
          event.endAt,
          event.startDate,
          event.endDate,
          event.timezone,
          bool(event.allDay),
          event.recurrenceRule,
          event.category,
          event.color,
          event.reminderMinutes,
          event.importedUid,
          event.status,
          event.version,
          event.createdAt,
          event.updatedAt,
          event.dismissedAt
        ),
      this.changeStatement(
        userId,
        "calendar_event",
        event.id,
        event.status === "deleted" ? "delete" : "upsert",
        event.status === "deleted"
          ? { type: "calendar_event", op: "delete", id: event.id, userId }
          : { type: "calendar_event", op: "upsert", event }
      )
    ]);
    return { event, created: !existing };
  }

  async updateCalendarEvent(
    userId: EntityId,
    eventId: EntityId,
    expectedVersion: number,
    patch: CalendarEventPatch,
    now: string
  ): Promise<CalendarEvent> {
    const row = await this.db
      .prepare(`SELECT * FROM calendar_events WHERE id = ? AND user_id = ? AND status != 'deleted'`)
      .bind(eventId, userId)
      .first<CalendarEventRow>();
    if (!row) throw new StoreError("not_found", "Calendar event not found");
    const existing = calendarEventFromRow(row);
    const next: CalendarEvent = {
      ...existing,
      status: patch.status ?? existing.status,
      version: existing.version + 1,
      updatedAt: now,
      dismissedAt:
        patch.status === "dismissed" ? now : patch.status === "active" ? null : existing.dismissedAt
    };
    const result = await this.db
      .prepare(
        `UPDATE calendar_events
         SET status = ?, version = ?, updated_at = ?, dismissed_at = ?
         WHERE id = ? AND user_id = ? AND version = ? AND status != 'deleted'`
      )
      .bind(
        next.status,
        next.version,
        next.updatedAt,
        next.dismissedAt,
        eventId,
        userId,
        expectedVersion
      )
      .run();
    if ((result.meta?.changes ?? 0) !== 1) {
      throw new StoreError("version_mismatch", "Calendar event changed on the server");
    }
    await this.batch([
      this.changeStatement(
        userId,
        "calendar_event",
        next.id,
        next.status === "deleted" ? "delete" : "upsert",
        next.status === "deleted"
          ? { type: "calendar_event", op: "delete", id: next.id, userId }
          : { type: "calendar_event", op: "upsert", event: next }
      )
    ]);
    return next;
  }

  async listNotifications(userId: EntityId): Promise<{ notifications: Notification[] }> {
    const rows = await this.all<NotificationRow>(
      `SELECT * FROM notifications
       WHERE user_id = ? AND status != 'deleted'
       ORDER BY pinned DESC, rank DESC, global_order ASC, updated_at ASC`,
      [userId]
    );
    return { notifications: rows.map(notificationFromRow) };
  }

  async createNotification(
    userId: EntityId,
    input: NotificationInput & { source?: Notification["source"]; sourceLabel?: string },
    now: string
  ): Promise<Notification> {
    const notification: Notification = {
      id: nextId("notification"),
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
      globalOrder: await this.nextNotificationOrder(userId),
      version: 1,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      dismissedAt: null,
      email: input.email ?? null,
      rule: input.rule ?? null,
      ai: input.ai ?? defaultNotificationAi()
    };
    await this.batch([
      this.db
        .prepare(
          `INSERT INTO notifications
           (id, user_id, title, summary, body, source, source_label, source_url, severity, status,
            pinned, rank, global_order, version, created_at, updated_at, completed_at, dismissed_at,
            email_metadata_json, rule_metadata_json, ai_metadata_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          notification.id,
          notification.userId,
          notification.title,
          notification.summary,
          notification.body,
          notification.source,
          notification.sourceLabel,
          notification.sourceUrl,
          notification.severity,
          notification.status,
          bool(notification.pinned),
          notification.rank,
          notification.globalOrder,
          notification.version,
          notification.createdAt,
          notification.updatedAt,
          notification.completedAt,
          notification.dismissedAt,
          jsonOrNull(notification.email),
          jsonOrNull(notification.rule),
          JSON.stringify(notification.ai)
        ),
      this.changeStatement(userId, "notification", notification.id, "upsert", {
        type: "notification",
        op: "upsert",
        notification
      })
    ]);
    return notification;
  }

  async updateNotification(
    userId: EntityId,
    notificationId: EntityId,
    expectedVersion: number,
    patch: NotificationPatch,
    now: string
  ): Promise<Notification> {
    const existing = await this.requireNotification(userId, notificationId);
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
    const result = await this.db
      .prepare(
        `UPDATE notifications
         SET title = ?, summary = ?, body = ?, source_url = ?, severity = ?, status = ?,
             pinned = ?, rank = ?, global_order = ?, version = ?, updated_at = ?,
             completed_at = ?, dismissed_at = ?, email_metadata_json = ?, rule_metadata_json = ?,
             ai_metadata_json = ?
         WHERE id = ? AND user_id = ? AND status != 'deleted' AND version = ?`
      )
      .bind(
        next.title,
        next.summary,
        next.body,
        next.sourceUrl,
        next.severity,
        next.status,
        bool(next.pinned),
        next.rank,
        next.globalOrder,
        next.version,
        next.updatedAt,
        next.completedAt,
        next.dismissedAt,
        jsonOrNull(next.email),
        jsonOrNull(next.rule),
        JSON.stringify(next.ai),
        notificationId,
        userId,
        expectedVersion
      )
      .run();
    if ((result.meta?.changes ?? 0) !== 1) {
      throw new StoreError("version_mismatch", "Notification changed on the server");
    }
    await this.batch([
      this.changeStatement(
        userId,
        "notification",
        next.id,
        next.status === "deleted" ? "delete" : "upsert",
        next.status === "deleted"
          ? { type: "notification", op: "delete", id: next.id, userId }
          : { type: "notification", op: "upsert", notification: next }
      )
    ]);
    return next;
  }

  async reorderNotifications(
    userId: EntityId,
    notificationOrders: Array<{ id: EntityId; expectedVersion: number; globalOrder: number }>,
    now: string
  ): Promise<Notification[]> {
    const updates = notificationOrders.map((order) =>
      this.db
        .prepare(
          `UPDATE notifications
           SET global_order = ?, version = version + 1, updated_at = ?
           WHERE id = ? AND user_id = ? AND status != 'deleted' AND version = ?`
        )
        .bind(order.globalOrder, now, order.id, userId, order.expectedVersion)
    );
    const results = await this.batch(updates);
    if (results.some((result) => (result.meta?.changes ?? 0) !== 1)) {
      throw new StoreError("version_mismatch", "Notification changed on the server");
    }
    const updated = [];
    for (const order of notificationOrders) {
      const notification = await this.requireNotification(userId, order.id);
      await this.batch([
        this.changeStatement(userId, "notification", notification.id, "upsert", {
          type: "notification",
          op: "upsert",
          notification
        })
      ]);
      updated.push(notification);
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
    await this.db
      .prepare(
        `INSERT INTO ai_usage_daily
         (id, user_id, usage_date, provider, model, requests, input_chars, output_tokens,
          failed_requests, estimated_cost_micros, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, usage_date, provider, model)
         DO UPDATE SET requests = requests + 1,
                       input_chars = input_chars + excluded.input_chars,
                       output_tokens = output_tokens + excluded.output_tokens,
                       failed_requests = failed_requests + excluded.failed_requests,
                       estimated_cost_micros =
                         CASE
                           WHEN ai_usage_daily.estimated_cost_micros IS NULL
                                AND excluded.estimated_cost_micros IS NULL THEN NULL
                           ELSE COALESCE(ai_usage_daily.estimated_cost_micros, 0)
                                + COALESCE(excluded.estimated_cost_micros, 0)
                         END,
                       updated_at = excluded.updated_at`
      )
      .bind(
        nextId("ai-usage"),
        userId,
        usageDate,
        input.provider,
        input.model,
        Math.max(0, input.inputChars),
        Math.max(0, input.outputTokens ?? 0),
        input.failed ? 1 : 0,
        input.estimatedCostMicros ?? null,
        now,
        now
      )
      .run();
  }

  async getAiUsageSettings(
    userId: EntityId,
    config: Pick<EmailAiSettings, "enabled" | "model" | "maxInputChars" | "estimatedCostThisMonth">,
    now: string
  ): Promise<EmailAiSettings> {
    const monthStart = `${now.slice(0, 7)}-01`;
    const monthEnd = new Date(`${monthStart}T00:00:00.000Z`);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
    const row = await this.db
      .prepare(
        `SELECT COALESCE(SUM(requests), 0) AS requests,
                COALESCE(SUM(input_chars), 0) AS input_chars,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(failed_requests), 0) AS failed_requests,
                SUM(estimated_cost_micros) AS estimated_cost_micros
         FROM ai_usage_daily
         WHERE user_id = ? AND usage_date >= ? AND usage_date < ?`
      )
      .bind(userId, monthStart, monthEnd.toISOString().slice(0, 10))
      .first<AiUsageRow>();
    return {
      ...config,
      requestsThisMonth: row?.requests ?? 0,
      inputCharsThisMonth: row?.input_chars ?? 0,
      outputTokensThisMonth: row?.output_tokens ?? 0,
      failedRequestsThisMonth: row?.failed_requests ?? 0,
      estimatedCostThisMonth:
        row?.estimated_cost_micros === null || row?.estimated_cost_micros === undefined
          ? config.estimatedCostThisMonth
          : row.estimated_cost_micros / 1_000_000
    };
  }

  async createWebhookEndpoint(
    userId: EntityId,
    input: WebhookEndpointInput,
    secretHash: string,
    now: string
  ): Promise<WebhookEndpoint> {
    const webhook: WebhookEndpoint = {
      id: nextId("webhook"),
      userId,
      name: input.name.trim(),
      slug: input.slug,
      destination: input.destination,
      enabled: input.enabled ?? true,
      defaultSeverity: input.defaultSeverity ?? "info",
      defaultPriority: input.defaultPriority ?? "none",
      createdAt: now,
      updatedAt: now,
      lastTriggeredAt: null,
      version: 1
    };
    try {
      await this.batch([
        this.db
          .prepare(
            `INSERT INTO webhook_endpoints
             (id, user_id, name, slug, secret_hash, destination, enabled, default_severity,
              default_priority, created_at, updated_at, last_triggered_at, version)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            webhook.id,
            userId,
            webhook.name,
            webhook.slug,
            secretHash,
            webhook.destination,
            bool(webhook.enabled),
            webhook.defaultSeverity,
            webhook.defaultPriority,
            webhook.createdAt,
            webhook.updatedAt,
            webhook.lastTriggeredAt,
            webhook.version
          ),
        this.changeStatement(userId, "webhook", webhook.id, "upsert", {
          type: "webhook",
          op: "upsert",
          webhook
        })
      ]);
    } catch (error) {
      throw mapConstraintError(error, "webhook_exists", "A webhook with that slug already exists");
    }
    return webhook;
  }

  async listWebhookEndpoints(userId: EntityId): Promise<WebhookEndpoint[]> {
    const rows = await this.all<WebhookRow>(
      `SELECT * FROM webhook_endpoints WHERE user_id = ? ORDER BY name ASC`,
      [userId]
    );
    return rows.map(webhookFromRow);
  }

  async updateWebhookEndpoint(
    userId: EntityId,
    endpointId: EntityId,
    expectedVersion: number,
    patch: WebhookEndpointPatch,
    now: string
  ): Promise<WebhookEndpoint | null> {
    const existing = await this.getWebhook(userId, endpointId);
    if (!existing) return null;
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
    const result = await this.db
      .prepare(
        `UPDATE webhook_endpoints
         SET name = ?, destination = ?, enabled = ?, default_severity = ?, default_priority = ?,
             version = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND version = ?`
      )
      .bind(
        next.name,
        next.destination,
        bool(next.enabled),
        next.defaultSeverity,
        next.defaultPriority,
        next.version,
        next.updatedAt,
        endpointId,
        userId,
        expectedVersion
      )
      .run();
    if ((result.meta?.changes ?? 0) !== 1) {
      throw new StoreError("version_mismatch", "Webhook changed on the server");
    }
    await this.batch([
      this.changeStatement(userId, "webhook", next.id, "upsert", {
        type: "webhook",
        op: "upsert",
        webhook: next
      })
    ]);
    return next;
  }

  async deleteWebhookEndpoint(
    userId: EntityId,
    endpointId: EntityId,
    expectedVersion: number,
    now: string
  ): Promise<WebhookEndpoint | null> {
    const existing = await this.getWebhook(userId, endpointId);
    if (!existing) return null;
    const result = await this.db
      .prepare(`DELETE FROM webhook_endpoints WHERE id = ? AND user_id = ? AND version = ?`)
      .bind(endpointId, userId, expectedVersion)
      .run();
    if ((result.meta?.changes ?? 0) !== 1) {
      const stillExists = await this.getWebhook(userId, endpointId);
      if (stillExists) throw new StoreError("version_mismatch", "Webhook changed on the server");
    }
    const deleted = { ...existing, enabled: false, version: existing.version + 1, updatedAt: now };
    await this.batch([
      this.changeStatement(userId, "webhook", endpointId, "delete", {
        type: "webhook",
        op: "delete",
        id: endpointId,
        userId
      })
    ]);
    return deleted;
  }

  async deliverWebhook(
    slug: string,
    secretHash: string,
    input: WebhookIngestInput,
    now: string
  ): Promise<{ endpoint: WebhookEndpoint; notification?: Notification; note?: Note } | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM webhook_endpoints
         WHERE slug = ? AND secret_hash = ? AND enabled = 1`
      )
      .bind(slug, secretHash)
      .first<WebhookRow>();
    if (!row) return null;
    const endpoint = webhookFromRow(row);
    await this.assertWebhookRateLimit(endpoint.id, now);
    await this.db
      .prepare(`UPDATE webhook_endpoints SET last_triggered_at = ?, updated_at = ? WHERE id = ?`)
      .bind(now, now, endpoint.id)
      .run();
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
      await this.recordWebhookDelivery(endpoint.userId, endpoint.id, now);
      return { endpoint: { ...endpoint, lastTriggeredAt: now, updatedAt: now }, note };
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
    await this.recordWebhookDelivery(endpoint.userId, endpoint.id, now);
    return { endpoint: { ...endpoint, lastTriggeredAt: now, updatedAt: now }, notification };
  }

  async listConflicts(userId: EntityId): Promise<NoteConflict[]> {
    const rows = await this.all<ConflictRow>(
      `SELECT * FROM note_conflicts WHERE user_id = ? AND status = 'open' ORDER BY created_at ASC`,
      [userId]
    );
    return rows.map(conflictFromRow);
  }

  async resolveConflict(
    userId: EntityId,
    conflictId: EntityId,
    expectedVersion: number,
    resolution: ConflictResolution,
    now: string
  ): Promise<NoteConflict | null> {
    const conflict = await this.getConflict(userId, conflictId);
    if (!conflict) return null;
    const result = await this.db
      .prepare(
        `UPDATE note_conflicts
         SET status = 'resolved', resolution = ?, resolved_at = ?, version = version + 1
         WHERE id = ?
           AND user_id = ?
           AND version = ?`
      )
      .bind(resolution, now, conflictId, userId, expectedVersion)
      .run();
    if ((result.meta?.changes ?? 0) !== 1) {
      throw new StoreError("conflict_version_mismatch", "Conflict was already changed");
    }
    const resolved = await this.getConflict(userId, conflictId);
    if (!resolved) return null;
    await this.batch([
      this.historyStatement(userId, resolved.serverNote, "conflict_resolved", now),
      this.changeStatement(userId, "conflict", resolved.id, "upsert", {
        type: "conflict",
        op: "upsert",
        conflict: resolved
      })
    ]);
    return resolved;
  }

  async sync(userId: EntityId, cursor: string): Promise<{ cursor: string; changes: SyncChange[] }> {
    const since = Number.parseInt(cursor, 10);
    if (!/^\d+$/.test(cursor) || !Number.isSafeInteger(since)) {
      throw new StoreError("invalid_cursor", "Sync cursor is invalid");
    }
    const rows = await this.all<SyncRow>(
      `SELECT cursor, payload_json
       FROM sync_changes
       WHERE user_id = ? AND cursor > ?
       ORDER BY cursor ASC`,
      [userId, since]
    );
    const latest = await this.db
      .prepare(`SELECT COALESCE(MAX(cursor), 0) AS cursor FROM sync_changes WHERE user_id = ?`)
      .bind(userId)
      .first<{ cursor: number }>();
    return {
      cursor: String(latest?.cursor ?? 0),
      changes: rows.map(
        (row) => ({ ...JSON.parse(row.payload_json), cursor: String(row.cursor) }) as SyncChange
      )
    };
  }

  async listHistory(userId: EntityId, noteId: EntityId): Promise<NoteHistoryEvent[]> {
    const rows = await this.all<HistoryRow>(
      `SELECT * FROM note_history WHERE user_id = ? AND note_id = ? ORDER BY created_at ASC, id ASC`,
      [userId, noteId]
    );
    return rows.map(historyFromRow);
  }

  private insertCalendarEventStatement(event: CalendarEvent): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT INTO calendar_events
         (id, user_id, source, connector_account_id, provider, provider_event_id, calendar_id,
          calendar_summary, title, description, location, source_url, start_at, end_at, start_date,
          end_date, timezone, all_day, recurrence_rule, category, color, reminder_minutes,
          imported_uid, status, version, created_at, updated_at, dismissed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        event.id,
        event.userId,
        event.source,
        event.connectorAccountId,
        event.provider,
        event.providerEventId,
        event.calendarId,
        event.calendarSummary,
        event.title,
        event.description,
        event.location,
        event.sourceUrl,
        event.startAt,
        event.endAt,
        event.startDate,
        event.endDate,
        event.timezone,
        bool(event.allDay),
        event.recurrenceRule,
        event.category,
        event.color,
        event.reminderMinutes,
        event.importedUid,
        event.status,
        event.version,
        event.createdAt,
        event.updatedAt,
        event.dismissedAt
      );
  }

  private async getCalendarAnnotation(
    userId: EntityId,
    eventId: EntityId
  ): Promise<CalendarEventAnnotation | null> {
    const row = await this.db
      .prepare(`SELECT * FROM calendar_event_annotations WHERE user_id = ? AND event_id = ?`)
      .bind(userId, eventId)
      .first<CalendarAnnotationRow>();
    return row
      ? calendarAnnotationFromRow(row, await this.tagsForIds(userId, parseTagIds(row.tag_ids_json)))
      : null;
  }

  private async tagsForIds(userId: EntityId, tagIds: EntityId[]): Promise<Tag[]> {
    const tags: Tag[] = [];
    for (const tagId of tagIds) {
      const row = await this.db
        .prepare(`SELECT * FROM tags WHERE id = ? AND user_id = ?`)
        .bind(tagId, userId)
        .first<TagRow>();
      if (row) tags.push(tagFromRow(row));
    }
    return tags;
  }

  private async requireNote(userId: EntityId, noteId: EntityId): Promise<Note> {
    const notes = await this.noteRows(
      `SELECT * FROM notes WHERE id = ? AND user_id = ? AND status != 'deleted'`,
      [noteId, userId]
    );
    const note = notes[0];
    if (!note) throw new StoreError("not_found", "Note not found");
    return note;
  }

  private async requireNotification(
    userId: EntityId,
    notificationId: EntityId
  ): Promise<Notification> {
    const row = await this.db
      .prepare(`SELECT * FROM notifications WHERE id = ? AND user_id = ? AND status != 'deleted'`)
      .bind(notificationId, userId)
      .first<NotificationRow>();
    if (!row) throw new StoreError("not_found", "Notification not found");
    return notificationFromRow(row);
  }

  private async getWebhook(
    userId: EntityId,
    endpointId: EntityId
  ): Promise<WebhookEndpoint | null> {
    const row = await this.db
      .prepare(`SELECT * FROM webhook_endpoints WHERE id = ? AND user_id = ?`)
      .bind(endpointId, userId)
      .first<WebhookRow>();
    return row ? webhookFromRow(row) : null;
  }

  private async assertWebhookRateLimit(endpointId: EntityId, now: string): Promise<void> {
    const windowStart = new Date(new Date(now).getTime() - 60_000).toISOString();
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM webhook_deliveries
         WHERE endpoint_id = ?
           AND status = 'accepted'
           AND created_at >= ?`
      )
      .bind(endpointId, windowStart)
      .first<{ count: number }>();
    if ((row?.count ?? 0) >= 60) {
      throw new StoreError("rate_limited", "Webhook rate limit exceeded");
    }
  }

  private async recordWebhookDelivery(
    userId: EntityId,
    endpointId: EntityId,
    now: string
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO webhook_deliveries (id, user_id, endpoint_id, status, message, created_at)
         VALUES (?, ?, ?, 'accepted', 'accepted', ?)`
      )
      .bind(nextId("delivery"), userId, endpointId, now)
      .run();
  }

  private async noteRows(sql: string, values: Primitive[]): Promise<Note[]> {
    const rows = await this.all<NoteRow>(sql, values);
    return Promise.all(rows.map((row) => this.noteFromRow(row)));
  }

  private async noteFromRow(row: NoteRow): Promise<Note> {
    return this.toStoredNote(noteFromRow(row), await this.tagIdsForNote(row.user_id, row.id));
  }

  private async toStoredNote(note: Note, tagIds: string[]): Promise<Note> {
    const tags = tagIds.length === 0 ? [] : await this.tagsByIds(note.userId, tagIds);
    return { ...note, tags: tags.sort(compareNames) };
  }

  private async tagIdsForNote(userId: EntityId, noteId: EntityId): Promise<string[]> {
    const rows = await this.all<{ tag_id: string }>(
      `SELECT tag_id FROM note_tags WHERE user_id = ? AND note_id = ? ORDER BY tag_id ASC`,
      [userId, noteId]
    );
    return rows.map((row) => row.tag_id);
  }

  private async tagsByIds(userId: EntityId, tagIds: string[]): Promise<Tag[]> {
    const tags = [];
    for (const tagId of tagIds) {
      const row = await this.db
        .prepare(`SELECT * FROM tags WHERE user_id = ? AND id = ?`)
        .bind(userId, tagId)
        .first<TagRow>();
      if (row) tags.push(tagFromRow(row));
    }
    return tags;
  }

  private async assertFolder(
    userId: EntityId,
    folderId: EntityId | null | undefined
  ): Promise<void> {
    if (!folderId) return;
    const row = await this.db
      .prepare(`SELECT id FROM folders WHERE user_id = ? AND id = ?`)
      .bind(userId, folderId)
      .first<{ id: string }>();
    if (!row) throw new StoreError("invalid_folder", "Folder not found");
  }

  private async assertTags(userId: EntityId, tagIds: EntityId[]): Promise<void> {
    for (const tagId of tagIds) {
      const row = await this.db
        .prepare(`SELECT id FROM tags WHERE user_id = ? AND id = ?`)
        .bind(userId, tagId)
        .first<{ id: string }>();
      if (!row) throw new StoreError("invalid_tag", "Tag not found");
    }
  }

  private async nextOrder(userId: EntityId): Promise<number> {
    const row = await this.db
      .prepare(`SELECT COALESCE(MAX(global_order), 0) AS max_order FROM notes WHERE user_id = ?`)
      .bind(userId)
      .first<{ max_order: number }>();
    return (row?.max_order ?? 0) + 1000;
  }

  private async nextNotificationOrder(userId: EntityId): Promise<number> {
    const row = await this.db
      .prepare(
        `SELECT COALESCE(MAX(global_order), 0) AS max_order FROM notifications WHERE user_id = ?`
      )
      .bind(userId)
      .first<{ max_order: number }>();
    return (row?.max_order ?? 0) + 1000;
  }

  private async createConflict(
    userId: EntityId,
    serverNote: Note,
    expectedVersion: number,
    attemptedPatch: NotePatch,
    now: string
  ): Promise<NoteConflict> {
    const conflict: NoteConflict = {
      id: nextId("conflict"),
      userId,
      noteId: serverNote.id,
      expectedVersion,
      actualVersion: serverNote.version,
      attemptedPatch,
      serverNote,
      status: "open",
      version: 1,
      createdAt: now,
      resolvedAt: null,
      resolution: null
    };
    await this.batch([
      this.db
        .prepare(
          `INSERT INTO note_conflicts
           (id, user_id, note_id, expected_version, actual_version, attempted_patch_json,
            server_note_json, status, version, resolution, created_at, resolved_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          conflict.id,
          userId,
          serverNote.id,
          expectedVersion,
          serverNote.version,
          JSON.stringify(attemptedPatch),
          JSON.stringify(serverNote),
          conflict.status,
          conflict.version,
          conflict.resolution,
          conflict.createdAt,
          conflict.resolvedAt
        ),
      this.historyStatement(userId, serverNote, "conflict_created", now),
      this.changeStatement(userId, "conflict", conflict.id, "upsert", {
        type: "conflict",
        op: "upsert",
        conflict
      })
    ]);
    return conflict;
  }

  private async getConflict(userId: EntityId, conflictId: EntityId): Promise<NoteConflict | null> {
    const row = await this.db
      .prepare(`SELECT * FROM note_conflicts WHERE id = ? AND user_id = ?`)
      .bind(conflictId, userId)
      .first<ConflictRow>();
    return row ? conflictFromRow(row) : null;
  }

  private historyStatement(
    userId: EntityId,
    note: Note,
    action: NoteHistoryEvent["action"],
    now: string
  ): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT INTO note_history
         (id, user_id, note_id, action, version, snapshot_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(nextId("history"), userId, note.id, action, note.version, JSON.stringify(note), now);
  }

  private changeStatement(
    userId: EntityId,
    entityType:
      | "note"
      | "folder"
      | "tag"
      | "notification"
      | "calendar_event"
      | "webhook"
      | "connector_account"
      | "conflict",
    entityId: string,
    operation: "upsert" | "delete",
    payload: SyncPayload
  ): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT INTO sync_changes (user_id, entity_type, entity_id, operation, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        userId,
        entityType,
        entityId,
        operation,
        JSON.stringify(payload),
        new Date().toISOString()
      );
  }

  private async all<T>(sql: string, values: Primitive[] = []): Promise<T[]> {
    const result = await this.db
      .prepare(sql)
      .bind(...values)
      .all<T>();
    return result.results ?? [];
  }

  private async batch(statements: D1PreparedStatement[]): Promise<Array<D1Result>> {
    if (statements.length === 0) return [];
    if (this.db.batch) return this.db.batch(statements);
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

function noteFromRow(row: NoteRow): Note {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    folderId: row.folder_id,
    tags: [],
    dueAt: row.due_at,
    priority: row.priority,
    pinned: Boolean(row.pinned),
    status: row.status,
    globalOrder: row.global_order,
    sourceUrl: row.source_url,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  };
}

function folderFromRow(row: FolderRow): Folder {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function tagFromRow(row: TagRow): Tag {
  return folderFromRow(row);
}

function notificationFromRow(row: NotificationRow): Notification {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    summary: row.summary,
    body: row.body,
    source: row.source,
    sourceLabel: row.source_label,
    sourceUrl: row.source_url,
    severity: row.severity,
    status: row.status,
    pinned: Boolean(row.pinned),
    rank: row.rank,
    globalOrder: row.global_order,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    dismissedAt: row.dismissed_at,
    email: parseJsonOrNull<Notification["email"]>(row.email_metadata_json ?? null),
    rule: parseJsonOrNull<Notification["rule"]>(row.rule_metadata_json ?? null),
    ai: parseJsonOrNull<Notification["ai"]>(row.ai_metadata_json ?? null) ?? defaultNotificationAi()
  };
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

function jsonOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function parseJsonOrNull<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function calendarEventFromRow(row: CalendarEventRow): CalendarEvent {
  return {
    id: row.id,
    userId: row.user_id,
    source: row.source ?? "google-calendar",
    connectorAccountId: row.connector_account_id,
    provider: row.provider,
    providerEventId: row.provider_event_id,
    calendarId: row.calendar_id,
    calendarSummary: row.calendar_summary,
    title: row.title,
    description: row.description,
    location: row.location,
    sourceUrl: row.source_url,
    startAt: row.start_at,
    endAt: row.end_at,
    startDate: row.start_date,
    endDate: row.end_date,
    timezone: row.timezone,
    allDay: Boolean(row.all_day),
    recurrenceRule: row.recurrence_rule ?? null,
    category: row.category ?? null,
    color: row.color ?? null,
    reminderMinutes: row.reminder_minutes ?? null,
    importedUid: row.imported_uid ?? null,
    annotation: null,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dismissedAt: row.dismissed_at
  };
}

type CalendarAnnotationSelectRow = {
  annotation_id: string | null;
  annotation_notes: string | null;
  annotation_pinned: number | null;
  annotation_completed: number | null;
  annotation_hidden: number | null;
  annotation_tag_ids_json: string | null;
  annotation_version: number | null;
  annotation_created_at: string | null;
  annotation_updated_at: string | null;
};

function calendarAnnotationSelectColumns(): string {
  return `a.id AS annotation_id,
          a.notes AS annotation_notes,
          a.pinned AS annotation_pinned,
          a.completed AS annotation_completed,
          a.hidden AS annotation_hidden,
          a.tag_ids_json AS annotation_tag_ids_json,
          a.version AS annotation_version,
          a.created_at AS annotation_created_at,
          a.updated_at AS annotation_updated_at`;
}

function calendarEventWithAnnotationFromRow(
  row: CalendarEventRow & CalendarAnnotationSelectRow
): CalendarEvent {
  const event = calendarEventFromRow(row);
  event.annotation = row.annotation_id
    ? {
        id: row.annotation_id,
        userId: row.user_id,
        eventId: row.id,
        notes: row.annotation_notes ?? "",
        pinned: Boolean(row.annotation_pinned),
        completed: Boolean(row.annotation_completed),
        hidden: Boolean(row.annotation_hidden),
        tagIds: parseTagIds(row.annotation_tag_ids_json),
        tags: [],
        version: row.annotation_version ?? 1,
        createdAt: row.annotation_created_at ?? row.created_at,
        updatedAt: row.annotation_updated_at ?? row.updated_at
      }
    : null;
  return event;
}

function calendarAnnotationFromRow(
  row: CalendarAnnotationRow,
  tags: Tag[]
): CalendarEventAnnotation {
  return {
    id: row.id,
    userId: row.user_id,
    eventId: row.event_id,
    notes: row.notes,
    pinned: Boolean(row.pinned),
    completed: Boolean(row.completed),
    hidden: Boolean(row.hidden),
    tagIds: parseTagIds(row.tag_ids_json),
    tags,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function webhookFromRow(row: WebhookRow): WebhookEndpoint {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    slug: row.slug,
    destination: row.destination,
    enabled: Boolean(row.enabled),
    defaultSeverity: row.default_severity,
    defaultPriority: row.default_priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastTriggeredAt: row.last_triggered_at,
    version: row.version
  };
}

function connectorAccountFromRow(row: ConnectorAccountRow): ConnectorAccount {
  return {
    id: row.id,
    userId: row.user_id,
    connectorKey: row.connector_key,
    displayName: row.display_name,
    status: row.status,
    healthStatus: row.health_status,
    syncStatus: row.sync_status,
    settings: JSON.parse(row.settings_json) as ConnectorAccount["settings"],
    credentialRef: row.credential_ref,
    credentialStatus: row.credential_status,
    syncCursor: row.sync_cursor,
    lastSyncAt: row.last_sync_at,
    nextSyncAt: row.next_sync_at,
    lastHealthAt: row.last_health_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version
  };
}

function connectorSourceRecordFromRow(row: ConnectorSourceRecordRow): ConnectorSourceRecord {
  return {
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    connectorKey: row.connector_key,
    sourceExternalId: row.source_external_id,
    sourceType: row.source_type,
    payloadHash: row.payload_hash,
    normalizedPayload: JSON.parse(row.normalized_payload_json) as Record<string, unknown>,
    status: row.status,
    receivedAt: row.received_at,
    processedAt: row.processed_at,
    processingReason: row.processing_reason,
    errorMessage: row.error_message,
    version: row.version
  };
}

function connectorOAuthStateFromRow(row: ConnectorOAuthStateRow): ConnectorOAuthState {
  return {
    id: row.id,
    userId: row.user_id,
    stateHash: row.state_hash,
    connectorKey: row.connector_key,
    reconnectAccountId: row.reconnect_account_id,
    returnTo: row.return_to,
    createdAt: row.created_at,
    expiresAt: row.expires_at
  };
}

function connectorCredentialFromRow(row: ConnectorCredentialRow): ConnectorCredential {
  return {
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    connectorKey: row.connector_key,
    kind: row.kind,
    encryptedValue: row.encrypted_value,
    encryptionVersion: row.encryption_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function historyFromRow(row: HistoryRow): NoteHistoryEvent {
  return {
    id: row.id,
    userId: row.user_id,
    noteId: row.note_id,
    action: row.action,
    version: row.version,
    snapshot: JSON.parse(row.snapshot_json) as Note,
    createdAt: row.created_at
  };
}

function conflictFromRow(row: ConflictRow): NoteConflict {
  return {
    id: row.id,
    userId: row.user_id,
    noteId: row.note_id,
    expectedVersion: row.expected_version,
    actualVersion: row.actual_version,
    attemptedPatch: JSON.parse(row.attempted_patch_json) as NotePatch,
    serverNote: JSON.parse(row.server_note_json) as Note,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolution: row.resolution
  };
}

function actionForPatch(patch: NotePatch): NoteHistoryEvent["action"] {
  if (patch.status === "deleted") return "deleted";
  if (patch.status === "done") return "done";
  if (patch.status === "active") return "reopened";
  if (patch.globalOrder !== undefined) return "reordered";
  return "updated";
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

function nextId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function bool(value: boolean): number {
  return value ? 1 : 0;
}

function localCalendarEventFromInput(
  userId: EntityId,
  input: CalendarEventInput,
  now: string
): CalendarEvent {
  return {
    id: nextId("calendar"),
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

function applyLocalCalendarPatch(
  existing: CalendarEvent,
  patch: LocalCalendarEventPatch,
  now: string
): CalendarEvent {
  const category =
    patch.category === undefined ? existing.category : patch.category?.trim() || null;
  return {
    ...existing,
    title: patch.title === undefined ? existing.title : patch.title.trim(),
    description: patch.description === undefined ? existing.description : patch.description.trim(),
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

function normalizeRecurrence(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.toUpperCase().startsWith("RRULE:") ? value : `RRULE:${value}`;
}

function parseTagIds(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function mapConstraintError(error: unknown, code: string, message: string): StoreError {
  if (error instanceof Error && /constraint|unique/i.test(error.message)) {
    return new StoreError(code, message);
  }
  if (error instanceof StoreError) return error;
  throw error;
}
