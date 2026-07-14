import { hashSessionToken } from "./auth";
import {
  createGoogleOAuthState,
  decryptSecret,
  encryptSecret,
  GOOGLE_CREDENTIAL_ENCRYPTION_VERSION,
  GOOGLE_OAUTH_AUTHORIZE_URL,
  googleOAuthConfig,
  GoogleConfigError,
  tokenInfoRequest,
  tokenRequest,
  type GoogleRuntimeEnv,
  type GoogleTokenResponse
} from "./google";
import { StoreError, type DentLinkStore } from "./storage";

import type {
  ConnectorAccount,
  ConnectorSourceRecord,
  EntityId,
  GmailDiagnostics,
  GmailSyncResult
} from "@dentlink/item-model";
import type { ConnectorDefinition } from "@dentlink/connector-sdk";

const GMAIL_CONNECTOR_KEY = "gmail";
const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_SCOPE = GMAIL_READONLY_SCOPE;
const GMAIL_API_BASE_URL = "https://gmail.googleapis.com/gmail/v1";
const INITIAL_SYNC_PAGE_SIZE = 25;
const HISTORY_PAGE_SIZE = 100;
const GMAIL_READONLY_RECONNECT_MESSAGE =
  "Reconnect Gmail to grant read-only mailbox access required for backfill.";

type GmailOperation =
  | "gmail_token_refresh"
  | "gmail_messages_list"
  | "gmail_message_get"
  | "gmail_history_list"
  | "gmail_profile_get";

export type GmailRuntimeEnv = GoogleRuntimeEnv & {
  gmailClient?: GmailApiClient;
};

export type GmailApiClient = {
  exchangeCode(code: string, redirectUri: string): Promise<GmailTokenResponse>;
  refreshAccessToken(refreshToken: string): Promise<GmailTokenResponse>;
  getAccessTokenScopes(accessToken: string): Promise<string[]>;
  getProfile(accessToken: string): Promise<GmailProfile>;
  listMessages(
    accessToken: string,
    options?: string | GmailListMessagesOptions
  ): Promise<GmailMessageList>;
  listHistory(
    accessToken: string,
    startHistoryId: string,
    pageToken?: string
  ): Promise<GmailHistoryList>;
  getMessage(accessToken: string, messageId: string): Promise<GmailMessage>;
};

export type GmailTokenResponse = GoogleTokenResponse;

export type GmailProfile = {
  emailAddress: string;
  historyId?: string;
};

export type GmailMessageList = {
  messages: Array<{ id: string; threadId?: string }>;
  nextPageToken?: string;
};

export type GmailListMessagesOptions = {
  pageToken?: string;
  query?: string;
  maxResults?: number;
};

export type GmailHistoryList = {
  history: Array<{
    id?: string;
    messagesAdded?: Array<{ message: { id: string; threadId?: string } }>;
    messages?: Array<{ id: string; threadId?: string }>;
  }>;
  historyId?: string;
  nextPageToken?: string;
};

export type GmailMessage = {
  id: string;
  threadId: string;
  historyId?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: {
    headers?: Array<{ name: string; value: string }>;
  };
};

export class GmailUpstreamError extends StoreError {
  constructor(
    readonly operation: GmailOperation,
    readonly upstreamStatus: number,
    readonly upstreamReason: string | null,
    message: string
  ) {
    super(gmailDentLinkErrorCode(upstreamStatus, upstreamReason), message);
    this.name = "GmailUpstreamError";
  }
}

export function gmailConnectorDefinition(): ConnectorDefinition {
  return {
    key: GMAIL_CONNECTOR_KEY,
    name: "Gmail",
    kind: "email",
    authType: "oauth2",
    capabilities: ["poll", "normalize_notifications"],
    settings: [],
    version: 1
  };
}

export async function startGmailOAuth(
  store: DentLinkStore,
  userId: EntityId,
  env: GmailRuntimeEnv,
  url: URL,
  now: string
): Promise<{ authorizationUrl: string; expiresAt: string }> {
  const config = googleOAuthConfig(env, url, "/v1/connectors/gmail/callback");
  const { state, expiresAt } = await createGoogleOAuthState(
    store,
    userId,
    GMAIL_CONNECTOR_KEY,
    url,
    env,
    now,
    "gmail_oauth_"
  );
  const authorizationUrl = new URL(GOOGLE_OAUTH_AUTHORIZE_URL);
  authorizationUrl.searchParams.set("client_id", config.clientId);
  authorizationUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", GMAIL_SCOPE);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("access_type", "offline");
  authorizationUrl.searchParams.set("prompt", "consent");
  return { authorizationUrl: authorizationUrl.toString(), expiresAt };
}

