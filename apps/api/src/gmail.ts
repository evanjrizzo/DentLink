import { generateSessionToken, hashSessionToken } from "./auth";
import { StoreError, type DentLinkStore } from "./storage";

import type { ConnectorAccount, EntityId, GmailSyncResult } from "@dentlink/item-model";
import type { ConnectorDefinition } from "@dentlink/connector-sdk";

const GMAIL_CONNECTOR_KEY = "gmail";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.metadata";
const OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API_BASE_URL = "https://gmail.googleapis.com/gmail/v1";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const ENCRYPTION_VERSION = 1;
const INITIAL_SYNC_PAGE_SIZE = 25;
const HISTORY_PAGE_SIZE = 100;

export type GmailRuntimeEnv = {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  GMAIL_CREDENTIAL_ENCRYPTION_KEY?: string;
  DENTLINK_WEB_ORIGIN?: string;
  gmailClient?: GmailApiClient;
};

export type GmailApiClient = {
  exchangeCode(code: string, redirectUri: string): Promise<GmailTokenResponse>;
  refreshAccessToken(refreshToken: string): Promise<GmailTokenResponse>;
  getProfile(accessToken: string): Promise<GmailProfile>;
  listMessages(accessToken: string, pageToken?: string): Promise<GmailMessageList>;
  listHistory(
    accessToken: string,
    startHistoryId: string,
    pageToken?: string
  ): Promise<GmailHistoryList>;
  getMessage(accessToken: string, messageId: string): Promise<GmailMessage>;
};

export type GmailTokenResponse = {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
};

export type GmailProfile = {
  emailAddress: string;
  historyId?: string;
};

export type GmailMessageList = {
  messages: Array<{ id: string; threadId?: string }>;
  nextPageToken?: string;
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
  const config = gmailOAuthConfig(env, url);
  const state = generateSessionToken().replace("session_", "gmail_oauth_");
  const stateHash = await hashSessionToken(state);
  const reconnectAccountId = url.searchParams.get("accountId");
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"), env);
  const expiresAt = new Date(new Date(now).getTime() + OAUTH_STATE_TTL_MS).toISOString();
  await store.createConnectorOAuthState(
    userId,
    {
      stateHash,
      connectorKey: GMAIL_CONNECTOR_KEY,
      reconnectAccountId,
      returnTo,
      expiresAt
    },
    now
  );
  const authorizationUrl = new URL(OAUTH_AUTHORIZE_URL);
  authorizationUrl.searchParams.set("client_id", config.clientId);
  authorizationUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", GMAIL_SCOPE);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("access_type", "offline");
  authorizationUrl.searchParams.set("prompt", "consent");
  authorizationUrl.searchParams.set("include_granted_scopes", "true");
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
  const token = await gmail.exchangeCode(code, config.redirectUri);
  if (!token.refreshToken) {
    throw new StoreError("missing_refresh_token", "Gmail did not return a refresh token");
  }
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
      encryptionVersion: ENCRYPTION_VERSION
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
      settings: { ...account.settings, googleEmail: profile.emailAddress },
      syncCursor: profile.historyId ?? account.syncCursor,
      lastHealthAt: now,
      errorCode: null,
      errorMessage: null
    },
    now
  );
  if (!updated) throw new StoreError("not_found", "Gmail account not found");
  return { account: updated, returnTo: stateRecord.returnTo };
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
    const token = await gmail.refreshAccessToken(refreshToken);
    const messages = await messagesForSync(gmail, token.accessToken, syncing.syncCursor);
    let processed = 0;
    let createdNotifications = 0;
    let nextCursor = syncing.syncCursor;
    for (const messageId of messages.messageIds) {
      const message = await gmail.getMessage(token.accessToken, messageId);
      nextCursor = maxHistoryId(nextCursor, message.historyId);
      const created = await ingestGmailMessage(store, userId, syncing, message, now);
      processed += 1;
      if (created) createdNotifications += 1;
    }
    nextCursor = messages.historyId ?? nextCursor;
    const latest = await store.getConnectorAccount(userId, account.id);
    if (!latest) throw new StoreError("not_found", "Gmail account not found");
    const updated = await store.updateConnectorAccount(
      userId,
      latest.id,
      latest.version,
      {
        status: "connected",
        healthStatus: "healthy",
        syncStatus: "idle",
        syncCursor: nextCursor,
        lastSyncAt: now,
        lastHealthAt: now,
        errorCode: null,
        errorMessage: null
      },
      now
    );
    if (!updated) throw new StoreError("not_found", "Gmail account not found");
    return { account: updated, processed, createdNotifications };
  } catch (error) {
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
          errorCode: gmailErrorCode(error),
          errorMessage: safeErrorMessage(error)
        },
        now
      );
    }
    throw error;
  }
}

