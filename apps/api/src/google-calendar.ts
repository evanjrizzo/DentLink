import { hashSessionToken } from "./auth";
import {
  createGoogleOAuthState,
  decryptSecret,
  encryptSecret,
  GOOGLE_CREDENTIAL_ENCRYPTION_VERSION,
  GOOGLE_OAUTH_AUTHORIZE_URL,
  GoogleConfigError,
  tokenRequest,
  type GoogleRuntimeEnv,
  type GoogleTokenResponse
} from "./google";
import { StoreError, type DentLinkStore } from "./storage";

import type {
  CalendarEvent,
  ConnectorAccount,
  EntityId,
  GoogleCalendarSyncResult
} from "@dentlink/item-model";
import type { ConnectorDefinition } from "@dentlink/connector-sdk";

const GOOGLE_CALENDAR_CONNECTOR_KEY = "google-calendar";
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const GOOGLE_CALENDAR_API_BASE_URL = "https://www.googleapis.com/calendar/v3";
const INITIAL_SYNC_PAST_DAYS = 30;
const INITIAL_SYNC_FUTURE_MONTHS = 12;
const EVENTS_PAGE_SIZE = 50;

export type GoogleCalendarRuntimeEnv = GoogleRuntimeEnv & {
  GOOGLE_CALENDAR_REDIRECT_URI?: string;
  googleCalendarClient?: GoogleCalendarApiClient;
};

export type GoogleCalendarApiClient = {
  exchangeCode(code: string, redirectUri: string): Promise<GoogleTokenResponse>;
  refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse>;
  listCalendars(accessToken: string): Promise<GoogleCalendarList>;
  listEvents(
    accessToken: string,
    calendarId: string,
    options: GoogleCalendarListEventsOptions
  ): Promise<GoogleCalendarEventsPage>;
};

export type GoogleCalendarListEventsOptions = {
  pageToken?: string;
  syncToken?: string | null;
  timeMin?: string;
  timeMax?: string;
};

export type GoogleCalendarList = {
  items: GoogleCalendarListEntry[];
};

export type GoogleCalendarListEntry = {
  id: string;
  summary?: string;
  primary?: boolean;
  accessRole?: string;
};