export async function completeGmailOAuth(
  store: DentLinkStore,
  env: GmailRuntimeEnv,
  url: URL,
  now: string
): Promise<{ account: ConnectorAccount; returnTo: string | null }> {
  const errorCode = url.searchParams.get("error");
  if (errorCode) throw new StoreError("oauth_denied", "Gmail authorization was not completed");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) throw new StoreError("invalid_oauth_callback", "OAuth callback is invalid");
  const stateRecord = await store.consumeConnectorOAuthState(
    await hashSessionToken(state),
    GMAIL_CONNECTOR_KEY,
    now
  );
  if (!stateRecord) throw new StoreError("invalid_oauth_state", "OAuth state is invalid");

  const config = gmailOAuthConfig(env, url);
  const gmail = gmailClient(env);
  const reconnecting = Boolean(stateRecord.reconnectAccountId);
  let grantedScopes: string[] = [];
  let refreshTokenReturned = false;
  try {
    const token = await gmail.exchangeCode(code, config.redirectUri);
    refreshTokenReturned = Boolean(token.refreshToken);
    grantedScopes = await verifiedGmailScopes(gmail, token);
    if (!grantedScopes.includes(GMAIL_READONLY_SCOPE)) {
      throw new StoreError("gmail_permission_denied", GMAIL_READONLY_RECONNECT_MESSAGE);
    }
    if (!token.refreshToken) {
      throw new StoreError(
        "missing_refresh_token",
        "Google did not issue an upgraded offline Gmail credential. Reconnect Gmail and approve read-only mailbox access."
      );
    }
    await verifyGmailReadonlyCapability(gmail, token.accessToken, now);
    const profile = await gmail.getProfile(token.accessToken);
    const account = await linkGmailAccount(
      store,
      stateRecord.userId,
      profile.emailAddress,
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
        settings: withGmailGrantedScopes(
          {
            ...account.settings,
            googleEmail: profile.emailAddress
          },
          grantedScopes.join(" ")
        ),
        syncCursor: profile.historyId ?? account.syncCursor,
        lastHealthAt: now,
        errorCode: null,
        errorMessage: null
      },
      now
    );
    if (!updated) throw new StoreError("not_found", "Gmail account not found");
    logGmailOAuthOutcome({
      accountId: updated.id,
      reconnecting,
      refreshTokenReturned,
      credentialReplaced: true,
      grantedScopes,
      outcome: "connected"
    });
    return { account: updated, returnTo: stateRecord.returnTo };
  } catch (error) {
    await markFailedGmailReconnect(
      store,
      stateRecord.userId,
      stateRecord.reconnectAccountId,
      now,
      error
    );
    logGmailOAuthOutcome({
      accountId: stateRecord.reconnectAccountId,
      reconnecting,
      refreshTokenReturned,
      credentialReplaced: false,
      grantedScopes,
      outcome: "failed",
      errorCode: gmailErrorCode(error),
      message: safeErrorMessage(error)
    });
    throw error;
  }
}

export async function disconnectGmailAccount(
  store: DentLinkStore,
  userId: EntityId,
  accountId: EntityId,
  now: string
): Promise<ConnectorAccount> {
  const account = await requireGmailAccount(store, userId, accountId);
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
  if (!updated) throw new StoreError("not_found", "Gmail account not found");
  return updated;
}

export async function syncGmailAccount(
  store: DentLinkStore,
  userId: EntityId,
  accountId: EntityId,
  env: GmailRuntimeEnv,
  now: string
): Promise<GmailSyncResult> {
  const account = await requireGmailAccount(store, userId, accountId);
  const syncing = await store.updateConnectorAccount(
    userId,
    account.id,
    account.version,
    { syncStatus: "syncing", errorCode: null, errorMessage: null },
    now
  );
  if (!syncing) throw new StoreError("not_found", "Gmail account not found");

  try {
    const credential = await store.getConnectorCredential(
      userId,
      account.id,
      "oauth_refresh_token"
    );
    if (!credential) throw new StoreError("missing_credentials", "Gmail must be reconnected");
    const refreshToken = await decryptSecret(credential.encryptedValue, env);
    const gmail = gmailClient(env);
    const token = await refreshGmailAccessToken(gmail, refreshToken);
    const messages = await messagesForSync(gmail, token.accessToken, syncing.syncCursor);
    const result = await processGmailMessageIds(
      store,
      userId,
      syncing,
      gmail,
      token.accessToken,
      messages.messageIds,
      now
    );
    const latest = await store.getConnectorAccount(userId, account.id);
    if (!latest) throw new StoreError("not_found", "Gmail account not found");
    const summary = summarizeGmailOutcomes(messages.messageIds.length, result.outcomes);
    const failed = result.outcomes.filter((outcome) => outcome.status === "failed");
    const nextCursor =
      failed.length === 0
        ? (messages.historyId ?? result.nextCursor ?? syncing.syncCursor)
        : syncing.syncCursor;
    const updated = await store.updateConnectorAccount(
      userId,
      latest.id,
      latest.version,
      {
        status: "connected",
        healthStatus: failed.length > 0 ? "degraded" : "healthy",
        syncStatus: "idle",
        syncCursor: nextCursor,
        lastSyncAt: now,
        lastHealthAt: now,
        settings: withGmailOperationSummary(
          latest.settings,
          "incremental",
          now,
          failed.length > 0 ? "partial" : "success",
          summary
        ),
        errorCode: failed.length > 0 ? "gmail_partial_sync_failed" : null,
        errorMessage:
          failed.length > 0
            ? `${failed.length} Gmail message${failed.length === 1 ? "" : "s"} failed processing`
            : null
      },
      now
    );
    if (!updated) throw new StoreError("not_found", "Gmail account not found");
    return {
      account: updated,
      processed: summary.examined,
      createdNotifications: result.createdNotifications,
      summary,
      outcomes: result.outcomes
    };
  } catch (error) {
    const latest = await store.getConnectorAccount(userId, account.id);
    if (latest) {
      await store.updateConnectorAccount(
        userId,
        latest.id,
        latest.version,
        {
          status: isGmailAuthFailure(error) ? "error" : "connected",
          healthStatus: isGmailAuthFailure(error) ? "error" : "degraded",
          syncStatus: "idle",
          lastHealthAt: now,
          settings: withGmailOperationFailure(latest.settings, "incremental", now, error),
          errorCode: gmailErrorCode(error),
          errorMessage: safeErrorMessage(error)
        },
        now
      );
    }
    throw error;
  }
}

