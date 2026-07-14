import type {
  AuthSession,
  CalendarEventAnnotation,
  CalendarEventAnnotationPatch,
  CalendarEventInput,
  CalendarEvent,
  CalendarEventPatch,
  CalendarEventsList,
  CalendarIcsImportResult,
  CalendarSourceFilter,
  ConflictResponse,
  ConnectorAccount,
  ConnectorAccountInput,
  ConnectorAccountPatch,
  ConnectorAccountsList,
  ConnectorSourceRecord,
  ConnectorSourceRecordInput,
  CurrentSession,
  EntityId,
  Folder,
  GmailDiagnostics,
  GmailSyncResult,
  GoogleCalendarSyncResult,
  Notification,
  NotificationInput,
  NotificationPatch,
  NotificationsList,
  Note,
  NoteHistoryEvent,
  NoteInput,
  NotePatch,
  NotesList,
  SyncResponse,
  Tag,
  WebhookEndpoint,
  WebhookEndpointInput,
  WebhookEndpointPatch,
  WebhooksList
} from "@dentlink/item-model";
import type { ConnectorDefinition } from "@dentlink/connector-sdk";

export class DentLinkApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, code: string, status: number, details?: unknown) {
    super(message);
    this.name = "DentLinkApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type ApiClientOptions = {
  baseUrl?: string;
  token?: string | null;
  fetchImpl?: typeof fetch;
};

export type CreateFolderInput = {
  name: string;
};

export type CreateTagInput = {
  name: string;
};

