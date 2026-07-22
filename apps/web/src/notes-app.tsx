import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";

import { DentLinkApiClient, DentLinkApiError } from "@dentlink/api-client";
import type {
  AssistantChatSource,
  AuthSession,
  CalendarEvent,
  CalendarEventInput,
  CalendarIcsImportResult,
  CalendarSourceFilter,
  ConnectorAccount,
  ConnectorSyncAllResult,
  DentLinkChangeEvent,
  EmailAiReprocessResult,
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
  UserPreferences,
  WebhookDestination,
  WebhookEndpoint
} from "@dentlink/item-model";
import { NotesWorkspace } from "@dentlink/ui";

const initialList: NotesList = { notes: [], folders: [], tags: [] };
const SESSION_STORAGE_KEY = "dentlink.auth.session.v1";
const DEBUG_MODE_STORAGE_KEY = "dentlink.ui.debugMode.v1";
const APPEARANCE_STORAGE_KEY = "dentlink.appearance.v1";
type View = "home" | "notifications" | "agenda" | "notes" | "settings";
type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: AssistantChatSource[];
  error?: boolean;
};
type SettingsTab = "general" | "appearance" | "ai" | "connections" | "rules" | "debug" | "about";
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

type ConnectorReconnectWarning = {
  accountId: EntityId;
  title: string;
  message: string;
};

type RefreshState = {
  running: boolean;
  message: string | null;
  result: ConnectorSyncAllResult | null;
  error: string | null;
  live: "connecting" | "connected" | "reconnecting" | "degraded";
  nextPollAt: string | null;
  lastAttemptAt: string | null;
};

type QueuedNoteMutation = {
  patch: NotePatch;
  inFlight: boolean;
  timer: number | null;
  sequence: number;
};

type AppearancePreferences = {
  version: 2;
  preset:
    "light" | "soft-gray" | "neutral-gray" | "dark" | "charcoal" | "oled" | "purple" | "system";
  loadedProfileId: string | null;
  loadedProfileName: string;
  profiles: AppearanceProfile[];
  accent: string;
  colors: AppearanceColorSettings;
  typography: AppearanceTypographySettings;
  surfaces: AppearanceSurfaceSettings;
  inputs: AppearanceInputSettings;
  buttons: AppearanceButtonSettings;
  cards: AppearanceCardSettings;
  borders: AppearanceBorderSettings;
  statusColors: AppearanceStatusSettings;
  branding: AppearanceBrandingSettings;
  roundedness: number;
  animations: boolean;
  sourceColors: Record<string, string>;
};

type AppearanceProfile = {
  id: string;
  name: string;
  builtIn: boolean;
  settings: AppearanceSnapshot;
  createdAt: string;
  updatedAt: string;
};

type AppearanceSnapshot = Omit<
  AppearancePreferences,
  "profiles" | "loadedProfileId" | "loadedProfileName"
>;

type AppearanceColorSettings = {
  primaryText: string;
  secondaryText: string;
  mutedText: string;
  headings: string;
  navigationText: string;
  cardTitles: string;
  bodyText: string;
  metadataText: string;
  links: string;
  successText: string;
  warningText: string;
  dangerText: string;
  notificationMetadata: string;
};

type AppearanceTypographySettings = {
  base: number;
  small: number;
  cardTitle: number;
  pageHeading: number;
  navigation: number;
  control: number;
};

type AppearanceSurfaceSettings = {
  appBackground: string;
  headerBackground: string;
  toolbarBackground: string;
  cardBackground: string;
  elevatedPanel: string;
  modalBackground: string;
  selectedBackground: string;
  hoverBackground: string;
  divider: string;
};

type AppearanceInputSettings = {
  background: string;
  text: string;
  placeholder: string;
  border: string;
  focusBorder: string;
  invalidBorder: string;
  disabledBackground: string;
  disabledText: string;
};

type AppearanceButtonSettings = {
  primaryBackground: string;
  primaryText: string;
  secondaryBackground: string;
  secondaryText: string;
  destructiveBackground: string;
  destructiveText: string;
  iconBackground: string;
  iconColor: string;
  hoverBackground: string;
  pressedBackground: string;
  disabledBackground: string;
  disabledText: string;
  focusRing: string;
};

type AppearanceCardSettings = {
  background: string;
  border: string;
  title: string;
  body: string;
  metadata: string;
  pinnedAccent: string;
  hover: string;
  shadow: number;
  radius: number;
  borderWidth: number;
  noteMinWidth: number;
};

type AppearanceBorderSettings = {
  globalRadius: number;
  cardRadius: number;
  borderWidth: number;
  shadowIntensity: number;
};

type AppearanceStatusSettings = {
  success: string;
  warning: string;
  danger: string;
  info: string;
  suppressed: string;
};

type AppearanceBrandingSettings = {
  logoVariant: "standard" | "dark" | "auto";
  logoBackground: string;
  logoBorder: string;
  logoRadius: number;
  showLogoBorder: boolean;
};

type IconName = "check" | "close" | "external" | "pin" | "restore";

const API_BASE_URL = import.meta.env.VITE_DENTLINK_API_BASE_URL ?? "";
const UI_REFRESH_INTERVAL_MS = 60_000;
const DEFAULT_IMPORTANCE_INSTRUCTION =
  "Prioritize messages that need my action, affect scheduling, billing, safety, family, healthcare, work commitments, travel, or account security. Lower the score for routine marketing, receipts without action, newsletters, automated confirmations, and FYI-only updates.";
const MAX_PROMPT_CHARS = 2000;