export async function backfillGmailAccount(
  store: DentLinkStore,
  userId: EntityId,
  accountId: EntityId,
  env: GmailRuntimeEnv,
  now: string,
  days = 30
): Promise<GmailSyncResult> {
  const boundedDays = Math.min(Math.max(Math.floor(days), 1), 365);
  const account = await requireGmailAccount(store, userId, accountId);
  const syncing = await store.updateConnectorAccount(
    userId,
    account.id,
    account.version,
    { syncStatus: "syncing", errorCode: null, errorMessage: null },
    now
  );
  if (!syncing) throw new StoreError("not_found", "Gmail account not found");

  try {
    if (knownGmailScopesMissReadonly(syncing.settings)) {
      throw new StoreError("gmail_permission_denied", GMAIL_READONLY_RECONNECT_MESSAGE);
    }
    const credential = await store.getConnectorCredential(
      userId,
      account.id,
      "oauth_refresh_token"
    );
    if (!credential) throw new StoreError("missing_credentials", "Gmail must be reconnected");
    const refreshToken = await decryptSecret(credential.encryptedValue, env);
    const gmail = gmailClient(env);
    const token = await refreshGmailAccessToken(gmail, refreshToken);
    const messages = await messagesForBackfill(gmail, token.accessToken, now, boundedDays);
    const result = await processGmailMessageIds(
      store,
      userId,
      syncing,
      gmail,
      token.accessToken,
      messages.messageIds,
      now
    );
    const latest = await store.getConnectorAccount(userId, account.id);
    if (!latest) throw new StoreError("not_found", "Gmail account not found");
    const summary = summarizeGmailOutcomes(messages.messageIds.length, result.outcomes);
    const failed = result.outcomes.filter((outcome) => outcome.status === "failed");
    const updated = await store.updateConnectorAccount(
      userId,
      latest.id,
      latest.version,
      {
        status: "connected",
        healthStatus: failed.length > 0 ? "degraded" : "healthy",
        syncStatus: "idle",
        lastSyncAt: now,
        lastHealthAt: now,
        settings: withGmailOperationSummary(
          latest.settings,
          "backfill",
          now,
          failed.length > 0 ? "partial" : "success",
          summary
        ),
        errorCode: failed.length > 0 ? "gmail_partial_sync_failed" : null,
        errorMessage:
          failed.length > 0
            ? `${failed.length} Gmail message${failed.length === 1 ? "" : "s"} failed processing`
            : null
      },
      now
    );
    if (!updated) throw new StoreError("not_found", "Gmail account not found");
    return {
      account: updated,
      processed: summary.examined,
      createdNotifications: result.createdNotifications,
      summary,
      outcomes: result.outcomes
    };
  } catch (error) {
    const latest = await store.getConnectorAccount(userId, account.id);
    if (latest) {
      await store.updateConnectorAccount(
        userId,
        latest.id,
        latest.version,
        {
          status: isGmailAuthFailure(error) ? "error" : "connected",
          healthStatus: isGmailAuthFailure(error) ? "error" : "degraded",
          syncStatus: "idle",
          lastHealthAt: now,
          settings: withGmailOperationFailure(latest.settings, "backfill", now, error),
          errorCode: gmailErrorCode(error),
          errorMessage: safeErrorMessage(error)
        },
        now
      );
    }
    throw error;
  }
}

export async function getGmailDiagnostics(
  store: DentLinkStore,
  userId: EntityId,
  accountId: EntityId
): Promise<GmailDiagnostics> {
  const account = await requireGmailAccount(store, userId, accountId);
  const records = await store.listConnectorSourceRecords(userId, account.id);
  const messages = records
    .filter(isGmailDiagnosticRecord)
    .sort((left, right) => {
      const leftTime = left.processedAt ?? left.receivedAt;
      const rightTime = right.processedAt ?? right.receivedAt;
      return rightTime.localeCompare(leftTime);
    })
    .map(gmailDiagnosticMessage);
  return {
    account,
    summary: summarizeGmailDiagnostics(messages),
    messages
  };
}

export { GoogleConfigError as GmailConfigError };