export type GoogleCalendarEventsPage = {
  items: GoogleCalendarProviderEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

export type GoogleCalendarProviderEvent = {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  updated?: string;
  recurringEventId?: string;
  iCalUID?: string;
  start?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  end?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
};

export function googleCalendarConnectorDefinition(): ConnectorDefinition {
  return {
    key: GOOGLE_CALENDAR_CONNECTOR_KEY,
    name: "Google Calendar",
    kind: "calendar",
    authType: "oauth2",
    capabilities: ["poll", "normalize_calendar"],
    settings: [],
    version: 1
  };
}

export async function startGoogleCalendarOAuth(
  store: DentLinkStore,
  userId: EntityId,
  env: GoogleCalendarRuntimeEnv,
  url: URL,
  now: string
): Promise<{ authorizationUrl: string; expiresAt: string }> {
  const config = googleCalendarOAuthConfig(env, url);
  const { state, expiresAt } = await createGoogleOAuthState(
    store,
    userId,
    GOOGLE_CALENDAR_CONNECTOR_KEY,
    url,
    env,
    now,
    "google_calendar_oauth_"
  );
  const authorizationUrl = new URL(GOOGLE_OAUTH_AUTHORIZE_URL);
  authorizationUrl.searchParams.set("client_id", config.clientId);
  authorizationUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", GOOGLE_CALENDAR_SCOPE);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("access_type", "offline");
  authorizationUrl.searchParams.set("prompt", "consent");
  authorizationUrl.searchParams.set("include_granted_scopes", "true");
  return { authorizationUrl: authorizationUrl.toString(), expiresAt };
}

export async function completeGoogleCalendarOAuth(
  store: DentLinkStore,
  env: GoogleCalendarRuntimeEnv,
  url: URL,
  now: string
): Promise<{ account: ConnectorAccount; returnTo: string | null }> {
  const errorCode = url.searchParams.get("error");
  if (errorCode) {
    throw new StoreError("oauth_denied", "Google Calendar authorization was not completed");
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) throw new StoreError("invalid_oauth_callback", "OAuth callback is invalid");
  const stateRecord = await store.consumeConnectorOAuthState(
    await hashSessionToken(state),
    GOOGLE_CALENDAR_CONNECTOR_KEY,
    now
  );
  if (!stateRecord) throw new StoreError("invalid_oauth_state", "OAuth state is invalid");

  const config = googleCalendarOAuthConfig(env, url);
  const calendar = googleCalendarClient(env);
  const token = await calendar.exchangeCode(code, config.redirectUri);
  if (!token.refreshToken) {
    throw new StoreError("missing_refresh_token", "Google Calendar did not return a refresh token");
  }
  const primary = primaryCalendar(await calendar.listCalendars(token.accessToken));
  const account = await linkGoogleCalendarAccount(
    store,
    stateRecord.userId,
    primary,
    stateRecord.reconnectAccountId,
    now
  );
  const encrypted = await encryptSecret(token.refreshToken, env);
  const credential = await store.upsertConnectorCredential(
    stateRecord.userId,
    account.id,
    {
      kind: "oauth_refresh_token",
      encryptedValue: encrypted,
      encryptionVersion: GOOGLE_CREDENTIAL_ENCRYPTION_VERSION
    },
    now
  );
  const updated = await store.updateConnectorAccount(
    stateRecord.userId,
    account.id,
    account.version,
    {
      status: "connected",
      healthStatus: "healthy",
      syncStatus: "idle",
      credentialRef: credential.id,
      credentialStatus: "configured",
      settings: {
        ...account.settings,
        googleCalendarId: primary.id,
        googleCalendarSummary: primary.summary ?? primary.id
      },
      lastHealthAt: now,
      errorCode: null,
      errorMessage: null
    },
    now
  );
  if (!updated) throw new StoreError("not_found", "Google Calendar account not found");
  return { account: updated, returnTo: stateRecord.returnTo };
}

export async function disconnectGoogleCalendarAccount(
  store: DentLinkStore,
  userId: EntityId,
  accountId: EntityId,
  now: string
): Promise<ConnectorAccount> {
  const account = await requireGoogleCalendarAccount(store, userId, accountId);
  await store.deleteConnectorCredentials(userId, account.id);
  const updated = await store.updateConnectorAccount(
    userId,
    account.id,
    account.version,
    {
      status: "paused",
      healthStatus: "unknown",
      syncStatus: "idle",
      credentialRef: null,
      credentialStatus: "not_configured",
      lastHealthAt: now,
      errorCode: null,
      errorMessage: null
    },
    now
  );
  if (!updated) throw new StoreError("not_found", "Google Calendar account not found");
  return updated;
}

export async function syncGoogleCalendarAccount(
  store: DentLinkStore,
  userId: EntityId,
  accountId: EntityId,
  env: GoogleCalendarRuntimeEnv,
  now: string
): Promise<GoogleCalendarSyncResult> {
  const account = await requireGoogleCalendarAccount(store, userId, accountId);
  const syncing = await store.updateConnectorAccount(
    userId,
    account.id,
    account.version,
    { syncStatus: "syncing", errorCode: null, errorMessage: null },
    now
  );
  if (!syncing) throw new StoreError("not_found", "Google Calendar account not found");

  try {
    const credential = await store.getConnectorCredential(
      userId,
      account.id,
      "oauth_refresh_token"
    );
    if (!credential)
      throw new StoreError("missing_credentials", "Google Calendar must be reconnected");
    const refreshToken = await decryptSecret(credential.encryptedValue, env);
    const calendar = googleCalendarClient(env);
    const token = await calendar.refreshAccessToken(refreshToken);
    const calendarId = calendarIdForAccount(syncing);
    const calendarSummary = calendarSummaryForAccount(syncing);
    const events = await eventsForSync(
      calendar,
      token.accessToken,
      calendarId,
      syncing.syncCursor,
      now
    );
    let processed = 0;
    let upsertedEvents = 0;
    for (const providerEvent of events.events) {
      await ingestGoogleCalendarEvent(
        store,
        userId,
        syncing,
        calendarId,
        calendarSummary,
        providerEvent,
        now
      );
      processed += 1;
      upsertedEvents += 1;
    }
    const latest = await store.getConnectorAccount(userId, account.id);
    if (!latest) throw new StoreError("not_found", "Google Calendar account not found");
    const updated = await store.updateConnectorAccount(
      userId,
      latest.id,
      latest.version,
      {
        status: "connected",
        healthStatus: "healthy",
        syncStatus: "idle",
        syncCursor: events.nextSyncToken ?? latest.syncCursor,
        lastSyncAt: now,
        lastHealthAt: now,
        errorCode: null,
        errorMessage: null
      },
      now
    );
    if (!updated) throw new StoreError("not_found", "Google Calendar account not found");
    return { account: updated, processed, upsertedEvents };
  } catch (error) {
    if (isInvalidSyncToken(error)) {
      const latest = await store.getConnectorAccount(userId, account.id);
      if (latest) {
        await store.updateConnectorAccount(
          userId,
          latest.id,
          latest.version,
          { syncCursor: null, syncStatus: "idle", errorCode: null, errorMessage: null },
          now
        );
        return syncGoogleCalendarAccount(store, userId, accountId, env, now);
      }
    }
    const latest = await store.getConnectorAccount(userId, account.id);
    if (latest) {
      await store.updateConnectorAccount(
        userId,
        latest.id,
        latest.version,
        {
          status: "error",
          healthStatus: "error",
          syncStatus: "error",
          lastHealthAt: now,
          errorCode: googleCalendarErrorCode(error),
          errorMessage: safeErrorMessage(error)
        },
        now
      );
    }
    throw error;
  }
}

export function createGoogleCalendarClient(
  clientId: string,
  clientSecret: string,
  fetchImpl: typeof fetch = fetch
): GoogleCalendarApiClient {
  return {
    async exchangeCode(code, redirectUri) {
      return tokenRequest(fetchImpl, {
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      });
    },
    async refreshAccessToken(refreshToken) {
      return tokenRequest(fetchImpl, {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token"
      });
    },
    async listCalendars(accessToken) {
      const url = new URL(`${GOOGLE_CALENDAR_API_BASE_URL}/users/me/calendarList`);
      url.searchParams.set("minAccessRole", "reader");
      return (await googleCalendarRequest(fetchImpl, accessToken, url)) as GoogleCalendarList;
    },
    async listEvents(accessToken, calendarId, options) {
      const url = new URL(
        `${GOOGLE_CALENDAR_API_BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events`
      );
      url.searchParams.set("maxResults", String(EVENTS_PAGE_SIZE));
      url.searchParams.set("showDeleted", "true");
      url.searchParams.set("singleEvents", "true");
      if (options.syncToken) {
        url.searchParams.set("syncToken", options.syncToken);
      } else {
        url.searchParams.set("orderBy", "startTime");
        if (options.timeMin) url.searchParams.set("timeMin", options.timeMin);
        if (options.timeMax) url.searchParams.set("timeMax", options.timeMax);
      }
      if (options.pageToken) url.searchParams.set("pageToken", options.pageToken);
      return (await googleCalendarRequest(fetchImpl, accessToken, url)) as GoogleCalendarEventsPage;
    }
  };
}

async function linkGoogleCalendarAccount(
  store: DentLinkStore,
  userId: EntityId,
  calendar: GoogleCalendarListEntry,
  reconnectAccountId: EntityId | null,
  now: string
): Promise<ConnectorAccount> {
  if (reconnectAccountId) return requireGoogleCalendarAccount(store, userId, reconnectAccountId);
  const accounts = await store.listConnectorAccounts(userId);
  const existing = accounts.accounts.find(
    (account) =>
      account.connectorKey === GOOGLE_CALENDAR_CONNECTOR_KEY &&
      account.settings.googleCalendarId === calendar.id
  );
  if (existing) return existing;
  return store.createConnectorAccount(
    userId,
    {
      connectorKey: GOOGLE_CALENDAR_CONNECTOR_KEY,
      displayName: `Google Calendar ${calendar.summary ?? calendar.id}`,
      settings: {
        googleCalendarId: calendar.id,
        googleCalendarSummary: calendar.summary ?? calendar.id
      },
      credentialStatus: "not_configured"
    },
    now
  );
}

async function requireGoogleCalendarAccount(
  store: DentLinkStore,
  userId: EntityId,
  accountId: EntityId
): Promise<ConnectorAccount> {
  const account = await store.getConnectorAccount(userId, accountId);
  if (!account || account.connectorKey !== GOOGLE_CALENDAR_CONNECTOR_KEY) {
    throw new StoreError("not_found", "Google Calendar account not found");
  }
  return account;
}

async function eventsForSync(
  calendar: GoogleCalendarApiClient,
  accessToken: string,
  calendarId: string,
  syncToken: string | null,
  now: string
): Promise<{ events: GoogleCalendarProviderEvent[]; nextSyncToken: string | null }> {
  const events: GoogleCalendarProviderEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;
  do {
    const page = await calendar.listEvents(accessToken, calendarId, {
      pageToken,
      syncToken,
      timeMin: initialTimeMin(now),
      timeMax: initialTimeMax(now)
    });
    events.push(...(page.items ?? []));
    nextSyncToken = page.nextSyncToken ?? nextSyncToken;
    pageToken = page.nextPageToken;
  } while (pageToken);
  return { events, nextSyncToken };
}

async function ingestGoogleCalendarEvent(
  store: DentLinkStore,
  userId: EntityId,
  account: ConnectorAccount,
  calendarId: string,
  calendarSummary: string,
  event: GoogleCalendarProviderEvent,
  now: string
): Promise<CalendarEvent> {
  const normalized = normalizedCalendarPayload(account, calendarId, calendarSummary, event, now);
  const { event: stored } = await store.upsertCalendarEvent(userId, normalized, now);
  await store.createConnectorSourceRecordIfAbsent(
    userId,
    {
      accountId: account.id,
      sourceExternalId: event.id,
      sourceType: "calendar_event",
      payloadHash: await hashSessionToken(JSON.stringify(normalized)),
      normalizedPayload: {
        provider: "google-calendar",
        provider_item_id: event.id,
        calendar_id: calendarId,
        calendar_summary: calendarSummary,
        recurring_event_id: event.recurringEventId ?? null,
        ical_uid: event.iCalUID ?? null,
        updated: event.updated ?? null,
        permalink: event.htmlLink ?? null,
        connector_account: account.id
      }
    },
    now
  );
  return stored;
}

function normalizedCalendarPayload(
  account: ConnectorAccount,
  calendarId: string,
  calendarSummary: string,
  event: GoogleCalendarProviderEvent,
  now: string
): Omit<
  CalendarEvent,
  "id" | "userId" | "version" | "createdAt" | "updatedAt" | "dismissedAt" | "annotation"
> {
  const start = normalizeEventTime(event.start, now);
  const end = normalizeEventTime(event.end, start.iso);
  const allDay = Boolean(event.start?.date);
  return {
    source: "google-calendar",
    connectorAccountId: account.id,
    provider: "google-calendar",
    providerEventId: event.id,
    calendarId,
    calendarSummary,
    title: event.summary?.trim() || "(untitled event)",
    description: event.description?.trim() ?? "",
    location: event.location?.trim() || null,
    sourceUrl: event.htmlLink ?? null,
    startAt: start.iso,
    endAt: end.iso,
    startDate: event.start?.date ?? null,
    endDate: event.end?.date ?? null,
    timezone: event.start?.timeZone ?? event.end?.timeZone ?? null,
    allDay,
    recurrenceRule: null,
    category: null,
    color: null,
    reminderMinutes: null,
    importedUid: event.iCalUID ?? null,
    status: event.status === "cancelled" ? "cancelled" : "active"
  };
}

async function googleCalendarRequest(
  fetchImpl: typeof fetch,
  accessToken: string,
  pathOrUrl: string | URL
): Promise<unknown> {
  const url =
    typeof pathOrUrl === "string" ? `${GOOGLE_CALENDAR_API_BASE_URL}${pathOrUrl}` : pathOrUrl;
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
  });
  const json = await response.json().catch(() => null);
  if (response.status === 410) {
    throw new StoreError(
      "google_calendar_sync_token_expired",
      "Google Calendar sync token expired"
    );
  }
  if (!response.ok)
    throw new StoreError("google_calendar_api_error", "Google Calendar API request failed");
  return json;
}

