import { useEffect, useMemo, useState, type ReactElement } from "react";

import { DentLinkApiClient, DentLinkApiError } from "@dentlink/api-client";
import type {
  AuthSession,
  EntityId,
  Notification,
  Note,
  NoteInput,
  NotePatch,
  NotesList,
  WebhookDestination,
  WebhookEndpoint
} from "@dentlink/item-model";
import { NotesWorkspace } from "@dentlink/ui";

const initialList: NotesList = { notes: [], folders: [], tags: [] };
const SESSION_STORAGE_KEY = "dentlink.auth.session.v1";
type View = "notifications" | "notes" | "webhooks";

export function DentLinkNotesApp(): ReactElement {
  const [client] = useState(
    () =>
      new DentLinkApiClient({
        baseUrl: import.meta.env.VITE_DENTLINK_API_BASE_URL ?? "",
        token: storedSession()?.session.token ?? null
      })
  );
  const [auth, setAuth] = useState<AuthSession | null>(() => storedSession());
  const [credentials, setCredentials] = useState({ email: "", password: "" });
  const [notesList, setNotesList] = useState<NotesList>(initialList);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [webhooks, setWebhooks] = useState<Array<WebhookEndpoint & { ingestUrl: string }>>([]);
  const [webhookDraft, setWebhookDraft] = useState({
    name: "",
    slug: "",
    destination: "notification" as WebhookDestination
  });
  const [lastWebhookSecret, setLastWebhookSecret] = useState<string | null>(null);
  const [view, setView] = useState<View>("notifications");
  const [search, setSearch] = useState("");
  const [folderId, setFolderId] = useState<EntityId | null>(null);
  const [tagIds, setTagIds] = useState<EntityId[]>([]);
  const [error, setError] = useState<string | null>(null);

  const filteredNotes = useMemo(() => notesList.notes, [notesList.notes]);

  useEffect(() => {
    if (!auth) return;
    let cancelled = false;
    client
      .currentSession()
      .then(async (current) => {
        if (cancelled) return;
        setAuth({
          user: current.user,
          session: { token: auth.session.token, expiresAt: current.session.expiresAt }
        });
        await loadNotes("", null, []);
        await loadNotifications();
        await loadWebhooks();
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        clearStoredSession();
        handleFailure(caught);
      });
    return () => {
      cancelled = true;
    };
    // Run once for the restored token. User-initiated auth paths load notes directly.
  }, []);

  async function loadNotes(
    nextSearch = search,
    nextFolderId = folderId,
    nextTagIds = tagIds
  ): Promise<void> {
    const response = await client.listNotes({
      search: nextSearch || undefined,
      folderId: nextFolderId ?? undefined,
      tagIds: nextTagIds
    });
    setNotesList(response);
  }

  async function loadNotifications(): Promise<void> {
    const response = await client.listNotifications();
    setNotifications(response.notifications);
  }

  async function loadWebhooks(): Promise<void> {
    const response = await client.listWebhooks();
    setWebhooks(response.webhooks);
  }

  async function authenticate(mode: "login" | "register"): Promise<void> {
    try {
      setError(null);
      const session =
        mode === "login"
          ? await client.login(credentials.email, credentials.password)
          : await client.register(credentials.email, credentials.password);
      setAuth(session);
      storeSession(session);
      await loadNotes("", null, []);
      await loadNotifications();
      await loadWebhooks();
    } catch (caught) {
      handleFailure(caught);
    }
  }

  async function createNote(input: NoteInput): Promise<void> {
    try {
      await client.createNote(input);
      await loadNotes();
    } catch (caught) {
      handleFailure(caught);
    }
  }

  async function createFolder(name: string): Promise<void> {
    try {
      await client.createFolder({ name });
      await loadNotes();
    } catch (caught) {
      handleFailure(caught);
    }
  }

  async function createTag(name: string): Promise<void> {
    try {
      await client.createTag({ name });
      await loadNotes();
    } catch (caught) {
      handleFailure(caught);
    }
  }

  async function updateNote(note: Note, patch: NotePatch): Promise<void> {
    const previous = notesList;
    setNotesList({
      ...notesList,
      notes: notesList.notes.map((item) =>
        item.id === note.id ? { ...item, ...patch, version: item.version + 1 } : item
      )
    });
    try {
      await client.updateNote(note.id, note.version, patch);
      await loadNotes();
    } catch (caught) {
      setNotesList(previous);
      handleFailure(caught);
    }
  }

  async function deleteNote(note: Note): Promise<void> {
    const previous = notesList;
    setNotesList({
      ...notesList,
      notes: notesList.notes.filter((item) => item.id !== note.id)
    });
    try {
      await client.deleteNote(note.id, note.version);
      await loadNotes();
    } catch (caught) {
      setNotesList(previous);
      handleFailure(caught);
    }
  }

  async function updateNotification(
    notification: Notification,
    patch: Partial<Pick<Notification, "pinned" | "status">>
  ): Promise<void> {
    const previous = notifications;
    setNotifications(
      notifications.map((item) =>
        item.id === notification.id ? { ...item, ...patch, version: item.version + 1 } : item
      )
    );
    try {
      await client.updateNotification(notification.id, notification.version, patch);
      await loadNotifications();
    } catch (caught) {
      setNotifications(previous);
      handleFailure(caught);
    }
  }

  async function reorderNotifications(orderedNotifications: Notification[]): Promise<void> {
    const previous = notifications;
    setNotifications(
      orderedNotifications.map((notification, index) => ({
        ...notification,
        globalOrder: (index + 1) * 1000
      }))
    );
    try {
      await client.reorderNotifications(
        orderedNotifications.map((notification, index) => ({
          id: notification.id,
          expectedVersion: notification.version,
          globalOrder: (index + 1) * 1000
        }))
      );
      await loadNotifications();
    } catch (caught) {
      setNotifications(previous);
      handleFailure(caught);
    }
  }

  async function createWebhook(): Promise<void> {
    try {
      setLastWebhookSecret(null);
      const created = await client.createWebhook(webhookDraft);
      setLastWebhookSecret(created.secret);
      setWebhookDraft({ name: "", slug: "", destination: "notification" });
      await loadWebhooks();
    } catch (caught) {
      handleFailure(caught);
    }
  }

  async function logout(): Promise<void> {
    try {
      await client.logout();
    } catch {
      client.setToken(null);
    } finally {
      clearStoredSession();
      setAuth(null);
      setNotesList(initialList);
      setNotifications([]);
      setWebhooks([]);
      setLastWebhookSecret(null);
      setSearch("");
      setFolderId(null);
      setTagIds([]);
    }
  }

  async function reorderNotes(orderedNotes: Note[]): Promise<void> {
    const previous = notesList;
    const noteOrders = orderedNotes.map((note, index) => ({
      id: note.id,
      expectedVersion: note.version,
      globalOrder: (index + 1) * 1000
    }));
    setNotesList({
      ...notesList,
      notes: orderedNotes.map((note, index) => ({ ...note, globalOrder: (index + 1) * 1000 }))
    });
    try {
      await client.reorderNotes(noteOrders);
      await loadNotes();
    } catch (caught) {
      setNotesList(previous);
      handleFailure(caught);
    }
  }

  function handleFailure(caught: unknown): void {
    if (caught instanceof DentLinkApiError && caught.status === 401) {
      client.setToken(null);
      clearStoredSession();
      setAuth(null);
    }
    setError(messageFor(caught));
  }

  if (!auth) {
    return (
      <main className="auth-screen">
        <form
          className="auth-panel"
          onSubmit={(event) => {
            event.preventDefault();
            void authenticate("login");
          }}
        >
          <h1>DentLink Notes</h1>
          <label>
            Email
            <input
              type="email"
              value={credentials.email}
              onChange={(event) =>
                setCredentials({ ...credentials, email: event.currentTarget.value })
              }
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={credentials.password}
              onChange={(event) =>
                setCredentials({ ...credentials, password: event.currentTarget.value })
              }
            />
          </label>
          {error ? <p role="alert">{error}</p> : null}
          <div className="auth-actions">
            <button type="submit">Log in</button>
            <button type="button" onClick={() => void authenticate("register")}>
              Register
            </button>
          </div>
        </form>
      </main>
    );
  }

  return (
    <>
      <header className="app-header">
        <strong>DentLink</strong>
        <nav className="app-tabs" aria-label="Primary">
          <button
            className={view === "notifications" ? "selected" : ""}
            onClick={() => setView("notifications")}
          >
            Notifications
          </button>
          <button className={view === "notes" ? "selected" : ""} onClick={() => setView("notes")}>
            Notes
          </button>
          <button
            className={view === "webhooks" ? "selected" : ""}
            onClick={() => setView("webhooks")}
          >
            Webhooks
          </button>
        </nav>
        <span>{auth.user.email}</span>
        <button onClick={() => void logout()}>Log out</button>
      </header>
      {error ? (
        <p className="app-error" role="alert">
          {error}
        </p>
      ) : null}
      {view === "notifications" ? (
        <NotificationsView
          notifications={notifications}
          onUpdateNotification={updateNotification}
          onReorderNotifications={reorderNotifications}
        />
      ) : null}
      {view === "notes" ? (
        <NotesWorkspace
          notes={filteredNotes}
          folders={notesList.folders}
          tags={notesList.tags}
          selectedFolderId={folderId}
          selectedTagIds={tagIds}
          search={search}
          onSearchChange={(nextSearch) => {
            setSearch(nextSearch);
            void loadNotes(nextSearch, folderId, tagIds);
          }}
          onFolderChange={(nextFolderId) => {
            setFolderId(nextFolderId);
            void loadNotes(search, nextFolderId, tagIds);
          }}
          onTagToggle={(tagId) => {
            const nextTagIds = tagIds.includes(tagId)
              ? tagIds.filter((item) => item !== tagId)
              : [...tagIds, tagId];
            setTagIds(nextTagIds);
            void loadNotes(search, folderId, nextTagIds);
          }}
          onCreateFolder={createFolder}
          onCreateTag={createTag}
          onCreateNote={createNote}
          onUpdateNote={updateNote}
          onDeleteNote={deleteNote}
          onReorderNotes={reorderNotes}
        />
      ) : null}
      {view === "webhooks" ? (
        <WebhooksView
          webhooks={webhooks}
          draft={webhookDraft}
          lastSecret={lastWebhookSecret}
          onDraftChange={setWebhookDraft}
          onCreateWebhook={createWebhook}
        />
      ) : null}
    </>
  );
}