export function createGoogleGmailClient(
  clientId: string,
  clientSecret: string,
  fetchImpl: typeof fetch = fetch
): GmailApiClient {
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
    async getAccessTokenScopes(accessToken) {
      const info = await tokenInfoRequest(fetchImpl, accessToken);
      return normalizeScopes(info.scope ?? "");
    },
    async getProfile(accessToken) {
      const response = await gmailRequest(
        fetchImpl,
        accessToken,
        "gmail_profile_get",
        "/users/me/profile"
      );
      return response as GmailProfile;
    },
    async listMessages(accessToken, options) {
      const parsedOptions = typeof options === "string" ? { pageToken: options } : (options ?? {});
      const url = new URL(`${GMAIL_API_BASE_URL}/users/me/messages`);
      url.searchParams.set(
        "maxResults",
        String(parsedOptions.maxResults ?? INITIAL_SYNC_PAGE_SIZE)
      );
      url.searchParams.append("labelIds", "INBOX");
      if (parsedOptions.pageToken) url.searchParams.set("pageToken", parsedOptions.pageToken);
      if (parsedOptions.query) url.searchParams.set("q", parsedOptions.query);
      return (await gmailRequest(
        fetchImpl,
        accessToken,
        "gmail_messages_list",
        url
      )) as GmailMessageList;
    },
    async listHistory(accessToken, startHistoryId, pageToken) {
      const url = new URL(`${GMAIL_API_BASE_URL}/users/me/history`);
      url.searchParams.set("startHistoryId", startHistoryId);
      url.searchParams.set("maxResults", String(HISTORY_PAGE_SIZE));
      url.searchParams.append("historyTypes", "messageAdded");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      return (await gmailRequest(
        fetchImpl,
        accessToken,
        "gmail_history_list",
        url
      )) as GmailHistoryList;
    },
    async getMessage(accessToken, messageId) {
      const url = new URL(
        `${GMAIL_API_BASE_URL}/users/me/messages/${encodeURIComponent(messageId)}`
      );
      url.searchParams.set("format", "metadata");
      for (const header of ["From", "Subject", "Date", "Message-ID"]) {
        url.searchParams.append("metadataHeaders", header);
      }
      return (await gmailRequest(fetchImpl, accessToken, "gmail_message_get", url)) as GmailMessage;
    }
  };
}

async function linkGmailAccount(
  store: DentLinkStore,
  userId: EntityId,
  emailAddress: string,
  reconnectAccountId: EntityId | null,
  now: string
): Promise<ConnectorAccount> {
  if (reconnectAccountId) {
    const account = await requireGmailAccount(store, userId, reconnectAccountId);
    return account;
  }
  const accounts = await store.listConnectorAccounts(userId);
  const existing = accounts.accounts.find(
    (account) =>
      account.connectorKey === GMAIL_CONNECTOR_KEY &&
      typeof account.settings.googleEmail === "string" &&
      account.settings.googleEmail.toLowerCase() === emailAddress.toLowerCase()
  );
  if (existing) return existing;
  return store.createConnectorAccount(
    userId,
    {
      connectorKey: GMAIL_CONNECTOR_KEY,
      displayName: `Gmail ${emailAddress}`,
      settings: { googleEmail: emailAddress },
      credentialStatus: "not_configured"
    },
    now
  );
}

async function requireGmailAccount(
  store: DentLinkStore,
  userId: EntityId,
  accountId: EntityId
): Promise<ConnectorAccount> {
  const account = await store.getConnectorAccount(userId, accountId);
  if (!account || account.connectorKey !== GMAIL_CONNECTOR_KEY) {
    throw new StoreError("not_found", "Gmail account not found");
  }
  return account;
}

async function messagesForSync(
  gmail: GmailApiClient,
  accessToken: string,
  historyId: string | null
): Promise<{ messageIds: string[]; historyId: string | null }> {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  let latestHistoryId: string | null = null;
  if (historyId) {
    do {
      const page = await gmail.listHistory(accessToken, historyId, pageToken);
      for (const event of page.history ?? []) {
        latestHistoryId = maxHistoryId(latestHistoryId, event.id);
        for (const item of event.messagesAdded ?? []) ids.add(item.message.id);
        for (const item of event.messages ?? []) ids.add(item.id);
      }
      latestHistoryId = maxHistoryId(latestHistoryId, page.historyId);
      pageToken = page.nextPageToken;
    } while (pageToken);
  } else {
    do {
      const page = await gmail.listMessages(accessToken, pageToken);
      for (const message of page.messages ?? []) ids.add(message.id);
      pageToken = page.nextPageToken;
    } while (pageToken);
  }
  return { messageIds: [...ids], historyId: latestHistoryId };
}

