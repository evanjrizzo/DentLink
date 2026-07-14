import type {
  AuthSession,
  ConflictResponse,
  CurrentSession,
  EntityId,
  Folder,
  Note,
  NoteHistoryEvent,
  NoteInput,
  NotePatch,
  NotesList,
  SyncResponse,
  Tag
} from "@dentlink/item-model";

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