function NotificationsView(props: {
  notifications: Notification[];
  onUpdateNotification: (
    notification: Notification,
    patch: Partial<Pick<Notification, "pinned" | "status">>
  ) => Promise<void>;
  onReorderNotifications: (notifications: Notification[]) => Promise<void>;
}): ReactElement {
  const [rankingMode, setRankingMode] = useState(false);
  const sorted = [...props.notifications].sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    return right.rank - left.rank || left.globalOrder - right.globalOrder;
  });
  return (
    <main className="notifications-shell">
      <div className="note-toolbar">
        <button
          className={rankingMode ? "selected" : ""}
          onClick={() => setRankingMode((enabled) => !enabled)}
        >
          Ranking Mode
        </button>
      </div>
      {sorted.length === 0 ? <p>No notifications yet.</p> : null}
      {sorted.map((notification, index) => (
        <article key={notification.id} className={`notification-card ${notification.status}`}>
          <div className="note-card-top">
            <strong>{notification.title}</strong>
            <span>{notification.sourceLabel}</span>
            <span>{notification.severity}</span>
            <button
              onClick={() =>
                void props.onUpdateNotification(notification, { pinned: !notification.pinned })
              }
            >
              {notification.pinned ? "Pinned" : "Pin"}
            </button>
          </div>
          <p>{notification.summary || notification.body}</p>
          <div className="note-order">
            <button
              onClick={() => void props.onUpdateNotification(notification, { status: "done" })}
            >
              Done
            </button>
            {rankingMode ? (
              <button
                onClick={() =>
                  void props.onUpdateNotification(notification, { status: "dismissed" })
                }
              >
                Dismiss
              </button>
            ) : null}
            <button
              disabled={index === 0}
              onClick={() => void props.onReorderNotifications(move(sorted, index, index - 1))}
            >
              Up
            </button>
            <button
              disabled={index === sorted.length - 1}
              onClick={() => void props.onReorderNotifications(move(sorted, index, index + 1))}
            >
              Down
            </button>
          </div>
        </article>
      ))}
    </main>
  );
}