async function messagesForBackfill(
  gmail: GmailApiClient,
  accessToken: string,
  now: string,
  days: number
): Promise<{ messageIds: string[] }> {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  const afterSeconds = Math.floor((Date.parse(now) - days * 24 * 60 * 60 * 1000) / 1000);
  const query = `after:${afterSeconds}`;
  do {
    const page = await gmail.listMessages(accessToken, { pageToken, query });
    for (const message of page.messages ?? []) ids.add(message.id);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return { messageIds: [...ids] };
}

async function processGmailMessageIds(
  store: DentLinkStore,
  userId: EntityId,
  account: ConnectorAccount,
  gmail: GmailApiClient,
  accessToken: string,
  messageIds: string[],
  now: string
): Promise<{
  createdNotifications: number;
  nextCursor: string | null;
  outcomes: GmailSyncResult["outcomes"];
}> {
  let createdNotifications = 0;
  let nextCursor = account.syncCursor;
  const outcomes: GmailSyncResult["outcomes"] = [];
  for (const messageId of messageIds) {
    try {
      const existingRecord = await store.findConnectorSourceRecord(userId, account.id, messageId);
      if (existingRecord && !shouldRetryGmailSourceRecord(existingRecord.status)) {
        outcomes.push(
          await recordGmailMessageDuplicate(store, userId, account, existingRecord, now)
        );
        continue;
      }
      const message = await gmail.getMessage(accessToken, messageId);
      nextCursor = maxHistoryId(nextCursor, message.historyId);
      const outcome = await ingestGmailMessage(store, userId, account, message, now);
      outcomes.push(outcome);
      if (outcome.status === "notification_created") createdNotifications += 1;
    } catch (error) {
      outcomes.push(await recordGmailMessageFailure(store, userId, account, messageId, error, now));
    }
  }
  return { createdNotifications, nextCursor, outcomes };
}

async function ingestGmailMessage(
  store: DentLinkStore,
  userId: EntityId,
  account: ConnectorAccount,
  message: GmailMessage,
  now: string
): Promise<GmailSyncResult["outcomes"][number]> {
  const headers = headersByName(message);
  const subject = headers.get("subject") ?? "(no subject)";
  const sender = headers.get("from") ?? "Unknown sender";
  const messageId = headers.get("message-id") ?? null;
  const receivedAt = message.internalDate
    ? new Date(Number(message.internalDate)).toISOString()
    : now;
  const unread = message.labelIds?.includes("UNREAD") ?? false;
  const normalizedPayload = {
    provider: "gmail",
    provider_item_id: message.id,
    history_id: message.historyId ?? null,
    thread_id: message.threadId,
    message_id: messageId,
    internal_date: message.internalDate ?? null,
    received_at: receivedAt,
    labels: message.labelIds ?? [],
    unread,
    sender,
    subject,
    permalink: gmailPermalink(message.threadId),
    connector_account: account.id
  };
  const payloadHash = await hashSessionToken(JSON.stringify(normalizedPayload));
  const { record, created } = await store.createConnectorSourceRecordIfAbsent(
    userId,
    {
      accountId: account.id,
      sourceExternalId: message.id,
      sourceType: "email",
      payloadHash,
      normalizedPayload
    },
    now
  );
  if (!created && record.status !== "failed") {
    return recordGmailMessageDuplicate(store, userId, account, record, now);
  }
  const notification = await store.createNotification(
    userId,
    {
      title: subject,
      summary: `${sender}${unread ? " · unread" : ""}`,
      body: "",
      source: "connector",
      sourceLabel: "Gmail",
      sourceUrl: gmailPermalink(message.threadId),
      severity: unread ? "medium" : "info"
    },
    now
  );
  const updatedPayload = {
    ...normalizedPayload,
    notification_id: notification.id
  };
  const updatedRecord = await store.updateConnectorSourceRecordProcessing(
    userId,
    account.id,
    message.id,
    {
      status: "notification_created",
      processingReason: "Created a Gmail notification",
      normalizedPayload: updatedPayload,
      payloadHash: await hashSessionToken(JSON.stringify(updatedPayload))
    },
    now
  );
  return {
    messageId: message.id,
    status: "notification_created",
    reason: updatedRecord.processingReason ?? "Created a Gmail notification",
    recordId: updatedRecord.id
  };
}

async function recordGmailMessageFailure(
  store: DentLinkStore,
  userId: EntityId,
  account: ConnectorAccount,
  messageId: string,
  error: unknown,
  now: string
): Promise<GmailSyncResult["outcomes"][number]> {
  const existing = await store.findConnectorSourceRecord(userId, account.id, messageId);
  if (existing && !shouldRetryGmailSourceRecord(existing.status)) {
    return recordGmailMessageDuplicate(store, userId, account, existing, now);
  }
  const normalizedPayload = {
    provider: "gmail",
    provider_item_id: messageId,
    connector_account: account.id
  };
  const payloadHash = await hashSessionToken(JSON.stringify(normalizedPayload));
  const { record } = await store.createConnectorSourceRecordIfAbsent(
    userId,
    {
      accountId: account.id,
      sourceExternalId: messageId,
      sourceType: "email",
      payloadHash,
      normalizedPayload
    },
    now
  );
  const message = safeErrorMessage(error);
  const updated = await store.updateConnectorSourceRecordProcessing(
    userId,
    account.id,
    messageId,
    {
      status: "failed",
      processingReason: message,
      errorMessage: message,
      normalizedPayload: record.normalizedPayload,
      payloadHash: record.payloadHash
    },
    now
  );
  return {
    messageId,
    status: "failed",
    reason: updated.processingReason ?? message,
    recordId: updated.id
  };
}

async function recordGmailMessageDuplicate(
  store: DentLinkStore,
  userId: EntityId,
  account: ConnectorAccount,
  record: ConnectorSourceRecord,
  now: string
): Promise<GmailSyncResult["outcomes"][number]> {
  const updated = await store.updateConnectorSourceRecordProcessing(
    userId,
    account.id,
    record.sourceExternalId,
    {
      status: "duplicate",
      processingReason: "Gmail message already has a source record",
      normalizedPayload: record.normalizedPayload,
      payloadHash: record.payloadHash
    },
    now
  );
  return {
    messageId: record.sourceExternalId,
    status: "duplicate",
    reason: updated.processingReason ?? "Gmail message already has a source record",
    recordId: updated.id
  };
}

function shouldRetryGmailSourceRecord(status: ConnectorSourceRecord["status"]): boolean {
  return status === "pending" || status === "failed";
}

function summarizeGmailOutcomes(
  discovered: number,
  outcomes: GmailSyncResult["outcomes"]
): GmailSyncResult["summary"] {
  const summary = emptyGmailSummary(discovered, outcomes.length);
  for (const outcome of outcomes) {
    if (outcome.status === "notification_created") summary.created += 1;
    if (outcome.status === "notification_updated") summary.updated += 1;
    if (outcome.status === "duplicate") summary.duplicate += 1;
    if (outcome.status === "skipped") summary.skipped += 1;
    if (outcome.status === "filtered") summary.filtered += 1;
    if (outcome.status === "failed") summary.failed += 1;
  }
  return summary;
}

function summarizeGmailDiagnostics(
  messages: GmailDiagnostics["messages"]
): GmailDiagnostics["summary"] {
  const summary = emptyGmailSummary(messages.length, messages.length);
  for (const message of messages) {
    if (message.outcome === "notification_created") summary.created += 1;
    if (message.outcome === "notification_updated") summary.updated += 1;
    if (message.outcome === "duplicate") summary.duplicate += 1;
    if (message.outcome === "skipped") summary.skipped += 1;
    if (message.outcome === "filtered") summary.filtered += 1;
    if (message.outcome === "failed") summary.failed += 1;
  }
  return summary;
}

function emptyGmailSummary(discovered: number, examined: number): GmailSyncResult["summary"] {
  return {
    discovered,
    examined,
    created: 0,
    updated: 0,
    duplicate: 0,
    skipped: 0,
    filtered: 0,
    failed: 0
  };
}

function isGmailDiagnosticRecord(record: ConnectorSourceRecord): boolean {
  return (
    record.connectorKey === GMAIL_CONNECTOR_KEY &&
    record.sourceType === "email" &&
    isDiagnosticOutcome(record.status)
  );
}

function gmailDiagnosticMessage(
  record: ConnectorSourceRecord
): GmailDiagnostics["messages"][number] {
  return {
    messageId: record.sourceExternalId,
    outcome: record.status as GmailDiagnostics["messages"][number]["outcome"],
    reason: record.processingReason ?? record.errorMessage ?? "No processing reason recorded",
    processedAt: record.processedAt,
    notificationId:
      typeof record.normalizedPayload.notification_id === "string"
        ? record.normalizedPayload.notification_id
        : null,
    sourceRecordId: record.id
  };
}

function isDiagnosticOutcome(
  status: ConnectorSourceRecord["status"]
): status is GmailDiagnostics["messages"][number]["outcome"] {
  return (
    status === "notification_created" ||
    status === "notification_updated" ||
    status === "skipped" ||
    status === "duplicate" ||
    status === "filtered" ||
    status === "failed"
  );
}

async function gmailRequest(
  fetchImpl: typeof fetch,
  accessToken: string,
  operation: GmailOperation,
  pathOrUrl: string | URL
): Promise<unknown> {
  const url = typeof pathOrUrl === "string" ? `${GMAIL_API_BASE_URL}${pathOrUrl}` : pathOrUrl;
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = gmailErrorReason(json);
    const message = gmailSafeUpstreamMessage(operation, response.status, reason, json);
    logGmailUpstreamFailure(operation, response.status, reason, message, url);
    throw new GmailUpstreamError(operation, response.status, reason, message);
  }
  if (!json) throw new StoreError("gmail_response_invalid", "Gmail response was invalid");
  return json;
}