export class GmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailConfigError";
  }
}

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
    async getProfile(accessToken) {
      const response = await gmailRequest(fetchImpl, accessToken, "/users/me/profile");
      return response as GmailProfile;
    },
    async listMessages(accessToken, pageToken) {
      const url = new URL(`${GMAIL_API_BASE_URL}/users/me/messages`);
      url.searchParams.set("maxResults", String(INITIAL_SYNC_PAGE_SIZE));
      url.searchParams.append("labelIds", "INBOX");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      return (await gmailRequest(fetchImpl, accessToken, url)) as GmailMessageList;
    },
    async listHistory(accessToken, startHistoryId, pageToken) {
      const url = new URL(`${GMAIL_API_BASE_URL}/users/me/history`);
      url.searchParams.set("startHistoryId", startHistoryId);
      url.searchParams.set("maxResults", String(HISTORY_PAGE_SIZE));
      url.searchParams.append("historyTypes", "messageAdded");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      return (await gmailRequest(fetchImpl, accessToken, url)) as GmailHistoryList;
    },
    async getMessage(accessToken, messageId) {
      const url = new URL(
        `${GMAIL_API_BASE_URL}/users/me/messages/${encodeURIComponent(messageId)}`
      );
      url.searchParams.set("format", "metadata");
      for (const header of ["From", "Subject", "Date", "Message-ID"]) {
        url.searchParams.append("metadataHeaders", header);
      }
      return (await gmailRequest(fetchImpl, accessToken, url)) as GmailMessage;
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

async function ingestGmailMessage(
  store: DentLinkStore,
  userId: EntityId,
  account: ConnectorAccount,
  message: GmailMessage,
  now: string
): Promise<boolean> {
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
  const { created } = await store.createConnectorSourceRecordIfAbsent(
    userId,
    {
      accountId: account.id,
      sourceExternalId: message.id,
      sourceType: "email",
      payloadHash: await hashSessionToken(JSON.stringify(normalizedPayload)),
      normalizedPayload
    },
    now
  );
  if (!created) return false;
  await store.createNotification(
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
  return true;
}

async function tokenRequest(
  fetchImpl: typeof fetch,
  fields: Record<string, string>
): Promise<GmailTokenResponse> {
  const body = new URLSearchParams(fields);
  const response = await fetchImpl(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !json) {
    throw new StoreError("gmail_token_error", "Gmail token exchange failed");
  }
  const accessToken = json.access_token;
  if (typeof accessToken !== "string") {
    throw new StoreError("gmail_token_error", "Gmail token response was invalid");
  }
  return {
    accessToken,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : undefined,
    expiresIn: typeof json.expires_in === "number" ? json.expires_in : undefined
  };
}

async function gmailRequest(
  fetchImpl: typeof fetch,
  accessToken: string,
  pathOrUrl: string | URL
): Promise<unknown> {
  const url = typeof pathOrUrl === "string" ? `${GMAIL_API_BASE_URL}${pathOrUrl}` : pathOrUrl;
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new StoreError("gmail_api_error", "Gmail API request failed");
  return json;
}

function gmailOAuthConfig(
  env: GmailRuntimeEnv,
  url: URL
): { clientId: string; redirectUri: string } {
  if (!env.GOOGLE_CLIENT_ID) throw new GmailConfigError("GOOGLE_CLIENT_ID is required");
  if (!env.GOOGLE_CLIENT_SECRET) throw new GmailConfigError("GOOGLE_CLIENT_SECRET is required");
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    redirectUri: env.GOOGLE_REDIRECT_URI ?? `${url.origin}/v1/connectors/gmail/callback`
  };
}

function gmailClient(env: GmailRuntimeEnv): GmailApiClient {
  if (env.gmailClient) return env.gmailClient;
  if (!env.GOOGLE_CLIENT_ID) throw new GmailConfigError("GOOGLE_CLIENT_ID is required");
  if (!env.GOOGLE_CLIENT_SECRET) throw new GmailConfigError("GOOGLE_CLIENT_SECRET is required");
  return createGoogleGmailClient(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
}

async function encryptSecret(secret: string, env: GmailRuntimeEnv): Promise<string> {
  const key = await importAesKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBufferSource(iv) },
    key,
    new TextEncoder().encode(secret)
  );
  return `v${ENCRYPTION_VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(encrypted))}`;
}

async function decryptSecret(value: string, env: GmailRuntimeEnv): Promise<string> {
  const [version, ivValue, encryptedValue] = value.split(".");
  if (version !== `v${ENCRYPTION_VERSION}` || !ivValue || !encryptedValue) {
    throw new StoreError("invalid_credentials", "Stored Gmail credentials are invalid");
  }
  const key = await importAesKey(env);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBufferSource(fromBase64Url(ivValue)) },
    key,
    asBufferSource(fromBase64Url(encryptedValue))
  );
  return new TextDecoder().decode(decrypted);
}

async function importAesKey(env: GmailRuntimeEnv): Promise<CryptoKey> {
  if (!env.GMAIL_CREDENTIAL_ENCRYPTION_KEY) {
    throw new GmailConfigError("GMAIL_CREDENTIAL_ENCRYPTION_KEY is required");
  }
  const raw = fromBase64Flexible(env.GMAIL_CREDENTIAL_ENCRYPTION_KEY);
  if (raw.byteLength !== 32) {
    throw new GmailConfigError("GMAIL_CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes");
  }
  return crypto.subtle.importKey("raw", asBufferSource(raw), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt"
  ]);
}

function safeReturnTo(value: string | null, env: GmailRuntimeEnv): string | null {
  if (!value) return null;
  const allowedOrigin = env.DENTLINK_WEB_ORIGIN;
  try {
    const url = new URL(value);
    if (allowedOrigin && url.origin !== allowedOrigin) return null;
    return url.toString();
  } catch {
    return null;
  }
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
  if (error instanceof GmailConfigError) return "gmail_config_error";
  if (error instanceof StoreError) return error.code;
  return "gmail_sync_error";
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof GmailConfigError) return error.message;
  if (error instanceof StoreError) return error.message;
  if (error instanceof Error) return error.message;
  return "Gmail sync failed";
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function fromBase64Flexible(value: string): Uint8Array {
  return /[-_]/.test(value)
    ? fromBase64Url(value)
    : Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function asBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}