function WebhooksView(props: {
  webhooks: Array<WebhookEndpoint & { ingestUrl: string }>;
  draft: { name: string; slug: string; destination: WebhookDestination };
  lastSecret: string | null;
  onDraftChange: (draft: { name: string; slug: string; destination: WebhookDestination }) => void;
  onCreateWebhook: () => Promise<void>;
}): ReactElement {
  return (
    <main className="webhooks-shell">
      <form
        className="note-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void props.onCreateWebhook();
        }}
      >
        <input
          aria-label="Webhook name"
          placeholder="Webhook name"
          value={props.draft.name}
          onChange={(event) =>
            props.onDraftChange({ ...props.draft, name: event.currentTarget.value })
          }
        />
        <input
          aria-label="Webhook slug"
          placeholder="webhook-slug"
          value={props.draft.slug}
          onChange={(event) =>
            props.onDraftChange({ ...props.draft, slug: event.currentTarget.value })
          }
        />
        <select
          value={props.draft.destination}
          onChange={(event) =>
            props.onDraftChange({
              ...props.draft,
              destination: event.currentTarget.value as WebhookDestination
            })
          }
        >
          <option value="notification">Notification</option>
          <option value="note">Note</option>
        </select>
        <button type="submit">Create</button>
      </form>
      {props.lastSecret ? (
        <p className="app-error" role="status">
          Webhook secret shown once: {props.lastSecret}
        </p>
      ) : null}
      <div className="note-list">
        {props.webhooks.map((webhook) => (
          <article key={webhook.id} className="notification-card">
            <strong>{webhook.name}</strong>
            <span>{webhook.destination}</span>
            <code>{webhook.ingestUrl}</code>
            <span>{webhook.enabled ? "Enabled" : "Disabled"}</span>
          </article>
        ))}
      </div>
    </main>
  );
}

function move<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

function storedSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as AuthSession;
  } catch {
    clearStoredSession();
    return null;
  }
}

function storeSession(session: AuthSession): void {
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function clearStoredSession(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

function messageFor(caught: unknown): string {
  if (caught instanceof DentLinkApiError) return caught.message;
  if (caught instanceof Error) return caught.message;
  return "Something went wrong";
}