async function refreshGmailAccessToken(
  gmail: GmailApiClient,
  refreshToken: string
): Promise<GmailTokenResponse> {
  try {
    const token = await gmail.refreshAccessToken(refreshToken);
    console.log(
      JSON.stringify({
        level: "info",
        event: "gmail_token_refresh",
        operation: "gmail_token_refresh",
        succeeded: true
      })
    );
    return token;
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "gmail_token_refresh",
        operation: "gmail_token_refresh",
        succeeded: false,
        errorCode: gmailErrorCode(error),
        message: safeErrorMessage(error)
      })
    );
    if (error instanceof StoreError) {
      throw new StoreError(
        "gmail_auth_failed",
        "Gmail authentication failed. Reconnect the account."
      );
    }
    throw error;
  }
}

async function verifiedGmailScopes(
  gmail: GmailApiClient,
  token: GmailTokenResponse
): Promise<string[]> {
  const tokenScopes = normalizeScopes(token.scope ?? "");
  if (tokenScopes.length > 0) return tokenScopes;
  return gmail.getAccessTokenScopes(token.accessToken);
}

async function verifyGmailReadonlyCapability(
  gmail: GmailApiClient,
  accessToken: string,
  now: string
): Promise<void> {
  const afterSeconds = Math.floor((Date.parse(now) - 24 * 60 * 60 * 1000) / 1000);
  await gmail.listMessages(accessToken, { query: `after:${afterSeconds}`, maxResults: 1 });
}