function googleCalendarOAuthConfig(
  env: GoogleCalendarRuntimeEnv,
  url: URL
): { clientId: string; clientSecret: string; redirectUri: string } {
  if (!env.GOOGLE_CLIENT_ID) throw new GoogleConfigError("GOOGLE_CLIENT_ID is required");
  if (!env.GOOGLE_CLIENT_SECRET) throw new GoogleConfigError("GOOGLE_CLIENT_SECRET is required");
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri:
      env.GOOGLE_CALENDAR_REDIRECT_URI ?? `${url.origin}/v1/connectors/google-calendar/callback`
  };
}

function googleCalendarClient(env: GoogleCalendarRuntimeEnv): GoogleCalendarApiClient {
  if (env.googleCalendarClient) return env.googleCalendarClient;
  if (!env.GOOGLE_CLIENT_ID) throw new GoogleConfigError("GOOGLE_CLIENT_ID is required");
  if (!env.GOOGLE_CLIENT_SECRET) throw new GoogleConfigError("GOOGLE_CLIENT_SECRET is required");
  return createGoogleCalendarClient(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
}

function primaryCalendar(list: GoogleCalendarList): GoogleCalendarListEntry {
  const calendar = list.items.find((item) => item.primary) ?? list.items[0];
  if (!calendar)
    throw new StoreError("calendar_not_found", "No readable Google Calendar was found");
  return calendar;
}

function calendarIdForAccount(account: ConnectorAccount): string {
  const value = account.settings.googleCalendarId;
  if (typeof value !== "string" || value.length === 0) {
    throw new StoreError(
      "invalid_calendar_account",
      "Google Calendar account is missing a calendar id"
    );
  }
  return value;
}

function calendarSummaryForAccount(account: ConnectorAccount): string {
  const value = account.settings.googleCalendarSummary;
  return typeof value === "string" && value.length > 0 ? value : calendarIdForAccount(account);
}

function normalizeEventTime(
  value: GoogleCalendarProviderEvent["start"],
  fallback: string
): { iso: string } {
  if (value?.dateTime) return { iso: new Date(value.dateTime).toISOString() };
  if (value?.date) return { iso: `${value.date}T00:00:00.000Z` };
  return { iso: fallback };
}

function initialTimeMin(now: string): string {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - INITIAL_SYNC_PAST_DAYS);
  return date.toISOString();
}

function initialTimeMax(now: string): string {
  const date = new Date(now);
  date.setUTCMonth(date.getUTCMonth() + INITIAL_SYNC_FUTURE_MONTHS);
  return date.toISOString();
}

function isInvalidSyncToken(error: unknown): boolean {
  return error instanceof StoreError && error.code === "google_calendar_sync_token_expired";
}

function googleCalendarErrorCode(error: unknown): string {
  if (error instanceof GoogleConfigError) return "google_calendar_config_error";
  if (error instanceof StoreError) return error.code;
  return "google_calendar_sync_error";
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof GoogleConfigError) return error.message;
  if (error instanceof StoreError) return error.message;
  if (error instanceof Error) return error.message;
  return "Google Calendar sync failed";
}
