import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";

import { DentLinkApiClient, DentLinkApiError } from "@dentlink/api-client";
import type {
  AuthSession,
  CalendarEvent,
  CalendarEventInput,
  CalendarIcsImportResult,
  CalendarSourceFilter,
  ConnectorAccount,
  EntityId,
  GmailDiagnostics,
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
type CalendarMode = "agenda" | "day" | "week" | "month";

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
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("agenda");
  const [calendarDate, setCalendarDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [calendarSource, setCalendarSource] = useState<CalendarSourceFilter>("all");
  const [calendarDraft, setCalendarDraft] = useState<CalendarEventInput>(() =>
    emptyCalendarDraft()
  );
  const [calendarActionPending, setCalendarActionPending] = useState(false);
  const [webhooks, setWebhooks] = useState<Array<WebhookEndpoint & { ingestUrl: string }>>([]);
  const [connectorAccounts, setConnectorAccounts] = useState<ConnectorAccount[]>([]);
  const [gmailDiagnostics, setGmailDiagnostics] = useState<Record<EntityId, GmailDiagnostics>>({});
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

  async function loadCalendarEvents(
    nextDate = calendarDate,
    nextSource = calendarSource,
    nextMode = calendarMode
  ): Promise<void> {
    const requestId = (calendarRequest.current += 1);
    const range = calendarRange(nextMode, nextDate);
    const response = await client.listCalendarEvents({
      timeMin: range.timeMin,
      timeMax: range.timeMax,
      source: nextSource
    });
    if (requestId === calendarRequest.current) setCalendarEvents(response.events);
  }

  async function loadWebhooks(): Promise<void> {
    const requestId = (webhooksRequest.current += 1);
    const response = await client.listWebhooks();
    if (requestId === webhooksRequest.current) setWebhooks(response.webhooks);
  }

  async function loadConnectors(): Promise<ConnectorAccount[]> {
    const requestId = (connectorsRequest.current += 1);
    const response = await client.listConnectorAccounts();
    if (requestId === connectorsRequest.current) {
      setConnectorAccounts(response.accounts);
      await loadGmailDiagnosticsForAccounts(response.accounts);
    }
    return response.accounts;
  }

  async function loadGmailDiagnosticsForAccounts(accounts: ConnectorAccount[]): Promise<void> {
    const gmailAccounts = accounts.filter((account) => account.connectorKey === "gmail");
    const entries = await Promise.all(
      gmailAccounts.map(async (account) => {
        try {
          return [account.id, await client.getGmailDiagnostics(account.id)] as const;
        } catch {
          return [account.id, null] as const;
        }
      })
    );
    setGmailDiagnostics((current) => {
      const next = { ...current };
      for (const [accountId, diagnostics] of entries) {
        if (diagnostics) next[accountId] = diagnostics;
      }
      return next;
    });
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
      const diagnostics = await client.getGmailDiagnostics(account.id);
      setGmailDiagnostics((current) => ({ ...current, [account.id]: diagnostics }));
      await refreshConnectorNotificationState();
      if (result.createdNotifications > 0) setView("notifications");
    } catch (caught) {
      handleFailure(caught);
      await loadConnectors().catch(() => undefined);
    }
  }

  async function backfillGmail(account: ConnectorAccount): Promise<void> {
    try {
      setError(null);
      const result = await client.backfillGmailAccount(account.id);
      const diagnostics = await client.getGmailDiagnostics(account.id);
      setGmailDiagnostics((current) => ({ ...current, [account.id]: diagnostics }));
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

  async function createLocalCalendarEvent(): Promise<void> {
    try {
      setError(null);
      setCalendarActionPending(true);
      await client.createLocalCalendarEvent(calendarDraft);
      setCalendarDraft(emptyCalendarDraft());
      await loadCalendarEvents();
      setView("agenda");
    } catch (caught) {
      handleFailure(caught);
    } finally {
      setCalendarActionPending(false);
    }
  }

  async function updateLocalCalendarEvent(event: CalendarEvent): Promise<void> {
    try {
      setError(null);
      await client.updateLocalCalendarEvent(event.id, event.version, {
        title: `${event.title} updated`
      });
      await loadCalendarEvents();
    } catch (caught) {
      handleFailure(caught);
    }
  }

  async function deleteLocalCalendarEvent(event: CalendarEvent): Promise<void> {
    try {
      setError(null);
      await client.deleteLocalCalendarEvent(event.id, event.version);
      await loadCalendarEvents();
    } catch (caught) {
      handleFailure(caught);
    }
  }

  async function annotateCalendarEvent(
    event: CalendarEvent,
    patch: { notes?: string; pinned?: boolean; completed?: boolean; hidden?: boolean }
  ): Promise<void> {
    try {
      setError(null);
      await client.updateCalendarAnnotation(event.id, patch, event.annotation?.version);
      await loadCalendarEvents();
    } catch (caught) {
      handleFailure(caught);
    }
  }

  async function importIcs(ics: string): Promise<CalendarIcsImportResult> {
    try {
      setError(null);
      setCalendarActionPending(true);
      const result = await client.importIcs(ics);
      await loadCalendarEvents();
      return result;
    } catch (caught) {
      handleFailure(caught);
      throw caught;
    } finally {
      setCalendarActionPending(false);
    }
  }

  async function exportIcs(): Promise<string> {
    try {
      setError(null);
      const range = calendarRange(calendarMode, calendarDate);
      return await client.exportIcs(range);
    } catch (caught) {
      handleFailure(caught);
      throw caught;
    }
  }

  function changeCalendarDate(nextDate: string): void {
    setCalendarDate(nextDate);
    void loadCalendarEvents(nextDate, calendarSource);
  }

  function changeCalendarMode(nextMode: CalendarMode): void {
    setCalendarMode(nextMode);
    void loadCalendarEvents(calendarDate, calendarSource, nextMode);
  }

  function changeCalendarSource(nextSource: CalendarSourceFilter): void {
    setCalendarSource(nextSource);
    void loadCalendarEvents(calendarDate, nextSource);
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
        <CalendarWorkspace
          events={calendarEvents}
          accounts={connectorAccounts}
          mode={calendarMode}
          selectedDate={calendarDate}
          source={calendarSource}
          draft={calendarDraft}
          actionPending={calendarActionPending}
          onModeChange={changeCalendarMode}
          onDateChange={changeCalendarDate}
          onSourceChange={changeCalendarSource}
          onDraftChange={setCalendarDraft}
          onCreateLocalEvent={createLocalCalendarEvent}
          onUpdateLocalEvent={updateLocalCalendarEvent}
          onDeleteLocalEvent={deleteLocalCalendarEvent}
          onAnnotateEvent={annotateCalendarEvent}
          onImportIcs={importIcs}
          onExportIcs={exportIcs}
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
          onBackfillGmail={backfillGmail}
          onDisconnectGmail={disconnectGmail}
          gmailDiagnostics={gmailDiagnostics}
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

function CalendarWorkspace(props: {
  events: CalendarEvent[];
  accounts: ConnectorAccount[];
  mode: CalendarMode;
  selectedDate: string;
  source: CalendarSourceFilter;
  draft: CalendarEventInput;
  actionPending: boolean;
  onModeChange: (mode: CalendarMode) => void;
  onDateChange: (date: string) => void;
  onSourceChange: (source: CalendarSourceFilter) => void;
  onDraftChange: (draft: CalendarEventInput) => void;
  onCreateLocalEvent: () => Promise<void>;
  onUpdateLocalEvent: (event: CalendarEvent) => Promise<void>;
  onDeleteLocalEvent: (event: CalendarEvent) => Promise<void>;
  onAnnotateEvent: (
    event: CalendarEvent,
    patch: { notes?: string; pinned?: boolean; completed?: boolean; hidden?: boolean }
  ) => Promise<void>;
  onImportIcs: (ics: string) => Promise<CalendarIcsImportResult>;
  onExportIcs: () => Promise<string>;
  onRefresh: () => Promise<void>;
  onConnectGoogleCalendar: () => Promise<void>;
  onSyncGoogleCalendar: (account: ConnectorAccount) => Promise<void>;
  onDismissEvent: (event: CalendarEvent) => Promise<void>;
}): ReactElement {
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const calendarAccounts = props.accounts.filter(
    (account) => account.connectorKey === "google-calendar"
  );
  const connectedAccounts = calendarAccounts.filter((account) => account.status === "connected");
  const visibleEvents = eventsForMode(props.events, props.mode, props.selectedDate);
  const eventActions = {
    onSelectEvent: setSelectedEvent,
    onUpdateLocalEvent: props.onUpdateLocalEvent,
    onDeleteLocalEvent: props.onDeleteLocalEvent,
    onAnnotateEvent: props.onAnnotateEvent,
    onDismissEvent: props.onDismissEvent
  };
  return (
    <main className="calendar-shell">
      <CalendarToolbar
        mode={props.mode}
        selectedDate={props.selectedDate}
        source={props.source}
        connectedAccounts={connectedAccounts}
        hasCalendarAccount={calendarAccounts.length > 0}
        onModeChange={props.onModeChange}
        onDateChange={props.onDateChange}
        onSourceChange={props.onSourceChange}
        onRefresh={props.onRefresh}
        onConnectGoogleCalendar={props.onConnectGoogleCalendar}
        onSyncGoogleCalendar={props.onSyncGoogleCalendar}
      />
      {calendarAccounts.length === 0 ? <p>No Google Calendar account connected.</p> : null}
      {calendarAccounts.some((account) => account.errorMessage) ? (
        <p role="alert">{calendarAccounts.find((account) => account.errorMessage)?.errorMessage}</p>
      ) : null}
      <div className="calendar-management">
        <LocalEventForm
          draft={props.draft}
          pending={props.actionPending}
          onDraftChange={props.onDraftChange}
          onCreateLocalEvent={props.onCreateLocalEvent}
        />
        <IcsControls onImportIcs={props.onImportIcs} onExportIcs={props.onExportIcs} />
      </div>
      {props.mode === "agenda" ? (
        <AgendaCalendarView events={visibleEvents} actions={eventActions} />
      ) : null}
      {props.mode === "day" ? (
        <DayCalendarView
          events={visibleEvents}
          selectedDate={props.selectedDate}
          actions={eventActions}
        />
      ) : null}
      {props.mode === "week" ? (
        <WeekCalendarView
          events={visibleEvents}
          selectedDate={props.selectedDate}
          actions={eventActions}
        />
      ) : null}
      {props.mode === "month" ? (
        <MonthCalendarView
          events={visibleEvents}
          selectedDate={props.selectedDate}
          onDateChange={props.onDateChange}
          onModeChange={props.onModeChange}
          actions={eventActions}
        />
      ) : null}
      {selectedEvent ? (
        <EventDetailsPanel
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          actions={eventActions}
        />
      ) : null}
    </main>
  );
}

type CalendarEventActions = {
  onSelectEvent: (event: CalendarEvent) => void;
  onUpdateLocalEvent: (event: CalendarEvent) => Promise<void>;
  onDeleteLocalEvent: (event: CalendarEvent) => Promise<void>;
  onAnnotateEvent: (
    event: CalendarEvent,
    patch: { notes?: string; pinned?: boolean; completed?: boolean; hidden?: boolean }
  ) => Promise<void>;
  onDismissEvent: (event: CalendarEvent) => Promise<void>;
};

function CalendarToolbar(props: {
  mode: CalendarMode;
  selectedDate: string;
  source: CalendarSourceFilter;
  connectedAccounts: ConnectorAccount[];
  hasCalendarAccount: boolean;
  onModeChange: (mode: CalendarMode) => void;
  onDateChange: (date: string) => void;
  onSourceChange: (source: CalendarSourceFilter) => void;
  onRefresh: () => Promise<void>;
  onConnectGoogleCalendar: () => Promise<void>;
  onSyncGoogleCalendar: (account: ConnectorAccount) => Promise<void>;
}): ReactElement {
  return (
    <section className="calendar-toolbar" aria-label="Calendar controls">
      <div className="calendar-toolbar-group" aria-label="Calendar view">
        {(["agenda", "day", "week", "month"] as CalendarMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            className={props.mode === mode ? "selected" : ""}
            aria-pressed={props.mode === mode}
            onClick={() => props.onModeChange(mode)}
          >
            {mode[0]?.toUpperCase()}
            {mode.slice(1)}
          </button>
        ))}
      </div>
      <div className="calendar-toolbar-group calendar-navigation" aria-label="Date navigation">
        <button
          type="button"
          onClick={() => props.onDateChange(shiftDate(props.selectedDate, props.mode, -1))}
        >
          Previous
        </button>
        <label className="calendar-date-field" htmlFor="calendar-selected-date">
          <span>{calendarRangeLabel(props.mode, props.selectedDate)}</span>
          <input
            id="calendar-selected-date"
            aria-label="Calendar date"
            type="date"
            value={props.selectedDate}
            onChange={(event) => props.onDateChange(event.target.value)}
          />
        </label>
        <button type="button" onClick={() => props.onDateChange(todayKey())}>
          Today
        </button>
        <button
          type="button"
          onClick={() => props.onDateChange(shiftDate(props.selectedDate, props.mode, 1))}
        >
          Next
        </button>
      </div>
      <div className="calendar-toolbar-group" aria-label="Calendar source">
        <label htmlFor="calendar-source">Source</label>
        <select
          id="calendar-source"
          value={props.source}
          onChange={(event) => props.onSourceChange(event.target.value as CalendarSourceFilter)}
        >
          <option value="all">All sources</option>
          <option value="google-calendar">Google Calendar</option>
          <option value="local">DentLink Local</option>
        </select>
      </div>
      <div className="calendar-toolbar-group calendar-provider-actions" aria-label="Calendar data">
        <button type="button" onClick={() => void props.onRefresh()}>
          Refresh
        </button>
        {props.connectedAccounts.map((account) => (
          <button
            key={account.id}
            type="button"
            onClick={() => void props.onSyncGoogleCalendar(account)}
          >
            Sync Now
          </button>
        ))}
        {!props.hasCalendarAccount ? (
          <button type="button" onClick={() => void props.onConnectGoogleCalendar()}>
            Connect Google Calendar
          </button>
        ) : null}
      </div>
    </section>
  );
}

function LocalEventForm(props: {
  draft: CalendarEventInput;
  pending: boolean;
  onDraftChange: (draft: CalendarEventInput) => void;
  onCreateLocalEvent: () => Promise<void>;
}): ReactElement {
  const [submitted, setSubmitted] = useState(false);
  const titleError = submitted && !props.draft.title.trim() ? "Title is required." : null;
  const dateError =
    submitted && new Date(props.draft.endAt).getTime() <= new Date(props.draft.startAt).getTime()
      ? "End must be after start."
      : null;
  return (
    <section className="calendar-panel local-event-panel" aria-labelledby="local-event-heading">
      <div>
        <h2 id="local-event-heading">Create DentLink Local Event</h2>
        <p>DentLink Local events are editable here and never write back to Google Calendar.</p>
      </div>
      <form
        className="local-event-form"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
          if (!props.draft.title.trim() || dateError) return;
          void props.onCreateLocalEvent().then(() => setSubmitted(false));
        }}
      >
        <Field label="Title" id="local-event-title" required error={titleError}>
          <input
            id="local-event-title"
            value={props.draft.title}
            placeholder="Patient consult"
            onChange={(event) => props.onDraftChange({ ...props.draft, title: event.target.value })}
          />
        </Field>
        <Field label="Start" id="local-event-start" required error={dateError}>
          <input
            id="local-event-start"
            type="datetime-local"
            value={toDateTimeLocal(props.draft.startAt)}
            onChange={(event) =>
              props.onDraftChange({
                ...props.draft,
                startAt: fromDateTimeLocal(event.target.value)
              })
            }
          />
        </Field>
        <Field label="End" id="local-event-end" required>
          <input
            id="local-event-end"
            type="datetime-local"
            value={toDateTimeLocal(props.draft.endAt)}
            onChange={(event) =>
              props.onDraftChange({ ...props.draft, endAt: fromDateTimeLocal(event.target.value) })
            }
          />
        </Field>
        <label className="checkbox-field" htmlFor="local-event-all-day">
          <input
            id="local-event-all-day"
            type="checkbox"
            checked={props.draft.allDay ?? false}
            onChange={(event) =>
              props.onDraftChange({ ...props.draft, allDay: event.target.checked })
            }
          />
          <span>All day</span>
        </label>
        <Field label="Location" id="local-event-location">
          <input
            id="local-event-location"
            value={props.draft.location ?? ""}
            placeholder="Room 3"
            onChange={(event) =>
              props.onDraftChange({ ...props.draft, location: event.target.value || null })
            }
          />
        </Field>
        <Field label="Description" id="local-event-description" className="span-2">
          <textarea
            id="local-event-description"
            value={props.draft.description ?? ""}
            placeholder="Details visible only in DentLink"
            onChange={(event) =>
              props.onDraftChange({ ...props.draft, description: event.target.value })
            }
          />
        </Field>
        <Field label="Recurrence" id="local-event-recurrence">
          <select
            id="local-event-recurrence"
            value={props.draft.recurrenceRule ?? ""}
            onChange={(event) =>
              props.onDraftChange({ ...props.draft, recurrenceRule: event.target.value || null })
            }
          >
            <option value="">No recurrence</option>
            <option value="FREQ=DAILY">Daily</option>
            <option value="FREQ=WEEKLY">Weekly</option>
            <option value="FREQ=MONTHLY">Monthly</option>
          </select>
        </Field>
        <Field label="Category" id="local-event-category">
          <input
            id="local-event-category"
            value={props.draft.category ?? ""}
            placeholder="Clinic"
            onChange={(event) =>
              props.onDraftChange({ ...props.draft, category: event.target.value || null })
            }
          />
        </Field>
        <Field label="Color" id="local-event-color">
          <input
            id="local-event-color"
            type="color"
            value={props.draft.color ?? "#2f855a"}
            onChange={(event) => props.onDraftChange({ ...props.draft, color: event.target.value })}
          />
        </Field>
        <Field label="Reminder" id="local-event-reminder">
          <select
            id="local-event-reminder"
            value={String(props.draft.reminderMinutes ?? 15)}
            onChange={(event) =>
              props.onDraftChange({
                ...props.draft,
                reminderMinutes: Number(event.target.value)
              })
            }
          >
            <option value="0">At start</option>
            <option value="5">5 minutes before</option>
            <option value="15">15 minutes before</option>
            <option value="30">30 minutes before</option>
            <option value="60">1 hour before</option>
          </select>
        </Field>
        <div className="form-actions">
          <button type="submit" disabled={props.pending}>
            {props.pending ? "Creating..." : "Create Local Event"}
          </button>
        </div>
      </form>
    </section>
  );
}

function Field(props: {
  label: string;
  id: string;
  children: ReactElement;
  required?: boolean;
  error?: string | null;
  className?: string;
}): ReactElement {
  return (
    <div className={`form-field ${props.className ?? ""}`}>
      <label htmlFor={props.id}>
        {props.label}
        {props.required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {props.children}
      {props.error ? (
        <span className="field-error" role="alert">
          {props.error}
        </span>
      ) : null}
    </div>
  );
}

function IcsControls(props: {
  onImportIcs: (ics: string) => Promise<CalendarIcsImportResult>;
  onExportIcs: () => Promise<string>;
}): ReactElement {
  const [fileName, setFileName] = useState("");
  const [fileText, setFileText] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <section className="calendar-panel ics-panel" aria-labelledby="ics-heading">
      <div>
        <h2 id="ics-heading">Import ICS</h2>
        <p>Imported .ics events become DentLink Local events.</p>
      </div>
      <label className="file-picker" htmlFor="ics-file-input">
        <span>ICS file</span>
        <input
          id="ics-file-input"
          type="file"
          accept=".ics,text/calendar"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (!file) {
              setFileName("");
              setFileText("");
              return;
            }
            setFileName(file.name);
            void file.text().then(setFileText);
          }}
        />
      </label>
      <span className="file-name">{fileName || "No file selected"}</span>
      <div className="note-order">
        <button
          type="button"
          disabled={!fileText || pending}
          onClick={() => {
            setPending(true);
            props
              .onImportIcs(fileText)
              .then((result) =>
                setStatus(
                  `Imported ${result.imported} event${result.imported === 1 ? "" : "s"}. ${
                    result.skippedDuplicates
                  } duplicate${result.skippedDuplicates === 1 ? "" : "s"} skipped.`
                )
              )
              .finally(() => setPending(false));
          }}
        >
          {pending ? "Importing..." : "Import ICS"}
        </button>
        <button
          type="button"
          onClick={() =>
            void props.onExportIcs().then((ics) => {
              downloadTextFile("dentlink-calendar.ics", ics, "text/calendar;charset=utf-8");
              setStatus("Export Local ICS download started.");
            })
          }
        >
          Export Local ICS
        </button>
      </div>
      {status ? (
        <p className="calendar-status" role="status" aria-live="polite">
          {status}
        </p>
      ) : null}
    </section>
  );
}