async function markFailedGmailReconnect(
  store: DentLinkStore,
  userId: EntityId,
  accountId: EntityId | null,
  now: string,
  error: unknown
): Promise<void> {
  if (!accountId) return;
  const account = await store.getConnectorAccount(userId, accountId);
  if (!account || account.connectorKey !== GMAIL_CONNECTOR_KEY) return;
  await store.updateConnectorAccount(
    userId,
    account.id,
    account.version,
    {
      status: isGmailAuthFailure(error) ? "error" : "connected",
      healthStatus: isGmailAuthFailure(error) ? "error" : "degraded",
      syncStatus: "idle",
      lastHealthAt: now,
      settings: {
        ...account.settings,
        gmailReconnectRequired: true
      },
      errorCode: gmailErrorCode(error),
      errorMessage: safeErrorMessage(error)
    },
    now
  );
}

function logGmailOAuthOutcome(input: {
  accountId: EntityId | null;
  reconnecting: boolean;
  refreshTokenReturned: boolean;
  credentialReplaced: boolean;
  grantedScopes: string[];
  outcome: "connected" | "failed";
  errorCode?: string;
  message?: string;
}): void {
  const payload = {
    level: input.outcome === "connected" ? "info" : "error",
    event: "gmail_oauth_credential_upgrade",
    accountId: input.accountId,
    reconnecting: input.reconnecting,
    requestedScopes: [GMAIL_SCOPE],
    grantedScopes: input.grantedScopes,
    refreshTokenReturned: input.refreshTokenReturned,
    credentialReplaced: input.credentialReplaced,
    outcome: input.outcome,
    errorCode: input.errorCode,
    message: input.message
  };
  const serialized = JSON.stringify(payload);
  if (input.outcome === "connected") console.log(serialized);
  else console.error(serialized);
}

function gmailOAuthConfig(
  env: GmailRuntimeEnv,
  url: URL
): { clientId: string; redirectUri: string } {
  const config = googleOAuthConfig(env, url, "/v1/connectors/gmail/callback");
  return { clientId: config.clientId, redirectUri: config.redirectUri };
}