export function DentLinkNotesApp(): ReactElement {
  const initialSession = useMemo(() => storedSession(), []);
  const [client] = useState(
    () =>
      new DentLinkApiClient({
        baseUrl: API_BASE_URL,
        token: initialSession?.session.token ?? null
      })
  );
  const [auth, setAuth] = useState<AuthSession | null>(() => initialSession);
  const [desktopSessionHydrating, setDesktopSessionHydrating] = useState(
    () => isDesktopClient() && !initialSession
  );
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
    error: null,
    live: "connecting",
    nextPollAt: null,
    lastAttemptAt: null
  });
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [aiReprocessResult, setAiReprocessResult] = useState<EmailAiReprocessResult | null>(null);
  const [aiReprocessRunning, setAiReprocessRunning] = useState(false);
  const [gmailEngineSaveStates, setGmailEngineSaveStates] = useState<
    Record<EntityId, GmailEngineSaveState>
  >({});
  const [webhookDraft, setWebhookDraft] = useState({
    name: "",
    slug: "",
    destination: "notification" as WebhookDestination
  });
  const [lastWebhookSecret, setLastWebhookSecret] = useState<string | null>(null);
  const [view, setView] = useState<View>("home");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
  const [assistantDraft, setAssistantDraft] = useState("");
  const [assistantRunning, setAssistantRunning] = useState(false);
  const [desktopAssistantRequest, setDesktopAssistantRequest] = useState(0);
  const [debugMode, setDebugMode] = useState(() => storedDebugMode());
  const [appearance, setAppearance] = useState<AppearancePreferences>(() => storedAppearance());
  const [search, setSearch] = useState("");
  const [folderId, setFolderId] = useState<EntityId | null>(null);
  const [tagIds, setTagIds] = useState<EntityId[]>([]);
  const [openNoteId, setOpenNoteId] = useState<EntityId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatingNoteIds, setUpdatingNoteIds] = useState<EntityId[]>([]);
  const notesRequest = useRef(0);
  const notificationsRequest = useRef(0);
  const calendarRequest = useRef(0);
  const webhooksRequest = useRef(0);
  const connectorsRequest = useRef(0);
  const refreshPromise = useRef<Promise<void> | null>(null);
  const connectorSyncPromise = useRef<Promise<ConnectorSyncAllResult | null> | null>(null);
  const refreshAllRunning = useRef(false);
  const eventsAbort = useRef<AbortController | null>(null);
  const syncCursor = useRef("0");
  const noteMutations = useRef(new Map<EntityId, QueuedNoteMutation>());
  const noteMutationSequence = useRef(0);
  const notesListRef = useRef(notesList);

  const effectiveTimezone = preferences?.timezone.selected ?? detectedTimezone();
  const calendarEventsWithNotes = useMemo(
    () => [
      ...calendarEvents,
      ...dueNoteCalendarEvents(notesList.notes, effectiveTimezone, calendarMode)
    ],
    [calendarEvents, notesList.notes, effectiveTimezone, calendarMode, calendarDate]
  );
  const reconnectWarnings = useMemo(
    () => connectorReconnectWarnings(connectorAccounts, gmailEngineSaveStates),
    [connectorAccounts, gmailEngineSaveStates]
  );

  useEffect(() => {
    notesListRef.current = notesList;
  }, [notesList]);

  useEffect(() => {
    if (!isDesktopClient()) return;
    document.documentElement.classList.add("dentlink-desktop-client");
    const removeMomentumScrolling = installDesktopMomentumScrolling();
    const fallback = window.setTimeout(() => setDesktopSessionHydrating(false), 1000);
    function handleDesktopSession(event: MessageEvent): void {
      if (event.source !== window.parent) return;
      const data = event.data as { type?: string; session?: AuthSession | null } | null;
      if (!data || data.type !== "dentlink.desktop.session.response") return;
      window.clearTimeout(fallback);
      setDesktopSessionHydrating(false);
      if (data.session) void restoreDesktopSession(data.session);
    }
    window.addEventListener("message", handleDesktopSession);
    window.parent.postMessage({ type: "dentlink.web.session.request" }, "*");
    return () => {
      window.clearTimeout(fallback);
      window.removeEventListener("message", handleDesktopSession);
      removeMomentumScrolling();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(DEBUG_MODE_STORAGE_KEY, debugMode ? "true" : "false");
  }, [debugMode]);

  useEffect(() => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(appearance));
    applyAppearanceToDocument(appearance);
  }, [appearance]);

  useEffect(() => {
    if (!auth) return;
    let cancelled = false;
    client
      .currentSession()
      .then(async (current) => {
        if (cancelled) return;
        const refreshedSession = {
          user: current.user,
          session: { token: auth.session.token, expiresAt: current.session.expiresAt }
        };
        setAuth(refreshedSession);
        storeSession(refreshedSession);
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
    scheduleNextPoll();
    const timer = window.setInterval(() => {
      scheduleNextPoll();
      if (document.visibilityState === "visible") void refreshDentLinkData("poll");
    }, UI_REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", refreshIfVisible);
    startChangeStream(token, 0);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      eventsAbort.current?.abort();
      eventsAbort.current = null;
    };
  }, [auth?.session.token]);

  useEffect(() => {
    function handleDesktopMacro(event: MessageEvent): void {
      const data = event.data as { type?: string; action?: string } | null;
      if (!data || data.type !== "dentlink.desktop.macro") return;
      if (data.action === "settings") {
        setSettingsTab("general");
        setView("settings");
      }
      if (data.action === "assistant") {
        setView("home");
        setDesktopAssistantRequest((current) => current + 1);
      }
      if (data.action === "history" || data.action === "rerank") {
        setView("notifications");
      }
    }
    window.addEventListener("message", handleDesktopMacro);
    return () => window.removeEventListener("message", handleDesktopMacro);
  }, []);

  useEffect(() => {
    document.title = auth ? `${pageTitle(view, settingsTab)} - DentLink` : "DentLink";
  }, [auth, view, settingsTab]);

  async function loadNotes(nextSearch = search, nextTagIds = tagIds): Promise<void> {
    const requestId = (notesRequest.current += 1);
    const response = await client.listNotes({
      search: nextSearch || undefined,
      tagIds: nextTagIds
    });
    if (requestId === notesRequest.current) setNotesList(response);
  }

  async function loadNotifications(): Promise<void> {
    const requestId = (notificationsRequest.current += 1);
    const [response, aiSettings] = await Promise.all([
      client.listNotifications({ includeSuppressed: true }),
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

  async function loadPreferences(): Promise<void> {
    const detected = detectedTimezone();
    const next = await client.getPreferences(detected).catch(() => null);
    if (next) setPreferences(next);
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
    setRefreshState((current) => ({ ...current, lastAttemptAt: new Date().toISOString() }));
    const work = (async () => {
      try {
        if (reason === "poll") await syncConnectedServicesSilently();
        await Promise.all([
          loadConnectors(),
          loadNotifications(),
          loadCalendarEvents(),
          loadNotes(),
          loadWebhooks(),
          loadPreferences()
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

  function scheduleNextPoll(): void {
    setRefreshState((current) => ({
      ...current,
      nextPollAt: new Date(Date.now() + UI_REFRESH_INTERVAL_MS).toISOString()
    }));
  }

  async function refreshAll(): Promise<void> {
    if (refreshState.running || refreshAllRunning.current) return;
    refreshAllRunning.current = true;
    setError(null);
    setRefreshState({
      running: true,
      message: "Refreshing connected services...",
      result: null,
      error: null,
      live: refreshState.live,
      nextPollAt: refreshState.nextPollAt,
      lastAttemptAt: new Date().toISOString()
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
        error: result.status === "failed" ? "Refresh All failed" : null,
        live: refreshState.live,
        nextPollAt: refreshState.nextPollAt,
        lastAttemptAt: new Date().toISOString()
      });
      if (result.status === "partial") setError("Partial refresh completed");
    } catch (caught) {
      const message = refreshMessageFor(caught);
      await refreshDentLinkData("refresh-all-failed");
      setRefreshState({
        running: false,
        message: null,
        result: null,
        error: message,
        live: refreshState.live,
        nextPollAt: refreshState.nextPollAt,
        lastAttemptAt: new Date().toISOString()
      });
      setError(message);
    } finally {
      refreshAllRunning.current = false;
    }
  }

  async function syncConnectedServicesSilently(): Promise<ConnectorSyncAllResult | null> {
    if (refreshAllRunning.current) return null;
    if (connectorSyncPromise.current) return connectorSyncPromise.current;
    const work = client
      .syncAllConnectors()
      .then((result) => {
        setRefreshState((current) => ({ ...current, result, error: null }));
        return result;
      })
      .catch((caught: unknown) => {
        void caught;
        setRefreshState((current) => ({
          ...current,
          error: current.error,
          lastAttemptAt: new Date().toISOString()
        }));
        return null;
      })
      .finally(() => {
        connectorSyncPromise.current = null;
      });
    connectorSyncPromise.current = work;
    return work;
  }

  function startChangeStream(token: string, attempt: number): void {
    eventsAbort.current?.abort();
    const controller = new AbortController();
    eventsAbort.current = controller;
    setRefreshState((current) => ({
      ...current,
      live: attempt === 0 ? "connecting" : "reconnecting"
    }));
    void readDentLinkEvents(
      token,
      syncCursor.current,
      controller.signal,
      (event) => {
        syncCursor.current = String(Math.max(Number(syncCursor.current), event.revision));
        void refreshDentLinkData(`push:${event.type}`);
      },
      () => {
        setRefreshState((current) => ({ ...current, live: "connected", message: null }));
      }
    ).catch(() => {
      if (!controller.signal.aborted) {
        const nextAttempt = attempt + 1;
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(nextAttempt, 5));
        setRefreshState((current) =>
          current.running
            ? current
            : {
                ...current,
                live: nextAttempt > 5 ? "degraded" : "reconnecting",
                message:
                  nextAttempt > 5
                    ? "Live updates degraded; polling fallback is active."
                    : "Live updates reconnecting..."
              }
        );
        window.setTimeout(() => {
          if (!controller.signal.aborted) startChangeStream(token, nextAttempt);
        }, delay);
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

  async function restoreDesktopSession(session: AuthSession): Promise<void> {
    client.setToken(session.session.token);
    setAuth(session);
    storeSession(session);
    await refreshDentLinkData("desktop-session");
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
      throw caught;
    }
  }

  async function updateFolder(folderId: EntityId, name: string): Promise<void> {
    try {
      await client.updateFolder(folderId, { name });
      await loadNotes();
    } catch (caught) {
      handleFailure(caught);
      throw caught;
    }
  }

  async function deleteFolder(folderId: EntityId): Promise<void> {
    try {
      await client.deleteFolder(folderId);
      setFolderId(null);
      await loadNotes();
    } catch (caught) {
      handleFailure(caught);
      throw caught;
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

  async function updateTag(tagId: EntityId, name: string): Promise<void> {
    try {
      await client.updateTag(tagId, { name });
      await loadNotes();
    } catch (caught) {
      handleFailure(caught);
    }
  }

  async function deleteTag(tagId: EntityId): Promise<void> {
    try {
      await client.deleteTag(tagId);
      setTagIds((ids) => ids.filter((id) => id !== tagId));
      await loadNotes();
    } catch (caught) {
      handleFailure(caught);
    }
  }

  async function updatePreferences(patch: Parameters<DentLinkApiClient["updatePreferences"]>[0]) {
    try {
      const next = await client.updatePreferences(patch);
      setPreferences(next);
      if (patch.ai) await loadNotifications();
    } catch (caught) {
      handleFailure(caught);
    }
  }

  async function reprocessEmailAi(accountId?: EntityId | null): Promise<void> {
    setAiReprocessRunning(true);
    setAiReprocessResult(null);
    try {
      const result = await client.reprocessEmailAi({
        timezone: effectiveTimezone,
        accountId: accountId ?? null
      });
      setAiReprocessResult(result);
      await loadNotifications();
    } catch (caught) {
      handleFailure(caught);
    } finally {
      setAiReprocessRunning(false);
    }
  }

  async function updateNote(note: Note, patch: NotePatch): Promise<void> {
    setNotesList((current) => ({
      ...current,
      notes: current.notes.map((item) =>
        item.id === note.id ? optimisticNote(item, patch, current.tags) : item
      )
    }));
    queueNoteMutation(note.id, patch);
  }

  function queueNoteMutation(noteId: EntityId, patch: NotePatch): void {
    const existing = noteMutations.current.get(noteId);
    const sequence = noteMutationSequence.current + 1;
    noteMutationSequence.current = sequence;
    const merged = { ...(existing?.patch ?? {}), ...patch };
    if (existing?.timer) window.clearTimeout(existing.timer);
    const entry: QueuedNoteMutation = {
      patch: merged,
      inFlight: existing?.inFlight ?? false,
      timer: null,
      sequence
    };
    entry.timer = window.setTimeout(() => void flushNoteMutation(noteId), 250);
    noteMutations.current.set(noteId, entry);
    setUpdatingNoteIds((ids) => [...new Set([...ids, noteId])]);
    if (!entry.inFlight) void flushNoteMutation(noteId);
  }

  async function flushNoteMutation(noteId: EntityId): Promise<void> {
    const entry = noteMutations.current.get(noteId);
    if (!entry || entry.inFlight) return;
    if (entry.timer) window.clearTimeout(entry.timer);
    const patch = entry.patch;
    noteMutations.current.set(noteId, { ...entry, inFlight: true, timer: null });
    try {
      const latestLocal = notesListRef.current.notes.find((item) => item.id === noteId);
      if (!latestLocal) return;
      const response = await saveNotePatchWithRetry(noteId, latestLocal.version, patch);
      setNotesList((current) => ({
        ...current,
        notes: current.notes.map((item) =>
          item.id === noteId && response.version >= item.version ? response : item
        )
      }));
      const currentEntry = noteMutations.current.get(noteId);
      if (currentEntry && currentEntry.sequence !== entry.sequence) {
        noteMutations.current.set(noteId, {
          ...currentEntry,
          inFlight: false,
          patch: currentEntry.patch
        });
        void flushNoteMutation(noteId);
      } else {
        noteMutations.current.delete(noteId);
        setUpdatingNoteIds((ids) => ids.filter((id) => id !== noteId));
      }
    } catch (caught) {
      const currentEntry = noteMutations.current.get(noteId);
      if (currentEntry) noteMutations.current.set(noteId, { ...currentEntry, inFlight: false });
      setUpdatingNoteIds((ids) => ids.filter((id) => id !== noteId));
      await loadNotes().catch(() => undefined);
      handleFailure(caught);
    }
  }

  async function saveNotePatchWithRetry(
    noteId: EntityId,
    expectedVersion: number,
    patch: NotePatch
  ): Promise<Note> {
    try {
      return await client.updateNote(noteId, expectedVersion, patch);
    } catch (caught) {
      if (!isRecoverableNoteConflict(caught)) throw caught;
      const latest = await client.listNotes({ search: undefined, folderId: undefined, tagIds: [] });
      const server = latest.notes.find((item) => item.id === noteId);
      if (!server) throw caught;
      setNotesList(latest);
      return client.updateNote(noteId, server.version, patch);
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
      if (caught instanceof DentLinkApiError && caught.code === "version_mismatch") {
        try {
          const latest = await client.listNotifications({ includeSuppressed: true });
          const current = latest.notifications.find((item) => item.id === notification.id);
          if (!current) {
            setNotifications(latest.notifications);
            return;
          }
          await client.updateNotification(current.id, current.version, patch);
          await loadNotifications();
          return;
        } catch (retryError) {
          setNotifications(previous);
          handleFailure(retryError);
          return;
        }
      }
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
      if (caught instanceof DentLinkApiError && caught.code === "version_mismatch") {
        try {
          const latest = await client.listNotifications({ includeSuppressed: true });
          const latestById = new Map(latest.notifications.map((item) => [item.id, item]));
          await client.reorderNotifications(
            orderedNotifications
              .map((notification, index) => {
                const current = latestById.get(notification.id);
                return current
                  ? {
                      id: notification.id,
                      expectedVersion: current.version,
                      globalOrder: (index + 1) * 1000
                    }
                  : null;
              })
              .filter(
                (item): item is { id: EntityId; expectedVersion: number; globalOrder: number } =>
                  Boolean(item)
              )
          );
          await loadNotifications();
          return;
        } catch (retryError) {
          setNotifications(previous);
          handleFailure(retryError);
          return;
        }
      }
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
      const message = gmailSyncMessageFor(caught, gmailActiveEngine(account));
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
    setConnectorAccounts((current) =>
      mergeConnectorAccount(current, withRequestedGmailEngine(account, engine, comparisonMode))
    );
    try {
      setError(null);
      const updated = await saveGmailEngineSelection(account, engine, comparisonMode);
      setConnectorAccounts((current) =>
        mergeConnectorAccount(current, withRequestedGmailEngine(updated, engine, comparisonMode))
      );
      setGmailEngineSaveStates((current) => ({
        ...current,
        [account.id]: { engine, comparisonMode, saving: false, error: null }
      }));
      await refreshGmailDiagnostics(account.id);
    } catch (caught) {
      if (caught instanceof DentLinkApiError && caught.code === "version_mismatch") {
        try {
          const latestAccounts = await loadConnectors();
          const latest = latestAccounts.find((item) => item.id === account.id);
          if (!latest) throw caught;
          const updated = await saveGmailEngineSelection(latest, engine, comparisonMode);
          setConnectorAccounts((current) =>
            mergeConnectorAccount(
              current,
              withRequestedGmailEngine(updated, engine, comparisonMode)
            )
          );
          setGmailEngineSaveStates((current) => ({
            ...current,
            [account.id]: { engine, comparisonMode, saving: false, error: null }
          }));
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

  async function askAssistant(message: string): Promise<void> {
    const trimmed = message.trim();
    if (!trimmed || assistantRunning) return;
    const userMessage: AssistantMessage = {
      id: localMessageId(),
      role: "user",
      content: trimmed,
      sources: []
    };
    setAssistantDraft("");
    setAssistantRunning(true);
    setAssistantMessages((current) => [...current, userMessage]);
    try {
      const response = await client.askAssistant({
        message: trimmed,
        timezone: effectiveTimezone
      });
      setAssistantMessages((current) => [
        ...current,
        {
          id: localMessageId(),
          role: "assistant",
          content: response.answer,
          sources: response.sources
        }
      ]);
    } catch (caught) {
      const content =
        caught instanceof DentLinkApiError
          ? caught.message
          : "Assistant request failed. Try again after the next refresh.";
      setAssistantMessages((current) => [
        ...current,
        {
          id: localMessageId(),
          role: "assistant",
          content,
          sources: [],
          error: true
        }
      ]);
    } finally {
      setAssistantRunning(false);
    }
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
      setRefreshState({
        running: false,
        message: null,
        result: null,
        error: null,
        live: "connecting",
        nextPollAt: null,
        lastAttemptAt: null
      });
      setLastWebhookSecret(null);
      setSearch("");
      setFolderId(null);
      setTagIds([]);
      setAssistantMessages([]);
      setAssistantDraft("");
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
      if (caught instanceof DentLinkApiError && caught.code === "version_mismatch") {
        try {
          const latest = await client.listNotes();
          const latestById = new Map(latest.notes.map((note) => [note.id, note]));
          await client.reorderNotes(
            orderedNotes
              .map((note, index) => {
                const latestNote = latestById.get(note.id);
                return latestNote
                  ? {
                      id: note.id,
                      expectedVersion: latestNote.version,
                      globalOrder: (index + 1) * 1000
                    }
                  : null;
              })
              .filter(
                (item): item is { id: EntityId; expectedVersion: number; globalOrder: number } =>
                  Boolean(item)
              )
          );
          await loadNotes();
          return;
        } catch (retryError) {
          setNotesList(previous);
          handleFailure(retryError);
          return;
        }
      }
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

  if (!auth && desktopSessionHydrating) {
    return <main className="auth-screen" aria-label="Restoring DentLink session" />;
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
          <h1>DentLink</h1>
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

  const desktopClient = isDesktopClient();

  return (
    <>
      <header className={`app-header ${desktopClient ? "desktop-app-header" : ""}`}>
        <span
          className={`brand-mark ${appearance.branding.showLogoBorder ? "with-border" : ""}`}
          style={
            {
              "--logo-bg": appearance.branding.logoBackground,
              "--logo-border": appearance.branding.logoBorder,
              "--logo-radius": `${appearance.branding.logoRadius}px`
            } as CSSProperties
          }
        >
          <img src={logoSource(appearance)} alt="DentLink" />
        </span>
        <AppNavigation view={view} onViewChange={setView} variant="top" />
        {desktopClient ? (
          <button
            type="button"
            className="icon-refresh-button desktop-refresh-button"
            aria-label="Refresh All"
            title="Refresh all connected services"
            aria-busy={refreshState.running}
            onClick={() => void refreshAll()}
            disabled={refreshState.running}
          >
            <RefreshIcon />
          </button>
        ) : null}
        {desktopClient ? null : (
          <>
            <span className="account-email truncate" title={auth.user.email}>
              {auth.user.email}
            </span>
            <button className="logout-button" onClick={() => void logout()}>
              Log out
            </button>
          </>
        )}
      </header>
      <AppNavigation view={view} onViewChange={setView} variant="bottom" />
      {desktopClient ? null : (
        <PageHeader
          title={pageTitle(view, settingsTab)}
          refreshRunning={refreshState.running}
          refreshState={refreshState}
          reconnectWarnings={reconnectWarnings}
          onOpenConnections={() => {
            setSettingsTab("connections");
            setView("settings");
          }}
          onRefreshAll={refreshAll}
        />
      )}
      {(desktopClient ? refreshState.error : refreshState.message || refreshState.error) ? (
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
      {view === "home" ? (
        <HomeView
          notifications={notifications}
          calendarEvents={calendarEventsWithNotes}
          notes={notesList.notes}
          sourceColors={appearance.sourceColors}
          webhooks={webhooks}
          messages={assistantMessages}
          draft={assistantDraft}
          running={assistantRunning}
          assistantRequest={desktopAssistantRequest}
          onDraftChange={setAssistantDraft}
          onSubmit={askAssistant}
          onUpdateNotification={updateNotification}
          onCreateNote={createNote}
          onUpdateNote={updateNote}
          onOpenNotifications={() => setView("notifications")}
          onOpenCalendar={() => setView("agenda")}
          onOpenNotes={(noteId) => {
            if (noteId) setOpenNoteId(noteId);
            setView("notes");
          }}
        />
      ) : null}
      {view === "notifications" ? (
        <NotificationsView
          notifications={notifications}
          aiSettings={emailAiSettings}
          importanceThreshold={preferences?.ai.threshold ?? 0}
          sourceColors={appearance.sourceColors}
          webhooks={webhooks}
          onCreateNotification={createNotification}
          onUpdateNotification={updateNotification}
          onDeleteNotification={deleteNotification}
          onReorderNotifications={reorderNotifications}
          debugMode={debugMode}
        />
      ) : null}
      {view === "agenda" ? (
        <CalendarWorkspace
          events={calendarEventsWithNotes}
          accounts={connectorAccounts}
          sourceColors={appearance.sourceColors}
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
          onOpenNote={(noteId) => {
            setOpenNoteId(noteId);
            setView("notes");
          }}
        />
      ) : null}
      {view === "notes" ? (
        <NotesWorkspace
          notes={notesList.notes}
          folders={notesList.folders}
          tags={notesList.tags}
          selectedFolderId={folderId}
          selectedTagIds={tagIds}
          search={search}
          onSearchChange={(nextSearch) => {
            setSearch(nextSearch);
            void loadNotes(nextSearch, tagIds);
          }}
          onFolderChange={(nextFolderId) => {
            setFolderId(nextFolderId);
          }}
          onTagToggle={(tagId) => {
            const nextTagIds = tagIds.includes(tagId)
              ? tagIds.filter((item) => item !== tagId)
              : [...tagIds, tagId];
            setTagIds(nextTagIds);
            void loadNotes(search, nextTagIds);
          }}
          onCreateFolder={createFolder}
          onUpdateFolder={updateFolder}
          onDeleteFolder={deleteFolder}
          onCreateTag={createTag}
          onUpdateTag={updateTag}
          onDeleteTag={deleteTag}
          onCreateNote={createNote}
          onUpdateNote={updateNote}
          onDeleteNote={deleteNote}
          onReorderNotes={reorderNotes}
          updatingNoteIds={updatingNoteIds}
          openNoteId={openNoteId}
        />
      ) : null}
      {view === "settings" ? (
        <SettingsView
          selectedTab={settingsTab}
          onTabChange={setSettingsTab}
          debugMode={debugMode}
          onDebugModeChange={setDebugMode}
          appearance={appearance}
          onAppearanceChange={setAppearance}
          preferences={preferences}
          onPreferencesChange={updatePreferences}
          aiSettings={emailAiSettings}
          onEmailAiEnabledChange={updateEmailAiEnabled}
          aiReprocessResult={aiReprocessResult}
          aiReprocessRunning={aiReprocessRunning}
          onReprocessEmailAi={reprocessEmailAi}
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

function isRecoverableNoteConflict(caught: unknown): caught is DentLinkApiError {
  return (
    caught instanceof DentLinkApiError &&
    (caught.code === "version_mismatch" || caught.code === "conflict")
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

function HomeView(props: {
  notifications: Notification[];
  calendarEvents: CalendarEvent[];
  notes: Note[];
  sourceColors: Record<string, string>;
  webhooks: Array<WebhookEndpoint & { ingestUrl: string }>;
  messages: AssistantMessage[];
  draft: string;
  running: boolean;
  assistantRequest: number;
  onDraftChange: (value: string) => void;
  onSubmit: (message: string) => Promise<void>;
  onUpdateNotification: (
    notification: Notification,
    patch: Partial<Pick<Notification, "pinned" | "status">>
  ) => Promise<void>;
  onCreateNote: (input: NoteInput) => Promise<void>;
  onUpdateNote: (note: Note, patch: NotePatch) => Promise<void>;
  onOpenNotifications: () => void;
  onOpenCalendar: () => void;
  onOpenNotes: (noteId?: EntityId) => void;
}): ReactElement {
  const threadRef = useRef<HTMLDivElement | null>(null);
  const followThreadRef = useRef(true);
  const desktopClient = isDesktopClient();
  const [assistantOpen, setAssistantOpen] = useState(() => !isDesktopClient());
  const [quickNoteTitle, setQuickNoteTitle] = useState("");
  const today = todayKey();
  const activeNotificationLimit = desktopClient ? 10 : 5;
  const activeNotifications = sortNotifications(
    props.notifications.filter((notification) => notification.status === "active"),
    "recommended"
  ).slice(0, activeNotificationLimit);
  const todayEvents = props.calendarEvents
    .filter((event) => eventOccursOnDate(event, today))
    .sort(compareEventsByStart)
    .slice(0, 5);
  const timelineEvents = desktopClient ? upcomingEvents(props.calendarEvents, 10) : todayEvents;
  const nextEvent =
    [...props.calendarEvents]
      .filter((event) => event.status === "active" && event.startAt >= new Date().toISOString())
      .sort(compareEventsByStart)[0] ?? null;
  const dueNotes = dueHomeNotes(props.notes, today).slice(0, 5);
  const reviewItems = homeReviewItems(props.notifications).slice(0, 5);
  const promptSuggestions = homePromptSuggestions({
    activeNotifications: activeNotifications.length,
    dueNotes: dueNotes.length,
    todayEvents: todayEvents.length,
    reviewItems: reviewItems.length
  });

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread || !followThreadRef.current) return;
    thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
  }, [props.messages.length, props.running]);

  useEffect(() => {
    if (!desktopClient || props.assistantRequest === 0) return;
    setAssistantOpen(true);
  }, [desktopClient, props.assistantRequest]);

  function updateThreadFollow(): void {
    const thread = threadRef.current;
    if (!thread) return;
    const distanceFromBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight;
    followThreadRef.current = distanceFromBottom < 80;
  }

  return (
    <main className="home-shell">
      <section className="home-main" aria-label="Home overview">
        <section className="home-band today-band" aria-label="Today">
          <div className="home-section-header">
            <h2>{desktopClient ? "Upcoming" : "Today"}</h2>
            <button type="button" onClick={props.onOpenCalendar}>
              Open Agenda
            </button>
          </div>
          <div className="today-summary-grid">
            <HomeMetric label="Events" value={todayEvents.length} />
            <HomeMetric label="Inbox" value={activeNotifications.length} />
            <HomeMetric label="Next" value={nextEvent ? 1 : 0} />
          </div>
          {!desktopClient && nextEvent ? (
            <button type="button" className="next-event-button" onClick={props.onOpenCalendar}>
              <span>Next</span>
              <strong>{nextEvent.title}</strong>
              <small>{formatEventStart(nextEvent)}</small>
            </button>
          ) : !desktopClient ? (
            <p className="home-empty">No upcoming events loaded.</p>
          ) : null}
          <div className="home-row-list">
            {timelineEvents.map((event) => (
              <button
                type="button"
                key={event.id}
                className="home-event-row"
                style={eventAccentStyle(event, props.sourceColors)}
                onClick={props.onOpenCalendar}
              >
                <span>
                  {formatEventTimelineDate(event)} ·{" "}
                  {event.allDay ? "All day" : formatEventTime(event)}
                </span>
                <strong>{event.title}</strong>
                <small>{sourceLabel(event)}</small>
              </button>
            ))}
          </div>
          {desktopClient && timelineEvents.length === 0 ? (
            <p className="home-empty">No upcoming events loaded.</p>
          ) : null}
        </section>

        <section className="home-band priority-inbox-band" aria-label="Priority inbox">
          <div className="home-section-header">
            <h2>Priority Inbox</h2>
            <button type="button" onClick={props.onOpenNotifications}>
              Open Notifications
            </button>
          </div>
          {activeNotifications.length === 0 ? (
            <p className="home-empty">No active notifications.</p>
          ) : null}
          <div className="home-row-list">
            {activeNotifications.map((notification) => (
              <article
                key={notification.id}
                className={`home-notification-row importance-${importanceBand(notification)}`}
                style={notificationAccentStyle(notification, props.sourceColors, props.webhooks)}
              >
                <button type="button" onClick={props.onOpenNotifications}>
                  <span>{notificationSender(notification)}</span>
                  <strong>{notification.email?.subject || notification.title}</strong>
                  <small>{notificationSummary(notification)}</small>
                </button>
                <div className="notification-meta-actions home-notification-meta-actions">
                  <div className="notification-card-meta">
                    <span className="importance-pill">
                      Importance: {importanceScore(notification)}
                    </span>
                    <span className="notification-card-time">
                      {relativeTime(notification.email?.receivedAt ?? notification.createdAt)}
                    </span>
                    {notification.ai?.requiresAction ? (
                      <span className="action-required">Action required</span>
                    ) : null}
                  </div>
                  <NotificationQuickActions
                    notification={notification}
                    onUpdateNotification={props.onUpdateNotification}
                  />
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="home-band due-notes-band" aria-label="Due notes">
          <div className="home-section-header">
            <h2>Due Notes</h2>
            <button type="button" onClick={() => props.onOpenNotes()}>
              Open Notes
            </button>
          </div>
          <form
            className="quick-capture"
            onSubmit={(event) => {
              event.preventDefault();
              const title = quickNoteTitle.trim();
              if (!title) return;
              void props.onCreateNote({
                kind: "task",
                title,
                priority: "medium",
                dueAt: `${today}T23:59:00.000Z`
              });
              setQuickNoteTitle("");
            }}
          >
            <input
              aria-label="Quick task"
              value={quickNoteTitle}
              maxLength={72}
              placeholder="Quick task"
              onChange={(event) => setQuickNoteTitle(event.currentTarget.value)}
            />
            <button type="submit" disabled={quickNoteTitle.trim().length === 0}>
              Add
            </button>
          </form>
          {dueNotes.length === 0 ? (
            <p className="home-empty">No notes due today or overdue.</p>
          ) : null}
          <div className="home-row-list">
            {dueNotes.map((note) => (
              <article key={note.id} className={`home-note-row priority-${note.priority}`}>
                <label>
                  <input
                    type="checkbox"
                    checked={note.status === "done"}
                    onChange={() =>
                      void props.onUpdateNote(note, {
                        status: note.status === "done" ? "active" : "done"
                      })
                    }
                  />
                  <span>
                    <strong>{note.title}</strong>
                    <small>{homeNoteDueLabel(note, today)}</small>
                  </span>
                </label>
                <button type="button" onClick={() => props.onOpenNotes(note.id)}>
                  Open
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="home-band needs-review-band" aria-label="Needs review">
          <div className="home-section-header">
            <h2>Needs Review</h2>
            <button type="button" onClick={props.onOpenNotifications}>
              Review
            </button>
          </div>
          {reviewItems.length === 0 ? (
            <p className="home-empty">Nothing waiting for review.</p>
          ) : null}
          <div className="home-row-list">
            {reviewItems.map((item) => (
              <button
                type="button"
                key={item.id}
                className="home-review-row"
                onClick={props.onOpenNotifications}
              >
                <span>{item.reason}</span>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </button>
            ))}
          </div>
        </section>
      </section>

      <section
        className={`assistant-panel ${desktopClient ? "desktop-assistant-panel" : ""}`}
        aria-label="Assistant"
        hidden={desktopClient && !assistantOpen}
      >
        <header className="assistant-header">
          <h2>DentLink Assistant</h2>
          {desktopClient ? (
            <button
              type="button"
              className="assistant-close"
              aria-label="Close DentLink Assistant"
              onClick={() => setAssistantOpen(false)}
            >
              Close
            </button>
          ) : null}
          <div className="assistant-prompts" aria-label="Suggested prompts">
            {promptSuggestions.map((prompt) => (
              <button
                type="button"
                key={prompt}
                disabled={props.running}
                onClick={() => void props.onSubmit(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
        </header>
        <div
          ref={threadRef}
          className="assistant-thread"
          aria-live="polite"
          onScroll={updateThreadFollow}
        >
          {props.messages.length === 0 ? (
            <div className="assistant-example" aria-label="Example assistant exchange">
              <article className="assistant-message user">
                <p>What needs my attention today?</p>
              </article>
              <article className="assistant-message assistant">
                <p>
                  Ask about today, newest notifications, overdue notes, or what changed recently.
                </p>
              </article>
            </div>
          ) : (
            props.messages.map((message) => (
              <article
                key={message.id}
                className={`assistant-message ${message.role}${message.error ? " error" : ""}`}
              >
                <p>{message.content}</p>
                {message.sources.length > 0 ? (
                  <div className="assistant-sources" aria-label="Sources">
                    {message.sources.map((source) => (
                      <a
                        key={source.id}
                        href={source.sourceUrl ?? undefined}
                        target={source.sourceUrl ? "_blank" : undefined}
                        rel={source.sourceUrl ? "noreferrer" : undefined}
                        className="assistant-source"
                        aria-disabled={source.sourceUrl ? undefined : true}
                      >
                        <span>{assistantSourceLabel(source.kind)}</span>
                        <strong>{source.title}</strong>
                        <small>
                          {source.timestamp
                            ? new Date(source.timestamp).toLocaleString()
                            : source.subtitle}
                        </small>
                      </a>
                    ))}
                  </div>
                ) : null}
              </article>
            ))
          )}
          {props.running ? (
            <article
              className="assistant-message assistant-thinking"
              aria-label="Assistant thinking"
            >
              <span />
              <span />
              <span />
            </article>
          ) : null}
        </div>
        <form
          className="assistant-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void props.onSubmit(props.draft);
          }}
        >
          <textarea
            value={props.draft}
            maxLength={MAX_PROMPT_CHARS}
            onChange={(event) => props.onDraftChange(event.currentTarget.value)}
            placeholder="Ask DentLink"
            aria-label="Ask DentLink"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void props.onSubmit(props.draft);
              }
            }}
          />
          <button type="submit" disabled={props.running || props.draft.trim().length === 0}>
            {props.running ? "Sending" : "Send"}
          </button>
        </form>
      </section>
    </main>
  );
}

function HomeMetric(props: { label: string; value: number }): ReactElement {
  return (
    <div className="home-metric">
      <strong>{props.value}</strong>
      <span>{props.label}</span>
    </div>
  );
}

function dueHomeNotes(notes: Note[], today: string): Note[] {
  return notes
    .filter((note) => note.status === "active" && note.dueAt && note.dueAt.slice(0, 10) <= today)
    .sort((left, right) => {
      if (left.pinned !== right.pinned) return Number(right.pinned) - Number(left.pinned);
      return (
        (left.dueAt ?? "").localeCompare(right.dueAt ?? "") ||
        notePriorityScore(right.priority) - notePriorityScore(left.priority) ||
        left.title.localeCompare(right.title)
      );
    });
}

function upcomingEvents(events: CalendarEvent[], limit: number): CalendarEvent[] {
  const now = new Date().toISOString();
  return [...events]
    .filter((event) => event.status === "active" && event.endAt >= now)
    .sort(compareEventsByStart)
    .slice(0, limit);
}

function notePriorityScore(priority: Note["priority"]): number {
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  if (priority === "low") return 1;
  return 0;
}

function homeNoteDueLabel(note: Note, today: string): string {
  if (!note.dueAt) return "No due date";
  const dueDate = note.dueAt.slice(0, 10);
  if (dueDate < today) return `Overdue ${formatMonthDay(dueDate)}`;
  if (dueDate === today) return "Due today";
  return `Due ${formatMonthDay(dueDate)}`;
}

function homeReviewItems(
  notifications: Notification[]
): Array<{ id: EntityId; title: string; reason: string; detail: string }> {
  return notifications
    .filter(
      (notification) =>
        notification.status === "suppressed" ||
        notification.ai?.status === "failed" ||
        notification.ai?.status === "skipped"
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((notification) => ({
      id: notification.id,
      title: notification.email?.subject || notification.title || "Notification",
      reason:
        notification.status === "suppressed"
          ? "Below threshold"
          : notification.ai?.status === "failed"
            ? "AI failed"
            : "AI skipped",
      detail: notificationSummary(notification)
    }));
}

function homePromptSuggestions(counts: {
  activeNotifications: number;
  dueNotes: number;
  todayEvents: number;
  reviewItems: number;
}): string[] {
  const prompts = ["What needs my attention today?"];
  if (counts.activeNotifications > 0) prompts.push("Summarize my newest notifications");
  if (counts.dueNotes > 0) prompts.push("What notes are overdue?");
  if (counts.todayEvents > 0) prompts.push("What do I have going on today?");
  if (counts.reviewItems > 0) prompts.push("What should I review?");
  prompts.push("What changed since the last sync?");
  return prompts.slice(0, 4);
}

function PageHeader(props: {
  title: string;
  refreshRunning: boolean;
  refreshState: RefreshState;
  reconnectWarnings: ConnectorReconnectWarning[];
  onOpenConnections: () => void;
  onRefreshAll: () => Promise<void>;
}): ReactElement {
  const reconnectWarning = props.reconnectWarnings[0];
  const extraReconnectCount = Math.max(0, props.reconnectWarnings.length - 1);
  return (
    <section className="page-header" aria-label={`${props.title} page controls`}>
      <h1>{props.title}</h1>
      <div className="page-header-status">
        <span className={`refresh-indicator ${props.refreshState.live}`}>
          Auto sync: {props.refreshState.live}
          {props.refreshState.nextPollAt
            ? ` · next ${new Date(props.refreshState.nextPollAt).toLocaleTimeString()}`
            : ""}
        </span>
        {reconnectWarning ? (
          <div className="reconnect-alert" role="status" aria-live="polite">
            <strong>{reconnectWarning.title}</strong>
            <span>
              {reconnectWarning.message}
              {extraReconnectCount > 0
                ? ` ${extraReconnectCount} more source(s) need attention.`
                : ""}
            </span>
            <button type="button" onClick={props.onOpenConnections}>
              Reconnect
            </button>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="icon-refresh-button"
        aria-label="Refresh All"
        title="Refresh all connected services"
        aria-busy={props.refreshRunning}
        onClick={() => void props.onRefreshAll()}
        disabled={props.refreshRunning}
      >
        <RefreshIcon />
      </button>
    </section>
  );
}

function RefreshIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M21 12a9 9 0 0 1-14.85 6.85" />
      <path d="M3 12A9 9 0 0 1 17.85 5.15" />
      <path d="M17.85 5.15H14" />
      <path d="M17.85 5.15V1.3" />
      <path d="M6.15 18.85H10" />
      <path d="M6.15 18.85v3.85" />
    </svg>
  );
}

function PlusIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 5v14M5 12h14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function pageTitle(view: View, settingsTab?: SettingsTab): string {
  switch (view) {
    case "home":
      return "Home";
    case "agenda":
      return "Agenda";
    case "notes":
      return "Notes";
    case "settings":
      if (settingsTab === "appearance") return "Appearance";
      if (settingsTab === "ai") return "AI";
      if (settingsTab === "connections") return "Connections";
      if (settingsTab === "rules") return "Notification Rules";
      if (settingsTab === "debug") return "Debug";
      if (settingsTab === "about") return "About";
      return "Settings";
    case "notifications":
    default:
      return "Notifications";
  }
}

function storedDebugMode(): boolean {
  return localStorage.getItem(DEBUG_MODE_STORAGE_KEY) === "true";
}

function defaultAppearance(): AppearancePreferences {
  const base: AppearancePreferences = {
    version: 2,
    preset: "light",
    loadedProfileId: "builtin-light",
    loadedProfileName: "Light",
    profiles: [],
    accent: "#7c3aed",
    colors: {
      primaryText: "#171a20",
      secondaryText: "#3f4854",
      mutedText: "#6b7280",
      headings: "#171a20",
      navigationText: "#171a20",
      cardTitles: "#171a20",
      bodyText: "#3f4854",
      metadataText: "#6b7280",
      links: "#2563eb",
      successText: "#15803d",
      warningText: "#b45309",
      dangerText: "#b42318",
      notificationMetadata: "#6b7280"
    },
    typography: {
      base: 15,
      small: 13,
      cardTitle: 16,
      pageHeading: 22,
      navigation: 14,
      control: 15
    },
    surfaces: {
      appBackground: "#f5f6f8",
      headerBackground: "#ffffff",
      toolbarBackground: "#fbfcff",
      cardBackground: "#ffffff",
      elevatedPanel: "#fbfcff",
      modalBackground: "#ffffff",
      selectedBackground: "#eee9ff",
      hoverBackground: "#f3f4f6",
      divider: "#d8dee8"
    },
    inputs: {
      background: "#ffffff",
      text: "#171a20",
      placeholder: "#6b7280",
      border: "#d8dee8",
      focusBorder: "#7c3aed",
      invalidBorder: "#b42318",
      disabledBackground: "#f3f4f6",
      disabledText: "#6b7280"
    },
    buttons: {
      primaryBackground: "#7c3aed",
      primaryText: "#ffffff",
      secondaryBackground: "#ffffff",
      secondaryText: "#171a20",
      destructiveBackground: "#b42318",
      destructiveText: "#ffffff",
      iconBackground: "#ffffff",
      iconColor: "#171a20",
      hoverBackground: "#f3f4f6",
      pressedBackground: "#eee9ff",
      disabledBackground: "#e5e7eb",
      disabledText: "#6b7280",
      focusRing: "#7c3aed"
    },
    cards: {
      background: "#ffffff",
      border: "#d8dee8",
      title: "#171a20",
      body: "#3f4854",
      metadata: "#6b7280",
      pinnedAccent: "#7c3aed",
      hover: "#fbfcff",
      shadow: 1,
      radius: 12,
      borderWidth: 1,
      noteMinWidth: 300
    },
    borders: {
      globalRadius: 10,
      cardRadius: 12,
      borderWidth: 1,
      shadowIntensity: 1
    },
    statusColors: {
      success: "#15803d",
      warning: "#b45309",
      danger: "#b42318",
      info: "#2563eb",
      suppressed: "#92400e"
    },
    branding: {
      logoVariant: "auto",
      logoBackground: "#ffffff",
      logoBorder: "#d8dee8",
      logoRadius: 8,
      showLogoBorder: false
    },
    roundedness: 10,
    animations: true,
    sourceColors: {
      gmail: "#1d4ed8",
      "google-calendar": "#2563eb",
      local: "#137a3a",
      note: "#7c3aed",
      webhook: "#b45309"
    }
  };
  return { ...base, profiles: builtInAppearanceProfiles(base) };
}

function storedAppearance(): AppearancePreferences {
  if (typeof window === "undefined") return defaultAppearance();
  try {
    const parsed = JSON.parse(
      localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? "{}"
    ) as Partial<AppearancePreferences>;
    return normalizeAppearance(parsed);
  } catch {
    return defaultAppearance();
  }
}

function normalizeAppearance(parsed: Partial<AppearancePreferences>): AppearancePreferences {
  const fallback = defaultAppearance();
  const merged = {
    ...fallback,
    ...parsed,
    version: 2 as const,
    colors: { ...fallback.colors, ...(parsed.colors ?? {}) },
    typography: { ...fallback.typography, ...(parsed.typography ?? {}) },
    surfaces: { ...fallback.surfaces, ...(parsed.surfaces ?? {}) },
    inputs: { ...fallback.inputs, ...(parsed.inputs ?? {}) },
    buttons: { ...fallback.buttons, ...(parsed.buttons ?? {}) },
    cards: { ...fallback.cards, ...(parsed.cards ?? {}) },
    borders: { ...fallback.borders, ...(parsed.borders ?? {}) },
    statusColors: { ...fallback.statusColors, ...(parsed.statusColors ?? {}) },
    branding: { ...fallback.branding, ...(parsed.branding ?? {}) },
    sourceColors: { ...fallback.sourceColors, ...(parsed.sourceColors ?? {}) }
  };
  merged.cards.noteMinWidth = clampNumber(merged.cards.noteMinWidth, 220, 480);
  merged.profiles = [
    ...builtInAppearanceProfiles(merged),
    ...(Array.isArray(parsed.profiles) ? parsed.profiles.filter((profile) => !profile.builtIn) : [])
  ];
  return merged;
}

function builtInAppearanceProfiles(base: AppearancePreferences): AppearanceProfile[] {
  const now = "built-in";
  const profiles: Array<[string, string, AppearancePreferences["preset"]]> = [
    ["builtin-light", "Light", "light"],
    ["builtin-soft-gray", "Soft Gray", "soft-gray"],
    ["builtin-neutral-gray", "Neutral Gray", "neutral-gray"],
    ["builtin-dark", "Dark", "dark"],
    ["builtin-charcoal", "Charcoal", "charcoal"],
    ["builtin-oled", "OLED", "oled"],
    ["builtin-purple", "Purple/Cosmic", "purple"],
    ["builtin-system", "Follow System", "system"]
  ];
  return profiles.map(([id, name, preset]) => ({
    id,
    name,
    builtIn: true,
    settings: appearanceSnapshotForPreset(base, preset),
    createdAt: now,
    updatedAt: now
  }));
}

function appearanceSnapshotForPreset(
  base: AppearancePreferences,
  preset: AppearancePreferences["preset"]
): AppearanceSnapshot {
  const snapshot = appearanceSnapshot({ ...base, preset });
  const darkText = {
    primaryText: "#f8fafc",
    secondaryText: "#d1d5db",
    mutedText: "#9ca3af",
    headings: "#ffffff",
    navigationText: "#f8fafc",
    cardTitles: "#ffffff",
    bodyText: "#d1d5db",
    metadataText: "#9ca3af",
    links: "#93c5fd",
    successText: "#86efac",
    warningText: "#fbbf24",
    dangerText: "#fca5a5",
    notificationMetadata: "#9ca3af"
  };
  if (preset === "soft-gray") {
    return {
      ...snapshot,
      surfaces: {
        ...snapshot.surfaces,
        appBackground: "#eef1f5",
        headerBackground: "#f8fafc",
        toolbarBackground: "#f1f5f9",
        cardBackground: "#ffffff",
        elevatedPanel: "#f8fafc",
        selectedBackground: "#e7e5ff",
        hoverBackground: "#e5e7eb"
      }
    };
  }
  if (preset === "neutral-gray") {
    return {
      ...snapshot,
      surfaces: {
        ...snapshot.surfaces,
        appBackground: "#eeeeee",
        headerBackground: "#fafafa",
        toolbarBackground: "#f5f5f5",
        cardBackground: "#ffffff",
        elevatedPanel: "#fafafa",
        selectedBackground: "#e5e5e5",
        hoverBackground: "#eeeeee",
        divider: "#d4d4d4"
      },
      accent: "#525252"
    };
  }
  if (preset === "purple") {
    return {
      ...snapshot,
      accent: "#7c3aed",
      surfaces: {
        ...snapshot.surfaces,
        appBackground: "#f7f4ff",
        headerBackground: "#ffffff",
        toolbarBackground: "#fbfaff",
        selectedBackground: "#ede9fe",
        hoverBackground: "#f3f0ff"
      }
    };
  }
  if (preset === "dark" || preset === "charcoal" || preset === "oled" || preset === "system") {
    const oled = preset === "oled";
    const charcoal = preset === "charcoal";
    const appBackground = oled ? "#000000" : charcoal ? "#111111" : "#111827";
    const panel = oled ? "#050505" : charcoal ? "#181818" : "#1f2937";
    const elevated = oled ? "#080808" : charcoal ? "#202020" : "#253244";
    return {
      ...snapshot,
      colors: darkText,
      surfaces: {
        appBackground,
        headerBackground: panel,
        toolbarBackground: panel,
        cardBackground: panel,
        elevatedPanel: elevated,
        modalBackground: elevated,
        selectedBackground: oled ? "#1f1634" : "#312e81",
        hoverBackground: oled ? "#111111" : "#374151",
        divider: oled ? "#262626" : "#4b5563"
      },
      inputs: {
        background: oled ? "#050505" : "#111827",
        text: "#f8fafc",
        placeholder: "#9ca3af",
        border: oled ? "#262626" : "#4b5563",
        focusBorder: "#a78bfa",
        invalidBorder: "#fca5a5",
        disabledBackground: "#1f2937",
        disabledText: "#9ca3af"
      },
      buttons: {
        primaryBackground: "#7c3aed",
        primaryText: "#ffffff",
        secondaryBackground: panel,
        secondaryText: "#f8fafc",
        destructiveBackground: "#dc2626",
        destructiveText: "#ffffff",
        iconBackground: panel,
        iconColor: "#f8fafc",
        hoverBackground: oled ? "#111111" : "#374151",
        pressedBackground: "#312e81",
        disabledBackground: "#374151",
        disabledText: "#9ca3af",
        focusRing: "#a78bfa"
      },
      cards: {
        ...snapshot.cards,
        background: panel,
        border: oled ? "#262626" : "#4b5563",
        title: "#ffffff",
        body: "#d1d5db",
        metadata: "#9ca3af",
        hover: elevated
      },
      branding: {
        ...snapshot.branding,
        logoBackground: "#ffffff",
        logoBorder: oled ? "#262626" : "#4b5563"
      }
    };
  }
  return snapshot;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function localMessageId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `message_${Date.now()}_${Math.random()}`;
}

function assistantSourceLabel(kind: AssistantChatSource["kind"]): string {
  if (kind === "email") return "Email";
  if (kind === "notification") return "Notification";
  return "Calendar";
}

function applyAppearanceToDocument(appearance: AppearancePreferences): void {
  const root = document.documentElement;
  const preset =
    appearance.preset === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : appearance.preset;
  root.dataset.theme = preset;
  const vars: Record<string, string> = {
    "--accent": appearance.accent,
    "--app-bg": appearance.surfaces.appBackground,
    "--surface-bg": appearance.surfaces.cardBackground,
    "--surface-elevated": appearance.surfaces.elevatedPanel,
    "--header-bg": appearance.surfaces.headerBackground,
    "--toolbar-bg": appearance.surfaces.toolbarBackground,
    "--modal-bg": appearance.surfaces.modalBackground,
    "--selected-bg": appearance.surfaces.selectedBackground,
    "--hover-bg": appearance.surfaces.hoverBackground,
    "--border": appearance.surfaces.divider,
    "--border-subtle": appearance.surfaces.divider,
    "--text-primary": appearance.colors.primaryText,
    "--text-secondary": appearance.colors.secondaryText,
    "--text-muted": appearance.colors.mutedText,
    "--heading-text": appearance.colors.headings,
    "--navigation-text": appearance.colors.navigationText,
    "--card-title": appearance.cards.title,
    "--card-body": appearance.cards.body,
    "--metadata-text": appearance.cards.metadata,
    "--link-text": appearance.colors.links,
    "--success": appearance.statusColors.success,
    "--warning": appearance.statusColors.warning,
    "--error": appearance.statusColors.danger,
    "--info": appearance.statusColors.info,
    "--input-bg": appearance.inputs.background,
    "--input-text": appearance.inputs.text,
    "--input-placeholder": appearance.inputs.placeholder,
    "--input-border": appearance.inputs.border,
    "--input-focus-border": appearance.inputs.focusBorder,
    "--input-invalid-border": appearance.inputs.invalidBorder,
    "--input-disabled-bg": appearance.inputs.disabledBackground,
    "--input-disabled-text": appearance.inputs.disabledText,
    "--button-primary-bg": appearance.buttons.primaryBackground,
    "--button-primary-text": appearance.buttons.primaryText,
    "--button-secondary-bg": appearance.buttons.secondaryBackground,
    "--button-secondary-text": appearance.buttons.secondaryText,
    "--button-danger-bg": appearance.buttons.destructiveBackground,
    "--button-danger-text": appearance.buttons.destructiveText,
    "--button-icon-bg": appearance.buttons.iconBackground,
    "--button-icon-color": appearance.buttons.iconColor,
    "--button-hover-bg": appearance.buttons.hoverBackground,
    "--button-pressed-bg": appearance.buttons.pressedBackground,
    "--button-disabled-bg": appearance.buttons.disabledBackground,
    "--button-disabled-text": appearance.buttons.disabledText,
    "--focus-color": appearance.buttons.focusRing,
    "--card-bg": appearance.cards.background,
    "--card-border": appearance.cards.border,
    "--card-hover": appearance.cards.hover,
    "--pin-active": appearance.cards.pinnedAccent,
    "--radius": `${appearance.borders.globalRadius}px`,
    "--card-radius": `${appearance.cards.radius}px`,
    "--border-width": `${appearance.borders.borderWidth}px`,
    "--card-border-width": `${appearance.cards.borderWidth}px`,
    "--font-sm": `${appearance.typography.small}px`,
    "--font-base": `${appearance.typography.base}px`,
    "--font-lg": `${appearance.typography.pageHeading}px`,
    "--font-card-title": `${appearance.typography.cardTitle}px`,
    "--font-navigation": `${appearance.typography.navigation}px`,
    "--font-control": `${appearance.typography.control}px`,
    "--note-card-min-width": `${appearance.cards.noteMinWidth}px`,
    "--logo-bg": appearance.branding.logoBackground,
    "--logo-border": appearance.branding.logoBorder,
    "--logo-radius": `${appearance.branding.logoRadius}px`,
    "--shadow": `0 ${Math.round(8 + appearance.borders.shadowIntensity * 8)}px ${Math.round(24 + appearance.borders.shadowIntensity * 24)}px rgb(15 23 42 / ${Math.min(0.32, 0.08 + appearance.borders.shadowIntensity * 0.08)})`
  };
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
}

function AppNavigation(props: {
  view: View;
  onViewChange: (view: View) => void;
  variant: "top" | "bottom";
}): ReactElement {
  const desktopClient = isDesktopClient();
  const items: Array<{ view: View; label: string; short: string }> = [
    { view: "home", label: "Home", short: "Home" },
    { view: "notifications", label: "Notifications", short: "Inbox" },
    { view: "agenda", label: "Agenda", short: "Agenda" },
    { view: "notes", label: "Notes", short: "Notes" },
    { view: "settings", label: "Settings", short: "Settings" }
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
          aria-label={item.label}
          title={item.label}
          onClick={() => props.onViewChange(item.view)}
        >
          {desktopClient ? <NavIcon view={item.view} /> : null}
          <span>{desktopClient ? item.short : item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function NavIcon(props: { view: View }): ReactElement {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.2",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false
  };
  if (props.view === "home") {
    return (
      <svg {...common}>
        <path d="m3 11 9-7 9 7" />
        <path d="M5 10v10h14V10" />
        <path d="M10 20v-6h4v6" />
      </svg>
    );
  }
  if (props.view === "notifications") {
    return (
      <svg {...common}>
        <path d="M4 5h16v11H7l-3 3V5Z" />
        <path d="M8 9h8" />
        <path d="M8 13h5" />
      </svg>
    );
  }
  if (props.view === "agenda") {
    return (
      <svg {...common}>
        <path d="M7 3v4M17 3v4M4 8h16" />
        <rect x="4" y="5" width="16" height="16" rx="2" />
        <path d="M8 12h3M8 16h6" />
      </svg>
    );
  }
  if (props.view === "notes") {
    return (
      <svg {...common}>
        <path d="M6 3h9l3 3v15H6V3Z" />
        <path d="M14 3v4h4" />
        <path d="M9 12h6M9 16h6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M9.6 3.2h4.8l.6 2.5a7.4 7.4 0 0 1 1.4.8l2.4-.8 2.4 4.2-1.8 1.7a7.8 7.8 0 0 1 0 1.7l1.8 1.7-2.4 4.2-2.4-.8a7.4 7.4 0 0 1-1.4.8l-.6 2.5H9.6L9 19.2a7.4 7.4 0 0 1-1.4-.8l-2.4.8-2.4-4.2 1.8-1.7a7.8 7.8 0 0 1 0-1.7L2.8 9.9l2.4-4.2 2.4.8A7.4 7.4 0 0 1 9 5.7l.6-2.5Z" />
      <circle cx="12" cy="12.5" r="3.1" />
    </svg>
  );
}

function logoSource(appearance: AppearancePreferences): string {
  if (isDesktopClient()) return "/icons/DentLinkDark.png";
  if (appearance.branding.logoVariant === "dark") return "/icons/DentLinkDark.png";
  if (appearance.branding.logoVariant === "auto") {
    const darkSurface =
      appearance.preset === "dark" ||
      appearance.preset === "charcoal" ||
      appearance.preset === "oled";
    return darkSurface ? "/icons/DentLinkDark.png" : "/icons/DentLink.png";
  }
  return "/icons/DentLink.png";
}

function NotificationsView(props: {
  notifications: Notification[];
  aiSettings: EmailAiSettings | null;
  importanceThreshold: number;
  sourceColors: Record<string, string>;
  webhooks: Array<WebhookEndpoint & { ingestUrl: string }>;
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
  const [notificationSearch, setNotificationSearch] = useState("");
  const [expandedId, setExpandedId] = useState<EntityId | null>(null);
  const [showFullBodyIds, setShowFullBodyIds] = useState<EntityId[]>([]);
  const [draft, setDraft] = useState<NotificationInput>({
    title: "",
    summary: "",
    severity: "info"
  });
  const visibleNotifications = props.notifications.filter((notification) => {
    const searchMatches =
      !notificationSearch.trim() ||
      JSON.stringify({
        title: notification.title,
        summary: notification.summary,
        sender: notification.email?.senderDisplayName,
        subject: notification.email?.subject,
        category: notification.ai?.category
      })
        .toLowerCase()
        .includes(notificationSearch.trim().toLowerCase());
    if (!searchMatches) return false;
    if (listMode === "history")
      return notification.status === "dismissed" || notification.status === "done";
    if (notification.status === "suppressed")
      return props.debugMode || Boolean(notificationSearch.trim());
    return notification.status === "active";
  });
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
      <label className="field notification-search">
        <span>Search notifications</span>
        <input
          aria-label="Search notifications"
          value={notificationSearch}
          onChange={(event) => setNotificationSearch(event.currentTarget.value)}
        />
      </label>
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
          {listMode === "history"
            ? "No completed or dismissed notifications yet."
            : "No active notifications."}
        </p>
      ) : null}
      {sorted.map((notification) => (
        <article
          key={notification.id}
          className={`notification-card compact-notification ${notification.status} importance-${importanceBand(notification)}`}
          style={notificationAccentStyle(notification, props.sourceColors, props.webhooks)}
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
          </button>
          <div className="notification-meta-actions">
            <div className="notification-card-meta">
              <span className="importance-pill">Importance: {importanceScore(notification)}</span>
              <span className="notification-card-time">
                {relativeTime(notification.email?.receivedAt ?? notification.createdAt)}
              </span>
              {notification.ai?.requiresAction ? (
                <span className="action-required">Action required</span>
              ) : null}
              {listMode === "history" ? <HistoryStateBadge notification={notification} /> : null}
              {notification.status === "suppressed" ? (
                <span className="history-state suppressed">Below threshold</span>
              ) : null}
            </div>
            <NotificationQuickActions
              notification={notification}
              onUpdateNotification={props.onUpdateNotification}
            />
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
            onUpdateNotification={(patch) =>
              props.onUpdateNotification(selectedNotification, patch)
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
  onUpdateNotification: (patch: Partial<Pick<Notification, "pinned" | "status">>) => Promise<void>;
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
        <IconButton label="Close notification details" icon="close" onClick={props.onClose} />
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
      {notification.status !== "active" ? <HistoryStateBadge notification={notification} /> : null}
      {notification.ai?.reason ? <p>{notification.ai.reason}</p> : null}
      {notification.rule ? (
        <p>
          Rule: {notification.rule.ruleName} - {notification.rule.action}
        </p>
      ) : null}
      <NotificationQuickActions
        notification={notification}
        onUpdateNotification={(_, patch) => props.onUpdateNotification(patch)}
        expanded
      />
      {hasBody ? (
        <div className="notification-detail-actions">
          <button type="button" onClick={props.onToggleFullBody}>
            {props.showFullBody ? "Hide full email" : "Show full email"}
          </button>
        </div>
      ) : null}
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
      <div className="notification-detail-actions">
        <IconButton label="Close" icon="close" onClick={props.onClose} />
      </div>
    </section>
  );
}

function NotificationQuickActions(props: {
  notification: Notification;
  onUpdateNotification: (
    notification: Notification,
    patch: Partial<Pick<Notification, "pinned" | "status">>
  ) => Promise<void>;
  expanded?: boolean;
}): ReactElement {
  const notification = props.notification;
  const actionable = isActionableNotification(notification);
  const isHistory =
    notification.status === "dismissed" ||
    notification.status === "done" ||
    notification.status === "suppressed";
  return (
    <div className={`notification-touch-actions ${props.expanded ? "expanded" : ""}`}>
      <IconButton
        label={notification.pinned ? "Unpin" : "Pin"}
        icon="pin"
        pressed={notification.pinned}
        onClick={() =>
          void props.onUpdateNotification(notification, { pinned: !notification.pinned })
        }
      />
      {isHistory ? (
        <IconButton
          label="Restore"
          icon="restore"
          onClick={() => void props.onUpdateNotification(notification, { status: "active" })}
        />
      ) : (
        <>
          {actionable ? (
            <IconButton
              label="Complete"
              icon="check"
              variant="complete"
              onClick={() => void props.onUpdateNotification(notification, { status: "done" })}
            />
          ) : null}
          <IconButton
            label="Dismiss"
            icon="close"
            variant="dismiss"
            onClick={() => void props.onUpdateNotification(notification, { status: "dismissed" })}
          />
        </>
      )}
      {props.expanded && notification.sourceUrl ? (
        <IconLink
          label={sourceOpenLabel(notification)}
          icon="external"
          href={notification.sourceUrl}
        />
      ) : null}
    </div>
  );
}

function HistoryStateBadge(props: { notification: Notification }): ReactElement | null {
  const notification = props.notification;
  if (notification.status === "done") {
    return (
      <span className="history-state completed">
        Completed {notification.completedAt ? relativeTime(notification.completedAt) : ""}
      </span>
    );
  }
  if (notification.status === "dismissed") {
    return (
      <span className="history-state dismissed">
        Dismissed {notification.dismissedAt ? relativeTime(notification.dismissedAt) : ""}
      </span>
    );
  }
  if (notification.status === "suppressed") {
    return <span className="history-state suppressed">Below threshold</span>;
  }
  return null;
}

function IconButton(props: {
  label: string;
  icon: IconName;
  onClick: () => void;
  pressed?: boolean;
  variant?: "complete" | "dismiss";
}): ReactElement {
  return (
    <button
      type="button"
      className={`icon-button ${props.variant ?? ""}`}
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.pressed}
      onClick={props.onClick}
    >
      <Icon name={props.icon} filled={props.pressed} />
      <span className="icon-button-text">{props.label}</span>
    </button>
  );
}

function IconLink(props: { label: string; icon: IconName; href: string }): ReactElement {
  return (
    <a
      className="icon-button"
      aria-label={props.label}
      title={props.label}
      href={props.href}
      target="_blank"
      rel="noreferrer"
    >
      <Icon name={props.icon} />
      <span className="icon-button-text">{props.label}</span>
    </a>
  );
}

function Icon(props: { name: IconName; filled?: boolean }): ReactElement {
  const common = {
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };
  if (props.name === "pin") {
    const path = props.filled
      ? "M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2Z"
      : "M14 4v8.83L15.17 14H8.83L10 12.83V4h4Zm3-2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2V4h1V2Z";
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={path} />
      </svg>
    );
  }
  if (props.name === "check") {
    return (
      <svg {...common}>
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  if (props.name === "external") {
    return (
      <svg {...common}>
        <path d="M15 3h6v6" />
        <path d="M10 14 21 3" />
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      </svg>
    );
  }
  if (props.name === "restore") {
    return (
      <svg {...common}>
        <path d="M3 7v6h6" />
        <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
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
  sourceColors: Record<string, string>;
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
  onOpenNote: (noteId: EntityId) => void;
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
    onDismissEvent: props.onDismissEvent,
    onOpenNote: props.onOpenNote
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
        <PlusIcon />
      </button>
      {props.mode === "agenda" ? (
        <AgendaCalendarView
          events={visibleEvents}
          actions={eventActions}
          sourceColors={props.sourceColors}
        />
      ) : null}
      {props.mode === "day" ? (
        <DayCalendarView
          events={visibleEvents}
          selectedDate={props.selectedDate}
          actions={eventActions}
          sourceColors={props.sourceColors}
        />
      ) : null}
      {props.mode === "week" ? (
        <WeekCalendarView
          events={visibleEvents}
          selectedDate={props.selectedDate}
          actions={eventActions}
          sourceColors={props.sourceColors}
        />
      ) : null}
      {props.mode === "month" ? (
        <MonthCalendarView
          events={visibleEvents}
          selectedDate={props.selectedDate}
          onDateChange={props.onDateChange}
          onModeChange={props.onModeChange}
          actions={eventActions}
          sourceColors={props.sourceColors}
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
            sourceColors={props.sourceColors}
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
              <IconButton
                label="Close calendar actions"
                icon="close"
                onClick={() => setCalendarAction(null)}
              />
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
  onOpenNote: (noteId: EntityId) => void;
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
  sourceColors: Record<string, string>;
}): ReactElement {
  const sorted = [...props.events].sort(compareEventsByStart);
  if (sorted.length === 0) return <p>No events in this range.</p>;
  return (
    <section className="agenda-view" aria-label="Agenda events">
      {sorted.map((event) => (
        <CalendarEventCard
          key={event.id}
          event={event}
          actions={props.actions}
          sourceColors={props.sourceColors}
          detailed
        />
      ))}
    </section>
  );
}

function DayCalendarView(props: {
  events: CalendarEvent[];
  selectedDate: string;
  actions: CalendarEventActions;
  sourceColors: Record<string, string>;
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
            <EventChip
              key={event.id}
              event={event}
              actions={props.actions}
              sourceColors={props.sourceColors}
            />
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
            <TimedEventBlock
              key={layout.event.id}
              layout={layout}
              actions={props.actions}
              sourceColors={props.sourceColors}
            />
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
  sourceColors: Record<string, string>;
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
                <EventChip
                  key={event.id}
                  event={event}
                  actions={props.actions}
                  sourceColors={props.sourceColors}
                />
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
                <TimedEventBlock
                  key={layout.event.id}
                  layout={layout}
                  actions={props.actions}
                  sourceColors={props.sourceColors}
                />
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
  sourceColors: Record<string, string>;
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
                <EventChip
                  key={event.id}
                  event={event}
                  actions={props.actions}
                  sourceColors={props.sourceColors}
                  compact
                />
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
  sourceColors: Record<string, string>;
  detailed?: boolean;
}): ReactElement {
  const event = props.event;
  return (
    <article
      className={`calendar-card ${event.source} ${event.status}`}
      aria-label={`Calendar event ${event.title}`}
      style={eventAccentStyle(event, props.sourceColors)}
    >
      <div className="calendar-card-header">
        <strong>{event.title}</strong>
        <SourceBadge event={event} sourceColors={props.sourceColors} />
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
  sourceColors: Record<string, string>;
  compact?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      className={`event-chip ${props.event.source}`}
      style={eventAccentStyle(props.event, props.sourceColors)}
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
  sourceColors: Record<string, string>;
}): ReactElement {
  const left = (props.layout.column / props.layout.columns) * 100;
  const width = 100 / props.layout.columns;
  return (
    <button
      type="button"
      className={`timed-event ${props.layout.event.source}`}
      style={{
        ...eventAccentStyle(props.layout.event, props.sourceColors),
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
  sourceColors: Record<string, string>;
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
        <IconButton label="Close event details" icon="close" onClick={props.onClose} />
      </div>
      <SourceBadge event={event} sourceColors={props.sourceColors} />
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
  if (event.source === "note") {
    return (
      <div className="event-actions">
        <IconButton
          label="Open note"
          icon="external"
          onClick={() => props.actions.onOpenNote(noteIdFromCalendarEvent(event))}
        />
      </div>
    );
  }
  return (
    <div className="event-actions">
      <IconButton
        label={event.annotation?.pinned ? "Unpin event" : "Pin event"}
        icon="pin"
        pressed={event.annotation?.pinned ?? false}
        onClick={() =>
          void props.actions.onAnnotateEvent(event, {
            pinned: !(event.annotation?.pinned ?? false)
          })
        }
      />
      <IconButton
        label={event.annotation?.completed ? "Mark incomplete" : "Complete event"}
        icon="check"
        variant="complete"
        onClick={() =>
          void props.actions.onAnnotateEvent(event, {
            completed: !(event.annotation?.completed ?? false)
          })
        }
      />
      <IconButton
        label={event.source === "local" ? "Delete event" : "Dismiss event"}
        icon="close"
        variant="dismiss"
        onClick={() =>
          event.source === "local"
            ? void props.actions.onDeleteLocalEvent(event)
            : void props.actions.onDismissEvent(event)
        }
      />
    </div>
  );
}

function SourceBadge(props: {
  event: CalendarEvent;
  sourceColors: Record<string, string>;
}): ReactElement {
  return (
    <span
      className={`source-badge ${props.event.source}`}
      style={sourceBadgeStyle(calendarSourceColor(props.event, props.sourceColors))}
    >
      {sourceLabel(props.event)}
    </span>
  );
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

function eventAccentStyle(
  event: CalendarEvent,
  sourceColors: Record<string, string>
): CSSProperties {
  return sourceAccentStyle(calendarSourceColor(event, sourceColors), "--event-accent");
}

function notificationAccentStyle(
  notification: Notification,
  sourceColors: Record<string, string>,
  webhooks: Array<WebhookEndpoint & { ingestUrl: string }>
): CSSProperties {
  return sourceAccentStyle(
    notificationSourceColor(notification, sourceColors, webhooks),
    "--source-accent"
  );
}

function sourceBadgeStyle(color: string): CSSProperties {
  return {
    "--source-accent": color,
    borderColor: color
  } as CSSProperties;
}

function sourceAccentStyle(color: string, variableName: string): CSSProperties {
  return {
    [variableName]: color,
    "--source-accent": color
  } as CSSProperties;
}

function calendarSourceColor(event: CalendarEvent, sourceColors: Record<string, string>): string {
  if (event.source === "note") return event.color || sourceColors.note || "#7c3aed";
  if (event.source === "local") return event.color || sourceColors.local || "#2f855a";
  if (event.connectorAccountId) {
    const accountColor = sourceColors[`google-calendar:${event.connectorAccountId}`];
    if (accountColor) return accountColor;
  }
  return sourceColors["google-calendar"] || "#2563eb";
}

function notificationSourceColor(
  notification: Notification,
  sourceColors: Record<string, string>,
  webhooks: Array<WebhookEndpoint & { ingestUrl: string }>
): string {
  const category = notification.ai?.category;
  if (category) {
    const categoryColor = sourceColors[`category:${category}`];
    if (categoryColor) return categoryColor;
  }
  if (notification.email?.accountId) {
    const accountColor = sourceColors[`gmail:${notification.email.accountId}`];
    if (accountColor) return accountColor;
  }
  if (notification.email) return sourceColors.gmail || "#1d4ed8";
  if (notification.source === "webhook") {
    const webhook = webhooks.find((endpoint) => endpoint.name === notification.sourceLabel);
    if (webhook) {
      const webhookColor = sourceColors[`webhook:${webhook.id}`];
      if (webhookColor) return webhookColor;
    }
    return sourceColors.webhook || "#b45309";
  }
  if (notification.source === "system") return sourceColors["category:system"] || "#64748b";
  return sourceColors.local || "#2563eb";
}

function sourceLabel(event: CalendarEvent): string {
  if (event.source === "note") return "Note";
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

function formatEventTimelineDate(event: CalendarEvent): string {
  const date = new Date(`${event.startDate ?? event.startAt.slice(0, 10)}T00:00:00.000Z`);
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
}

function todayKey(timeZone = detectedTimezone()): string {
  return dateKeyInTimezone(new Date(), timeZone);
}

function dateKeyInTimezone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? date.getUTCFullYear();
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function detectedTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function timezoneOptions(): string[] {
  const supported =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return supported.length > 0
    ? supported
    : [
        "UTC",
        "America/New_York",
        "America/Chicago",
        "America/Denver",
        "America/Los_Angeles",
        "Europe/London",
        "Europe/Paris",
        "Asia/Tokyo"
      ];
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
  onEvent: (event: DentLinkChangeEvent) => void,
  onReady: () => void
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
      if (chunk.includes("event: ready")) onReady();
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
      requestedEngine: gmailSelectedEngine(account),
      activeEngine: gmailActiveEngine(account),
      reconnectRequired: settings.gmailReconnectRequired === true,
      verified:
        gmailActiveEngine(account) === "gmail_imap"
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
          syncAttempts: diagnostics.attempts,
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

function isActionableNotification(notification: Notification): boolean {
  if (notification.ai?.requiresAction === true) return true;
  const suggestedAction = notification.ai?.suggestedAction?.trim().toLowerCase();
  if (
    suggestedAction &&
    suggestedAction !== "ignore" &&
    suggestedAction !== "archive" &&
    suggestedAction !== "none"
  ) {
    return true;
  }
  const category = notification.ai?.category ?? notification.rule?.category;
  if (category && /action|task|approval|reminder|deadline/.test(category)) return true;
  if (notification.rule?.action === "high_priority") return true;
  if (notification.ai?.deadline) return true;
  if (notification.sourceLabel.toLowerCase().includes("task")) return true;
  return false;
}

function sourceOpenLabel(notification: Notification): string {
  const source = notification.sourceLabel.toLowerCase();
  if (source.includes("calendar")) return "Open event";
  if (source.includes("gmail")) return "Open original";
  return "Open source";
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
    notification.email?.senderDisplayName?.trim() || notification.sourceLabel || "Unknown sender"
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
  appearance: AppearancePreferences;
  onAppearanceChange: (appearance: AppearancePreferences) => void;
  preferences: UserPreferences | null;
  onPreferencesChange: (
    patch: Parameters<DentLinkApiClient["updatePreferences"]>[0]
  ) => Promise<void>;
  aiSettings: EmailAiSettings | null;
  onEmailAiEnabledChange: (enabled: boolean) => Promise<void>;
  aiReprocessResult: EmailAiReprocessResult | null;
  aiReprocessRunning: boolean;
  onReprocessEmailAi: (accountId?: EntityId | null) => Promise<void>;
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
      {props.selectedTab !== "general" ? (
        <button
          type="button"
          className="settings-back-button"
          onClick={() => props.onTabChange("general")}
        >
          Back to Settings
        </button>
      ) : null}
      <nav className="settings-tabs" aria-label="Settings sections">
        {(
          [
            ["general", "General"],
            ["appearance", "Appearance"],
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
          <TimezoneSettingsPanel
            preferences={props.preferences}
            onPreferencesChange={props.onPreferencesChange}
          />
        </section>
      ) : null}
      {props.selectedTab === "appearance" ? (
        <AppearanceSettingsPanel
          appearance={props.appearance}
          onAppearanceChange={props.onAppearanceChange}
          preferences={props.preferences}
          onPreferencesChange={props.onPreferencesChange}
          accounts={props.accounts}
          webhooks={props.webhooks}
        />
      ) : null}
      {props.selectedTab === "ai" ? (
        <AiSettingsPanel
          settings={props.aiSettings}
          preferences={props.preferences}
          accounts={gmailAccounts}
          reprocessResult={props.aiReprocessResult}
          reprocessRunning={props.aiReprocessRunning}
          onPreferencesChange={props.onPreferencesChange}
          onEnabledChange={props.onEmailAiEnabledChange}
          onReprocess={props.onReprocessEmailAi}
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

function TimezoneSettingsPanel(props: {
  preferences: UserPreferences | null;
  onPreferencesChange: (
    patch: Parameters<DentLinkApiClient["updatePreferences"]>[0]
  ) => Promise<void>;
}): ReactElement {
  const detected = detectedTimezone();
  const timezone = props.preferences?.timezone ?? {
    mode: "device" as const,
    detected,
    selected: detected
  };
  const zones = timezoneOptions();
  return (
    <section className="subsettings-panel" aria-label="Timezone settings">
      <h3>Timezone</h3>
      <p>Detected device timezone: {detected}</p>
      <label className="debug-toggle">
        <input
          type="checkbox"
          checked={timezone.mode === "device"}
          onChange={(event) =>
            void props.onPreferencesChange({
              timezone: {
                mode: event.currentTarget.checked ? "device" : "override",
                detected,
                selected: event.currentTarget.checked ? detected : timezone.selected
              }
            })
          }
        />{" "}
        Use device timezone
      </label>
      <label className="field">
        <span>Timezone override</span>
        <select
          value={timezone.selected}
          disabled={timezone.mode === "device"}
          onChange={(event) =>
            void props.onPreferencesChange({
              timezone: { mode: "override", detected, selected: event.currentTarget.value }
            })
          }
        >
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}

function AppearanceSettingsPanel(props: {
  appearance: AppearancePreferences;
  onAppearanceChange: (appearance: AppearancePreferences) => void;
  preferences: UserPreferences | null;
  onPreferencesChange: (
    patch: Parameters<DentLinkApiClient["updatePreferences"]>[0]
  ) => Promise<void>;
  accounts: ConnectorAccount[];
  webhooks: Array<WebhookEndpoint & { ingestUrl: string }>;
}): ReactElement {
  const [profileName, setProfileName] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const update = (patch: Partial<AppearancePreferences>) => {
    props.onAppearanceChange(normalizeAppearance({ ...props.appearance, ...patch }));
  };
  const updateSection = <K extends keyof AppearancePreferences>(
    key: K,
    value: AppearancePreferences[K]
  ) => update({ [key]: value } as Partial<AppearancePreferences>);
  const dirty = appearanceProfileDirty(props.appearance);
  const accountProfile = props.preferences?.appearance?.profile ?? null;
  return (
    <section className="settings-panel" aria-label="Appearance settings">
      <h2>Appearance</h2>
      <details className="appearance-section" open>
        <summary>
          Presets and Profiles · {props.appearance.loadedProfileName}
          {dirty ? " modified" : ""}
        </summary>
        <div className="appearance-profile-grid">
          {props.appearance.profiles.map((profile) => (
            <button
              type="button"
              key={profile.id}
              className={profile.id === props.appearance.loadedProfileId ? "selected" : ""}
              onClick={() =>
                props.onAppearanceChange(loadAppearanceProfile(props.appearance, profile))
              }
            >
              <strong>{profile.name}</strong>
              <span>{profile.builtIn ? "Built-in" : "Custom"}</span>
            </button>
          ))}
        </div>
        <div className="inline-form">
          <input
            aria-label="Appearance profile name"
            placeholder="Profile name"
            value={profileName}
            onChange={(event) => setProfileName(event.currentTarget.value)}
          />
          <button
            type="button"
            onClick={() => {
              if (!profileName.trim()) return;
              props.onAppearanceChange(saveAppearanceProfile(props.appearance, profileName.trim()));
              setProfileName("");
            }}
          >
            Save profile
          </button>
          <button
            type="button"
            disabled={!props.appearance.loadedProfileId}
            onClick={() => props.onAppearanceChange(duplicateAppearanceProfile(props.appearance))}
          >
            Duplicate
          </button>
          <button
            type="button"
            disabled={!currentCustomProfile(props.appearance)}
            onClick={() => {
              const name = window.prompt("Rename profile", props.appearance.loadedProfileName);
              if (name?.trim())
                props.onAppearanceChange(renameAppearanceProfile(props.appearance, name.trim()));
            }}
          >
            Rename
          </button>
          <button
            type="button"
            disabled={!currentCustomProfile(props.appearance)}
            onClick={() =>
              props.onAppearanceChange(deleteCurrentAppearanceProfile(props.appearance))
            }
          >
            Delete
          </button>
        </div>
      </details>

      <details className="appearance-section">
        <summary>Text Colors · {props.appearance.colors.primaryText}</summary>
        <ColorControlGrid
          values={props.appearance.colors}
          defaults={defaultAppearance().colors}
          labels={{
            primaryText: "Primary text",
            secondaryText: "Secondary text",
            mutedText: "Muted text",
            headings: "Headings",
            navigationText: "Navigation text",
            cardTitles: "Card titles",
            bodyText: "Body text",
            metadataText: "Metadata text",
            links: "Links",
            successText: "Success text",
            warningText: "Warning text",
            dangerText: "Danger/error text",
            notificationMetadata: "Notification metadata"
          }}
          onChange={(colors) => updateSection("colors", colors)}
        />
      </details>
      <details className="appearance-section">
        <summary>Typography · base {props.appearance.typography.base}px</summary>
        <RangeControlGrid
          values={props.appearance.typography}
          defaults={defaultAppearance().typography}
          labels={{
            base: "Base/body font size",
            small: "Small metadata font size",
            cardTitle: "Card-title font size",
            pageHeading: "Page-heading font size",
            navigation: "Navigation font size",
            control: "Button and input font size"
          }}
          min={11}
          max={28}
          unit="px"
          onChange={(typography) => updateSection("typography", typography)}
        />
      </details>
      <details className="appearance-section">
        <summary>Backgrounds and Surfaces · {props.appearance.surfaces.appBackground}</summary>
        <ColorControlGrid
          values={props.appearance.surfaces}
          defaults={defaultAppearance().surfaces}
          labels={{
            appBackground: "Application background",
            headerBackground: "Top header background",
            toolbarBackground: "Toolbar surface",
            cardBackground: "Standard card background",
            elevatedPanel: "Elevated panel/sheet background",
            modalBackground: "Modal/dialog background",
            selectedBackground: "Selected item background",
            hoverBackground: "Hover background",
            divider: "Divider/border color"
          }}
          onChange={(surfaces) => updateSection("surfaces", surfaces)}
        />
      </details>
      <details className="appearance-section">
        <summary>Inputs · {props.appearance.inputs.background}</summary>
        <ColorControlGrid
          values={props.appearance.inputs}
          defaults={defaultAppearance().inputs}
          labels={{
            background: "Input background",
            text: "Input text",
            placeholder: "Placeholder text",
            border: "Input border",
            focusBorder: "Focused border",
            invalidBorder: "Invalid/error border",
            disabledBackground: "Disabled input background",
            disabledText: "Disabled input text"
          }}
          onChange={(inputs) => updateSection("inputs", inputs)}
        />
      </details>
      <details className="appearance-section">
        <summary>Buttons and Controls · {props.appearance.buttons.primaryBackground}</summary>
        <ColorControlGrid
          values={props.appearance.buttons}
          defaults={defaultAppearance().buttons}
          labels={{
            primaryBackground: "Primary button background",
            primaryText: "Primary button text",
            secondaryBackground: "Secondary button background",
            secondaryText: "Secondary button text",
            destructiveBackground: "Destructive button background",
            destructiveText: "Destructive button text",
            iconBackground: "Icon-button background",
            iconColor: "Icon color",
            hoverBackground: "Hover state",
            pressedBackground: "Pressed state",
            disabledBackground: "Disabled state",
            disabledText: "Disabled text",
            focusRing: "Focus ring"
          }}
          onChange={(buttons) => updateSection("buttons", buttons)}
        />
      </details>
      <details className="appearance-section">
        <summary>Cards · min {props.appearance.cards.noteMinWidth}px</summary>
        <ColorControlGrid
          values={{
            background: props.appearance.cards.background,
            border: props.appearance.cards.border,
            title: props.appearance.cards.title,
            body: props.appearance.cards.body,
            metadata: props.appearance.cards.metadata,
            pinnedAccent: props.appearance.cards.pinnedAccent,
            hover: props.appearance.cards.hover
          }}
          defaults={{
            background: defaultAppearance().cards.background,
            border: defaultAppearance().cards.border,
            title: defaultAppearance().cards.title,
            body: defaultAppearance().cards.body,
            metadata: defaultAppearance().cards.metadata,
            pinnedAccent: defaultAppearance().cards.pinnedAccent,
            hover: defaultAppearance().cards.hover
          }}
          labels={{
            background: "Card background",
            border: "Card border",
            title: "Card title color",
            body: "Card body color",
            metadata: "Metadata color",
            pinnedAccent: "Selected/pinned accent",
            hover: "Hover state"
          }}
          onChange={(colors) => updateSection("cards", { ...props.appearance.cards, ...colors })}
        />
        <RangeControlGrid
          values={{
            shadow: props.appearance.cards.shadow,
            radius: props.appearance.cards.radius,
            borderWidth: props.appearance.cards.borderWidth,
            noteMinWidth: props.appearance.cards.noteMinWidth
          }}
          defaults={{
            shadow: defaultAppearance().cards.shadow,
            radius: defaultAppearance().cards.radius,
            borderWidth: defaultAppearance().cards.borderWidth,
            noteMinWidth: defaultAppearance().cards.noteMinWidth
          }}
          labels={{
            shadow: "Shadow intensity",
            radius: "Corner radius",
            borderWidth: "Border thickness",
            noteMinWidth: "Note card minimum width"
          }}
          min={0}
          max={480}
          unit="px"
          bounds={{
            shadow: [0, 4],
            radius: [0, 24],
            borderWidth: [0, 4],
            noteMinWidth: [220, 480]
          }}
          onChange={(values) => updateSection("cards", { ...props.appearance.cards, ...values })}
        />
      </details>
      <details className="appearance-section">
        <summary>Borders, Corners, and Shadows · {props.appearance.borders.globalRadius}px</summary>
        <RangeControlGrid
          values={props.appearance.borders}
          defaults={defaultAppearance().borders}
          labels={{
            globalRadius: "Global corner radius",
            cardRadius: "Card corner radius",
            borderWidth: "Border thickness",
            shadowIntensity: "Shadow intensity"
          }}
          min={0}
          max={32}
          unit="px"
          bounds={{ shadowIntensity: [0, 4], borderWidth: [0, 4] }}
          onChange={(borders) => updateSection("borders", borders)}
        />
      </details>
      <details className="appearance-section">
        <summary>Status Colors · {props.appearance.statusColors.info}</summary>
        <ColorControlGrid
          values={props.appearance.statusColors}
          defaults={defaultAppearance().statusColors}
          labels={{
            success: "Success",
            warning: "Warning",
            danger: "Danger/error",
            info: "Info",
            suppressed: "Suppressed"
          }}
          onChange={(statusColors) => updateSection("statusColors", statusColors)}
        />
      </details>
      <details className="appearance-section">
        <summary>
          Source Colors · {Object.keys(props.appearance.sourceColors).length} values
        </summary>
        <SourceColorSettings
          appearance={props.appearance}
          onAppearanceChange={props.onAppearanceChange}
          accounts={props.accounts}
          webhooks={props.webhooks}
        />
      </details>
      <details className="appearance-section">
        <summary>DentLink Branding · {props.appearance.branding.logoVariant}</summary>
        <label className="field">
          <span>Logo variant</span>
          <select
            value={props.appearance.branding.logoVariant}
            onChange={(event) =>
              updateSection("branding", {
                ...props.appearance.branding,
                logoVariant: event.currentTarget.value as AppearanceBrandingSettings["logoVariant"]
              })
            }
          >
            <option value="standard">Standard logo</option>
            <option value="dark">Dark logo</option>
            <option value="auto">Automatic based on surface</option>
          </select>
        </label>
        <ColorControlGrid
          values={{
            logoBackground: props.appearance.branding.logoBackground,
            logoBorder: props.appearance.branding.logoBorder
          }}
          defaults={{
            logoBackground: defaultAppearance().branding.logoBackground,
            logoBorder: defaultAppearance().branding.logoBorder
          }}
          labels={{ logoBackground: "Logo background", logoBorder: "Logo border" }}
          onChange={(colors) =>
            updateSection("branding", { ...props.appearance.branding, ...colors })
          }
        />
        <RangeControlGrid
          values={{ logoRadius: props.appearance.branding.logoRadius }}
          defaults={{ logoRadius: defaultAppearance().branding.logoRadius }}
          labels={{ logoRadius: "Logo container corner radius" }}
          min={0}
          max={24}
          unit="px"
          onChange={(values) =>
            updateSection("branding", { ...props.appearance.branding, ...values })
          }
        />
        <label className="debug-toggle">
          <input
            type="checkbox"
            checked={props.appearance.branding.showLogoBorder}
            onChange={(event) =>
              updateSection("branding", {
                ...props.appearance.branding,
                showLogoBorder: event.currentTarget.checked
              })
            }
          />{" "}
          Show logo container border
        </label>
      </details>
      <details className="appearance-section">
        <summary>Advanced · animations {props.appearance.animations ? "on" : "off"}</summary>
        <label className="debug-toggle">
          <input
            type="checkbox"
            checked={props.appearance.animations}
            onChange={(event) => update({ animations: event.currentTarget.checked })}
          />{" "}
          Animations
        </label>
      </details>
      <details className="appearance-section">
        <summary>Reset and Transfer · local by default</summary>
        <div className="inline-form">
          <button type="button" onClick={() => props.onAppearanceChange(defaultAppearance())}>
            Reset all
          </button>
          <button type="button" onClick={() => exportAppearance(props.appearance)}>
            Export JSON
          </button>
          <label className="import-button">
            Import JSON
            <input
              type="file"
              accept="application/json"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (!file) return;
                void importAppearance(file)
                  .then((next) => {
                    setImportError(null);
                    if (window.confirm(`Apply appearance profile "${next.loadedProfileName}"?`)) {
                      props.onAppearanceChange(next);
                    }
                  })
                  .catch((error) =>
                    setImportError(error instanceof Error ? error.message : "Import failed.")
                  );
                event.currentTarget.value = "";
              }}
            />
          </label>
          <button
            type="button"
            onClick={() =>
              void props.onPreferencesChange({
                appearance: { profile: appearanceExportPayload(props.appearance) }
              })
            }
          >
            Set for all devices
          </button>
          <button
            type="button"
            disabled={!accountProfile}
            onClick={() => {
              if (!accountProfile) return;
              props.onAppearanceChange(appearanceFromExport(accountProfile));
            }}
          >
            Apply account profile
          </button>
          <button
            type="button"
            disabled={!accountProfile}
            onClick={() => void props.onPreferencesChange({ appearance: { profile: null } })}
          >
            Return this device to local-only
          </button>
        </div>
        {importError ? <p role="alert">{importError}</p> : null}
        <p>
          Appearance remains local on this device unless you explicitly set or apply an account
          profile.
        </p>
      </details>
    </section>
  );
}

function SourceColorSettings(props: {
  appearance: AppearancePreferences;
  onAppearanceChange: (appearance: AppearancePreferences) => void;
  accounts: ConnectorAccount[];
  webhooks: Array<WebhookEndpoint & { ingestUrl: string }>;
}): ReactElement {
  const defaultColors = defaultAppearance().sourceColors;
  const entries = sourceColorEntries(props.accounts, props.webhooks, props.appearance.sourceColors);
  const updateColor = (source: string, color: string) =>
    props.onAppearanceChange({
      ...props.appearance,
      sourceColors: {
        ...props.appearance.sourceColors,
        [source]: color
      }
    });
  const resetColor = (source: string) => {
    const next = { ...props.appearance.sourceColors };
    if (defaultColors[source]) next[source] = defaultColors[source];
    else delete next[source];
    props.onAppearanceChange({ ...props.appearance, sourceColors: next });
  };
  return (
    <section className="subsettings-panel" aria-label="Source colors">
      <h3>Source Colors</h3>
      <div className="source-color-grid">
        {entries.map((entry) => (
          <div key={entry.key} className="source-color-row">
            <div className="source-color-copy">
              <strong className="truncate" title={entry.label}>
                {entry.label}
              </strong>
              <small className="truncate" title={entry.key}>
                {entry.key}
              </small>
              <span>{entry.kind}</span>
            </div>
            <div className="source-color-actions">
              <ColorDraftControl
                label={`${entry.label} color`}
                value={entry.color}
                defaultValue={defaultColors[entry.key] ?? entry.color}
                onChange={(value) => updateColor(entry.key, value)}
              />
              <button type="button" onClick={() => resetColor(entry.key)}>
                Reset
              </button>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() =>
          props.onAppearanceChange({
            ...props.appearance,
            sourceColors: defaultAppearance().sourceColors
          })
        }
      >
        Reset all source colors
      </button>
    </section>
  );
}

function ColorControlGrid<T extends Record<string, string>>(props: {
  values: T;
  defaults: T;
  labels: Record<keyof T, string>;
  onChange: (values: T) => void;
}): ReactElement {
  return (
    <div className="appearance-control-grid">
      {(Object.keys(props.values) as Array<keyof T>).map((key) => (
        <ColorDraftControl
          key={String(key)}
          label={props.labels[key]}
          value={props.values[key] ?? "#000000"}
          defaultValue={props.defaults[key] ?? props.values[key] ?? "#000000"}
          onChange={(value) => props.onChange({ ...props.values, [key]: value })}
        />
      ))}
    </div>
  );
}

function ColorDraftControl(props: {
  label: string;
  value: string;
  defaultValue: string;
  onChange: (value: string) => void;
}): ReactElement {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  const valid = /^#[0-9a-fA-F]{6}$/.test(draft);
  const commit = () => {
    if (valid) props.onChange(draft);
  };
  return (
    <label className="color-control">
      <span className="truncate" title={props.label}>
        {props.label}
      </span>
      <span className="color-row">
        <input
          type="color"
          value={valid ? draft : props.value}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            props.onChange(event.currentTarget.value);
          }}
        />
        <input
          value={draft}
          aria-invalid={!valid}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
        />
        <button
          type="button"
          onClick={() => {
            setDraft(props.defaultValue);
            props.onChange(props.defaultValue);
          }}
        >
          Reset
        </button>
      </span>
      {!valid ? (
        <small role="alert">Use #RRGGBB.</small>
      ) : (
        <small>Contrast depends on pairing.</small>
      )}
    </label>
  );
}

function RangeControlGrid<T extends Record<string, number>>(props: {
  values: T;
  defaults: T;
  labels: Record<keyof T, string>;
  min: number;
  max: number;
  unit: string;
  bounds?: Partial<Record<keyof T, [number, number]>>;
  onChange: (values: T) => void;
}): ReactElement {
  return (
    <div className="appearance-control-grid">
      {(Object.keys(props.values) as Array<keyof T>).map((key) => {
        const [min, max] = props.bounds?.[key] ?? [props.min, props.max];
        return (
          <label key={String(key)} className="range-control">
            <span>
              {props.labels[key]}: {props.values[key]}
              {props.unit}
            </span>
            <input
              type="range"
              min={min}
              max={max}
              value={props.values[key]}
              onChange={(event) =>
                props.onChange({ ...props.values, [key]: Number(event.currentTarget.value) })
              }
            />
            <button
              type="button"
              onClick={() => props.onChange({ ...props.values, [key]: props.defaults[key] })}
            >
              Reset
            </button>
          </label>
        );
      })}
    </div>
  );
}

function appearanceSnapshot(appearance: AppearancePreferences): AppearanceSnapshot {
  const snapshot = { ...appearance } as Partial<AppearancePreferences>;
  delete snapshot.profiles;
  delete snapshot.loadedProfileId;
  delete snapshot.loadedProfileName;
  return JSON.parse(JSON.stringify(snapshot)) as AppearanceSnapshot;
}

function loadAppearanceProfile(
  appearance: AppearancePreferences,
  profile: AppearanceProfile
): AppearancePreferences {
  return normalizeAppearance({
    ...appearance,
    ...profile.settings,
    loadedProfileId: profile.id,
    loadedProfileName: profile.name,
    profiles: appearance.profiles
  });
}

function saveAppearanceProfile(
  appearance: AppearancePreferences,
  name: string
): AppearancePreferences {
  const now = new Date().toISOString();
  const profile: AppearanceProfile = {
    id: crypto.randomUUID(),
    name,
    builtIn: false,
    settings: appearanceSnapshot(appearance),
    createdAt: now,
    updatedAt: now
  };
  return {
    ...appearance,
    loadedProfileId: profile.id,
    loadedProfileName: name,
    profiles: [...appearance.profiles, profile]
  };
}

function duplicateAppearanceProfile(appearance: AppearancePreferences): AppearancePreferences {
  return saveAppearanceProfile(appearance, `${appearance.loadedProfileName} copy`);
}

function currentCustomProfile(appearance: AppearancePreferences): AppearanceProfile | null {
  return (
    appearance.profiles.find(
      (profile) => profile.id === appearance.loadedProfileId && !profile.builtIn
    ) ?? null
  );
}

function renameAppearanceProfile(
  appearance: AppearancePreferences,
  name: string
): AppearancePreferences {
  const profile = currentCustomProfile(appearance);
  if (!profile) return appearance;
  return {
    ...appearance,
    loadedProfileName: name,
    profiles: appearance.profiles.map((item) =>
      item.id === profile.id ? { ...item, name, updatedAt: new Date().toISOString() } : item
    )
  };
}

function deleteCurrentAppearanceProfile(appearance: AppearancePreferences): AppearancePreferences {
  const profile = currentCustomProfile(appearance);
  if (!profile) return appearance;
  return normalizeAppearance({
    ...defaultAppearance(),
    profiles: appearance.profiles.filter((item) => item.id !== profile.id)
  });
}

function appearanceProfileDirty(appearance: AppearancePreferences): boolean {
  const profile = appearance.profiles.find((item) => item.id === appearance.loadedProfileId);
  if (!profile) return true;
  return JSON.stringify(profile.settings) !== JSON.stringify(appearanceSnapshot(appearance));
}

function appearanceExportPayload(appearance: AppearancePreferences): Record<string, unknown> {
  return {
    schema: "dentlink.appearance",
    version: 2,
    profileName: appearance.loadedProfileName || "DentLink appearance",
    exportedAt: new Date().toISOString(),
    settings: appearanceSnapshot(appearance),
    sourceColors: appearance.sourceColors,
    typography: appearance.typography,
    cardLayout: appearance.cards,
    branding: appearance.branding
  };
}

function exportAppearance(appearance: AppearancePreferences): void {
  const payload = appearanceExportPayload(appearance);
  const safeName =
    String(payload.profileName ?? "profile")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "profile";
  downloadTextFile(
    `dentlink-appearance-${safeName}.json`,
    JSON.stringify(payload, null, 2),
    "application/json"
  );
}

async function importAppearance(file: File): Promise<AppearancePreferences> {
  return appearanceFromExport(JSON.parse(await file.text()) as Record<string, unknown>);
}

function appearanceFromExport(payload: Record<string, unknown>): AppearancePreferences {
  if (payload.schema !== "dentlink.appearance" || payload.version !== 2) {
    throw new Error("Unsupported appearance file.");
  }
  if (typeof payload.settings !== "object" || payload.settings === null) {
    throw new Error("Appearance file is missing settings.");
  }
  const name = typeof payload.profileName === "string" ? payload.profileName : "Imported profile";
  return normalizeAppearance({
    ...defaultAppearance(),
    ...(payload.settings as Partial<AppearancePreferences>),
    loadedProfileId: null,
    loadedProfileName: name
  });
}

function sourceColorEntries(
  accounts: ConnectorAccount[],
  webhooks: Array<WebhookEndpoint & { ingestUrl: string }>,
  colors: Record<string, string>
): Array<{ key: string; label: string; kind: string; color: string }> {
  const fallback = defaultAppearance().sourceColors;
  const gmailColor = fallback.gmail ?? "#1d4ed8";
  const calendarColor = fallback["google-calendar"] ?? "#2563eb";
  const localColor = fallback.local ?? "#137a3a";
  const noteColor = fallback.note ?? "#7c3aed";
  const webhookColor = fallback.webhook ?? "#b45309";
  const entries: Array<{ key: string; label: string; kind: string; color: string }> = [
    { key: "gmail", label: "Gmail", kind: "source type", color: colors.gmail ?? gmailColor },
    {
      key: "google-calendar",
      label: "Google Calendar",
      kind: "source type",
      color: colors["google-calendar"] ?? calendarColor
    },
    { key: "local", label: "Local events", kind: "source type", color: colors.local ?? localColor },
    { key: "note", label: "Notes", kind: "source type", color: colors.note ?? noteColor },
    {
      key: "webhook",
      label: "Webhooks",
      kind: "source type",
      color: colors.webhook ?? webhookColor
    },
    {
      key: "category:action_required",
      label: "Action required",
      kind: "notification category",
      color: colors["category:action_required"] ?? "#b91c1c"
    },
    {
      key: "category:newsletter",
      label: "Newsletter",
      kind: "notification category",
      color: colors["category:newsletter"] ?? "#0f766e"
    },
    {
      key: "category:receipt",
      label: "Receipt",
      kind: "notification category",
      color: colors["category:receipt"] ?? "#a16207"
    },
    {
      key: "category:personal",
      label: "Personal",
      kind: "notification category",
      color: colors["category:personal"] ?? "#7c3aed"
    }
  ];
  for (const account of accounts) {
    if (account.connectorKey === "gmail" || account.connectorKey === "google-calendar") {
      const key = `${account.connectorKey}:${account.id}`;
      entries.push({
        key,
        label: account.displayName,
        kind: account.connectorKey === "gmail" ? "Gmail account" : "calendar account",
        color: colors[key] ?? (account.connectorKey === "gmail" ? gmailColor : calendarColor)
      });
    }
  }
  for (const webhook of webhooks) {
    const key = `webhook:${webhook.id}`;
    entries.push({
      key,
      label: webhook.name,
      kind: "webhook",
      color: colors[key] ?? webhookColor
    });
  }
  return entries;
}

function AiSettingsPanel(props: {
  settings: EmailAiSettings | null;
  preferences: UserPreferences | null;
  accounts: ConnectorAccount[];
  reprocessResult: EmailAiReprocessResult | null;
  reprocessRunning: boolean;
  onPreferencesChange: (
    patch: Parameters<DentLinkApiClient["updatePreferences"]>[0]
  ) => Promise<void>;
  onEnabledChange: (enabled: boolean) => Promise<void>;
  onReprocess: (accountId?: EntityId | null) => Promise<void>;
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
      <AiImportanceControls
        preferences={props.preferences}
        accounts={props.accounts}
        reprocessResult={props.reprocessResult}
        reprocessRunning={props.reprocessRunning}
        onPreferencesChange={props.onPreferencesChange}
        onReprocess={props.onReprocess}
      />
      <p>
        When enabled, DentLink sends bounded normalized email text, subject, and safe metadata to
        the configured AI provider after deterministic rules allow notification creation.
      </p>
      <p>Tokens, OAuth data, credentials, raw MIME, and attachment contents are never sent.</p>
    </section>
  );
}

function AiImportanceControls(props: {
  preferences: UserPreferences | null;
  accounts: ConnectorAccount[];
  reprocessResult: EmailAiReprocessResult | null;
  reprocessRunning: boolean;
  onPreferencesChange: (
    patch: Parameters<DentLinkApiClient["updatePreferences"]>[0]
  ) => Promise<void>;
  onReprocess: (accountId?: EntityId | null) => Promise<void>;
}): ReactElement {
  const ai = props.preferences?.ai ?? {
    globalPrompt: "",
    threshold: 0,
    presets: [],
    accountOverrides: []
  };
  const [presetName, setPresetName] = useState("");
  const [savingPromptKey, setSavingPromptKey] = useState<string | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  function overrideFor(accountId: EntityId) {
    return ai.accountOverrides.find((override) => override.accountId === accountId);
  }
  async function saveAi(next: typeof ai): Promise<void> {
    await props.onPreferencesChange({ ai: next });
  }
  async function savePrompt(key: string, next: typeof ai): Promise<void> {
    setSavingPromptKey(key);
    setPromptError(null);
    try {
      await saveAi(next);
    } catch (error) {
      setPromptError(error instanceof Error ? error.message : "Prompt save failed.");
    } finally {
      setSavingPromptKey(null);
    }
  }
  return (
    <section className="subsettings-panel" aria-label="AI importance settings">
      <h3>Importance Scoring</h3>
      <p>
        Prompt and threshold changes affect future scoring. Reprocess today to apply them to stored
        same-day Gmail items without refetching Gmail.
      </p>
      {promptError ? <p role="alert">{promptError}</p> : null}
      <PromptDraftEditor
        label="Global importance instruction"
        ariaLabel="Global importance instruction"
        value={ai.globalPrompt}
        defaultValue={DEFAULT_IMPORTANCE_INSTRUCTION}
        saving={savingPromptKey === "global"}
        onSave={(prompt) => savePrompt("global", { ...ai, globalPrompt: prompt })}
      />
      <label className="field">
        <span>Notification threshold: {ai.threshold}</span>
        <input
          type="range"
          min="0"
          max="100"
          value={ai.threshold}
          onChange={(event) => void saveAi({ ...ai, threshold: Number(event.currentTarget.value) })}
        />
      </label>
      <button
        type="button"
        disabled={props.reprocessRunning}
        onClick={() => void props.onReprocess(null)}
      >
        {props.reprocessRunning ? "Reprocessing..." : "Reprocess today's Gmail"}
      </button>
      {props.reprocessResult ? (
        <div className={`ai-reprocess-result ${props.reprocessResult.status}`} role="status">
          <strong>Reprocess {props.reprocessResult.status}</strong>
          <span>
            {props.reprocessResult.updated} updated, {props.reprocessResult.suppressed} suppressed,{" "}
            {props.reprocessResult.restored} restored, {props.reprocessResult.failed} failed
          </span>
          {props.reprocessResult.errors.length > 0 ? (
            <button type="button" onClick={() => void props.onReprocess(null)}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {props.accounts.length > 0 ? (
        <section className="account-ai-overrides" aria-label="Per-account AI overrides">
          <h4>Gmail Account Overrides</h4>
          {props.accounts.map((account) => {
            const override = overrideFor(account.id);
            const inherited = !override?.enabled;
            const prompt = inherited ? ai.globalPrompt : override.prompt;
            const threshold = inherited ? ai.threshold : (override.threshold ?? ai.threshold);
            return (
              <section key={account.id} className="account-ai-card">
                <div>
                  <strong>{account.displayName}</strong>
                  <span>{inherited ? "Inheriting global settings" : "Using account override"}</span>
                </div>
                <label className="debug-toggle">
                  <input
                    type="checkbox"
                    checked={!inherited}
                    onChange={(event) => {
                      const enabled = event.currentTarget.checked;
                      const rest = ai.accountOverrides.filter(
                        (item) => item.accountId !== account.id
                      );
                      void saveAi({
                        ...ai,
                        accountOverrides: [
                          ...rest,
                          {
                            accountId: account.id,
                            enabled,
                            prompt: override?.prompt || ai.globalPrompt,
                            threshold: override?.threshold ?? ai.threshold
                          }
                        ]
                      });
                    }}
                  />{" "}
                  Override global
                </label>
                {!inherited ? (
                  <>
                    <PromptDraftEditor
                      label="Account importance instruction"
                      ariaLabel="Account importance instruction"
                      value={prompt}
                      defaultValue={ai.globalPrompt}
                      saving={savingPromptKey === account.id}
                      onSave={(nextPrompt) => {
                        const rest = ai.accountOverrides.filter(
                          (item) => item.accountId !== account.id
                        );
                        return savePrompt(account.id, {
                          ...ai,
                          accountOverrides: [
                            ...rest,
                            {
                              accountId: account.id,
                              enabled: true,
                              prompt: nextPrompt,
                              threshold
                            }
                          ]
                        });
                      }}
                    />
                    <label className="field">
                      <span>Account threshold: {threshold}</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={threshold}
                        onChange={(event) => {
                          const rest = ai.accountOverrides.filter(
                            (item) => item.accountId !== account.id
                          );
                          void saveAi({
                            ...ai,
                            accountOverrides: [
                              ...rest,
                              {
                                accountId: account.id,
                                enabled: true,
                                prompt,
                                threshold: Number(event.currentTarget.value)
                              }
                            ]
                          });
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        void saveAi({
                          ...ai,
                          accountOverrides: ai.accountOverrides.filter(
                            (item) => item.accountId !== account.id
                          )
                        })
                      }
                    >
                      Return to global inheritance
                    </button>
                    <button
                      type="button"
                      disabled={props.reprocessRunning}
                      onClick={() => void props.onReprocess(account.id)}
                    >
                      Reprocess this account today
                    </button>
                  </>
                ) : null}
              </section>
            );
          })}
        </section>
      ) : null}
      <div className="inline-form">
        <input
          aria-label="Preset name"
          placeholder="Preset name"
          value={presetName}
          onChange={(event) => setPresetName(event.currentTarget.value)}
        />
        <button
          type="button"
          onClick={() => {
            if (!presetName.trim()) return;
            void saveAi({
              ...ai,
              presets: [
                ...ai.presets,
                {
                  id: crypto.randomUUID(),
                  name: presetName.trim(),
                  prompt: ai.globalPrompt,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString()
                }
              ]
            });
            setPresetName("");
          }}
        >
          Save preset
        </button>
      </div>
      <div className="preset-list">
        {ai.presets.map((preset) => (
          <span key={preset.id} className="filter-chip">
            {preset.name}
            <button
              type="button"
              onClick={() => void saveAi({ ...ai, globalPrompt: preset.prompt })}
            >
              Load
            </button>
            <button
              type="button"
              onClick={() =>
                void saveAi({ ...ai, presets: ai.presets.filter((item) => item.id !== preset.id) })
              }
            >
              Delete
            </button>
          </span>
        ))}
      </div>
      <button
        type="button"
        onClick={() =>
          void saveAi({
            ...ai,
            globalPrompt: DEFAULT_IMPORTANCE_INSTRUCTION,
            threshold: 0,
            accountOverrides: []
          })
        }
      >
        Reset to DentLink default
      </button>
    </section>
  );
}

function PromptDraftEditor(props: {
  label: string;
  ariaLabel: string;
  value: string;
  defaultValue: string;
  saving: boolean;
  onSave: (value: string) => Promise<void>;
}): ReactElement {
  const [draft, setDraft] = useState(props.value);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!dirty) setDraft(props.value);
  }, [props.value, dirty]);
  const normalized = safePromptDraft(draft);
  const changed = normalized !== props.value;
  const valid = normalized.trim().length > 0 && normalized.length <= MAX_PROMPT_CHARS;
  return (
    <div className="prompt-draft-editor">
      <label className="field">
        <span>{props.label}</span>
        <textarea
          aria-label={props.ariaLabel}
          maxLength={MAX_PROMPT_CHARS}
          value={draft}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            setDirty(true);
            setError(null);
          }}
        />
        <span className="character-count">
          {MAX_PROMPT_CHARS - Array.from(draft).length} characters left
          {changed ? " · Unsaved changes" : ""}
        </span>
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <div className="inline-form">
        <button
          type="button"
          disabled={!changed || !valid || props.saving}
          onClick={() =>
            void props
              .onSave(normalized)
              .then(() => setDirty(false))
              .catch((caught) =>
                setError(caught instanceof Error ? caught.message : "Prompt save failed.")
              )
          }
        >
          {props.saving ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          disabled={!changed || props.saving}
          onClick={() => {
            setDraft(props.value);
            setDirty(false);
            setError(null);
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={props.saving}
          onClick={() => {
            setDraft(props.defaultValue.slice(0, MAX_PROMPT_CHARS));
            setDirty(true);
          }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

function safePromptDraft(value: string): string {
  return Array.from(value).slice(0, MAX_PROMPT_CHARS).join("");
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
          {calendarAccounts.map((account) => {
            const reconnectWarning = connectorReconnectWarning(account, undefined);
            return (
              <article key={account.id} className="notification-card">
                <strong>{account.displayName}</strong>
                <span>Status: {account.status}</span>
                {props.debugMode ? <span>Health: {account.healthStatus}</span> : null}
                {props.debugMode ? <span>Sync: {account.syncStatus}</span> : null}
                <span>
                  Last sync:{" "}
                  {account.lastSyncAt ? new Date(account.lastSyncAt).toLocaleString() : "Never"}
                </span>
                {reconnectWarning ? (
                  <p className="connector-warning">
                    <strong>{reconnectWarning.title}.</strong> {reconnectWarning.message}
                  </p>
                ) : account.errorMessage ? (
                  <p>{account.errorMessage}</p>
                ) : null}
                <div className="note-order">
                  <button type="button" onClick={() => void props.onSyncGoogleCalendar(account)}>
                    Sync Now
                  </button>
                  <button
                    type="button"
                    onClick={() => void props.onReconnectGoogleCalendar(account)}
                  >
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
            );
          })}
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
  const selectedEngine = props.engineSaveState?.engine ?? gmailSelectedEngine(props.account);
  const activeEngine = gmailActiveEngine(props.account);
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
        <span>
          Next Scheduled Sync:{" "}
          {nextScheduledSyncLabel(engineDiagnostics?.lastSyncAt ?? props.account.lastSyncAt)}
        </span>
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
  const recentAttempts = props.diagnostics?.attempts.slice(0, 10) ?? [];
  const latestOutcomeAt = latestProcessedAt(recentMessages);
  const latestSyncAt = engineDiagnostics?.lastSyncAt ?? null;
  const syncAfterLatestOutcome =
    latestSyncAt && latestOutcomeAt && Date.parse(latestSyncAt) > Date.parse(latestOutcomeAt);
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
      {recentAttempts.length > 0 ? (
        <details open>
          <summary>Recent Gmail sync attempts</summary>
          <div className="diagnostics-table-wrap">
            <table className="diagnostics-table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Trigger</th>
                  <th>Engine</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>Counts</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {recentAttempts.map((attempt) => (
                  <tr key={attempt.id}>
                    <td>{new Date(attempt.startedAt).toLocaleString()}</td>
                    <td>{attempt.trigger}</td>
                    <td>{syncAttemptEngineLabel(attempt.engine)}</td>
                    <td>{attempt.status}</td>
                    <td>{formatDuration(attempt.durationMs)}</td>
                    <td>
                      {attempt.summary
                        ? `${attempt.summary.discovered} found, ${attempt.summary.examined} checked, ${attempt.summary.created} created, ${attempt.summary.failed} failed`
                        : "No counts"}
                    </td>
                    <td>
                      {attempt.errorCode
                        ? `${attempt.errorCode}: ${attempt.errorMessage ?? "No message"}`
                        : "None"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
      {recentMessages.length > 0 ? (
        <details>
          <summary>Latest Gmail message processing outcomes</summary>
          <div className="gmail-diagnostics-grid diagnostics-recency">
            <span>
              Latest Sync Check: {latestSyncAt ? new Date(latestSyncAt).toLocaleString() : "Never"}
            </span>
            <span>
              Latest Message Outcome:{" "}
              {latestOutcomeAt ? new Date(latestOutcomeAt).toLocaleString() : "None"}
            </span>
          </div>
          {syncAfterLatestOutcome ? (
            <p className="connector-note">
              Gmail has checked since the latest message outcome. No newer eligible messages were
              recorded in diagnostics.
            </p>
          ) : null}
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

function latestProcessedAt(messages: GmailDiagnostics["messages"]): string | null {
  return messages.reduce<string | null>((latest, message) => {
    if (!message.processedAt) return latest;
    if (!latest) return message.processedAt;
    return Date.parse(message.processedAt) > Date.parse(latest) ? message.processedAt : latest;
  }, null);
}

function syncAttemptEngineLabel(engine: GmailDiagnostics["attempts"][number]["engine"]): string {
  if (engine === "unknown") return "Unknown";
  return gmailEngineLabel(engine);
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

type GmailEngine = "gmail_api" | "gmail_imap";
type GmailEngineAccount = ConnectorAccount & {
  requestedEngine?: GmailEngine;
  activeEngine?: GmailEngine;
};

export function gmailSelectedEngineForTest(account: GmailEngineAccount): GmailEngine {
  return gmailSelectedEngine(account);
}

export function connectorReconnectWarningsForTest(
  accounts: ConnectorAccount[],
  gmailEngineSaveStates: Record<EntityId, GmailEngineSaveState> = {}
): ConnectorReconnectWarning[] {
  return connectorReconnectWarnings(accounts, gmailEngineSaveStates);
}

function connectorReconnectWarnings(
  accounts: ConnectorAccount[],
  gmailEngineSaveStates: Record<EntityId, GmailEngineSaveState>
): ConnectorReconnectWarning[] {
  return accounts.flatMap((account) => {
    const warning = connectorReconnectWarning(account, gmailEngineSaveStates[account.id]);
    return warning ? [warning] : [];
  });
}

function connectorReconnectWarning(
  account: ConnectorAccount,
  gmailEngineSaveState: GmailEngineSaveState | undefined
): ConnectorReconnectWarning | null {
  if (account.status === "deleted") return null;
  if (account.connectorKey === "gmail") return gmailReconnectWarning(account, gmailEngineSaveState);
  if (account.credentialStatus === "not_configured" || account.status === "error") {
    return {
      accountId: account.id,
      title: `${connectorAccountLabel(account)} needs to be reconnected`,
      message:
        account.errorMessage ??
        `${connectorAccountLabel(account)} cannot sync until you reconnect this source.`
    };
  }
  return null;
}

function gmailReconnectWarning(
  account: ConnectorAccount,
  engineSaveState: GmailEngineSaveState | undefined
): ConnectorReconnectWarning | null {
  const selectedEngine = engineSaveState?.engine ?? gmailSelectedEngine(account);
  const activeEngine = gmailActiveEngine(account);
  const reconnectRequired =
    account.settings.gmailReconnectRequired === true || selectedEngine !== activeEngine;
  if (!reconnectRequired) return null;
  const engine = selectedEngine === "gmail_imap" ? "Gmail IMAP" : "Gmail API";
  return {
    accountId: account.id,
    title: `${connectorAccountLabel(account)} needs to be reconnected`,
    message:
      account.errorMessage ??
      `${engine} access needs to be reauthorized before this account can sync. Existing DentLink data will be preserved.`
  };
}

function connectorAccountLabel(account: ConnectorAccount): string {
  const accountEmail =
    stringSetting(account.settings.googleEmail) ??
    stringSetting(account.settings.email) ??
    stringSetting(account.settings.accountEmail);
  if (accountEmail && !account.displayName.toLowerCase().includes(accountEmail.toLowerCase())) {
    return `${account.displayName} (${accountEmail})`;
  }
  return account.displayName;
}

function gmailSelectedEngine(account: GmailEngineAccount): GmailEngine {
  const settings = account.settings;
  return account.requestedEngine === "gmail_imap" ||
    settings.gmailRequestedIngestionEngine === "gmail_imap" ||
    account.activeEngine === "gmail_imap" ||
    settings.gmailIngestionEngine === "gmail_imap"
    ? "gmail_imap"
    : "gmail_api";
}

function gmailActiveEngine(account: GmailEngineAccount): GmailEngine {
  if (account.activeEngine === "gmail_imap") return "gmail_imap";
  return account.settings.gmailIngestionEngine === "gmail_imap" ? "gmail_imap" : "gmail_api";
}

function withRequestedGmailEngine(
  account: ConnectorAccount,
  engine: GmailEngine,
  comparisonMode: boolean
): ConnectorAccount {
  return {
    ...account,
    requestedEngine: engine,
    settings: {
      ...account.settings,
      gmailRequestedIngestionEngine: engine,
      gmailImapComparisonMode: comparisonMode,
      gmailReconnectRequired:
        engine === "gmail_imap" && account.settings.gmailIngestionEngine !== "gmail_imap"
          ? true
          : account.settings.gmailReconnectRequired
    }
  } as ConnectorAccount;
}

function gmailEngineLabel(engine: GmailEngine): string {
  return engine === "gmail_imap" ? "Gmail IMAP (Preview)" : "Gmail API";
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return "Unknown";
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}

export function nextScheduledSyncLabel(
  lastSyncAt: string | null | undefined,
  now = new Date()
): string {
  if (!lastSyncAt) return "Within 5 minutes after activation";
  const lastSyncTime = new Date(lastSyncAt).getTime();
  if (!Number.isFinite(lastSyncTime)) return "Within 5 minutes after activation";
  const next = new Date(lastSyncTime + 5 * 60 * 1000);
  if (next.getTime() <= now.getTime()) return "Due now";
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

function dueNoteCalendarEvents(
  notes: Note[],
  timezone: string,
  mode: CalendarMode
): CalendarEvent[] {
  const today = todayKey(timezone);
  return notes
    .filter((note) => note.dueAt && note.status !== "deleted")
    .map((note) => {
      const dueDate = note.dueAt?.slice(0, 10) ?? today;
      const agendaDate =
        mode === "agenda" && note.status === "active" && dueDate < today ? today : dueDate;
      const end = new Date(`${agendaDate}T00:00:00.000Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      return {
        id: `note-due-${note.id}`,
        userId: note.userId,
        source: "note" as const,
        connectorAccountId: null,
        provider: null,
        providerEventId: note.id,
        calendarId: "notes",
        calendarSummary: "Notes",
        title: note.title,
        description: note.body,
        location: null,
        sourceUrl: null,
        startAt: `${agendaDate}T00:00:00.000Z`,
        endAt: end.toISOString(),
        startDate: agendaDate,
        endDate: end.toISOString().slice(0, 10),
        timezone,
        allDay: true,
        recurrenceRule: null,
        category: "note",
        color: note.priority === "high" ? "#b42318" : "#7c3aed",
        reminderMinutes: null,
        importedUid: null,
        annotation: null,
        status: note.status === "done" ? "dismissed" : "active",
        version: note.version,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        dismissedAt: note.completedAt
      };
    });
}

function noteIdFromCalendarEvent(event: CalendarEvent): EntityId {
  return event.providerEventId ?? event.id.replace(/^note-due-/, "");
}

function calendarRange(
  mode: CalendarMode,
  selectedDate: string
): { timeMin: string; timeMax: string } {
  const start = new Date(`${selectedDate}T00:00:00.000Z`);
  if (mode === "week" || mode === "agenda")
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  if (mode === "month") {
    start.setUTCDate(1);
    start.setUTCDate(1 - start.getUTCDay());
  }
  if (mode === "agenda") {
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 30);
    return { timeMin: start.toISOString(), timeMax: end.toISOString() };
  }
  const end = new Date(start);
  if (mode === "day") end.setUTCDate(end.getUTCDate() + 1);
  if (mode === "week") end.setUTCDate(end.getUTCDate() + 7);
  if (mode === "month") end.setUTCDate(end.getUTCDate() + 42);
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
  postDesktopSession({ type: "dentlink.web.session.store", session });
}

function clearStoredSession(): void {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    postDesktopSession({ type: "dentlink.web.session.clear" });
  }
}

function isDesktopClient(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("dentlinkDesktop") === "1";
}

function postDesktopSession(message: { type: string; session?: AuthSession }): void {
  if (!isDesktopClient() || window.parent === window) return;
  window.parent.postMessage(message, "*");
}

function installDesktopMomentumScrolling(): () => void {
  let suppressClickUntil = 0;
  let active: {
    target: HTMLElement;
    pointerId: number;
    lastX: number;
    lastY: number;
    lastTime: number;
    velocityX: number;
    velocityY: number;
    dragged: boolean;
    frame: number | null;
  } | null = null;

  function stopMomentum(): void {
    if (active?.frame) window.cancelAnimationFrame(active.frame);
    if (active) active.frame = null;
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.pointerType !== "touch") return;
    const target = scrollableAncestor(event.target);
    if (!target) return;
    stopMomentum();
    active = {
      target,
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: performance.now(),
      velocityX: 0,
      velocityY: 0,
      dragged: false,
      frame: null
    };
  }

  function onPointerMove(event: PointerEvent): void {
    if (!active || event.pointerId !== active.pointerId) return;
    const now = performance.now();
    const dx = event.clientX - active.lastX;
    const dy = event.clientY - active.lastY;
    const elapsed = Math.max(1, now - active.lastTime);
    if (!active.dragged && Math.hypot(dx, dy) < 8) return;
    active.dragged = true;
    active.target.scrollLeft -= dx;
    active.target.scrollTop -= dy;
    active.velocityX = dx / elapsed;
    active.velocityY = dy / elapsed;
    active.lastX = event.clientX;
    active.lastY = event.clientY;
    active.lastTime = now;
    event.preventDefault();
  }

  function onPointerUp(event: PointerEvent): void {
    if (!active || event.pointerId !== active.pointerId) return;
    if (!active.dragged) {
      active = null;
      return;
    }
    suppressClickUntil = performance.now() + 300;
    const target = active.target;
    let velocityX = active.velocityX * 7;
    let velocityY = active.velocityY * 7;
    const step = () => {
      target.scrollLeft -= velocityX;
      target.scrollTop -= velocityY;
      velocityX *= 0.88;
      velocityY *= 0.88;
      if (Math.abs(velocityX) > 0.35 || Math.abs(velocityY) > 0.35) {
        if (active) active.frame = window.requestAnimationFrame(step);
      } else {
        active = null;
      }
    };
    active.frame = window.requestAnimationFrame(step);
  }

  function onClick(event: MouseEvent): void {
    if (performance.now() <= suppressClickUntil) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("pointermove", onPointerMove, { passive: false });
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerUp);
  document.addEventListener("click", onClick, true);
  return () => {
    stopMomentum();
    document.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerUp);
    document.removeEventListener("click", onClick, true);
  };
}

function scrollableAncestor(target: EventTarget | null): HTMLElement | null {
  const origin = target instanceof Element ? target : null;
  if (!origin || origin.closest("input, textarea, select")) return null;
  for (let element: Element | null = origin; element; element = element.parentElement) {
    if (!(element instanceof HTMLElement)) continue;
    const style = window.getComputedStyle(element);
    const canScrollY =
      /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight;
    const canScrollX =
      /(auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth;
    if (canScrollY || canScrollX) return element;
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
}

function messageFor(caught: unknown): string {
  if (caught instanceof DentLinkApiError) return caught.message;
  if (caught instanceof Error) return caught.message;
  return "Something went wrong";
}
