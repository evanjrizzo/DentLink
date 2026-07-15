import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";

import { DentLinkApiClient, DentLinkApiError } from "@dentlink/api-client";
import type {
  AuthSession,
  CalendarEvent,
  CalendarEventInput,
  CalendarIcsImportResult,
  CalendarSourceFilter,
  ConnectorAccount,
  ConnectorSyncAllResult,
  DentLinkChangeEvent,
  EmailAiSettings,
  EntityId,
  GmailDiagnostics,
  GmailRule,
  Notification,
  NotificationInput,
  NotificationSeverity,
  NotificationSortMode,
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
const DEBUG_MODE_STORAGE_KEY = "dentlink.ui.debugMode.v1";
type View = "notifications" | "agenda" | "notes" | "settings";
type SettingsTab = "general" | "ai" | "connections" | "rules" | "debug" | "about";
type CalendarMode = "agenda" | "day" | "week" | "month";
type GmailSyncStage =
  | "Connecting..."
  | "Searching..."
  | "Fetching..."
  | "Applying rules..."
  | "Creating notifications..."
  | "Finished.";

type GmailSyncUiState = {
  stage: GmailSyncStage;
  running: boolean;
  error: string | null;
};

type GmailEngineSaveState = {
  engine: "gmail_api" | "gmail_imap";
  comparisonMode: boolean;
  saving: boolean;
  error: string | null;
};

type RefreshState = {
  running: boolean;
  message: string | null;
  result: ConnectorSyncAllResult | null;
  error: string | null;
};

const API_BASE_URL = import.meta.env.VITE_DENTLINK_API_BASE_URL ?? "";
const UI_REFRESH_INTERVAL_MS = 45_000;

export function DentLinkNotesApp(): ReactElement {
  const [client] = useState(
    () =>
      new DentLinkApiClient({
        baseUrl: API_BASE_URL,
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
  const [gmailRules, setGmailRules] = useState<Record<EntityId, GmailRule[]>>({});
  const [emailAiSettings, setEmailAiSettings] = useState<EmailAiSettings | null>(null);
  const [gmailSyncStates, setGmailSyncStates] = useState<Record<EntityId, GmailSyncUiState>>({});
  const [refreshState, setRefreshState] = useState<RefreshState>({
    running: false,
    message: null,
    result: null,
    error: null
  });
  const [gmailEngineSaveStates, setGmailEngineSaveStates] = useState<
    Record<EntityId, GmailEngineSaveState>
  >({});
  const [webhookDraft, setWebhookDraft] = useState({
    name: "",
    slug: "",
    destination: "notification" as WebhookDestination
  });
  const [lastWebhookSecret, setLastWebhookSecret] = useState<string | null>(null);
  const [view, setView] = useState<View>("notifications");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [debugMode, setDebugMode] = useState(() => storedDebugMode());
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
  const refreshPromise = useRef<Promise<void> | null>(null);
  const eventsAbort = useRef<AbortController | null>(null);
  const syncCursor = useRef("0");

  const filteredNotes = useMemo(() => notesList.notes, [notesList.notes]);

  useEffect(() => {
    localStorage.setItem(DEBUG_MODE_STORAGE_KEY, debugMode ? "true" : "false");
  }, [debugMode]);

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
        await refreshDentLinkData("session");
        if (hasOAuthReturnFlag()) await refreshDentLinkData("oauth");
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

  useEffect(() => {
    if (!auth) return;
    const token = auth.session.token;
    let stopped = false;
    const refreshIfVisible = () => {
      if (!stopped && document.visibilityState === "visible") void refreshDentLinkData("visible");
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshDentLinkData("poll");
    }, UI_REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", refreshIfVisible);
    startChangeStream(token);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      eventsAbort.current?.abort();
      eventsAbort.current = null;
    };
  }, [auth?.session.token]);

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
    const [response, aiSettings] = await Promise.all([
      client.listNotifications(),
      client.getEmailAiSettings().catch(() => null)
    ]);
    if (requestId === notificationsRequest.current) {
      setNotifications(response.notifications);
      if (aiSettings) setEmailAiSettings(aiSettings);
    }
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
      setConnectorAccounts((current) =>
        response.accounts.map((incoming) => {
          const existing = current.find((account) => account.id === incoming.id);
          return existing && existing.version > incoming.version ? existing : incoming;
        })
      );
      await loadGmailDiagnosticsForAccounts(response.accounts);
      await loadGmailRulesForAccounts(response.accounts);
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

  async function loadGmailRulesForAccounts(accounts: ConnectorAccount[]): Promise<void> {
    const gmailAccounts = accounts.filter((account) => account.connectorKey === "gmail");
    const entries = await Promise.all(
      gmailAccounts.map(async (account) => {
        try {
          const response = await client.getGmailRules(account.id);
          return [account.id, response.rules] as const;
        } catch {
          return [account.id, null] as const;
        }
      })
    );
    setGmailRules((current) => {
      const next = { ...current };
      for (const [accountId, rules] of entries) {
        if (rules) next[accountId] = rules;
      }
      return next;
    });
  }

  async function refreshDentLinkData(reason: string): Promise<void> {
    if (refreshPromise.current) return refreshPromise.current;
    const work = (async () => {
      try {
        await Promise.all([
          loadConnectors(),
          loadNotifications(),
          loadCalendarEvents(),
          loadNotes(),
          loadWebhooks()
        ]);
        if (reason !== "poll" && reason !== "push") setError(null);
      } catch (caught) {
        const message = refreshMessageFor(caught);
        if (reason !== "poll" && reason !== "push") setError(message);
      } finally {
        refreshPromise.current = null;
      }
    })();
    refreshPromise.current = work;
    return work;
  }

  async function refreshAll(): Promise<void> {
    if (refreshState.running) return;
    setError(null);
    setRefreshState({
      running: true,
      message: "Refreshing connected services...",
      result: null,
      error: null
    });
    try {
      setRefreshState((current) => ({ ...current, message: "Refreshing Gmail..." }));
      await refreshStepDelay();
      const result = await client.syncAllConnectors();
      setRefreshState((current) => ({ ...current, message: "Updating Notifications...", result }));
      await refreshStepDelay();
      await loadNotifications();
      setRefreshState((current) => ({ ...current, message: "Updating Calendar...", result }));
      await refreshStepDelay();
      await Promise.all([loadConnectors(), loadCalendarEvents(), loadNotes(), loadWebhooks()]);
      setRefreshState({
        running: false,
        message: refreshAllSummary(result),
        result,
        error: result.status === "failed" ? "Refresh All failed" : null
      });
      if (result.status === "partial") setError("Partial refresh completed");
    } catch (caught) {
      const message = refreshMessageFor(caught);
      await refreshDentLinkData("refresh-all-failed");
      setRefreshState({ running: false, message: null, result: null, error: message });
      setError(message);
    }
  }

  function startChangeStream(token: string): void {
    eventsAbort.current?.abort();
    const controller = new AbortController();
    eventsAbort.current = controller;
    void readDentLinkEvents(token, syncCursor.current, controller.signal, (event) => {
      syncCursor.current = String(Math.max(Number(syncCursor.current), event.revision));
      void refreshDentLinkData(`push:${event.type}`);
    }).catch(() => {
      if (!controller.signal.aborted) {
        setRefreshState((current) =>
          current.running ? current : { ...current, message: "Live updates reconnecting..." }
        );
      }
    });
  }

  async function refreshConnectorNotificationState(): Promise<void> {
    await refreshDentLinkData("manual");
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
      await refreshDentLinkData("auth");
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

  async function updateEmailAiEnabled(enabled: boolean): Promise<void> {
    try {
      const next = await client.updateEmailAiSettings({ enabled });
      setEmailAiSettings(next);
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
      setGmailSyncStage(account.id, "Connecting...", true);
      await nextFrame();
      setGmailSyncStage(account.id, "Searching...", true);
      const result = await client.syncGmailAccount(account.id);
      setGmailSyncStage(account.id, "Fetching...", true);
      await nextFrame();
      setGmailSyncStage(account.id, "Applying rules...", true);
      await nextFrame();
      setGmailSyncStage(account.id, "Creating notifications...", true);
      const diagnostics = await client.getGmailDiagnostics(account.id);
      setGmailDiagnostics((current) => ({ ...current, [account.id]: diagnostics }));
      await refreshConnectorNotificationState();
      setGmailSyncStage(account.id, "Finished.", false);
      if (result.createdNotifications > 0) setView("notifications");
    } catch (caught) {
      const message = gmailSyncMessageFor(caught, gmailActiveEngine(account.settings));
      setGmailSyncStates((current) => ({
        ...current,
        [account.id]: { stage: "Finished.", running: false, error: message }
      }));
      setError(message);
      await loadConnectors().catch(() => undefined);
    }
  }

  function setGmailSyncStage(accountId: EntityId, stage: GmailSyncStage, running: boolean): void {
    setGmailSyncStates((current) => ({
      ...current,
      [accountId]: { stage, running, error: null }
    }));
  }

  async function updateGmailEngine(
    account: ConnectorAccount,
    engine: "gmail_api" | "gmail_imap",
    comparisonMode = account.settings.gmailImapComparisonMode === true
  ): Promise<void> {
    setGmailEngineSaveStates((current) => ({
      ...current,
      [account.id]: { engine, comparisonMode, saving: true, error: null }
    }));
    try {
      setError(null);
      const updated = await saveGmailEngineSelection(account, engine, comparisonMode);
      setConnectorAccounts((current) => mergeConnectorAccount(current, updated));
      setGmailEngineSaveStates((current) => withoutKey(current, account.id));
      await refreshGmailDiagnostics(account.id);
    } catch (caught) {
      if (caught instanceof DentLinkApiError && caught.code === "version_mismatch") {
        try {
          const latestAccounts = await loadConnectors();
          const latest = latestAccounts.find((item) => item.id === account.id);
          if (!latest) throw caught;
          const updated = await saveGmailEngineSelection(latest, engine, comparisonMode);
          setConnectorAccounts((current) => mergeConnectorAccount(current, updated));
          setGmailEngineSaveStates((current) => withoutKey(current, account.id));
          await refreshGmailDiagnostics(account.id);
          return;
        } catch (retryError) {
          const message = gmailEngineSaveMessageFor(retryError);
          setGmailEngineSaveStates((current) => ({
            ...current,
            [account.id]: { engine, comparisonMode, saving: false, error: message }
          }));
          setError(message);
          return;
        }
      }
      const message = gmailEngineSaveMessageFor(caught);
      setGmailEngineSaveStates((current) => ({
        ...current,
        [account.id]: { engine, comparisonMode, saving: false, error: message }
      }));
      setError(message);
      await loadConnectors().catch(() => undefined);
    }
  }

  async function saveGmailEngineSelection(
    account: ConnectorAccount,
    engine: "gmail_api" | "gmail_imap",
    comparisonMode: boolean
  ): Promise<ConnectorAccount> {
    return client.updateGmailEngine(account.id, {
      expectedVersion: account.version,
      engine,
      comparisonMode
    });
  }

  async function refreshGmailDiagnostics(accountId: EntityId): Promise<void> {
    const diagnostics = await client.getGmailDiagnostics(accountId).catch(() => null);
    if (diagnostics) setGmailDiagnostics((current) => ({ ...current, [accountId]: diagnostics }));
  }

  async function saveGmailRules(account: ConnectorAccount, rules: GmailRule[]): Promise<void> {
    try {
      setError(null);
      const response = await client.updateGmailRules(account.id, rules);
      setConnectorAccounts((current) => mergeConnectorAccount(current, response.account));
      setGmailRules((current) => ({ ...current, [account.id]: response.rules }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gmail rules could not be saved.");
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
      eventsAbort.current?.abort();
      eventsAbort.current = null;
      syncCursor.current = "0";
      setAuth(null);
      setNotesList(initialList);
      setNotifications([]);
      setCalendarEvents([]);
      setWebhooks([]);
      setConnectorAccounts([]);
      setRefreshState({ running: false, message: null, result: null, error: null });
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
        <AppNavigation view={view} onViewChange={setView} variant="top" />
        <span className="account-email">{auth.user.email}</span>
        <button onClick={() => void logout()}>Log out</button>
      </header>
      <AppNavigation view={view} onViewChange={setView} variant="bottom" />
      <PageHeader
        title={pageTitle(view)}
        refreshRunning={refreshState.running}
        onRefreshAll={refreshAll}
      />
      {refreshState.message || refreshState.error ? (
        <section className="refresh-status" aria-live="polite">
          <strong>{refreshState.error ?? refreshState.message}</strong>
          {refreshState.result ? (
            <div className="refresh-results">
              {refreshState.result.connectors.map((connector) => (
                <span key={connector.accountId}>
                  {connectorLabel(connector.provider)}: {connector.status}
                  {connector.message ? ` - ${connector.message}` : ""}
                </span>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
      {error ? (
        <p className="app-error" role="alert">
          {error}
        </p>
      ) : null}
      {view === "notifications" ? (
        <NotificationsView
          notifications={notifications}
          aiSettings={emailAiSettings}
          onCreateNotification={createNotification}
          onUpdateNotification={updateNotification}
          onDeleteNotification={deleteNotification}
          onReorderNotifications={reorderNotifications}
          debugMode={debugMode}
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
          debugMode={debugMode}
          onRefresh={() => refreshDentLinkData("calendar")}
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
      {view === "settings" ? (
        <SettingsView
          selectedTab={settingsTab}
          onTabChange={setSettingsTab}
          debugMode={debugMode}
          onDebugModeChange={setDebugMode}
          aiSettings={emailAiSettings}
          onEmailAiEnabledChange={updateEmailAiEnabled}
          accounts={connectorAccounts}
          webhooks={webhooks}
          webhookDraft={webhookDraft}
          lastWebhookSecret={lastWebhookSecret}
          onWebhookDraftChange={setWebhookDraft}
          onCreateWebhook={createWebhook}
          onUpdateWebhook={updateWebhook}
          onDeleteWebhook={deleteWebhook}
          onConnectGmail={connectGmail}
          onReconnectGmail={(account) => connectGmail(account.id)}
          onSyncGmail={syncGmail}
          onUpdateGmailEngine={updateGmailEngine}
          onDisconnectGmail={disconnectGmail}
          gmailDiagnostics={gmailDiagnostics}
          gmailRules={gmailRules}
          gmailSyncStates={gmailSyncStates}
          gmailEngineSaveStates={gmailEngineSaveStates}
          onSaveGmailRules={saveGmailRules}
          onOpenRules={() => setSettingsTab("rules")}
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

function PageHeader(props: {
  title: string;
  refreshRunning: boolean;
  onRefreshAll: () => Promise<void>;
}): ReactElement {
  return (
    <section className="page-header" aria-label={`${props.title} page controls`}>
      <h1>{props.title}</h1>
      <button
        type="button"
        onClick={() => void props.onRefreshAll()}
        disabled={props.refreshRunning}
      >
        {props.refreshRunning ? "Refreshing..." : "Refresh All"}
      </button>
    </section>
  );
}

function pageTitle(view: View): string {
  switch (view) {
    case "agenda":
      return "Agenda";
    case "notes":
      return "Notes";
    case "settings":
      return "Settings";
    case "notifications":
    default:
      return "Notifications";
  }
}

function storedDebugMode(): boolean {
  return localStorage.getItem(DEBUG_MODE_STORAGE_KEY) === "true";
}

function AppNavigation(props: {
  view: View;
  onViewChange: (view: View) => void;
  variant: "top" | "bottom";
}): ReactElement {
  const items: Array<{ view: View; label: string }> = [
    { view: "notifications", label: "Notifications" },
    { view: "agenda", label: "Agenda" },
    { view: "notes", label: "Notes" },
    { view: "settings", label: "Settings" }
  ];
  return (
    <nav
      className={props.variant === "top" ? "app-tabs" : "mobile-bottom-tabs"}
      aria-label={props.variant === "top" ? "Primary" : "Mobile primary"}
    >
      {items.map((item) => (
        <button
          key={item.view}
          type="button"
          className={props.view === item.view ? "selected" : ""}
          aria-current={props.view === item.view ? "page" : undefined}
          onClick={() => props.onViewChange(item.view)}
        >
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function NotificationsView(props: {
  notifications: Notification[];
  aiSettings: EmailAiSettings | null;
  onCreateNotification: (input: NotificationInput) => Promise<void>;
  onUpdateNotification: (
    notification: Notification,
    patch: Partial<Pick<Notification, "pinned" | "status">>
  ) => Promise<void>;
  onDeleteNotification: (notification: Notification) => Promise<void>;
  onReorderNotifications: (notifications: Notification[]) => Promise<void>;
  debugMode: boolean;
}): ReactElement {
  const [rankingMode, setRankingMode] = useState(false);
  const [sortMode, setSortMode] = useState<NotificationSortMode>("recommended");
  const [listMode, setListMode] = useState<"active" | "history">("active");
  const [expandedId, setExpandedId] = useState<EntityId | null>(null);
  const [showFullBodyIds, setShowFullBodyIds] = useState<EntityId[]>([]);
  const [draft, setDraft] = useState<NotificationInput>({
    title: "",
    summary: "",
    severity: "info"
  });
  const visibleNotifications = props.notifications.filter((notification) =>
    listMode === "history"
      ? notification.status === "dismissed"
      : notification.status !== "dismissed"
  );
  const sorted = sortNotifications(visibleNotifications, sortMode);
  const selectedNotification = sorted.find((item) => item.id === expandedId) ?? null;
  const selectedIndex = selectedNotification ? sorted.indexOf(selectedNotification) : -1;
  return (
    <main className="notifications-shell">
      <div className="notification-mode-tabs" role="tablist" aria-label="Notification lists">
        <button
          type="button"
          className={listMode === "active" ? "selected" : ""}
          aria-pressed={listMode === "active"}
          onClick={() => setListMode("active")}
        >
          Active
        </button>
        <button
          type="button"
          className={listMode === "history" ? "selected" : ""}
          aria-pressed={listMode === "history"}
          onClick={() => setListMode("history")}
        >
          History
        </button>
        {props.debugMode ? (
          <label className="compact-select">
            Sort
            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.currentTarget.value as NotificationSortMode)}
            >
              <option value="recommended">Recommended</option>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="high_priority">High priority</option>
              <option value="requires_action">Requires action</option>
              <option value="deadline_soon">Deadline soon</option>
            </select>
          </label>
        ) : null}
        {props.debugMode ? (
          <button
            className={rankingMode ? "selected" : ""}
            onClick={() => setRankingMode((enabled) => !enabled)}
          >
            Ranking Mode
          </button>
        ) : null}
      </div>
      {props.debugMode ? (
        <>
          <section className="ai-settings-panel" aria-label="Email AI settings">
            <strong>Email AI: {props.aiSettings?.enabled ? "Enabled" : "Disabled"}</strong>
            <span>Model: {props.aiSettings?.model ?? "Not configured"}</span>
            <span>Requests this month: {props.aiSettings?.requestsThisMonth ?? 0}</span>
            <span>Failed requests: {props.aiSettings?.failedRequestsThisMonth ?? 0}</span>
            <span>
              Estimated cost:{" "}
              {props.aiSettings?.estimatedCostThisMonth === null ||
              props.aiSettings?.estimatedCostThisMonth === undefined
                ? "Not configured"
                : `$${props.aiSettings.estimatedCostThisMonth.toFixed(4)}`}
            </span>
          </section>
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
        </>
      ) : null}
      {sorted.length === 0 ? (
        <p>
          {listMode === "history" ? "No dismissed notifications yet." : "No active notifications."}
        </p>
      ) : null}
      {sorted.map((notification) => (
        <article
          key={notification.id}
          className={`notification-card compact-notification ${notification.status} importance-${importanceBand(notification)}`}
        >
          <button
            type="button"
            className="notification-summary-button"
            aria-expanded={expandedId === notification.id}
            onClick={() =>
              setExpandedId((current) => (current === notification.id ? null : notification.id))
            }
          >
            <span className="source-badge">{notification.sourceLabel}</span>
            <span className="notification-sender">{notificationSender(notification)}</span>
            <strong>
              {notification.email?.subject || notification.title || "Email notification"}
            </strong>
            <span className="notification-card-summary">{notificationSummary(notification)}</span>
            <span className="importance-pill">Importance: {importanceScore(notification)}</span>
            <span>{relativeTime(notification.email?.receivedAt ?? notification.createdAt)}</span>
            {notification.ai?.requiresAction ? (
              <span className="action-required">Action required</span>
            ) : null}
          </button>
          <div className="notification-touch-actions">
            <button
              onClick={() =>
                void props.onUpdateNotification(notification, { pinned: !notification.pinned })
              }
            >
              {notification.pinned ? "Pinned" : "Pin"}
            </button>
            <button
              onClick={() => void props.onUpdateNotification(notification, { status: "done" })}
            >
              Done
            </button>
            {notification.status === "dismissed" ? (
              <button
                onClick={() => void props.onUpdateNotification(notification, { status: "active" })}
              >
                Restore
              </button>
            ) : (
              <button
                onClick={() =>
                  void props.onUpdateNotification(notification, { status: "dismissed" })
                }
              >
                Dismiss
              </button>
            )}
          </div>
        </article>
      ))}
      {selectedNotification ? (
        <div className="adaptive-overlay" role="presentation" onClick={() => setExpandedId(null)}>
          <NotificationDetails
            notification={selectedNotification}
            debugMode={props.debugMode}
            rankingMode={rankingMode}
            showFullBody={showFullBodyIds.includes(selectedNotification.id)}
            onClose={() => setExpandedId(null)}
            onToggleFullBody={() =>
              setShowFullBodyIds((current) =>
                current.includes(selectedNotification.id)
                  ? current.filter((id) => id !== selectedNotification.id)
                  : [...current, selectedNotification.id]
              )
            }
            onDelete={() => props.onDeleteNotification(selectedNotification)}
            onMoveUp={() =>
              props.onReorderNotifications(move(sorted, selectedIndex, selectedIndex - 1))
            }
            onMoveDown={() =>
              props.onReorderNotifications(move(sorted, selectedIndex, selectedIndex + 1))
            }
            canMoveUp={selectedIndex > 0}
            canMoveDown={selectedIndex >= 0 && selectedIndex < sorted.length - 1}
          />
        </div>
      ) : null}
    </main>
  );
}

function NotificationDetails(props: {
  notification: Notification;
  debugMode: boolean;
  rankingMode: boolean;
  showFullBody: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onClose: () => void;
  onToggleFullBody: () => void;
  onDelete: () => Promise<void>;
  onMoveUp: () => Promise<void>;
  onMoveDown: () => Promise<void>;
}): ReactElement {
  const notification = props.notification;
  const hasBody = Boolean(notification.body || notification.email?.snippet);
  return (
    <section
      className="notification-detail-panel adaptive-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Notification details"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="sheet-header">
        <h2>Notification</h2>
        <button type="button" onClick={props.onClose}>
          Close
        </button>
      </div>
      <div className="detail-grid">
        <span>Source: {notification.sourceLabel}</span>
        {notification.email?.senderDisplayName ? (
          <span>Sender: {notification.email.senderDisplayName}</span>
        ) : null}
        {notification.email?.senderAddress ? (
          <span>Address: {notification.email.senderAddress}</span>
        ) : null}
        <span>
          Received:{" "}
          {new Date(notification.email?.receivedAt ?? notification.createdAt).toLocaleString()}
        </span>
        <span>Importance: {importanceScore(notification)}</span>
        {notification.ai?.category ? <span>Category: {notification.ai.category}</span> : null}
        {notification.ai?.suggestedAction ? (
          <span>Suggested action: {notification.ai.suggestedAction}</span>
        ) : null}
        {notification.ai?.deadline ? <span>Deadline: {notification.ai.deadline}</span> : null}
      </div>
      <p>{notificationSummary(notification)}</p>
      {notification.ai?.reason ? <p>{notification.ai.reason}</p> : null}
      {notification.rule ? (
        <p>
          Rule: {notification.rule.ruleName} - {notification.rule.action}
        </p>
      ) : null}
      <div className="notification-detail-actions">
        {notification.sourceUrl ? (
          <a href={notification.sourceUrl} target="_blank" rel="noreferrer">
            Open original
          </a>
        ) : null}
        {hasBody ? (
          <button type="button" onClick={props.onToggleFullBody}>
            {props.showFullBody ? "Hide full email" : "Show full email"}
          </button>
        ) : null}
      </div>
      {props.showFullBody && hasBody ? (
        <pre className="email-body-preview">{notification.body || notification.email?.snippet}</pre>
      ) : null}
      {props.debugMode ? (
        <section className={`ai-summary ${notification.ai?.status ?? "disabled"}`}>
          <strong>AI state: {notification.ai?.status ?? "disabled"}</strong>
          {notification.ai?.model ? <span>Model: {notification.ai.model}</span> : null}
          {notification.ai?.errorMessage ? <span>{notification.ai.errorMessage}</span> : null}
          {notification.rule ? <span>{notification.rule.explanation}</span> : null}
          <span>{recommendationExplanation(notification)}</span>
        </section>
      ) : null}
      {props.debugMode ? (
        <div className="note-order">
          {props.rankingMode ? (
            <>
              <button
                type="button"
                disabled={!props.canMoveUp}
                onClick={() => void props.onMoveUp()}
              >
                Up
              </button>
              <button
                type="button"
                disabled={!props.canMoveDown}
                onClick={() => void props.onMoveDown()}
              >
                Down
              </button>
            </>
          ) : null}
          <button type="button" onClick={() => void props.onDelete()}>
            Delete
          </button>
        </div>
      ) : null}
    </section>
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
  debugMode: boolean;
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
      {props.debugMode ? (
        <div className="note-toolbar">
          <button onClick={() => void props.onRefreshWebhooks()}>Refresh</button>
        </div>
      ) : null}
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
            {props.debugMode ? (
              <span>
                Last triggered:{" "}
                {webhook.lastTriggeredAt
                  ? new Date(webhook.lastTriggeredAt).toLocaleString()
                  : "Never"}
              </span>
            ) : null}
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
  debugMode: boolean;
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
  const [calendarAction, setCalendarAction] = useState<null | "menu" | "new-event" | "ics">(null);
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
        debugMode={props.debugMode}
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
      <button
        type="button"
        className="floating-action-button calendar-add-button"
        aria-label="Calendar actions"
        onClick={() => setCalendarAction("menu")}
      >
        +
      </button>
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
        <div
          className="adaptive-overlay"
          role="presentation"
          onClick={() => setSelectedEvent(null)}
        >
          <EventDetailsPanel
            event={selectedEvent}
            onClose={() => setSelectedEvent(null)}
            actions={eventActions}
          />
        </div>
      ) : null}
      {calendarAction ? (
        <div
          className="adaptive-overlay"
          role="presentation"
          onClick={() => setCalendarAction(null)}
        >
          <section
            className="adaptive-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Calendar actions"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sheet-header">
              <h2>
                {calendarAction === "new-event"
                  ? "New Local Event"
                  : calendarAction === "ics"
                    ? "Calendar Files"
                    : "Calendar Actions"}
              </h2>
              <button type="button" onClick={() => setCalendarAction(null)}>
                Close
              </button>
            </div>
            {calendarAction === "menu" ? (
              <div className="sheet-action-list">
                <button type="button" onClick={() => setCalendarAction("new-event")}>
                  New Local Event
                </button>
                <button type="button" onClick={() => setCalendarAction("ics")}>
                  Import ICS
                </button>
              </div>
            ) : null}
            {calendarAction === "new-event" ? (
              <LocalEventForm
                draft={props.draft}
                pending={props.actionPending}
                onDraftChange={props.onDraftChange}
                onCreateLocalEvent={async () => {
                  await props.onCreateLocalEvent();
                  setCalendarAction(null);
                }}
              />
            ) : null}
            {calendarAction === "ics" ? (
              <IcsControls onImportIcs={props.onImportIcs} onExportIcs={props.onExportIcs} />
            ) : null}
          </section>
        </div>
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
  debugMode: boolean;
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
      {props.debugMode ? (
        <div
          className="calendar-toolbar-group calendar-provider-actions"
          aria-label="Calendar data"
        >
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
      ) : null}
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
        <details className="local-event-more span-2">
          <summary>More Options</summary>
          <div className="local-event-more-grid">
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
                  props.onDraftChange({
                    ...props.draft,
                    recurrenceRule: event.target.value || null
                  })
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
                onChange={(event) =>
                  props.onDraftChange({ ...props.draft, color: event.target.value })
                }
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
          </div>
        </details>
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
    <aside
      className="event-details adaptive-panel"
      role="dialog"
      aria-modal="true"
      aria-label={`Details for ${event.title}`}
      onClick={(clickEvent) => clickEvent.stopPropagation()}
    >
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

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 80));
}

function refreshStepDelay(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 250));
}

async function readDentLinkEvents(
  token: string,
  cursor: string,
  signal: AbortSignal,
  onEvent: (event: DentLinkChangeEvent) => void
): Promise<void> {
  const params = new URLSearchParams({ cursor });
  const response = await fetch(`${API_BASE_URL}/v1/events?${params.toString()}`, {
    headers: {
      Accept: "text/event-stream",
      Authorization: `Bearer ${token}`
    },
    signal
  });
  if (!response.ok || !response.body) throw new Error("DentLink event stream unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseDentLinkSseChunk(chunk);
      if (event) onEvent(event);
      boundary = buffer.indexOf("\n\n");
    }
  }
}

function parseDentLinkSseChunk(chunk: string): DentLinkChangeEvent | null {
  if (!chunk.includes("event: dentlink_change")) return null;
  const dataLine = chunk
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice("data: ".length);
  if (!dataLine) return null;
  const parsed = JSON.parse(dataLine) as DentLinkChangeEvent;
  return parsed;
}

function hasOAuthReturnFlag(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get("gmail") === "connected" || params.get("calendar") === "connected";
}

function refreshAllSummary(result: ConnectorSyncAllResult): string {
  if (result.status === "success") return "Refresh All finished.";
  if (result.status === "partial") return "Refresh completed with warnings.";
  return "Refresh All failed.";
}

function refreshMessageFor(caught: unknown): string {
  if (caught instanceof DentLinkApiError) {
    if (caught.code === "network_unreachable") return "Could not reach DentLink API.";
    if (caught.status === 401) return "Sign in again before refreshing DentLink.";
    return caught.message;
  }
  if (caught instanceof Error && /fetch|network|cors/i.test(caught.message)) {
    return "Could not reach DentLink API.";
  }
  if (caught instanceof Error) return caught.message;
  return "DentLink refresh failed.";
}

function connectorLabel(provider: string): string {
  if (provider === "gmail") return "Gmail";
  if (provider === "google-calendar") return "Google Calendar";
  return provider;
}

function mergeConnectorAccount(
  accounts: ConnectorAccount[],
  updated: ConnectorAccount
): ConnectorAccount[] {
  let found = false;
  const merged = accounts.map((account) => {
    if (account.id !== updated.id) return account;
    found = true;
    return updated;
  });
  return found ? merged : [...merged, updated];
}

function withoutKey<T>(record: Record<EntityId, T>, key: EntityId): Record<EntityId, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

function exportGmailDiagnostics(
  account: ConnectorAccount,
  diagnostics: GmailDiagnostics | undefined
): void {
  const settings = account.settings;
  const payload = {
    exportedAt: new Date().toISOString(),
    account: {
      id: account.id,
      provider: account.connectorKey,
      status: account.status,
      healthStatus: account.healthStatus,
      syncStatus: account.syncStatus,
      requestedEngine: gmailSelectedEngine(settings),
      activeEngine: gmailActiveEngine(settings),
      reconnectRequired: settings.gmailReconnectRequired === true,
      verified:
        gmailActiveEngine(settings) === "gmail_imap"
          ? settings.gmailImapGranted === true
          : settings.gmailReadonlyGranted !== false
    },
    engineDiagnostics: gmailEngineDiagnostics(settings),
    comparison: gmailComparisonDiagnostics(settings),
    lastIncremental: gmailOperationSummary(settings, "Incremental"),
    lastImap: gmailOperationSummary(settings, "Imap"),
    diagnostics: diagnostics
      ? {
          summary: diagnostics.summary,
          recentOutcomes: diagnostics.messages.slice(0, 25).map((message) => ({
            outcome: message.outcome,
            reason: message.reason,
            processedAt: message.processedAt,
            linkedNotification: message.notificationId ? true : false,
            sourceRecord: message.sourceRecordId ? true : false
          }))
        }
      : null
  };
  downloadTextFile(
    `dentlink-gmail-diagnostics-${account.id}.json`,
    `${JSON.stringify(payload, null, 2)}\n`,
    "application/json;charset=utf-8"
  );
}

function sortNotifications(
  notifications: Notification[],
  mode: NotificationSortMode
): Notification[] {
  return [...notifications].sort((left, right) => {
    if (mode === "newest") return right.createdAt.localeCompare(left.createdAt);
    if (mode === "oldest") return left.createdAt.localeCompare(right.createdAt);
    if (mode === "high_priority") {
      return (
        severityScore(right.severity) - severityScore(left.severity) ||
        recommendedScore(right) - recommendedScore(left)
      );
    }
    if (mode === "requires_action") {
      return (
        Number(Boolean(right.ai?.requiresAction)) - Number(Boolean(left.ai?.requiresAction)) ||
        recommendedScore(right) - recommendedScore(left)
      );
    }
    if (mode === "deadline_soon") {
      return (
        deadlineScore(left) - deadlineScore(right) ||
        recommendedScore(right) - recommendedScore(left)
      );
    }
    return recommendedScore(right) - recommendedScore(left);
  });
}

function recommendedScore(notification: Notification): number {
  let score = importanceScore(notification) * 10 + notification.rank;
  if (notification.pinned) score += 1000;
  if (notification.rule?.action === "high_priority") score += 80;
  if (notification.rule?.action === "low_priority") score -= 30;
  if (notification.ai?.requiresAction) score += 60;
  if (notification.ai?.deadline) score += Math.max(0, 50 - deadlineScore(notification));
  score += Math.max(0, 30 - notificationAgeHours(notification));
  return score;
}

function recommendationExplanation(notification: Notification): string {
  const parts: string[] = [];
  if (notification.pinned) parts.push("pinned");
  if (notification.rule?.action === "high_priority") parts.push("high priority rule matched");
  if (notification.rule?.action === "low_priority") parts.push("low priority rule matched");
  if (notification.ai?.requiresAction) parts.push("reply or review requested");
  if (notification.ai?.deadline) parts.push(`deadline ${notification.ai.deadline}`);
  if (notification.ai?.importance !== null && notification.ai?.importance !== undefined) {
    parts.push(`importance ${importanceScore(notification)}`);
  }
  if (parts.length === 0) return "Recommended by recency and current order.";
  return `${capitalize(parts.join("; "))}.`;
}

function notificationSummary(notification: Notification): string {
  return (
    notification.ai?.summary ||
    notification.email?.snippet ||
    notification.summary ||
    notification.body ||
    "No summary available."
  );
}

function notificationSender(notification: Notification): string {
  return (
    notification.email?.senderDisplayName?.trim() ||
    notification.email?.senderAddress?.trim() ||
    notification.sourceLabel ||
    "Unknown sender"
  );
}

function importanceScore(notification: Notification): number {
  const value = notification.ai?.importance;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, Math.round(value <= 1 ? value * 100 : value)));
  }
  if (notification.severity === "high") return 85;
  if (notification.severity === "medium") return 65;
  if (notification.severity === "low") return 35;
  return 50;
}

function importanceBand(notification: Notification): "high" | "medium" | "low" {
  const score = importanceScore(notification);
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  return "low";
}

function relativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(timestamp).toLocaleDateString();
}

function severityScore(severity: NotificationSeverity): number {
  if (severity === "high") return 4;
  if (severity === "medium") return 3;
  if (severity === "low") return 2;
  return 1;
}

function deadlineScore(notification: Notification): number {
  if (!notification.ai?.deadline) return Number.MAX_SAFE_INTEGER;
  const value = Date.parse(notification.ai.deadline);
  if (Number.isNaN(value)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.floor((value - Date.now()) / 3_600_000));
}

function notificationAgeHours(notification: Notification): number {
  return Math.max(0, Math.floor((Date.now() - Date.parse(notification.createdAt)) / 3_600_000));
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase()}${value.slice(1)}`;
}

function ruleTestExplanation(rule: GmailRule, diagnostics: GmailDiagnostics | undefined): string {
  const latest = diagnostics?.messages[0];
  if (!latest) return "Test rule: no recent Gmail processing outcome available yet.";
  if (!rule.enabled) return "Test rule: disabled rules are skipped.";
  if (rule.neverNotify) return `Test rule: would suppress recent message ${latest.messageId}.`;
  if (rule.alwaysNotify)
    return `Test rule: would always notify for recent message ${latest.messageId}.`;
  return `Test rule: evaluates before AI; latest outcome was ${latest.outcome}.`;
}

function SettingsView(props: {
  selectedTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  debugMode: boolean;
  onDebugModeChange: (enabled: boolean) => void;
  aiSettings: EmailAiSettings | null;
  onEmailAiEnabledChange: (enabled: boolean) => Promise<void>;
  accounts: ConnectorAccount[];
  webhooks: Array<WebhookEndpoint & { ingestUrl: string }>;
  webhookDraft: { name: string; slug: string; destination: WebhookDestination };
  lastWebhookSecret: string | null;
  gmailDiagnostics: Record<EntityId, GmailDiagnostics>;
  gmailRules: Record<EntityId, GmailRule[]>;
  gmailSyncStates: Record<EntityId, GmailSyncUiState>;
  gmailEngineSaveStates: Record<EntityId, GmailEngineSaveState>;
  onWebhookDraftChange: (draft: {
    name: string;
    slug: string;
    destination: WebhookDestination;
  }) => void;
  onCreateWebhook: () => Promise<void>;
  onUpdateWebhook: (
    webhook: WebhookEndpoint & { ingestUrl: string },
    patch: { enabled: boolean }
  ) => Promise<void>;
  onDeleteWebhook: (webhook: WebhookEndpoint & { ingestUrl: string }) => Promise<void>;
  onConnectGmail: () => Promise<void>;
  onReconnectGmail: (account: ConnectorAccount) => Promise<void>;
  onSyncGmail: (account: ConnectorAccount) => Promise<void>;
  onUpdateGmailEngine: (
    account: ConnectorAccount,
    engine: "gmail_api" | "gmail_imap",
    comparisonMode?: boolean
  ) => Promise<void>;
  onSaveGmailRules: (account: ConnectorAccount, rules: GmailRule[]) => Promise<void>;
  onOpenRules: () => void;
  onDisconnectGmail: (account: ConnectorAccount) => Promise<void>;
  onConnectGoogleCalendar: () => Promise<void>;
  onReconnectGoogleCalendar: (account: ConnectorAccount) => Promise<void>;
  onSyncGoogleCalendar: (account: ConnectorAccount) => Promise<void>;
  onDisconnectGoogleCalendar: (account: ConnectorAccount) => Promise<void>;
  onRefreshConnectors: () => Promise<void>;
}): ReactElement {
  const gmailAccounts = props.accounts.filter((account) => account.connectorKey === "gmail");
  return (
    <main className="settings-shell">
      <nav className="settings-tabs" aria-label="Settings sections">
        {(
          [
            ["general", "General"],
            ["ai", "AI"],
            ["connections", "Connections"],
            ["rules", "Notification Rules"],
            ["debug", "Debug"],
            ["about", "About"]
          ] as const
        ).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            className={props.selectedTab === tab ? "selected" : ""}
            onClick={() => props.onTabChange(tab)}
          >
            {label}
          </button>
        ))}
      </nav>
      {props.selectedTab === "general" ? (
        <section className="settings-panel">
          <h2>General</h2>
          <p>DentLink uses backend events and a polling fallback to keep this dashboard current.</p>
          <p>Use Refresh All for a manual sync across connected services.</p>
        </section>
      ) : null}
      {props.selectedTab === "ai" ? (
        <AiSettingsPanel
          settings={props.aiSettings}
          onEnabledChange={props.onEmailAiEnabledChange}
        />
      ) : null}
      {props.selectedTab === "connections" ? (
        <ConnectorsView
          accounts={props.accounts}
          webhooks={props.webhooks}
          webhookDraft={props.webhookDraft}
          lastWebhookSecret={props.lastWebhookSecret}
          gmailDiagnostics={props.gmailDiagnostics}
          gmailRules={props.gmailRules}
          gmailSyncStates={props.gmailSyncStates}
          gmailEngineSaveStates={props.gmailEngineSaveStates}
          debugMode={props.debugMode}
          onWebhookDraftChange={props.onWebhookDraftChange}
          onCreateWebhook={props.onCreateWebhook}
          onUpdateWebhook={props.onUpdateWebhook}
          onDeleteWebhook={props.onDeleteWebhook}
          onConnectGmail={props.onConnectGmail}
          onReconnectGmail={props.onReconnectGmail}
          onSyncGmail={props.onSyncGmail}
          onUpdateGmailEngine={props.onUpdateGmailEngine}
          onSaveGmailRules={props.onSaveGmailRules}
          onOpenRules={props.onOpenRules}
          onDisconnectGmail={props.onDisconnectGmail}
          onConnectGoogleCalendar={props.onConnectGoogleCalendar}
          onReconnectGoogleCalendar={props.onReconnectGoogleCalendar}
          onSyncGoogleCalendar={props.onSyncGoogleCalendar}
          onDisconnectGoogleCalendar={props.onDisconnectGoogleCalendar}
          onRefreshConnectors={props.onRefreshConnectors}
        />
      ) : null}
      {props.selectedTab === "rules" ? (
        <section className="settings-panel">
          <h2>Notification Rules</h2>
          {gmailAccounts.length === 0 ? <p>Connect Gmail to manage email sorting rules.</p> : null}
          {gmailAccounts.map((account) => (
            <GmailRulesEditor
              key={account.id}
              account={account}
              rules={props.gmailRules[account.id] ?? []}
              diagnostics={props.gmailDiagnostics[account.id]}
              onSave={(rules) => props.onSaveGmailRules(account, rules)}
            />
          ))}
        </section>
      ) : null}
      {props.selectedTab === "debug" ? (
        <section className="settings-panel">
          <h2>Debug</h2>
          <label className="debug-toggle">
            <input
              type="checkbox"
              checked={props.debugMode}
              onChange={(event) => props.onDebugModeChange(event.currentTarget.checked)}
            />{" "}
            Debug Mode
          </label>
          <p>
            Debug Mode reveals diagnostics, detailed sync histories, sorting controls, ranking
            controls, and existing manual diagnostic actions.
          </p>
        </section>
      ) : null}
      {props.selectedTab === "about" ? (
        <section className="settings-panel">
          <h2>About</h2>
          <p>DentLink centralizes notifications, agenda, notes, and connected sources.</p>
          <p>Gmail IMAP is the primary preview ingestion engine. Gmail API remains available.</p>
        </section>
      ) : null}
    </main>
  );
}

function AiSettingsPanel(props: {
  settings: EmailAiSettings | null;
  onEnabledChange: (enabled: boolean) => Promise<void>;
}): ReactElement {
  const settings = props.settings;
  const unavailable = Boolean(settings && !settings.available);
  const status = !settings
    ? "Loading"
    : unavailable
      ? `AI unavailable: ${aiUnavailableLabel(settings.unavailableReason)}`
      : settings.enabled
        ? "Enabled"
        : "Disabled";
  return (
    <section className="settings-panel" aria-label="AI settings">
      <h2>AI</h2>
      <label className="debug-toggle">
        <input
          type="checkbox"
          checked={settings?.enabled ?? true}
          disabled={!settings || unavailable}
          onChange={(event) => void props.onEnabledChange(event.currentTarget.checked)}
        />{" "}
        AI summaries
      </label>
      <div className="settings-grid">
        <span>AI: {status}</span>
        <span>Provider: {settings?.provider ?? "OpenAI"}</span>
        <span>Model: {settings?.model ?? "Not configured"}</span>
        <span>Input limit: {settings?.maxInputChars ?? 0} characters</span>
        <span>Requests this month: {settings?.requestsThisMonth ?? 0}</span>
        <span>Failed requests: {settings?.failedRequestsThisMonth ?? 0}</span>
        <span>
          Estimated cost:{" "}
          {settings?.estimatedCostThisMonth === null ||
          settings?.estimatedCostThisMonth === undefined
            ? "Not configured"
            : `$${settings.estimatedCostThisMonth.toFixed(4)}`}
        </span>
      </div>
      <p>
        When enabled, DentLink sends bounded normalized email text, subject, and safe metadata to
        the configured AI provider after deterministic rules allow notification creation.
      </p>
      <p>Tokens, OAuth data, credentials, raw MIME, and attachment contents are never sent.</p>
    </section>
  );
}

function aiUnavailableLabel(reason: string | null | undefined): string {
  if (reason === "missing_api_key") return "OpenAI API key is not configured";
  if (reason === "disabled_by_environment") return "disabled by server configuration";
  return reason ?? "provider unavailable";
}

function ConnectorsView(props: {
  accounts: ConnectorAccount[];
  webhooks: Array<WebhookEndpoint & { ingestUrl: string }>;
  webhookDraft: { name: string; slug: string; destination: WebhookDestination };
  lastWebhookSecret: string | null;
  gmailDiagnostics: Record<EntityId, GmailDiagnostics>;
  gmailRules: Record<EntityId, GmailRule[]>;
  gmailSyncStates: Record<EntityId, GmailSyncUiState>;
  gmailEngineSaveStates: Record<EntityId, GmailEngineSaveState>;
  debugMode: boolean;
  onWebhookDraftChange: (draft: {
    name: string;
    slug: string;
    destination: WebhookDestination;
  }) => void;
  onCreateWebhook: () => Promise<void>;
  onUpdateWebhook: (
    webhook: WebhookEndpoint & { ingestUrl: string },
    patch: { enabled: boolean }
  ) => Promise<void>;
  onDeleteWebhook: (webhook: WebhookEndpoint & { ingestUrl: string }) => Promise<void>;
  onConnectGmail: () => Promise<void>;
  onReconnectGmail: (account: ConnectorAccount) => Promise<void>;
  onSyncGmail: (account: ConnectorAccount) => Promise<void>;
  onUpdateGmailEngine: (
    account: ConnectorAccount,
    engine: "gmail_api" | "gmail_imap",
    comparisonMode?: boolean
  ) => Promise<void>;
  onSaveGmailRules: (account: ConnectorAccount, rules: GmailRule[]) => Promise<void>;
  onOpenRules: () => void;
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
    <section className="connections-settings">
      <div className="connection-actions">
        {props.debugMode ? (
          <button onClick={() => void props.onRefreshConnectors()}>Refresh</button>
        ) : null}
        <button onClick={() => void props.onConnectGmail()}>Connect Gmail</button>
        <button onClick={() => void props.onConnectGoogleCalendar()}>
          Connect Google Calendar
        </button>
      </div>
      <details className="connection-section" open>
        <summary>Gmail Connections</summary>
        {gmailAccounts.length === 0 ? <p>No Gmail accounts connected.</p> : null}
        <div className="note-list">
          {gmailAccounts.map((account) => (
            <GmailConnectorCard
              key={account.id}
              account={account}
              diagnostics={props.gmailDiagnostics[account.id]}
              rules={props.gmailRules[account.id] ?? []}
              syncState={props.gmailSyncStates[account.id]}
              engineSaveState={props.gmailEngineSaveStates[account.id]}
              debugMode={props.debugMode}
              onSync={props.onSyncGmail}
              onReconnect={props.onReconnectGmail}
              onUpdateEngine={props.onUpdateGmailEngine}
              onSaveRules={props.onSaveGmailRules}
              onOpenRules={props.onOpenRules}
              onDisconnect={props.onDisconnectGmail}
            />
          ))}
        </div>
      </details>
      <details className="connection-section" open>
        <summary>Google Calendar Connections</summary>
        {calendarAccounts.length === 0 ? <p>No Google Calendar accounts connected.</p> : null}
        <div className="note-list">
          {calendarAccounts.map((account) => (
            <article key={account.id} className="notification-card">
              <strong>{account.displayName}</strong>
              <span>Status: {account.status}</span>
              {props.debugMode ? <span>Health: {account.healthStatus}</span> : null}
              {props.debugMode ? <span>Sync: {account.syncStatus}</span> : null}
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
                <button
                  type="button"
                  onClick={() => void props.onDisconnectGoogleCalendar(account)}
                >
                  Disconnect
                </button>
              </div>
            </article>
          ))}
        </div>
      </details>
      <details className="connection-section">
        <summary>Webhook Connections</summary>
        <WebhooksView
          webhooks={props.webhooks}
          draft={props.webhookDraft}
          lastSecret={props.lastWebhookSecret}
          onDraftChange={props.onWebhookDraftChange}
          onCreateWebhook={props.onCreateWebhook}
          onUpdateWebhook={props.onUpdateWebhook}
          onDeleteWebhook={props.onDeleteWebhook}
          onRefreshWebhooks={props.onRefreshConnectors}
          debugMode={props.debugMode}
        />
      </details>
    </section>
  );
}

function GmailConnectorCard(props: {
  account: ConnectorAccount;
  diagnostics: GmailDiagnostics | undefined;
  rules: GmailRule[];
  syncState: GmailSyncUiState | undefined;
  engineSaveState: GmailEngineSaveState | undefined;
  debugMode: boolean;
  onSync: (account: ConnectorAccount) => Promise<void>;
  onReconnect: (account: ConnectorAccount) => Promise<void>;
  onUpdateEngine: (
    account: ConnectorAccount,
    engine: "gmail_api" | "gmail_imap",
    comparisonMode?: boolean
  ) => Promise<void>;
  onSaveRules: (account: ConnectorAccount, rules: GmailRule[]) => Promise<void>;
  onOpenRules: () => void;
  onDisconnect: (account: ConnectorAccount) => Promise<void>;
}): ReactElement {
  const selectedEngine =
    props.engineSaveState?.engine ?? gmailSelectedEngine(props.account.settings);
  const activeEngine = gmailActiveEngine(props.account.settings);
  const comparisonMode =
    props.engineSaveState?.comparisonMode ??
    props.account.settings.gmailImapComparisonMode === true;
  const savingEngine = props.engineSaveState?.saving === true;
  const reconnectRequired =
    props.account.settings.gmailReconnectRequired === true || selectedEngine !== activeEngine;
  const engineVerified =
    activeEngine === "gmail_imap"
      ? props.account.settings.gmailImapGranted === true
      : props.account.settings.gmailReadonlyGranted !== false;
  const reason = reconnectRequired
    ? "Reconnect required"
    : props.account.errorMessage
      ? safeGmailStatusMessage(props.account.errorMessage, activeEngine)
      : engineVerified
        ? "Verified"
        : "Waiting for verification";
  const engineDiagnostics = gmailEngineDiagnostics(props.account.settings);
  const comparison = gmailComparisonDiagnostics(props.account.settings);
  const syncState = props.syncState;
  return (
    <article className="notification-card">
      <strong>{props.account.displayName}</strong>
      <div className="connector-state-grid" aria-label="Gmail connector state">
        <span>Requested Engine: {gmailEngineLabel(selectedEngine)}</span>
        <span>Active Engine: {gmailEngineLabel(activeEngine)}</span>
        <span>Connection Status: {props.account.status}</span>
        {props.debugMode ? <span>Health: {props.account.healthStatus}</span> : null}
        {props.debugMode ? <span>Sync: {props.account.syncStatus}</span> : null}
        <span>Reconnect Required: {reconnectRequired ? "Yes" : "No"}</span>
        <span>Verified: {engineVerified && !reconnectRequired ? "Yes" : "No"}</span>
        <span>Reason: {reason}</span>
        <span>
          Last Sync:{" "}
          {engineDiagnostics?.lastSyncAt
            ? new Date(engineDiagnostics.lastSyncAt).toLocaleString()
            : props.account.lastSyncAt
              ? new Date(props.account.lastSyncAt).toLocaleString()
              : "Never"}
        </span>
        <span>Next Scheduled Sync: {nextScheduledSyncLabel(engineDiagnostics?.lastSyncAt)}</span>
        <span>
          Last Successful Sync:{" "}
          {engineDiagnostics?.lastSuccessfulAt
            ? new Date(engineDiagnostics.lastSuccessfulAt).toLocaleString()
            : "Never"}
        </span>
        <span>Average Sync Time: {formatDuration(engineDiagnostics?.averageMs ?? null)}</span>
        {props.debugMode ? (
          <span>
            Latest Comparison Result:{" "}
            {comparison
              ? comparison.mismatch
                ? "Mismatch"
                : "Identical"
              : comparisonMode
                ? "Waiting"
                : "Off"}
          </span>
        ) : null}
      </div>
      {props.account.errorMessage ? (
        <p className="connector-warning">
          {safeGmailStatusMessage(props.account.errorMessage, activeEngine)}
        </p>
      ) : null}
      <label>
        Gmail Ingestion Engine
        <select
          value={selectedEngine}
          disabled={savingEngine}
          onChange={(event) =>
            void props.onUpdateEngine(
              props.account,
              event.currentTarget.value === "gmail_imap" ? "gmail_imap" : "gmail_api",
              comparisonMode
            )
          }
        >
          <option value="gmail_api">Gmail API</option>
          <option value="gmail_imap">Gmail IMAP (Preview)</option>
        </select>
      </label>
      {savingEngine ? (
        <p className="connector-progress" role="status">
          Saving...
        </p>
      ) : null}
      {props.engineSaveState?.error ? (
        <p className="connector-warning">{props.engineSaveState.error}</p>
      ) : null}
      {selectedEngine === "gmail_imap" && props.debugMode ? (
        <label>
          <input
            type="checkbox"
            checked={comparisonMode}
            disabled={savingEngine}
            onChange={(event) =>
              void props.onUpdateEngine(props.account, "gmail_imap", event.currentTarget.checked)
            }
          />{" "}
          Enable preview comparison mode
        </label>
      ) : null}
      {props.engineSaveState?.error ? (
        <button
          type="button"
          onClick={() => void props.onUpdateEngine(props.account, selectedEngine, comparisonMode)}
        >
          Retry
        </button>
      ) : null}
      {reconnectRequired ? (
        <p className="connector-warning">
          Reconnect Required. IMAP requires Gmail mail access. Reconnect upgrades your Gmail
          permission, and existing notifications and connector data are preserved.
        </p>
      ) : null}
      <p className="connector-help">
        Sync Now uses the active engine. IMAP-enabled accounts use a rolling recent scan for
        recovery.
      </p>
      {syncState ? (
        <p className={syncState.error ? "connector-warning" : "connector-progress"} role="status">
          {syncState.error ?? syncState.stage}
        </p>
      ) : null}
      <button type="button" className="secondary-action" onClick={props.onOpenRules}>
        Manage notification rules
      </button>
      {props.debugMode ? (
        <>
          <GmailDiagnosticsSummary
            diagnostics={props.diagnostics}
            degraded={props.account.healthStatus === "degraded"}
            settings={props.account.settings}
          />
        </>
      ) : null}
      <div className="note-order">
        <button
          type="button"
          onClick={() => void props.onSync(props.account)}
          disabled={syncState?.running === true}
        >
          {syncState?.running ? syncState.stage : "Sync Now"}
        </button>
        <button type="button" onClick={() => void props.onReconnect(props.account)}>
          Reconnect
        </button>
        {props.debugMode ? (
          <>
            <span className="connector-help">Export Diagnostics</span>
            <button
              type="button"
              aria-label="Export Diagnostics Download JSON"
              onClick={() => exportGmailDiagnostics(props.account, props.diagnostics)}
            >
              Download JSON
            </button>
          </>
        ) : null}
        <button type="button" onClick={() => void props.onDisconnect(props.account)}>
          Disconnect
        </button>
      </div>
    </article>
  );
}

function GmailRulesEditor(props: {
  account: ConnectorAccount;
  rules: GmailRule[];
  diagnostics: GmailDiagnostics | undefined;
  onSave: (rules: GmailRule[]) => Promise<void>;
}): ReactElement {
  const [drafts, setDrafts] = useState<GmailRule[]>(props.rules);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDrafts(props.rules), [props.account.id, JSON.stringify(props.rules)]);
  const updateRule = (index: number, patch: Partial<GmailRule>) => {
    setDrafts((current) =>
      current.map((rule, itemIndex) => (itemIndex === index ? { ...rule, ...patch } : rule))
    );
  };
  const save = async (rules: GmailRule[]) => {
    setSaving(true);
    try {
      await props.onSave(rules.map((rule, index) => ({ ...rule, priority: index + 1 })));
    } finally {
      setSaving(false);
    }
  };
  return (
    <details className="gmail-rules-panel">
      <summary>Email Sorting Rules</summary>
      <p className="connector-help">
        Rules run before optional AI summaries. Suppressed messages remain visible in Gmail
        diagnostics.
      </p>
      <div className="note-order">
        <button
          type="button"
          onClick={() =>
            setDrafts((current) => [
              ...current,
              {
                id: `gmail-rule-${Date.now()}`,
                name: "New email rule",
                enabled: true,
                priority: current.length + 1,
                matchMode: "all",
                action: "notify"
              }
            ])
          }
        >
          Add Rule
        </button>
        <button type="button" disabled={saving} onClick={() => void save(drafts)}>
          {saving ? "Saving Rules..." : "Save Rules"}
        </button>
      </div>
      {drafts.length === 0 ? <p>No email rules configured.</p> : null}
      {drafts.map((rule, index) => (
        <article key={rule.id} className="rule-card">
          <label>
            Rule name
            <input
              value={rule.name}
              onChange={(event) => updateRule(index, { name: event.currentTarget.value })}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={rule.enabled}
              onChange={(event) => updateRule(index, { enabled: event.currentTarget.checked })}
            />{" "}
            Enabled
          </label>
          <label>
            Match mode
            <select
              value={rule.matchMode ?? "all"}
              onChange={(event) =>
                updateRule(index, {
                  matchMode: event.currentTarget.value === "any" ? "any" : "all"
                })
              }
            >
              <option value="all">All conditions</option>
              <option value="any">Any condition</option>
            </select>
          </label>
          <div className="rules-grid">
            <RuleTextInput
              label="Sender address equals"
              value={rule.senderAddress}
              onChange={(value) => updateRule(index, { senderAddress: value })}
            />
            <RuleTextInput
              label="Sender domain equals"
              value={rule.senderDomain}
              onChange={(value) => updateRule(index, { senderDomain: value })}
            />
            <RuleTextInput
              label="Subject contains"
              value={rule.subjectContains}
              onChange={(value) => updateRule(index, { subjectContains: value })}
            />
            <RuleTextInput
              label="Recipient contains"
              value={rule.recipient}
              onChange={(value) => updateRule(index, { recipient: value })}
            />
            <RuleTextInput
              label="Gmail/IMAP label contains"
              value={rule.gmailLabel}
              onChange={(value) => updateRule(index, { gmailLabel: value })}
            />
            <RuleTextInput
              label="Body contains"
              value={rule.bodyContains}
              onChange={(value) => updateRule(index, { bodyContains: value })}
            />
            <RuleBooleanSelect
              label="Unread"
              value={rule.unread}
              onChange={(value) => updateRule(index, { unread: value })}
            />
            <RuleBooleanSelect
              label="Has attachment"
              value={rule.hasAttachment}
              onChange={(value) => updateRule(index, { hasAttachment: value })}
            />
            <RuleBooleanSelect
              label="Automated sender"
              value={rule.automatedSender}
              onChange={(value) => updateRule(index, { automatedSender: value })}
            />
            <RuleBooleanSelect
              label="Mailing list/newsletter"
              value={rule.mailingList}
              onChange={(value) => updateRule(index, { mailingList: value })}
            />
          </div>
          <div className="rules-grid">
            <label>
              Action
              <select
                value={rule.action}
                onChange={(event) =>
                  updateRule(index, { action: event.currentTarget.value as GmailRule["action"] })
                }
              >
                <option value="notify">Notify</option>
                <option value="suppress">Suppress</option>
                <option value="low_priority">Low priority</option>
                <option value="high_priority">High priority</option>
                <option value="assign_category">Assign category</option>
                <option value="assign_tag">Assign tag</option>
              </select>
            </label>
            <RuleTextInput
              label="Category"
              value={rule.category}
              onChange={(value) => updateRule(index, { category: value })}
            />
            <RuleTextInput
              label="Tag"
              value={rule.tag}
              onChange={(value) => updateRule(index, { tag: value })}
            />
            <label>
              <input
                type="checkbox"
                checked={rule.alwaysNotify === true}
                onChange={(event) =>
                  updateRule(index, { alwaysNotify: event.currentTarget.checked })
                }
              />{" "}
              Always notify
            </label>
            <label>
              <input
                type="checkbox"
                checked={rule.neverNotify === true}
                onChange={(event) =>
                  updateRule(index, { neverNotify: event.currentTarget.checked })
                }
              />{" "}
              Never notify
            </label>
          </div>
          <p className="rule-explanation">{ruleTestExplanation(rule, props.diagnostics)}</p>
          <div className="note-order">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => setDrafts((current) => move(current, index, index - 1))}
            >
              Up
            </button>
            <button
              type="button"
              disabled={index === drafts.length - 1}
              onClick={() => setDrafts((current) => move(current, index, index + 1))}
            >
              Down
            </button>
            <button
              type="button"
              onClick={() => setDrafts((current) => current.filter((item) => item.id !== rule.id))}
            >
              Delete
            </button>
          </div>
        </article>
      ))}
    </details>
  );
}

function RuleTextInput(props: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}): ReactElement {
  return (
    <label>
      {props.label}
      <input
        value={props.value ?? ""}
        onChange={(event) => props.onChange(event.currentTarget.value.trim() || undefined)}
      />
    </label>
  );
}

function RuleBooleanSelect(props: {
  label: string;
  value: boolean | undefined;
  onChange: (value: boolean | undefined) => void;
}): ReactElement {
  return (
    <label>
      {props.label}
      <select
        value={props.value === undefined ? "any" : props.value ? "true" : "false"}
        onChange={(event) =>
          props.onChange(
            event.currentTarget.value === "any" ? undefined : event.currentTarget.value === "true"
          )
        }
      >
        <option value="any">Any</option>
        <option value="true">True</option>
        <option value="false">False</option>
      </select>
    </label>
  );
}

function GmailDiagnosticsSummary(props: {
  diagnostics: GmailDiagnostics | undefined;
  degraded: boolean;
  settings: ConnectorAccount["settings"];
}): ReactElement | null {
  const incremental = gmailOperationSummary(props.settings, "Incremental");
  const imap = gmailOperationSummary(props.settings, "Imap");
  const engineDiagnostics = gmailEngineDiagnostics(props.settings);
  const comparison = gmailComparisonDiagnostics(props.settings);
  if (!props.diagnostics && !incremental && !imap && !engineDiagnostics) return null;
  const summary = props.diagnostics?.summary;
  const recentMessages = props.diagnostics?.messages.slice(0, 8) ?? [];
  return (
    <section className="gmail-diagnostics" aria-label="Gmail sync diagnostics">
      {engineDiagnostics ? (
        <div className="gmail-operation">
          <strong>Gmail Sync Diagnostics</strong>
          <div className="gmail-diagnostics-grid">
            <span>Engine: {gmailEngineLabel(engineDiagnostics.engine)}</span>
            <span>
              Last Sync:{" "}
              {engineDiagnostics.lastSyncAt
                ? new Date(engineDiagnostics.lastSyncAt).toLocaleString()
                : "Never"}
            </span>
            <span>Duration: {engineDiagnostics.durationMs ?? 0} ms</span>
            <span>{engineDiagnostics.scanned} messages scanned</span>
            <span>{engineDiagnostics.processed} messages processed</span>
            <span>{engineDiagnostics.created} notifications created</span>
            <span>{engineDiagnostics.duplicates} duplicates</span>
            <span>{engineDiagnostics.suppressed} suppressed</span>
            <span>{engineDiagnostics.failures} failures</span>
            <span>
              Last Successful Sync:{" "}
              {engineDiagnostics.lastSuccessfulAt
                ? new Date(engineDiagnostics.lastSuccessfulAt).toLocaleString()
                : "Never"}
            </span>
            <span>Average Sync Time: {engineDiagnostics.averageMs ?? 0} ms</span>
            <span>Expected Messages: {engineDiagnostics.expectedMessages}</span>
            <span>Actual Notifications: {engineDiagnostics.actualNotifications}</span>
            <span>Difference: {engineDiagnostics.difference}</span>
          </div>
          {engineDiagnostics.difference !== 0 ? (
            <p className="connector-warning">Possible missed messages detected.</p>
          ) : null}
        </div>
      ) : null}
      {comparison ? (
        <div className={`gmail-operation comparison-${comparison.mismatch ? "mismatch" : "match"}`}>
          <strong>Preview Comparison</strong>
          <div className="gmail-diagnostics-grid">
            <span>IMAP discovered: {comparison.imapDiscovered}</span>
            <span>API discovered: {comparison.apiDiscovered}</span>
            <span>Difference: {comparison.difference}</span>
            <span>Notifications created: {comparison.notificationsCreated}</span>
            <span>Duplicates: {comparison.duplicates}</span>
            <span>Failures: {comparison.failures}</span>
          </div>
          {comparison.mismatch ? (
            <details>
              <summary className="connector-warning">
                Potential missed messages detected. View comparison
              </summary>
              <div className="gmail-diagnostics-grid">
                <span>Compared: {new Date(comparison.at).toLocaleString()}</span>
                <span>IMAP discovered: {comparison.imapDiscovered}</span>
                <span>API discovered: {comparison.apiDiscovered}</span>
                <span>Difference: {comparison.difference}</span>
              </div>
            </details>
          ) : (
            <p className="connector-success">Comparison identical.</p>
          )}
        </div>
      ) : null}
      {imap ? <GmailOperationPanel title="Last IMAP Sync" item={imap} /> : null}
      {incremental ? (
        <GmailOperationPanel title="Last Incremental Sync" item={incremental} />
      ) : null}
      {!incremental && !imap && summary ? (
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
    averageMs: number | null;
    summary: GmailDiagnostics["summary"] | null;
  };
}): ReactElement {
  return (
    <div className="gmail-operation">
      <strong>{props.title}</strong>
      <span>
        {props.item.at ? new Date(props.item.at).toLocaleString() : "Not run"} · {props.item.status}
      </span>
      {props.item.averageMs ? <span>Average sync time: {props.item.averageMs} ms</span> : null}
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

function gmailSelectedEngine(settings: ConnectorAccount["settings"]): "gmail_api" | "gmail_imap" {
  return settings.gmailRequestedIngestionEngine === "gmail_imap" ||
    settings.gmailIngestionEngine === "gmail_imap"
    ? "gmail_imap"
    : "gmail_api";
}

function gmailActiveEngine(settings: ConnectorAccount["settings"]): "gmail_api" | "gmail_imap" {
  return settings.gmailIngestionEngine === "gmail_imap" ? "gmail_imap" : "gmail_api";
}

function gmailEngineLabel(engine: "gmail_api" | "gmail_imap"): string {
  return engine === "gmail_imap" ? "Gmail IMAP (Preview)" : "Gmail API";
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return "Unknown";
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}

function nextScheduledSyncLabel(lastSyncAt: string | null | undefined): string {
  if (!lastSyncAt) return "Within 5 minutes after activation";
  const next = new Date(new Date(lastSyncAt).getTime() + 5 * 60 * 1000);
  return next.toLocaleString();
}

function safeGmailStatusMessage(message: string, engine: "gmail_api" | "gmail_imap"): string {
  if (message === "Unexpected server error") {
    return engine === "gmail_imap"
      ? "Temporary Gmail IMAP sync error. Check diagnostics and try Sync Now again."
      : "Temporary Gmail API sync error. Check diagnostics and try Sync Now again.";
  }
  return message;
}

function gmailEngineSaveMessageFor(caught: unknown): string {
  if (caught instanceof DentLinkApiError) {
    if (caught.code === "network_unreachable") {
      return "DentLink could not reach the preview API. Your engine selection was not saved.";
    }
    if (caught.code === "version_mismatch") {
      return "Gmail connector changed while saving. Refresh and try again.";
    }
    if (caught.code === "invalid_gmail_engine")
      return "Gmail ingestion engine selection is invalid.";
    if (caught.status === 401) return "Sign in again before changing the Gmail ingestion engine.";
    return caught.message;
  }
  if (caught instanceof Error && /fetch|network|cors/i.test(caught.message)) {
    return "DentLink could not reach the preview API. Your engine selection was not saved.";
  }
  if (caught instanceof Error) return caught.message;
  return "Gmail ingestion engine selection could not be saved.";
}

function gmailSyncMessageFor(caught: unknown, engine: "gmail_api" | "gmail_imap"): string {
  if (caught instanceof DentLinkApiError) {
    switch (caught.code) {
      case "gmail_auth_failed":
        return "IMAP login failed. Reconnect Gmail and try again.";
      case "gmail_permission_denied":
        return "OAuth scope insufficient. Reconnect Gmail to grant mail access.";
      case "gmail_rate_limited":
        return "Temporary Gmail network error. Gmail rate limited this sync.";
      case "gmail_response_invalid":
        return "Message fetch failed. Gmail returned an unreadable response.";
      case "gmail_upstream_failed":
        return "Temporary Gmail network error. Try Sync Now again.";
      case "internal_error":
        return safeGmailStatusMessage(caught.message, engine);
      default:
        return safeGmailStatusMessage(caught.message, engine);
    }
  }
  if (caught instanceof Error) return safeGmailStatusMessage(caught.message, engine);
  return engine === "gmail_imap"
    ? "Temporary Gmail IMAP sync error. Try Sync Now again."
    : "Temporary Gmail API sync error. Try Sync Now again.";
}

function gmailEngineDiagnostics(settings: ConnectorAccount["settings"]): {
  engine: "gmail_api" | "gmail_imap";
  lastSyncAt: string | null;
  durationMs: number | null;
  scanned: number;
  processed: number;
  created: number;
  duplicates: number;
  suppressed: number;
  failures: number;
  lastSuccessfulAt: string | null;
  averageMs: number | null;
  expectedMessages: number;
  actualNotifications: number;
  difference: number;
} | null {
  const lastSyncAt = stringSetting(settings.gmailLastSyncAt);
  const engine = settings.gmailLastSyncEngine === "gmail_imap" ? "gmail_imap" : "gmail_api";
  if (!lastSyncAt && settings.gmailLastSyncScanned === undefined) return null;
  return {
    engine,
    lastSyncAt,
    durationMs: nullableNumberSetting(settings.gmailLastSyncDurationMs),
    scanned: numberSetting(settings.gmailLastSyncScanned),
    processed: numberSetting(settings.gmailLastSyncProcessed),
    created: numberSetting(settings.gmailLastSyncCreated),
    duplicates: numberSetting(settings.gmailLastSyncDuplicate),
    suppressed: numberSetting(settings.gmailLastSyncSuppressed),
    failures: numberSetting(settings.gmailLastSyncFailed),
    lastSuccessfulAt: stringSetting(settings.gmailLastSuccessfulSyncAt),
    averageMs: nullableNumberSetting(settings.gmailAverageSyncMs),
    expectedMessages: numberSetting(settings.gmailExpectedMessages),
    actualNotifications: numberSetting(settings.gmailActualNotifications),
    difference: numberSetting(settings.gmailMissingMessageDifference)
  };
}

function gmailComparisonDiagnostics(settings: ConnectorAccount["settings"]): {
  at: string;
  apiDiscovered: number;
  imapDiscovered: number;
  difference: number;
  notificationsCreated: number;
  duplicates: number;
  failures: number;
  mismatch: boolean;
} | null {
  const at = stringSetting(settings.gmailLastComparisonAt);
  if (!at) return null;
  const apiDiscovered = numberSetting(settings.gmailLastComparisonApiDiscovered);
  const imapDiscovered = numberSetting(settings.gmailLastComparisonImapDiscovered);
  return {
    at,
    apiDiscovered,
    imapDiscovered,
    difference: Math.abs(imapDiscovered - apiDiscovered),
    notificationsCreated: numberSetting(settings.gmailLastComparisonNotificationsCreated),
    duplicates: numberSetting(settings.gmailLastComparisonDuplicates),
    failures: numberSetting(settings.gmailLastComparisonFailures),
    mismatch: settings.gmailLastComparisonMismatch === true
  };
}

function gmailOperationSummary(
  settings: ConnectorAccount["settings"],
  operation: "Incremental" | "Backfill" | "Imap"
): {
  status: string;
  at: string | null;
  errorMessage: string | null;
  averageMs: number | null;
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
    averageMs: nullableNumberSetting(settings[`${prefix}AverageSyncMs`]),
    summary: hasSummary ? summary : null
  };
}

function stringSetting(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberSetting(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nullableNumberSetting(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