function gmailClient(env: GmailRuntimeEnv): GmailApiClient {
  if (env.gmailClient) return env.gmailClient;
  if (!env.GOOGLE_CLIENT_ID) throw new GoogleConfigError("GOOGLE_CLIENT_ID is required");
  if (!env.GOOGLE_CLIENT_SECRET) throw new GoogleConfigError("GOOGLE_CLIENT_SECRET is required");
  return createGoogleGmailClient(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
}

function headersByName(message: GmailMessage): Map<string, string> {
  const headers = new Map<string, string>();
  for (const header of message.payload?.headers ?? []) {
    headers.set(header.name.toLowerCase(), header.value);
  }
  return headers;
}

function gmailPermalink(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(threadId)}`;
}

function maxHistoryId(left: string | null, right?: string): string | null {
  if (!right) return left;
  if (!left) return right;
  try {
    return BigInt(right) > BigInt(left) ? right : left;
  } catch {
    return right > left ? right : left;
  }
}

function gmailErrorCode(error: unknown): string {
  if (error instanceof GoogleConfigError) return "gmail_config_error";
  if (error instanceof StoreError) return error.code;
  return "gmail_sync_error";
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof GoogleConfigError) return error.message;
  if (error instanceof StoreError) return error.message;
  if (error instanceof Error) return error.message;
  return "Gmail sync failed";
}

function isGmailAuthFailure(error: unknown): boolean {
  return error instanceof StoreError && error.code === "gmail_auth_failed";
}

function gmailDentLinkErrorCode(status: number, reason: string | null): string {
  const normalized = reason?.toLowerCase() ?? "";
  if (status === 401 || normalized.includes("auth") || normalized.includes("invalidcredentials")) {
    return "gmail_auth_failed";
  }
  if (
    status === 403 &&
    (normalized.includes("insufficient") ||
      normalized.includes("forbidden") ||
      normalized.includes("permission"))
  ) {
    return "gmail_permission_denied";
  }
  if (status === 400) return "gmail_query_invalid";
  if (status === 429 || normalized.includes("ratelimit")) return "gmail_rate_limited";
  return "gmail_upstream_failed";
}

function gmailSafeUpstreamMessage(
  operation: GmailOperation,
  status: number,
  reason: string | null,
  json: unknown
): string {
  const upstreamMessage = sanitizeGmailMessage(gmailErrorMessage(json));
  if (operation === "gmail_messages_list" && status === 400) {
    return "Backfill failed because Gmail rejected the mailbox search query.";
  }
  if (status === 401) return "Gmail authentication failed. Reconnect the account.";
  if (status === 403) {
    return reason?.toLowerCase().includes("insufficient")
      ? GMAIL_READONLY_RECONNECT_MESSAGE
      : upstreamMessage || "Gmail returned a permission error.";
  }
  if (status === 429) return "Gmail rate limited this request. Try again later.";
  if (status >= 500) return "Gmail is temporarily unavailable. Try again later.";
  return upstreamMessage || "Gmail API request failed.";
}

function gmailErrorReason(json: unknown): string | null {
  if (!isRecord(json)) return null;
  const error = json.error;
  if (!isRecord(error)) return null;
  const errors = error.errors;
  if (Array.isArray(errors)) {
    const first = errors.find(isRecord);
    if (first && typeof first.reason === "string") return first.reason;
  }
  if (typeof error.status === "string") return error.status;
  return null;
}

function gmailErrorMessage(json: unknown): string | null {
  if (!isRecord(json)) return null;
  const error = json.error;
  if (!isRecord(error)) return null;
  return typeof error.message === "string" ? error.message : null;
}

function sanitizeGmailMessage(message: string | null): string | null {
  if (!message) return null;
  return message
    .replaceAll(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    .replaceAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .slice(0, 240);
}

function logGmailUpstreamFailure(
  operation: GmailOperation,
  status: number,
  reason: string | null,
  message: string,
  url: string | URL
): void {
  const parsed = new URL(url.toString());
  console.error(
    JSON.stringify({
      level: "error",
      event: "gmail_upstream_failure",
      operation,
      upstreamStatus: status,
      upstreamReason: reason,
      message,
      endpoint: `${parsed.origin}${parsed.pathname}`,
      query: sanitizedGmailQuery(parsed)
    })
  );
}

function sanitizedGmailQuery(url: URL): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of url.searchParams) {
    const existing = query[key];
    if (existing) query[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    else query[key] = value;
  }
  return query;
}

function withGmailOperationSummary(
  settings: ConnectorAccount["settings"],
  operation: "incremental" | "backfill",
  now: string,
  status: "success" | "partial",
  summary: GmailSyncResult["summary"]
): ConnectorAccount["settings"] {
  const prefix = operation === "incremental" ? "gmailLastIncremental" : "gmailLastBackfill";
  const reconnectRequired = knownGmailScopesMissReadonly(settings) ? true : false;
  return {
    ...settings,
    gmailReconnectRequired: reconnectRequired,
    [`${prefix}At`]: now,
    [`${prefix}Status`]: status,
    [`${prefix}ErrorCode`]: null,
    [`${prefix}ErrorMessage`]: null,
    [`${prefix}Discovered`]: summary.discovered,
    [`${prefix}Examined`]: summary.examined,
    [`${prefix}Created`]: summary.created,
    [`${prefix}Updated`]: summary.updated,
    [`${prefix}Duplicate`]: summary.duplicate,
    [`${prefix}Skipped`]: summary.skipped,
    [`${prefix}Filtered`]: summary.filtered,
    [`${prefix}Failed`]: summary.failed
  };
}

function withGmailOperationFailure(
  settings: ConnectorAccount["settings"],
  operation: "incremental" | "backfill",
  now: string,
  error: unknown
): ConnectorAccount["settings"] {
  const prefix = operation === "incremental" ? "gmailLastIncremental" : "gmailLastBackfill";
  const reconnectRequired =
    error instanceof StoreError && error.code === "gmail_permission_denied" ? true : undefined;
  return {
    ...settings,
    ...(reconnectRequired === undefined
      ? {}
      : {
          gmailReconnectRequired: reconnectRequired
        }),
    [`${prefix}At`]: now,
    [`${prefix}Status`]: "failed",
    [`${prefix}ErrorCode`]: gmailErrorCode(error),
    [`${prefix}ErrorMessage`]: safeErrorMessage(error)
  };
}

function withGmailGrantedScopes(
  settings: ConnectorAccount["settings"],
  scope: string
): ConnectorAccount["settings"] {
  const scopes = normalizeScopes(scope);
  return {
    ...settings,
    gmailGrantedScopes: scopes.join(" "),
    gmailReadOnlyGranted: scopes.includes(GMAIL_READONLY_SCOPE),
    gmailReconnectRequired: !scopes.includes(GMAIL_READONLY_SCOPE),
    gmailRequestedScope: GMAIL_SCOPE
  };
}

function knownGmailScopesMissReadonly(settings: ConnectorAccount["settings"]): boolean {
  const scopeValue = settings.gmailGrantedScopes;
  if (typeof scopeValue !== "string" || scopeValue.length === 0) return false;
  return !normalizeScopes(scopeValue).includes(GMAIL_READONLY_SCOPE);
}

function normalizeScopes(scope: string): string[] {
  return scope
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