export class DentLinkApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private token: string | null;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "";
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.token = options.token ?? null;
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  async register(email: string, password: string): Promise<AuthSession> {
    const session = await this.request<AuthSession>("/v1/auth/register", {
      method: "POST",
      body: { email, password }
    });
    this.token = session.session.token;
    return session;
  }

  async login(email: string, password: string): Promise<AuthSession> {
    const session = await this.request<AuthSession>("/v1/auth/login", {
      method: "POST",
      body: { email, password }
    });
    this.token = session.session.token;
    return session;
  }

  async currentSession(): Promise<CurrentSession> {
    return this.request<CurrentSession>("/v1/auth/session");
  }

  async logout(): Promise<void> {
    await this.request<{ ok: true }>("/v1/auth/logout", { method: "POST" });
    this.token = null;
  }

  async listNotes(query?: {
    search?: string;
    folderId?: string;
    tagIds?: string[];
  }): Promise<NotesList> {
    const params = new URLSearchParams();
    if (query?.search) params.set("search", query.search);
    if (query?.folderId) params.set("folderId", query.folderId);
    for (const tagId of query?.tagIds ?? []) params.append("tagId", tagId);
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return this.request<NotesList>(`/v1/notes${suffix}`);
  }

  async createNote(input: NoteInput): Promise<Note> {
    return this.request<Note>("/v1/notes", { method: "POST", body: input });
  }

  async updateNote(noteId: EntityId, expectedVersion: number, patch: NotePatch): Promise<Note> {
    return this.request<Note>(`/v1/notes/${noteId}`, {
      method: "PATCH",
      body: { expectedVersion, patch }
    });
  }

  async deleteNote(noteId: EntityId, expectedVersion: number): Promise<Note> {
    return this.request<Note>(`/v1/notes/${noteId}`, {
      method: "DELETE",
      body: { expectedVersion }
    });
  }

  async reorderNotes(
    noteOrders: Array<{ id: EntityId; expectedVersion: number; globalOrder: number }>
  ): Promise<Note[]> {
    return this.request<Note[]>("/v1/notes/reorder", {
      method: "POST",
      body: { noteOrders }
    });
  }

  async createFolder(input: CreateFolderInput): Promise<Folder> {
    return this.request<Folder>("/v1/folders", { method: "POST", body: input });
  }

  async createTag(input: CreateTagInput): Promise<Tag> {
    return this.request<Tag>("/v1/tags", { method: "POST", body: input });
  }

  async listConnectorCatalog(): Promise<{ connectors: ConnectorDefinition[] }> {
    return this.request<{ connectors: ConnectorDefinition[] }>("/v1/connectors/catalog");
  }

  async startGmailOAuth(
    options: {
      returnTo?: string;
      accountId?: EntityId;
    } = {}
  ): Promise<{ authorizationUrl: string; expiresAt: string }> {
    const params = new URLSearchParams();
    if (options.returnTo) params.set("returnTo", options.returnTo);
    if (options.accountId) params.set("accountId", options.accountId);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return this.request<{ authorizationUrl: string; expiresAt: string }>(
      `/v1/connectors/gmail/start${suffix}`,
      { method: "POST" }
    );
  }

  async startGoogleCalendarOAuth(
    options: {
      returnTo?: string;
      accountId?: EntityId;
    } = {}
  ): Promise<{ authorizationUrl: string; expiresAt: string }> {
    const params = new URLSearchParams();
    if (options.returnTo) params.set("returnTo", options.returnTo);
    if (options.accountId) params.set("accountId", options.accountId);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return this.request<{ authorizationUrl: string; expiresAt: string }>(
      `/v1/connectors/google-calendar/start${suffix}`,
      { method: "POST" }
    );
  }

  async listConnectorAccounts(): Promise<ConnectorAccountsList> {
    return this.request<ConnectorAccountsList>("/v1/connectors/accounts");
  }

  async createConnectorAccount(input: ConnectorAccountInput): Promise<ConnectorAccount> {
    return this.request<ConnectorAccount>("/v1/connectors/accounts", {
      method: "POST",
      body: input
    });
  }

  async updateConnectorAccount(
    accountId: EntityId,
    expectedVersion: number,
    patch: ConnectorAccountPatch
  ): Promise<ConnectorAccount> {
    return this.request<ConnectorAccount>(`/v1/connectors/accounts/${accountId}`, {
      method: "PATCH",
      body: { expectedVersion, patch }
    });
  }

  async deleteConnectorAccount(
    accountId: EntityId,
    expectedVersion: number
  ): Promise<ConnectorAccount> {
    return this.request<ConnectorAccount>(`/v1/connectors/accounts/${accountId}`, {
      method: "DELETE",
      body: { expectedVersion }
    });
  }

  async createConnectorSourceRecord(
    input: ConnectorSourceRecordInput
  ): Promise<ConnectorSourceRecord> {
    return this.request<ConnectorSourceRecord>("/v1/connectors/source-records", {
      method: "POST",
      body: input
    });
  }

  async listConnectorSourceRecords(
    accountId: EntityId
  ): Promise<{ records: ConnectorSourceRecord[] }> {
    return this.request<{ records: ConnectorSourceRecord[] }>(
      `/v1/connectors/accounts/${accountId}/source-records`
    );
  }

  async syncGmailAccount(accountId: EntityId): Promise<GmailSyncResult> {
    return this.request<GmailSyncResult>(`/v1/connectors/gmail/${accountId}/sync`, {
      method: "POST"
    });
  }

  async getGmailDiagnostics(accountId: EntityId): Promise<GmailDiagnostics> {
    return this.request<GmailDiagnostics>(`/v1/connectors/gmail/${accountId}/diagnostics`);
  }

  async disconnectGmailAccount(accountId: EntityId): Promise<ConnectorAccount> {
    return this.request<ConnectorAccount>(`/v1/connectors/gmail/${accountId}/disconnect`, {
      method: "POST"
    });
  }

  async syncGoogleCalendarAccount(accountId: EntityId): Promise<GoogleCalendarSyncResult> {
    return this.request<GoogleCalendarSyncResult>(
      `/v1/connectors/google-calendar/${accountId}/sync`,
      {
        method: "POST"
      }
    );
  }

  async disconnectGoogleCalendarAccount(accountId: EntityId): Promise<ConnectorAccount> {
    return this.request<ConnectorAccount>(
      `/v1/connectors/google-calendar/${accountId}/disconnect`,
      {
        method: "POST"
      }
    );
  }

  async listCalendarEvents(query?: {
    timeMin?: string;
    timeMax?: string;
    source?: CalendarSourceFilter;
    includeHidden?: boolean;
  }): Promise<CalendarEventsList> {
    const params = new URLSearchParams();
    if (query?.timeMin) params.set("timeMin", query.timeMin);
    if (query?.timeMax) params.set("timeMax", query.timeMax);
    if (query?.source) params.set("source", query.source);
    if (query?.includeHidden) params.set("includeHidden", "true");
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return this.request<CalendarEventsList>(`/v1/calendar/events${suffix}`);
  }

  async createLocalCalendarEvent(input: CalendarEventInput): Promise<CalendarEvent> {
    return this.request<CalendarEvent>("/v1/calendar/events", { method: "POST", body: input });
  }

  async updateCalendarEvent(
    eventId: EntityId,
    expectedVersion: number,
    patch: CalendarEventPatch
  ): Promise<CalendarEvent> {
    return this.request<CalendarEvent>(`/v1/calendar/events/${eventId}`, {
      method: "PATCH",
      body: { expectedVersion, patch }
    });
  }

  async updateLocalCalendarEvent(
    eventId: EntityId,
    expectedVersion: number,
    patch: CalendarEventPatch
  ): Promise<CalendarEvent> {
    return this.request<CalendarEvent>(`/v1/calendar/local-events/${eventId}`, {
      method: "PATCH",
      body: { expectedVersion, patch }
    });
  }

  async deleteLocalCalendarEvent(
    eventId: EntityId,
    expectedVersion: number
  ): Promise<CalendarEvent> {
    return this.request<CalendarEvent>(`/v1/calendar/local-events/${eventId}`, {
      method: "DELETE",
      body: { expectedVersion }
    });
  }

  async updateCalendarAnnotation(
    eventId: EntityId,
    patch: CalendarEventAnnotationPatch,
    expectedVersion?: number
  ): Promise<CalendarEventAnnotation> {
    return this.request<CalendarEventAnnotation>(`/v1/calendar/events/${eventId}/annotation`, {
      method: "PATCH",
      body: { expectedVersion, patch }
    });
  }

  async importIcs(ics: string): Promise<CalendarIcsImportResult> {
    return this.request<CalendarIcsImportResult>("/v1/calendar/ics/import", {
      method: "POST",
      body: { ics }
    });
  }

  async exportIcs(query?: { timeMin?: string; timeMax?: string }): Promise<string> {
    const params = new URLSearchParams();
    if (query?.timeMin) params.set("timeMin", query.timeMin);
    if (query?.timeMax) params.set("timeMax", query.timeMax);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return this.requestText(`/v1/calendar/ics/export${suffix}`);
  }

  async listNotifications(): Promise<NotificationsList> {
    return this.request<NotificationsList>("/v1/notifications");
  }

  async createNotification(input: NotificationInput): Promise<Notification> {
    return this.request<Notification>("/v1/notifications", { method: "POST", body: input });
  }

  async updateNotification(
    notificationId: EntityId,
    expectedVersion: number,
    patch: NotificationPatch
  ): Promise<Notification> {
    return this.request<Notification>(`/v1/notifications/${notificationId}`, {
      method: "PATCH",
      body: { expectedVersion, patch }
    });
  }

  async deleteNotification(
    notificationId: EntityId,
    expectedVersion: number
  ): Promise<Notification> {
    return this.request<Notification>(`/v1/notifications/${notificationId}`, {
      method: "DELETE",
      body: { expectedVersion }
    });
  }

  async reorderNotifications(
    notificationOrders: Array<{ id: EntityId; expectedVersion: number; globalOrder: number }>
  ): Promise<Notification[]> {
    return this.request<Notification[]>("/v1/notifications/reorder", {
      method: "POST",
      body: { noteOrders: notificationOrders }
    });
  }

  async listWebhooks(): Promise<WebhooksList> {
    return this.request<WebhooksList>("/v1/webhooks");
  }

  async createWebhook(input: WebhookEndpointInput): Promise<{
    webhook: WebhookEndpoint & { ingestUrl: string };
    secret: string;
  }> {
    return this.request<{
      webhook: WebhookEndpoint & { ingestUrl: string };
      secret: string;
    }>("/v1/webhooks", {
      method: "POST",
      body: input
    });
  }

  async updateWebhook(
    webhookId: EntityId,
    expectedVersion: number,
    patch: WebhookEndpointPatch
  ): Promise<WebhookEndpoint & { ingestUrl: string }> {
    return this.request<WebhookEndpoint & { ingestUrl: string }>(`/v1/webhooks/${webhookId}`, {
      method: "PATCH",
      body: { expectedVersion, patch }
    });
  }

  async deleteWebhook(
    webhookId: EntityId,
    expectedVersion: number
  ): Promise<WebhookEndpoint & { ingestUrl: string }> {
    return this.request<WebhookEndpoint & { ingestUrl: string }>(`/v1/webhooks/${webhookId}`, {
      method: "DELETE",
      body: { expectedVersion }
    });
  }

  async sync(cursor?: string): Promise<SyncResponse> {
    const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return this.request<SyncResponse>(`/v1/sync${suffix}`);
  }

  async listConflicts(): Promise<ConflictResponse[]> {
    return this.request<ConflictResponse[]>("/v1/conflicts");
  }

  async resolveConflict(
    conflictId: EntityId,
    expectedVersion: number,
    resolution: string
  ): Promise<ConflictResponse> {
    return this.request<ConflictResponse>(`/v1/conflicts/${conflictId}/resolve`, {
      method: "POST",
      body: { expectedVersion, resolution }
    });
  }

  async listNoteHistory(noteId: EntityId): Promise<{ history: NoteHistoryEvent[] }> {
    return this.request<{ history: NoteHistoryEvent[] }>(`/v1/notes/${noteId}/history`);
  }

  private async request<T>(
    path: string,
    init: { method?: string; body?: unknown } = {}
  ): Promise<T> {
    const headers = new Headers();
    headers.set("Accept", "application/json");
    if (init.body !== undefined) headers.set("Content-Type", "application/json");
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body)
    });

    const json = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      if (isConflictBody(json)) {
        throw new DentLinkApiError(
          "This note changed on the server. Review the conflict before retrying.",
          "conflict",
          response.status,
          json
        );
      }
      const error = isErrorBody(json) ? json.error : undefined;
      throw new DentLinkApiError(
        error?.message ?? "Request failed",
        error?.code ?? "request_failed",
        response.status,
        error?.details
      );
    }
    return json as T;
  }

  private async requestText(path: string): Promise<string> {
    const headers = new Headers();
    headers.set("Accept", "text/calendar");
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { headers });
    const text = await response.text();
    if (!response.ok) {
      throw new DentLinkApiError(text || "Request failed", "request_failed", response.status);
    }
    return text;
  }
}

function isConflictBody(value: unknown): value is ConflictResponse {
  return typeof value === "object" && value !== null && "conflict" in value;
}

function isErrorBody(
  value: unknown
): value is { error: { code: string; message: string; details?: unknown } } {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error?: unknown }).error === "object"
  );
}