function AgendaCalendarView(props: {
  events: CalendarEvent[];
  actions: CalendarEventActions;
}): ReactElement {
  const sorted = [...props.events].sort(compareEventsByStart);
  if (sorted.length === 0) return <p>No events in this range.</p>;
  return (
    <section className="agenda-view" aria-label="Agenda events">
      {sorted.map((event) => (
        <CalendarEventCard key={event.id} event={event} actions={props.actions} detailed />
      ))}
    </section>
  );
}

function DayCalendarView(props: {
  events: CalendarEvent[];
  selectedDate: string;
  actions: CalendarEventActions;
}): ReactElement {
  const allDayEvents = props.events.filter((event) => isAllDayOnDate(event, props.selectedDate));
  const timedEvents = layoutTimedEvents(
    props.events.filter((event) => isTimedOnDate(event, props.selectedDate))
  );
  return (
    <section className="calendar-grid-panel" aria-label={`Day calendar for ${props.selectedDate}`}>
      <div className="calendar-all-day-row">
        <strong>All day</strong>
        <div className="calendar-chip-row">
          {allDayEvents.length === 0 ? <span>No all-day events</span> : null}
          {allDayEvents.map((event) => (
            <EventChip key={event.id} event={event} actions={props.actions} />
          ))}
        </div>
      </div>
      <div className="day-time-grid" role="grid" aria-label="Day schedule">
        <TimeLabels />
        <div className="time-grid-column" role="gridcell">
          {HOURS.map((hour) => (
            <div key={hour} className="time-grid-line" aria-hidden="true" />
          ))}
          {timedEvents.map((layout) => (
            <TimedEventBlock key={layout.event.id} layout={layout} actions={props.actions} />
          ))}
        </div>
      </div>
    </section>
  );
}

