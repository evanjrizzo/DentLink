import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import { DentLinkApiClient, DentLinkApiError } from "@dentlink/api-client";
import type {
  AuthSession,
  CalendarEvent,
  ConnectorAccount,
  EntityId,
  Notification,
  NotificationInput,
  NotificationSeverity,
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
type View = "notifications" | "agenda" | "notes" | "webhooks" | "connectors";

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
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [webhooks, setWebhooks] = useState<Array<WebhookEndpoint & { ingestUrl: string }>>([]);
  const [connectorAccounts, setConnectorAccounts] = useState<ConnectorAccount[]>([]);
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
  const [updatingNoteIds, setUpdatingNoteIds] = useState<EntityId[]>([]);
  const notesRequest = useRef(0);
  const notificationsRequest = useRef(0);
  const calendarRequest = useRef(0);
  const webhooksRequest = useRef(0);
  const connectorsRequest = useRef(0);

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
        await loadCalendarEvents();
        await loadWebhooks();
        await loadConnectors();
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
    const requestId = (notesRequest.current += 1);
    const response = await client.listNotes({
      search: nextSearch || undefined,
      folderId: nextFolderId ?? undefined,
      tagIds: nextTagIds
    });
    if (requestId === notesRequest.current) setNotesList(response);
  }

  async function loadNotifications(): Promise<void> {
    const requestId = (notificationsRequest.current += 1);
    const response = await client.listNotifications();
    if (requestId === notificationsRequest.current) setNotifications(response.notifications);
  }

  async function loadCalendarEvents(): Promise<void> {
    const requestId = (calendarRequest.current += 1);
    const response = await client.listCalendarEvents();
    if (requestId === calendarRequest.current) setCalendarEvents(response.events);
  }

  async function loadWebhooks(): Promise<void> {
    const requestId = (webhooksRequest.current += 1);
    const response = await client.listWebhooks();
    if (requestId === webhooksRequest.current) setWebhooks(response.webhooks);
  }

  async function loadConnectors(): Promise<void> {
    const requestId = (connectorsRequest.current += 1);
    const response = await client.listConnectorAccounts();
    if (requestId === connectorsRequest.current) setConnectorAccounts(response.accounts);
  }

  async function refreshConnectorNotificationState(): Promise<void> {
    await Promise.all([loadConnectors(), loadNotifications(), loadCalendarEvents()]);
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
      await loadCalendarEvents();
      await loadWebhooks();
      await loadConnectors();
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
    const current = notesList.notes.find((item) => item.id === note.id) ?? note;
    setUpdatingNoteIds((ids) => [...new Set([...ids, note.id])]);
    setNotesList({
      ...notesList,
      notes: notesList.notes.map((item) =>
        item.id === note.id ? optimisticNote(item, patch, notesList.tags) : item
      )
    });
    try {
      await client.updateNote(note.id, current.version, patch);
      await loadNotes();
    } catch (caught) {
      setNotesList(previous);
      handleFailure(caught);
    } finally {
      setUpdatingNoteIds((ids) => ids.filter((id) => id !== note.id));
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

  async function createNotification(input: NotificationInput): Promise<void> {
    try {
      await client.createNotification(input);
      await loadNotifications();
    } catch (caught) {
      handleFailure(caught);
    }
  }

  async function deleteNotification(notification: Notification): Promise<void> {
    const previous = notifications;
    setNotifications(notifications.filter((item) => item.id !== notification.id));
    try {
      await client.deleteNotification(notification.id, notification.version);
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

  async function updateWebhook(
    webhook: WebhookEndpoint & { ingestUrl: string },
    patch: { enabled: boolean }
  ): Promise<void> {
    try {
      const current = webhooks.find((item) => item.id === webhook.id) ?? webhook;
      await client.updateWebhook(webhook.id, current.version, patch);
      await loadWebhooks();
    } catch (caught) {
      if (await retryWebhookUpdate(webhook.id, patch, caught)) return;
      handleFailure(caught);
    }
  }

  async function deleteWebhook(webhook: WebhookEndpoint & { ingestUrl: string }): Promise<void> {
    try {
      const current = webhooks.find((item) => item.id === webhook.id) ?? webhook;
      await client.deleteWebhook(webhook.id, current.version);
      await loadWebhooks();
    } catch (caught) {
      if (await retryWebhookDelete(webhook.id, caught)) return;
      handleFailure(caught);
    }
  }

  async function retryWebhookUpdate(
    webhookId: EntityId,
    patch: { enabled: boolean },
    caught: unknown
  ): Promise<boolean> {
    if (!(caught instanceof DentLinkApiError) || caught.code !== "version_mismatch") return false;
    const latest = await client.listWebhooks();
    setWebhooks(latest.webhooks);
    const current = latest.webhooks.find((webhook) => webhook.id === webhookId);
    if (!current) return true;
    await client.updateWebhook(webhookId, current.version, patch);
    await loadWebhooks();
    return true;
  }

  async function retryWebhookDelete(webhookId: EntityId, caught: unknown): Promise<boolean> {
    if (!(caught instanceof DentLinkApiError) || caught.code !== "version_mismatch") return false;
    const latest = await client.listWebhooks();
    setWebhooks(latest.webhooks);
    const current = latest.webhooks.find((webhook) => webhook.id === webhookId);
    if (!current) return true;
    await client.deleteWebhook(webhookId, current.version);
    await loadWebhooks();
    return true;
  }

  async function connectGmail(accountId?: EntityId): Promise<void> {
    try {
      setError(null);
      const returnTo = window.location.origin + window.location.pathname;
      const response = await client.startGmailOAuth({ returnTo, accountId });
      window.location.assign(response.authorizationUrl);
    } catch (caught) {
      handleFailure(caught);
    }
  }

  async function connectGoogleCalendar(accountId?: EntityId): Promise<void> {
    try {
      setError(null);
      const returnTo = window.location.origin + window.location.pathname;
      const response = await client.startGoogleCalendarOAuth({ returnTo, accountId });
      window.location.assign(response.authorizationUrl);
    } catch (caught) {
      handleFailure(caught);
    }
  }

  async function syncGmail(account: ConnectorAccount): Promise<void> {
    try {
      setError(null);
      const result = await client.syncGmailAccount(account.id);
      await refreshConnectorNotificationState();
      if (result.createdNotifications > 0) setView("notifications");
    } catch (caught) {
      handleFailure(caught);
      await loadConnectors().catch(() => undefined);
    }
  }

  async function disconnectGmail(account: ConnectorAccount): Promise<void> {
    try {
      setError(null);
      await client.disconnectGmailAccount(account.id);
      await loadConnectors();
    } catch (caught) {
      handleFailure(caught);
    }
  }

  async function syncGoogleCalendar(account: ConnectorAccount): Promise<void> {
    try {
      setError(null);
      const result = await client.syncGoogleCalendarAccount(account.id);
      await Promise.all([loadConnectors(), loadCalendarEvents()]);
      if (result.upsertedEvents > 0) setView("agenda");
    } catch (caught) {
      handleFailure(caught);
      await loadConnectors().catch(() => undefined);
    }
  }

  async function disconnectGoogleCalendar(account: ConnectorAccount): Promise<void> {
    try {
      setError(null);
      await client.disconnectGoogleCalendarAccount(account.id);
      await Promise.all([loadConnectors(), loadCalendarEvents()]);
    } catch (caught) {
      handleFailure(caught);
    }
  }

  async function dismissCalendarEvent(event: CalendarEvent): Promise<void> {
    const previous = calendarEvents;
    setCalendarEvents(calendarEvents.filter((item) => item.id !== event.id));
    try {
      await client.updateCalendarEvent(event.id, event.version, { status: "dismissed" });
      await loadCalendarEvents();
    } catch (caught) {
      setCalendarEvents(previous);
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
      setCalendarEvents([]);
      setWebhooks([]);
      setConnectorAccounts([]);
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
          <button className={view === "agenda" ? "selected" : ""} onClick={() => setView("agenda")}>
            Agenda
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
          <button
            className={view === "connectors" ? "selected" : ""}
            onClick={() => setView("connectors")}
          >
            Connectors
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
          onCreateNotification={createNotification}
          onUpdateNotification={updateNotification}
          onDeleteNotification={deleteNotification}
          onRefreshNotifications={loadNotifications}
          onReorderNotifications={reorderNotifications}
        />
      ) : null}
      {view === "agenda" ? (
        <AgendaView
          events={calendarEvents}
          accounts={connectorAccounts}
          onRefresh={loadCalendarEvents}
          onConnectGoogleCalendar={connectGoogleCalendar}
          onSyncGoogleCalendar={syncGoogleCalendar}
          onDismissEvent={dismissCalendarEvent}
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
          updatingNoteIds={updatingNoteIds}
        />
      ) : null}
      {view === "webhooks" ? (
        <WebhooksView
          webhooks={webhooks}
          draft={webhookDraft}
          lastSecret={lastWebhookSecret}
          onDraftChange={setWebhookDraft}
          onCreateWebhook={createWebhook}
          onUpdateWebhook={updateWebhook}
          onDeleteWebhook={deleteWebhook}
          onRefreshWebhooks={loadWebhooks}
        />
      ) : null}
      {view === "connectors" ? (
        <ConnectorsView
          accounts={connectorAccounts}
          onConnectGmail={connectGmail}
          onReconnectGmail={(account) => connectGmail(account.id)}
          onSyncGmail={syncGmail}
          onDisconnectGmail={disconnectGmail}
          onConnectGoogleCalendar={connectGoogleCalendar}
          onReconnectGoogleCalendar={(account) => connectGoogleCalendar(account.id)}
          onSyncGoogleCalendar={syncGoogleCalendar}
          onDisconnectGoogleCalendar={disconnectGoogleCalendar}
          onRefreshConnectors={refreshConnectorNotificationState}
        />
      ) : null}
    </>
  );
}

function optimisticNote(note: Note, patch: NotePatch, tags: NotesList["tags"]): Note {
  return {
    ...note,
    ...patch,
    tags: patch.tagIds
      ? tags
          .filter((tag) => patch.tagIds?.includes(tag.id))
          .sort((left, right) => left.name.localeCompare(right.name))
      : note.tags,
    version: note.version + 1
  };
}

function NotificationsView(props: {
  notifications: Notification[];
  onCreateNotification: (input: NotificationInput) => Promise<void>;
  onUpdateNotification: (
    notification: Notification,
    patch: Partial<Pick<Notification, "pinned" | "status">>
  ) => Promise<void>;
  onDeleteNotification: (notification: Notification) => Promise<void>;
  onRefreshNotifications: () => Promise<void>;
  onReorderNotifications: (notifications: Notification[]) => Promise<void>;
}): ReactElement {
  const [rankingMode, setRankingMode] = useState(false);
  const [draft, setDraft] = useState<NotificationInput>({
    title: "",
    summary: "",
    severity: "info"
  });
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
        <button onClick={() => void props.onRefreshNotifications()}>Refresh</button>
      </div>
      <form
        className="note-composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.title.trim()) return;
          void props.onCreateNotification(draft);
          setDraft({ title: "", summary: "", severity: "info" });
        }}
      >
        <input
          aria-label="New notification title"
          placeholder="New notification"
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.currentTarget.value })}
        />
        <input
          aria-label="New notification summary"
          placeholder="Summary"
          value={draft.summary ?? ""}
          onChange={(event) => setDraft({ ...draft, summary: event.currentTarget.value })}
        />
        <select
          aria-label="New notification severity"
          value={draft.severity}
          onChange={(event) =>
            setDraft({
              ...draft,
              severity: event.currentTarget.value as NotificationSeverity
            })
          }
        >
          <option value="info">Info</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <button type="submit">Add</button>
      </form>
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
            <button onClick={() => void props.onDeleteNotification(notification)}>Delete</button>
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
  onUpdateWebhook: (
    webhook: WebhookEndpoint & { ingestUrl: string },
    patch: { enabled: boolean }
  ) => Promise<void>;
  onDeleteWebhook: (webhook: WebhookEndpoint & { ingestUrl: string }) => Promise<void>;
  onRefreshWebhooks: () => Promise<void>;
}): ReactElement {
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  async function copyValue(label: string, value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(`${label} copied`);
    } catch {
      setCopyStatus(`Could not copy ${label.toLowerCase()}`);
    }
  }
  return (
    <main className="webhooks-shell">
      <div className="note-toolbar">
        <button onClick={() => void props.onRefreshWebhooks()}>Refresh</button>
      </div>
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
        <div className="app-error" role="status">
          <span>Webhook secret shown once: </span>
          <code>{props.lastSecret}</code>
          <button type="button" onClick={() => void copyValue("Secret", props.lastSecret ?? "")}>
            Copy secret
          </button>
        </div>
      ) : null}
      {copyStatus ? (
        <p className="app-error" role="status">
          {copyStatus}
        </p>
      ) : null}
      <div className="note-list">
        {props.webhooks.map((webhook) => (
          <article key={webhook.id} className="notification-card">
            <strong>{webhook.name}</strong>
            <span>{webhook.destination}</span>
            <code>{webhook.ingestUrl}</code>
            <span>{webhook.enabled ? "Enabled" : "Disabled"}</span>
            <span>
              Last triggered:{" "}
              {webhook.lastTriggeredAt
                ? new Date(webhook.lastTriggeredAt).toLocaleString()
                : "Never"}
            </span>
            <div className="note-order">
              <button type="button" onClick={() => void copyValue("URL", webhook.ingestUrl)}>
                Copy URL
              </button>
              <button
                type="button"
                onClick={() => void props.onUpdateWebhook(webhook, { enabled: !webhook.enabled })}
              >
                {webhook.enabled ? "Disable" : "Enable"}
              </button>
              <button type="button" onClick={() => void props.onDeleteWebhook(webhook)}>
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}

function AgendaView(props: {
  events: CalendarEvent[];
  accounts: ConnectorAccount[];
  onRefresh: () => Promise<void>;
  onConnectGoogleCalendar: () => Promise<void>;
  onSyncGoogleCalendar: (account: ConnectorAccount) => Promise<void>;
  onDismissEvent: (event: CalendarEvent) => Promise<void>;
}): ReactElement {
  const calendarAccounts = props.accounts.filter(
    (account) => account.connectorKey === "google-calendar"
  );
  const connectedAccounts = calendarAccounts.filter((account) => account.status === "connected");
  return (
    <main className="agenda-shell">
      <div className="note-toolbar">
        <button onClick={() => void props.onRefresh()}>Refresh</button>
        <button onClick={() => void props.onConnectGoogleCalendar()}>
          Connect Google Calendar
        </button>
        {connectedAccounts.map((account) => (
          <button key={account.id} onClick={() => void props.onSyncGoogleCalendar(account)}>
            Sync Now
          </button>
        ))}
      </div>
      {calendarAccounts.length === 0 ? <p>No Google Calendar account connected.</p> : null}
      {calendarAccounts.some((account) => account.errorMessage) ? (
        <p role="alert">{calendarAccounts.find((account) => account.errorMessage)?.errorMessage}</p>
      ) : null}
      {calendarAccounts.length > 0 && props.events.length === 0 ? <p>No upcoming events.</p> : null}
      <div className="note-list">
        {props.events.map((event) => (
          <article key={event.id} className={`notification-card calendar-event ${event.status}`}>
            <div className="note-card-top">
              <strong>{event.title}</strong>
              <span>
                {event.provider === "google-calendar" ? "Google Calendar" : event.provider}
              </span>
              {event.allDay ? <span>All day</span> : null}
            </div>
            <div className="calendar-time">
              <time dateTime={event.startAt}>{formatEventStart(event)}</time>
              <span>{event.allDay ? formatAllDayRange(event) : formatEventEnd(event)}</span>
            </div>
            {event.location ? <p>{event.location}</p> : null}
            <span>{event.calendarSummary}</span>
            <div className="note-order">
              {event.sourceUrl ? (
                <a href={event.sourceUrl} target="_blank" rel="noreferrer">
                  Open in Google Calendar
                </a>
              ) : null}
              <button type="button" onClick={() => void props.onDismissEvent(event)}>
                Dismiss
              </button>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}

function ConnectorsView(props: {
  accounts: ConnectorAccount[];
  onConnectGmail: () => Promise<void>;
  onReconnectGmail: (account: ConnectorAccount) => Promise<void>;
  onSyncGmail: (account: ConnectorAccount) => Promise<void>;
  onDisconnectGmail: (account: ConnectorAccount) => Promise<void>;
  onConnectGoogleCalendar: () => Promise<void>;
  onReconnectGoogleCalendar: (account: ConnectorAccount) => Promise<void>;
  onSyncGoogleCalendar: (account: ConnectorAccount) => Promise<void>;
  onDisconnectGoogleCalendar: (account: ConnectorAccount) => Promise<void>;
  onRefreshConnectors: () => Promise<void>;
}): ReactElement {
  const gmailAccounts = props.accounts.filter((account) => account.connectorKey === "gmail");
  const calendarAccounts = props.accounts.filter(
    (account) => account.connectorKey === "google-calendar"
  );
  return (
    <main className="webhooks-shell">
      <div className="note-toolbar">
        <button onClick={() => void props.onRefreshConnectors()}>Refresh</button>
        <button onClick={() => void props.onConnectGmail()}>Connect Gmail</button>
        <button onClick={() => void props.onConnectGoogleCalendar()}>
          Connect Google Calendar
        </button>
      </div>
      {gmailAccounts.length === 0 ? <p>No Gmail accounts connected.</p> : null}
      {calendarAccounts.length === 0 ? <p>No Google Calendar accounts connected.</p> : null}
      <div className="note-list">
        {gmailAccounts.map((account) => (
          <article key={account.id} className="notification-card">
            <strong>{account.displayName}</strong>
            <span>Status: {account.status}</span>
            <span>Health: {account.healthStatus}</span>
            <span>Sync: {account.syncStatus}</span>
            <span>
              Last sync:{" "}
              {account.lastSyncAt ? new Date(account.lastSyncAt).toLocaleString() : "Never"}
            </span>
            {account.errorMessage ? <p>{account.errorMessage}</p> : null}
            <div className="note-order">
              <button type="button" onClick={() => void props.onSyncGmail(account)}>
                Sync Now
              </button>
              <button type="button" onClick={() => void props.onReconnectGmail(account)}>
                Reconnect
              </button>
              <button type="button" onClick={() => void props.onDisconnectGmail(account)}>
                Disconnect
              </button>
            </div>
          </article>
        ))}
        {calendarAccounts.map((account) => (
          <article key={account.id} className="notification-card">
            <strong>{account.displayName}</strong>
            <span>Status: {account.status}</span>
            <span>Health: {account.healthStatus}</span>
            <span>Sync: {account.syncStatus}</span>
            <span>
              Last sync:{" "}
              {account.lastSyncAt ? new Date(account.lastSyncAt).toLocaleString() : "Never"}
            </span>
            {account.errorMessage ? <p>{account.errorMessage}</p> : null}
            <div className="note-order">
              <button type="button" onClick={() => void props.onSyncGoogleCalendar(account)}>
                Sync Now
              </button>
              <button type="button" onClick={() => void props.onReconnectGoogleCalendar(account)}>
                Reconnect
              </button>
              <button type="button" onClick={() => void props.onDisconnectGoogleCalendar(account)}>
                Disconnect
              </button>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}

function formatEventStart(event: CalendarEvent): string {
  if (event.allDay && event.startDate) return event.startDate;
  return new Date(event.startAt).toLocaleString();
}

function formatEventEnd(event: CalendarEvent): string {
  return new Date(event.endAt).toLocaleTimeString();
}

function formatAllDayRange(event: CalendarEvent): string {
  if (!event.endDate || event.endDate === event.startDate) return "All day";
  return `through ${event.endDate}`;
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