function WeekCalendarView(props: {
  events: CalendarEvent[];
  selectedDate: string;
  actions: CalendarEventActions;
}): ReactElement {
  const days = weekDays(props.selectedDate);
  return (
    <section className="calendar-grid-panel week-scroll" aria-label="Week calendar">
      <div className="week-grid">
        <div className="week-corner" />
        {days.map((day) => (
          <button
            key={day.key}
            type="button"
            className={`week-day-header ${day.key === todayKey() ? "today" : ""}`}
            aria-label={day.label}
          >
            {day.shortLabel}
          </button>
        ))}
        <div className="week-all-day-label">All day</div>
        {days.map((day) => (
          <div key={`${day.key}-all-day`} className="week-all-day-cell">
            {props.events
              .filter((event) => isAllDayOnDate(event, day.key))
              .map((event) => (
                <EventChip key={event.id} event={event} actions={props.actions} />
              ))}
          </div>
        ))}
        <TimeLabels />
        {days.map((day) => (
          <div key={`${day.key}-timed`} className="time-grid-column" role="gridcell">
            {HOURS.map((hour) => (
              <div key={hour} className="time-grid-line" aria-hidden="true" />
            ))}
            {layoutTimedEvents(props.events.filter((event) => isTimedOnDate(event, day.key))).map(
              (layout) => (
                <TimedEventBlock key={layout.event.id} layout={layout} actions={props.actions} />
              )
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function MonthCalendarView(props: {
  events: CalendarEvent[];
  selectedDate: string;
  onDateChange: (date: string) => void;
  onModeChange: (mode: CalendarMode) => void;
  actions: CalendarEventActions;
}): ReactElement {
  const cells = monthCells(props.selectedDate);
  const currentMonth = props.selectedDate.slice(0, 7);
  return (
    <section className="month-view" aria-label="Month calendar">
      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
        <div key={day} className="month-weekday">
          {day}
        </div>
      ))}
      {cells.map((cell) => {
        const events = props.events.filter((event) => eventOccursOnDate(event, cell.key));
        const visible = events.slice(0, 3);
        return (
          <div
            key={cell.key}
            className={`month-cell ${cell.key.startsWith(currentMonth) ? "" : "muted"} ${
              cell.key === todayKey() ? "today" : ""
            } ${cell.key === props.selectedDate ? "selected" : ""}`}
          >
            <button
              type="button"
              className="month-date-button"
              onClick={() => {
                props.onDateChange(cell.key);
                props.onModeChange("day");
              }}
            >
              {Number(cell.key.slice(8, 10))}
            </button>
            <div className="month-events">
              {visible.map((event) => (
                <EventChip key={event.id} event={event} actions={props.actions} compact />
              ))}
              {events.length > visible.length ? (
                <button
                  type="button"
                  className="more-events"
                  onClick={() => {
                    props.onDateChange(cell.key);
                    props.onModeChange("day");
                  }}
                >
                  +{events.length - visible.length} more
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function CalendarEventCard(props: {
  event: CalendarEvent;
  actions: CalendarEventActions;
  detailed?: boolean;
}): ReactElement {
  const event = props.event;
  return (
    <article
      className={`calendar-card ${event.source} ${event.status}`}
      aria-label={`Calendar event ${event.title}`}
      style={eventAccentStyle(event)}
    >
      <div className="calendar-card-header">
        <strong>{event.title}</strong>
        <SourceBadge event={event} />
      </div>
      <div className="calendar-time">
        <time dateTime={event.startAt}>{formatEventStart(event)}</time>
        <span>{event.allDay ? formatAllDayRange(event) : formatEventEnd(event)}</span>
        {event.allDay ? <span>All day</span> : null}
      </div>
      {event.location ? <p>{event.location}</p> : null}
      <span className="muted-text">{event.calendarSummary}</span>
      <AnnotationSummary event={event} />
      <EventActions event={event} actions={props.actions} />
    </article>
  );
}

function EventChip(props: {
  event: CalendarEvent;
  actions: CalendarEventActions;
  compact?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      className={`event-chip ${props.event.source}`}
      style={eventAccentStyle(props.event)}
      onClick={() => props.actions.onSelectEvent(props.event)}
    >
      {!props.event.allDay && !props.compact ? <span>{formatEventTime(props.event)}</span> : null}
      <strong>{props.event.title}</strong>
      <span>{sourceLabel(props.event)}</span>
    </button>
  );
}

function TimedEventBlock(props: {
  layout: TimedLayoutEvent;
  actions: CalendarEventActions;
}): ReactElement {
  const left = (props.layout.column / props.layout.columns) * 100;
  const width = 100 / props.layout.columns;
  return (
    <button
      type="button"
      className={`timed-event ${props.layout.event.source}`}
      style={{
        ...eventAccentStyle(props.layout.event),
        top: `${props.layout.top}px`,
        height: `${props.layout.height}px`,
        left: `calc(${left}% + 4px)`,
        width: `calc(${width}% - 8px)`
      }}
      onClick={() => props.actions.onSelectEvent(props.layout.event)}
    >
      <strong>{props.layout.event.title}</strong>
      <span>{formatEventTime(props.layout.event)}</span>
    </button>
  );
}

function EventDetailsPanel(props: {
  event: CalendarEvent;
  actions: CalendarEventActions;
  onClose: () => void;
}): ReactElement {
  const event = props.event;
  return (
    <aside className="event-details" aria-label={`Details for ${event.title}`}>
      <div className="calendar-card-header">
        <h2>{event.title}</h2>
        <button type="button" onClick={props.onClose}>
          Close
        </button>
      </div>
      <SourceBadge event={event} />
      <dl>
        <dt>Date and time</dt>
        <dd>
          {formatEventStart(event)}{" "}
          {event.allDay ? formatAllDayRange(event) : formatEventEnd(event)}
        </dd>
        <dt>All day</dt>
        <dd>{event.allDay ? "Yes" : "No"}</dd>
        {event.timezone ? (
          <>
            <dt>Timezone</dt>
            <dd>{event.timezone}</dd>
          </>
        ) : null}
        {event.location ? (
          <>
            <dt>Location</dt>
            <dd>{event.location}</dd>
          </>
        ) : null}
        {event.description ? (
          <>
            <dt>Description</dt>
            <dd>{event.description}</dd>
          </>
        ) : null}
        {event.recurrenceRule ? (
          <>
            <dt>Recurrence</dt>
            <dd>{event.recurrenceRule}</dd>
          </>
        ) : null}
        {event.annotation?.notes ? (
          <>
            <dt>Annotation</dt>
            <dd>{event.annotation.notes}</dd>
          </>
        ) : null}
      </dl>
      <EventActions event={event} actions={props.actions} />
    </aside>
  );
}

function EventActions(props: {
  event: CalendarEvent;
  actions: CalendarEventActions;
}): ReactElement {
  const event = props.event;
  return (
    <div className="event-actions">
      {event.sourceUrl ? (
        <a href={event.sourceUrl} target="_blank" rel="noreferrer">
          {event.source === "local" ? "Open source" : "Open in Google Calendar"}
        </a>
      ) : null}
      {event.source === "local" ? (
        <>
          <button type="button" onClick={() => void props.actions.onUpdateLocalEvent(event)}>
            Edit
          </button>
          <button type="button" onClick={() => void props.actions.onDeleteLocalEvent(event)}>
            Delete
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() =>
              void props.actions.onAnnotateEvent(event, {
                notes: event.annotation?.notes ? "" : "DentLink note",
                pinned: !(event.annotation?.pinned ?? false)
              })
            }
          >
            Annotate
          </button>
          <button
            type="button"
            onClick={() =>
              void props.actions.onAnnotateEvent(event, {
                completed: !(event.annotation?.completed ?? false)
              })
            }
          >
            {event.annotation?.completed ? "Uncomplete" : "Complete"}
          </button>
          <button
            type="button"
            onClick={() => void props.actions.onAnnotateEvent(event, { hidden: true })}
          >
            Hide
          </button>
          <button type="button" onClick={() => void props.actions.onDismissEvent(event)}>
            Dismiss
          </button>
        </>
      )}
    </div>
  );
}

function SourceBadge(props: { event: CalendarEvent }): ReactElement {
  return <span className={`source-badge ${props.event.source}`}>{sourceLabel(props.event)}</span>;
}

function AnnotationSummary(props: { event: CalendarEvent }): ReactElement | null {
  const annotation = props.event.annotation;
  if (!annotation) return null;
  const labels = [
    annotation.pinned ? "Pinned" : null,
    annotation.completed ? "Completed" : null,
    annotation.hidden ? "Hidden" : null
  ].filter(Boolean);
  return (
    <>
      {labels.length > 0 ? <span className="annotation-flags">{labels.join(" · ")}</span> : null}
      {annotation.notes ? <p>{annotation.notes}</p> : null}
    </>
  );
}

const FIRST_VISIBLE_HOUR = 6;
const LAST_VISIBLE_HOUR = 23;
const HOURS = Array.from(
  { length: LAST_VISIBLE_HOUR - FIRST_VISIBLE_HOUR + 1 },
  (_, index) => index + FIRST_VISIBLE_HOUR
);
const HOUR_HEIGHT = 64;

type TimedLayoutEvent = {
  event: CalendarEvent;
  top: number;
  height: number;
  column: number;
  columns: number;
};

function TimeLabels(): ReactElement {
  return (
    <div className="time-labels" aria-hidden="true">
      {HOURS.map((hour) => (
        <span key={hour}>{formatHour(hour)}</span>
      ))}
    </div>
  );
}

function layoutTimedEvents(events: CalendarEvent[]): TimedLayoutEvent[] {
  const sorted = [...events].sort(compareEventsByStart);
  const activeColumns: Array<{ end: number }> = [];
  const layouts = sorted.map((event) => {
    const start = eventMinutes(event.startAt);
    const end = Math.max(start + 15, eventMinutes(event.endAt));
    const visibleStart = Math.max(start, FIRST_VISIBLE_HOUR * 60);
    const visibleEnd = Math.min(end, (LAST_VISIBLE_HOUR + 1) * 60);
    let column = activeColumns.findIndex((active) => active.end <= start);
    if (column === -1) {
      column = activeColumns.length;
      activeColumns.push({ end });
    } else {
      activeColumns[column] = { end };
    }
    return {
      event,
      top: ((visibleStart - FIRST_VISIBLE_HOUR * 60) / 60) * HOUR_HEIGHT,
      height: Math.max(28, ((visibleEnd - visibleStart) / 60) * HOUR_HEIGHT),
      column,
      columns: 1
    };
  });
  const columns = Math.max(1, activeColumns.length);
  return layouts.map((layout) => ({ ...layout, columns }));
}

function weekDays(selectedDate: string): Array<{ key: string; label: string; shortLabel: string }> {
  const start = new Date(`${selectedDate}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return {
      key: date.toISOString().slice(0, 10),
      label: date.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: "UTC"
      }),
      shortLabel: date.toLocaleDateString(undefined, {
        weekday: "short",
        month: "numeric",
        day: "numeric",
        timeZone: "UTC"
      })
    };
  });
}

function monthCells(selectedDate: string): Array<{ key: string }> {
  const monthStart = new Date(`${selectedDate.slice(0, 7)}-01T00:00:00.000Z`);
  const gridStart = new Date(monthStart);
  gridStart.setUTCDate(1 - monthStart.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setUTCDate(gridStart.getUTCDate() + index);
    return { key: date.toISOString().slice(0, 10) };
  });
}

function calendarRangeLabel(mode: CalendarMode, selectedDate: string): string {
  const date = new Date(`${selectedDate}T00:00:00.000Z`);
  if (mode === "day") {
    return date.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC"
    });
  }
  if (mode === "week" || mode === "agenda") {
    const days = weekDays(selectedDate);
    return `${formatMonthDay(days[0]?.key ?? selectedDate)}-${formatMonthDay(
      days[6]?.key ?? selectedDate
    )}, ${selectedDate.slice(0, 4)}`;
  }
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

function eventOccursOnDate(event: CalendarEvent, dateKey: string): boolean {
  if (event.allDay) return isAllDayOnDate(event, dateKey);
  return isTimedOnDate(event, dateKey);
}

function isAllDayOnDate(event: CalendarEvent, dateKey: string): boolean {
  if (!event.allDay) return false;
  const start = event.startDate ?? event.startAt.slice(0, 10);
  const exclusiveEnd = event.endDate ?? event.endAt.slice(0, 10);
  return dateKey >= start && dateKey < exclusiveEnd;
}

function isTimedOnDate(event: CalendarEvent, dateKey: string): boolean {
  return !event.allDay && event.startAt.slice(0, 10) === dateKey;
}

function eventMinutes(value: string): number {
  const date = new Date(value);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function compareEventsByStart(left: CalendarEvent, right: CalendarEvent): number {
  return left.startAt.localeCompare(right.startAt) || left.title.localeCompare(right.title);
}

function eventAccentStyle(event: CalendarEvent): CSSProperties {
  const color = event.source === "local" ? event.color || "#2f855a" : "#2563eb";
  return { "--event-accent": color } as CSSProperties;
}

function sourceLabel(event: CalendarEvent): string {
  return event.source === "local" ? "DentLink Local" : "Google Calendar";
}

function formatHour(hour: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const value = hour % 12 || 12;
  return `${value} ${suffix}`;
}

function formatMonthDay(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
}

function formatEventTime(event: CalendarEvent): string {
  return `${new Date(event.startAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  })}-${new Date(event.endAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function downloadTextFile(filename: string, contents: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function ConnectorsView(props: {
  accounts: ConnectorAccount[];
  gmailDiagnostics: Record<EntityId, GmailDiagnostics>;
  onConnectGmail: () => Promise<void>;
  onReconnectGmail: (account: ConnectorAccount) => Promise<void>;
  onSyncGmail: (account: ConnectorAccount) => Promise<void>;
  onBackfillGmail: (account: ConnectorAccount) => Promise<void>;
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
            {account.settings.gmailReconnectRequired === true ? (
              <p className="connector-warning">
                Reconnect Gmail to grant read-only mailbox access required for backfill.
              </p>
            ) : null}
            <p className="connector-help">
              Sync Now checks Gmail history since the last checkpoint. Backfill 30 Days scans recent
              Gmail history without resetting existing notifications.
            </p>
            <GmailDiagnosticsSummary
              diagnostics={props.gmailDiagnostics[account.id]}
              degraded={account.healthStatus === "degraded"}
              settings={account.settings}
            />
            <div className="note-order">
              <button type="button" onClick={() => void props.onSyncGmail(account)}>
                Sync Now
              </button>
              <button type="button" onClick={() => void props.onBackfillGmail(account)}>
                Backfill 30 Days
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

function GmailDiagnosticsSummary(props: {
  diagnostics: GmailDiagnostics | undefined;
  degraded: boolean;
  settings: ConnectorAccount["settings"];
}): ReactElement | null {
  const incremental = gmailOperationSummary(props.settings, "Incremental");
  const backfill = gmailOperationSummary(props.settings, "Backfill");
  if (!props.diagnostics && !incremental && !backfill) return null;
  const summary = props.diagnostics?.summary;
  const recentMessages = props.diagnostics?.messages.slice(0, 8) ?? [];
  return (
    <section className="gmail-diagnostics" aria-label="Gmail sync diagnostics">
      {incremental ? (
        <GmailOperationPanel title="Last Incremental Sync" item={incremental} />
      ) : null}
      {backfill ? <GmailOperationPanel title="Last Backfill" item={backfill} /> : null}
      {!incremental && !backfill && summary ? (
        <GmailSummaryGrid title="Last Sync" summary={summary} />
      ) : null}
      {props.degraded && summary && summary.failed > 0 ? (
        <p className="connector-warning">
          {summary.failed} Gmail message{summary.failed === 1 ? "" : "s"} could not be processed.
          Successfully processed messages were still imported.
        </p>
      ) : null}
      {recentMessages.length > 0 ? (
        <details>
          <summary>Recent Gmail processing outcomes</summary>
          <div className="diagnostics-table-wrap">
            <table className="diagnostics-table">
              <thead>
                <tr>
                  <th>Message ID</th>
                  <th>Outcome</th>
                  <th>Reason</th>
                  <th>Processed</th>
                  <th>Notification</th>
                </tr>
              </thead>
              <tbody>
                {recentMessages.map((message) => (
                  <tr key={message.sourceRecordId}>
                    <td>{message.messageId}</td>
                    <td>{formatOutcome(message.outcome)}</td>
                    <td>{message.reason}</td>
                    <td>
                      {message.processedAt
                        ? new Date(message.processedAt).toLocaleString()
                        : "Not processed"}
                    </td>
                    <td>{message.notificationId ?? "None"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
}

function GmailOperationPanel(props: {
  title: string;
  item: {
    status: string;
    at: string | null;
    errorMessage: string | null;
    summary: GmailDiagnostics["summary"] | null;
  };
}): ReactElement {
  return (
    <div className="gmail-operation">
      <strong>{props.title}</strong>
      <span>
        {props.item.at ? new Date(props.item.at).toLocaleString() : "Not run"} · {props.item.status}
      </span>
      {props.item.summary ? <GmailSummaryGrid summary={props.item.summary} /> : null}
      {props.item.errorMessage ? (
        <p className="connector-warning">{props.item.errorMessage}</p>
      ) : null}
    </div>
  );
}

function GmailSummaryGrid(props: {
  title?: string;
  summary: GmailDiagnostics["summary"];
}): ReactElement {
  return (
    <>
      {props.title ? <strong>{props.title}</strong> : null}
      <div className="gmail-diagnostics-grid">
        <span>{props.summary.examined} messages examined</span>
        <span>{props.summary.created} notifications created</span>
        <span>{props.summary.updated} updated</span>
        <span>{props.summary.duplicate} duplicates</span>
        <span>{props.summary.skipped} skipped</span>
        <span>{props.summary.filtered} filtered</span>
        <span>{props.summary.failed} failed</span>
      </div>
    </>
  );
}

function gmailOperationSummary(
  settings: ConnectorAccount["settings"],
  operation: "Incremental" | "Backfill"
): {
  status: string;
  at: string | null;
  errorMessage: string | null;
  summary: GmailDiagnostics["summary"] | null;
} | null {
  const prefix = `gmailLast${operation}`;
  const status = stringSetting(settings[`${prefix}Status`]);
  const at = stringSetting(settings[`${prefix}At`]);
  if (!status && !at) return null;
  const summary = {
    discovered: numberSetting(settings[`${prefix}Discovered`]),
    examined: numberSetting(settings[`${prefix}Examined`]),
    created: numberSetting(settings[`${prefix}Created`]),
    updated: numberSetting(settings[`${prefix}Updated`]),
    duplicate: numberSetting(settings[`${prefix}Duplicate`]),
    skipped: numberSetting(settings[`${prefix}Skipped`]),
    filtered: numberSetting(settings[`${prefix}Filtered`]),
    failed: numberSetting(settings[`${prefix}Failed`])
  };
  const hasSummary = Object.values(summary).some((value) => value > 0);
  return {
    status: status ?? "unknown",
    at,
    errorMessage: stringSetting(settings[`${prefix}ErrorMessage`]),
    summary: hasSummary ? summary : null
  };
}

function stringSetting(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberSetting(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatOutcome(outcome: string): string {
  return outcome.replaceAll("_", " ");
}

function formatEventStart(event: CalendarEvent): string {
  if (event.allDay && event.startDate) return event.startDate;
  return new Date(event.startAt).toLocaleString();
}

function emptyCalendarDraft(): CalendarEventInput {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start);
  end.setMinutes(end.getMinutes() + 30);
  return {
    title: "",
    description: "",
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    allDay: false,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    location: null,
    recurrenceRule: null,
    category: "DentLink Local",
    color: "#2f855a",
    reminderMinutes: 15
  };
}

function calendarRange(
  mode: CalendarMode,
  selectedDate: string
): { timeMin: string; timeMax: string } {
  const start = new Date(`${selectedDate}T00:00:00.000Z`);
  if (mode === "week") start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  if (mode === "month") start.setUTCDate(1);
  if (mode === "agenda") {
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 30);
    return { timeMin: start.toISOString(), timeMax: end.toISOString() };
  }
  const end = new Date(start);
  if (mode === "day") end.setUTCDate(end.getUTCDate() + 1);
  if (mode === "week") end.setUTCDate(end.getUTCDate() + 7);
  if (mode === "month") end.setUTCMonth(end.getUTCMonth() + 1);
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}

function eventsForMode(
  events: CalendarEvent[],
  mode: CalendarMode,
  selectedDate: string
): CalendarEvent[] {
  const range = calendarRange(mode, selectedDate);
  return events.filter((event) => event.endAt >= range.timeMin && event.startAt <= range.timeMax);
}

function shiftDate(selectedDate: string, mode: CalendarMode, direction: number): string {
  const date = new Date(`${selectedDate}T00:00:00.000Z`);
  if (mode === "day") date.setUTCDate(date.getUTCDate() + direction);
  if (mode === "week" || mode === "agenda") date.setUTCDate(date.getUTCDate() + direction * 7);
  if (mode === "month") date.setUTCMonth(date.getUTCMonth() + direction);
  return date.toISOString().slice(0, 10);
}

function toDateTimeLocal(value: string): string {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromDateTimeLocal(value: string): string {
  return new Date(value).toISOString();
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
