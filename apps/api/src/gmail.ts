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
import {
  openImapClient,
  pollGmailImap,
  type GmailImapMessage,
  type GmailImapPollOptions,
  type GmailImapPollResult,
  type ImapSocket
} from "../../../packages/imap-client/src";
import {
  createOpenAIEmailAiClient,
  DEFAULT_EMAIL_AI_MAX_INPUT_CHARS,
  DEFAULT_EMAIL_AI_MODEL,
  EMAIL_AI_PROMPT_VERSION,
  emailContentHash,
  EmailAiError,
  normalizeEmailBody,
  type EmailAiClient
} from "../../../packages/ai/src";
import type {
  ConnectorAccount,
  ConnectorSourceRecord,
  ConnectorSyncAttempt,
  ConnectorSyncAttemptTrigger,
  EmailAttachmentMetadata,
  EmailAiSettings,
  EntityId,
  GmailDiagnostics,
  GmailRule,
  GmailRulesResponse,
  GmailSyncResult,
  EmailAiReprocessResult,
  Notification
} from "@dentlink/item-model";
import type { ConnectorDefinition } from "@dentlink/connector-sdk";

const GMAIL_CONNECTOR_KEY = "gmail";
const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_IMAP_SCOPE = "https://mail.google.com/";
const GMAIL_DEFAULT_SCOPE = GMAIL_READONLY_SCOPE;
const GMAIL_API_BASE_URL = "https://gmail.googleapis.com/gmail/v1";
const INITIAL_SYNC_PAGE_SIZE = 25;
const HISTORY_PAGE_SIZE = 100;
const GMAIL_DIAGNOSTIC_MESSAGE_LIMIT = 25;
const GMAIL_DIAGNOSTIC_ATTEMPT_LIMIT = 10;
const GMAIL_IMAP_RECENT_WINDOW_DAYS = 2;
const GMAIL_IMAP_MAX_MESSAGES = 1;
const GMAIL_IMAP_REFRESH_ALL_MAX_MESSAGES = 1;
const GMAIL_SCHEDULED_SYNC_STALE_MS = 5 * 60 * 1000;
const GMAIL_INTERACTIVE_SYNC_STALE_MS = 60 * 1000;
const GMAIL_IMAP_POLL_TIMEOUT_MS = 25 * 1000;
const GMAIL_IMAP_COMPARISON_TIMEOUT_MS = 8 * 1000;
const GMAIL_READONLY_RECONNECT_MESSAGE =
  "Reconnect Gmail to grant read-only mailbox access required for backfill.";
const GMAIL_IMAP_RECONNECT_MESSAGE =
  "Reconnect Gmail to grant full Gmail mailbox access required for IMAP sync.";
const GMAIL_RULES_SETTING_KEY = "gmailRulesJson";
const GMAIL_INGESTION_ENGINE_SETTING_KEY = "gmailIngestionEngine";
const EMAIL_AI_ENABLED_PREFERENCE_KEY = "email_ai_enabled";
const EMAIL_AI_PREFERENCES_KEY = "email_ai_preferences_v1";
const DEFAULT_IMPORTANCE_PROMPT =
  "Prioritize messages that need my action, affect scheduling, billing, safety, family, healthcare, work commitments, travel, or account security. Lower the score for routine marketing, receipts without action, newsletters, automated confirmations, and FYI-only updates.";
const DEFAULT_SUMMARY_PROMPT = "";

type EmailAiUserConfig = ReturnType<typeof emailAiConfig> & {
  importanceInstruction: string;
  summaryInstruction: string;
  textReplacements: NonNullable<EmailAiSettings["preferences"]>["textReplacements"];
  threshold: number;
};

type GmailOperation =
  | "gmail_token_refresh"
  | "gmail_messages_list"
  | "gmail_message_get"
  | "gmail_history_list"
  | "gmail_profile_get";

export type GmailRuntimeEnv = GoogleRuntimeEnv & {
  gmailClient?: GmailApiClient;
  gmailImapClient?: GmailImapClient;
  emailAiClient?: EmailAiClient;
  OPENAI_API_KEY?: string;
  DENTLINK_AI_ENABLED?: string;
  DENTLINK_AI_MODEL?: string;
  DENTLINK_AI_MAX_INPUT_CHARS?: string;
};

export type GmailIngestionEngine = "gmail_api" | "gmail_imap";

export type GmailImapClient = {
  poll(options: GmailImapPollOptions): Promise<GmailImapPollResult>;
  verify(options: Pick<GmailImapPollOptions, "user" | "accessToken" | "now">): Promise<void>;
};

export type GmailEngineUpdateInput = {
  expectedVersion: number;
  engine: GmailIngestionEngine;
  comparisonMode?: boolean;
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
  snippet?: string;
  payload?: GmailMessagePayloadPart;
};

type GmailMessagePayloadPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: {
    size?: number;
    data?: string;
    attachmentId?: string;
  };
  parts?: GmailMessagePayloadPart[];
};

type NormalizedGmailEmail = {
  sourceExternalId: string;
  providerItemId: string;
  threadId: string | null;
  historyId: string | null;
  messageId: string | null;
  internalDate: string | null;
  receivedAt: string;
  labels: string[];
  unread: boolean;
  sender: string;
  senderAddress: string;
  subject: string;
  recipients: string[];
  hasAttachment: boolean;
  attachments: EmailAttachmentMetadata[];
  automatedSender: boolean;
  mailingList: boolean;
  permalink: string | null;
  normalizedBody: string;
  normalizedBodyHash: string | null;
  htmlPresent: boolean;
  imapUid: string | null;
  imapUidValidity: string | null;
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
  const scope = await requestedGmailOAuthScope(store, userId, url);
  const authorizationUrl = new URL(GOOGLE_OAUTH_AUTHORIZE_URL);
  authorizationUrl.searchParams.set("client_id", config.clientId);
  authorizationUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", scope);
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
    const targetAccount = stateRecord.reconnectAccountId
      ? await store.getConnectorAccount(stateRecord.userId, stateRecord.reconnectAccountId)
      : null;
    const targetEngine =
      targetAccount && targetAccount.connectorKey === GMAIL_CONNECTOR_KEY
        ? requestedGmailIngestionEngine(targetAccount.settings)
        : "gmail_api";
    const requiredScope = targetEngine === "gmail_imap" ? GMAIL_IMAP_SCOPE : GMAIL_READONLY_SCOPE;
    if (!grantedScopes.includes(requiredScope)) {
      throw new StoreError(
        "gmail_permission_denied",
        targetEngine === "gmail_imap"
          ? GMAIL_IMAP_RECONNECT_MESSAGE
          : GMAIL_READONLY_RECONNECT_MESSAGE
      );
    }
    if (!token.refreshToken) {
      throw new StoreError(
        "missing_refresh_token",
        "Google did not issue an upgraded offline Gmail credential. Reconnect Gmail and approve read-only mailbox access."
      );
    }
    if (targetEngine === "gmail_api") {
      await verifyGmailReadonlyCapability(gmail, token.accessToken, now);
    }
    const profile = await gmail.getProfile(token.accessToken);
    if (targetEngine === "gmail_imap") {
      await verifyGmailImapCapability(env, profile.emailAddress, token.accessToken, now);
    }
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
            googleEmail: profile.emailAddress,
            [GMAIL_INGESTION_ENGINE_SETTING_KEY]: targetEngine,
            gmailRequestedIngestionEngine: targetEngine
          },
          grantedScopes.join(" "),
          requiredScope
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
  now: string,
  trigger: ConnectorSyncAttemptTrigger = "manual"
): Promise<GmailSyncResult> {
  const account = await requireGmailAccount(store, userId, accountId);
  const startedAtIso = now;
  const startedAt = Date.now();
  const engine = gmailIngestionEngine(account.settings);
  const staleAfterMs = gmailSyncStaleMs(trigger);
  if (account.syncStatus === "syncing" && !isStaleGmailSync(account, now, staleAfterMs)) {
    const lockReferenceAt = gmailSyncLockReferenceAt(account);
    await recordGmailSyncAttempt(store, userId, account, {
      trigger,
      engine,
      status: "skipped",
      startedAt: startedAtIso,
      completedAt: now,
      durationMs: Date.now() - startedAt,
      errorCode: "sync_in_progress",
      errorMessage: "Gmail sync is already in progress",
      summary: null,
      details: gmailAttemptDetails(account, {
        operation: "incremental",
        skippedReason: "fresh_sync_in_progress",
        lockReferenceAt,
        lockAgeMs: lockAgeMs(lockReferenceAt, now),
        staleAfterMs
      })
    });
    throw new StoreError("sync_in_progress", "Gmail sync is already in progress");
  }
  const syncing =
    trigger === "refresh_all"
      ? account
      : await store.updateConnectorAccount(
          userId,
          account.id,
          account.version,
          { syncStatus: "syncing", lastHealthAt: now, errorCode: null, errorMessage: null },
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
    if (gmailIngestionEngine(syncing.settings) === "gmail_imap") {
      return syncGmailImapAccount(
        store,
        userId,
        syncing,
        env,
        token.accessToken,
        startedAtIso,
        startedAt,
        now,
        trigger
      );
    }
    const messages = await messagesForSync(gmail, token.accessToken, syncing.syncCursor);
    const result = await processGmailMessageIds(
      store,
      userId,
      syncing,
      gmail,
      token.accessToken,
      messages.messageIds,
      env,
      now
    );
    const latest = await store.getConnectorAccount(userId, account.id);
    if (!latest) throw new StoreError("not_found", "Gmail account not found");
    const summary = summarizeGmailOutcomes(messages.messageIds.length, result.outcomes);
    const elapsedMs = Date.now() - startedAt;
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
          withGmailEngineDiagnostics(
            latest.settings,
            "gmail_api",
            now,
            failed.length > 0 ? "partial" : "success",
            summary,
            elapsedMs
          ),
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
    await recordGmailSyncAttempt(store, userId, updated, {
      trigger,
      engine: "gmail_api",
      status: failed.length > 0 ? "partial" : "success",
      startedAt: startedAtIso,
      completedAt: now,
      durationMs: elapsedMs,
      errorCode: failed.length > 0 ? "gmail_partial_sync_failed" : null,
      errorMessage:
        failed.length > 0
          ? `${failed.length} Gmail message${failed.length === 1 ? "" : "s"} failed processing`
          : null,
      summary,
      details: gmailAttemptDetails(updated, {
        operation: "incremental",
        requestedMessageIds: messages.messageIds,
        outcomes: result.outcomes,
        cursorAdvanced: nextCursor !== syncing.syncCursor,
        cursorBeforePresent: Boolean(syncing.syncCursor),
        cursorAfterPresent: Boolean(nextCursor)
      })
    });
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
      const updated = await store.updateConnectorAccount(
        userId,
        latest.id,
        latest.version,
        {
          status: "connected",
          healthStatus: "degraded",
          syncStatus: "idle",
          lastHealthAt: now,
          settings: withGmailOperationFailure(latest.settings, "incremental", now, error),
          errorCode: gmailErrorCode(error),
          errorMessage: safeErrorMessage(error)
        },
        now
      );
      await recordGmailSyncAttempt(store, userId, updated ?? latest, {
        trigger,
        engine: gmailIngestionEngine(latest.settings),
        status: "failed",
        startedAt: startedAtIso,
        completedAt: now,
        durationMs: Date.now() - startedAt,
        errorCode: gmailErrorCode(error),
        errorMessage: safeErrorMessage(error),
        summary: null,
        details: gmailAttemptDetails(updated ?? latest, {
          operation: "incremental",
          failureName: error instanceof Error ? error.name : typeof error
        })
      });
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
  const startedAtIso = now;
  const startedAt = Date.now();
  const syncing = await store.updateConnectorAccount(
    userId,
    account.id,
    account.version,
    { syncStatus: "syncing", lastHealthAt: now, errorCode: null, errorMessage: null },
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
      env,
      now
    );
    const latest = await store.getConnectorAccount(userId, account.id);
    if (!latest) throw new StoreError("not_found", "Gmail account not found");
    const summary = summarizeGmailOutcomes(messages.messageIds.length, result.outcomes);
    const elapsedMs = Date.now() - startedAt;
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
    await recordGmailSyncAttempt(store, userId, updated, {
      trigger: "backfill",
      engine: "gmail_api",
      status: failed.length > 0 ? "partial" : "success",
      startedAt: startedAtIso,
      completedAt: now,
      durationMs: elapsedMs,
      errorCode: failed.length > 0 ? "gmail_partial_sync_failed" : null,
      errorMessage:
        failed.length > 0
          ? `${failed.length} Gmail message${failed.length === 1 ? "" : "s"} failed processing`
          : null,
      summary,
      details: gmailAttemptDetails(updated, {
        operation: "backfill",
        days: boundedDays,
        requestedMessageIds: messages.messageIds,
        outcomes: result.outcomes
      })
    });
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
      const updated = await store.updateConnectorAccount(
        userId,
        latest.id,
        latest.version,
        {
          status: "connected",
          healthStatus: "degraded",
          syncStatus: "idle",
          lastHealthAt: now,
          settings: withGmailOperationFailure(latest.settings, "backfill", now, error),
          errorCode: gmailErrorCode(error),
          errorMessage: safeErrorMessage(error)
        },
        now
      );
      await recordGmailSyncAttempt(store, userId, updated ?? latest, {
        trigger: "backfill",
        engine: gmailIngestionEngine(latest.settings),
        status: "failed",
        startedAt: startedAtIso,
        completedAt: now,
        durationMs: Date.now() - startedAt,
        errorCode: gmailErrorCode(error),
        errorMessage: safeErrorMessage(error),
        summary: null,
        details: gmailAttemptDetails(updated ?? latest, {
          operation: "backfill",
          days: boundedDays,
          failureName: error instanceof Error ? error.name : typeof error
        })
      });
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
  const records = await store.listConnectorSourceRecords(
    userId,
    account.id,
    GMAIL_DIAGNOSTIC_MESSAGE_LIMIT
  );
  const attempts = await store.listConnectorSyncAttempts(
    userId,
    account.id,
    GMAIL_DIAGNOSTIC_ATTEMPT_LIMIT
  );
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
    messages,
    attempts
  };
}

async function recordGmailSyncAttempt(
  store: DentLinkStore,
  userId: EntityId,
  account: ConnectorAccount,
  input: Omit<ConnectorSyncAttempt, "id" | "userId" | "accountId" | "connectorKey"> & {
    engine: "gmail_api" | "gmail_imap" | "unknown";
  }
): Promise<void> {
  try {
    await store.createConnectorSyncAttempt(userId, {
      accountId: account.id,
      connectorKey: GMAIL_CONNECTOR_KEY,
      ...input
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "gmail_sync_attempt_log_failed",
        accountId: account.id,
        errorCode: gmailErrorCode(error),
        message: safeErrorMessage(error)
      })
    );
  }
}

function gmailAttemptDetails(
  account: ConnectorAccount,
  details: Record<string, unknown>
): Record<string, unknown> {
  return {
    accountStatus: account.status,
    accountHealthStatus: account.healthStatus,
    accountSyncStatus: account.syncStatus,
    accountVersion: account.version,
    credentialStatus: account.credentialStatus,
    reconnectRequired: account.settings.gmailReconnectRequired === true,
    activeEngine: gmailIngestionEngine(account.settings),
    requestedEngine:
      account.settings.gmailRequestedIngestionEngine === "gmail_imap" ? "gmail_imap" : "gmail_api",
    readonlyGranted: account.settings.gmailReadonlyGranted === true,
    imapGranted: account.settings.gmailImapGranted === true,
    cursorPresent: Boolean(account.syncCursor),
    ...details
  };
}

export async function getGmailRules(
  store: DentLinkStore,
  userId: EntityId,
  accountId: EntityId
): Promise<GmailRulesResponse> {
  const account = await requireGmailAccount(store, userId, accountId);
  return { account, rules: gmailRulesFromSettings(account.settings) };
}

export async function updateGmailRules(
  store: DentLinkStore,
  userId: EntityId,
  accountId: EntityId,
  rules: GmailRule[],
  now: string
): Promise<GmailRulesResponse> {
  const account = await requireGmailAccount(store, userId, accountId);
  const normalized = normalizeGmailRules(rules);
  const updated = await store.updateConnectorAccount(
    userId,
    account.id,
    account.version,
    {
      settings: {
        ...account.settings,
        [GMAIL_RULES_SETTING_KEY]: JSON.stringify(normalized)
      }
    },
    now
  );
  if (!updated) throw new StoreError("not_found", "Gmail account not found");
  return { account: updated, rules: normalized };
}

export async function getEmailAiSettings(
  store: DentLinkStore,
  userId: EntityId,
  env: GmailRuntimeEnv,
  now: string
) {
  const config = await emailAiUserConfig(store, userId, env);
  const settings = await store.getAiUsageSettings(
    userId,
    {
      enabled: config.enabled,
      available: config.available,
      provider: "openai",
      model: config.model,
      maxInputChars: config.maxInputChars,
      unavailableReason: config.unavailableReason,
      estimatedCostThisMonth: null
    },
    now
  );
  return {
    ...settings,
    preferences: emailAiPreferencesFromStoredJson(
      await store.getUserPreference(userId, EMAIL_AI_PREFERENCES_KEY)
    )
  };
}

export async function updateEmailAiSettings(
  store: DentLinkStore,
  userId: EntityId,
  input: { enabled: boolean },
  env: GmailRuntimeEnv,
  now: string
) {
  await store.setUserPreference(
    userId,
    EMAIL_AI_ENABLED_PREFERENCE_KEY,
    input.enabled ? "true" : "false",
    now
  );
  return getEmailAiSettings(store, userId, env, now);
}

export async function updateGmailEngine(
  store: DentLinkStore,
  userId: EntityId,
  accountId: EntityId,
  input: GmailEngineUpdateInput,
  now: string
): Promise<ConnectorAccount> {
  const account = await requireGmailAccount(store, userId, accountId);
  if (input.engine === "gmail_api") {
    const updated = await store.updateConnectorAccount(
      userId,
      account.id,
      input.expectedVersion,
      {
        status: "connected",
        healthStatus: "healthy",
        syncStatus: "idle",
        lastHealthAt: now,
        settings: {
          ...account.settings,
          gmailIngestionEngine: "gmail_api",
          gmailRequestedIngestionEngine: "gmail_api",
          gmailImapComparisonMode: false,
          gmailReconnectRequired: knownGmailScopesMissReadonly(account.settings)
        },
        errorCode: null,
        errorMessage: null
      },
      now
    );
    if (!updated)
      throw new StoreError("version_mismatch", "Connector account changed on the server");
    return updated;
  }

  const comparisonMode = input.comparisonMode === true;
  const imapReady =
    account.settings.gmailImapGranted === true && !knownGmailScopesMissImap(account.settings);
  const updated = await store.updateConnectorAccount(
    userId,
    account.id,
    input.expectedVersion,
    {
      status: "connected",
      healthStatus: imapReady ? "healthy" : "degraded",
      syncStatus: "idle",
      lastHealthAt: now,
      settings: {
        ...account.settings,
        gmailRequestedIngestionEngine: "gmail_imap",
        gmailIngestionEngine: imapReady ? "gmail_imap" : gmailIngestionEngine(account.settings),
        gmailImapComparisonMode: comparisonMode,
        gmailReconnectRequired: !imapReady
      },
      errorCode: imapReady ? null : "gmail_imap_reconnect_required",
      errorMessage: imapReady ? null : GMAIL_IMAP_RECONNECT_MESSAGE
    },
    now
  );
  if (!updated) throw new StoreError("version_mismatch", "Connector account changed on the server");
  return updated;
}

export async function syncConnectedGmailAccounts(
  store: DentLinkStore,
  env: GmailRuntimeEnv,
  now: string
): Promise<{ attempted: number; succeeded: number; failed: number; skipped: number }> {
  const accounts = await store.listConnectorAccountsByKey(GMAIL_CONNECTOR_KEY);
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  for (const account of accounts) {
    if (!shouldAttemptGmailSync(account)) {
      skipped += 1;
      continue;
    }
    const staleAfterMs = gmailSyncStaleMs("scheduled");
    if (account.syncStatus === "syncing" && !isStaleGmailSync(account, now, staleAfterMs)) {
      const lockReferenceAt = gmailSyncLockReferenceAt(account);
      await recordGmailSyncAttempt(store, account.userId, account, {
        trigger: "scheduled",
        engine: gmailIngestionEngine(account.settings),
        status: "skipped",
        startedAt: now,
        completedAt: now,
        durationMs: 0,
        errorCode: "sync_in_progress",
        errorMessage: "Gmail sync is already in progress",
        summary: null,
        details: gmailAttemptDetails(account, {
          operation: "incremental",
          skippedReason: "fresh_sync_in_progress",
          lockReferenceAt,
          lockAgeMs: lockAgeMs(lockReferenceAt, now),
          staleAfterMs
        })
      });
      skipped += 1;
      continue;
    }
    attempted += 1;
    try {
      await syncGmailAccount(store, account.userId, account.id, env, now, "scheduled");
      succeeded += 1;
    } catch (error) {
      failed += 1;
      console.error(
        JSON.stringify({
          level: "error",
          event: "gmail_scheduled_sync_failed",
          accountId: account.id,
          errorCode: gmailErrorCode(error),
          message: safeErrorMessage(error)
        })
      );
    }
  }
  return { attempted, succeeded, failed, skipped };
}

function shouldAttemptGmailSync(account: ConnectorAccount): boolean {
  if (account.status === "connected") return true;
  return (
    account.status === "error" &&
    account.connectorKey === GMAIL_CONNECTOR_KEY &&
    account.credentialStatus === "configured"
  );
}

function gmailSyncStaleMs(trigger: ConnectorSyncAttemptTrigger): number {
  return trigger === "scheduled" ? GMAIL_SCHEDULED_SYNC_STALE_MS : GMAIL_INTERACTIVE_SYNC_STALE_MS;
}

function isStaleGmailSync(account: ConnectorAccount, now: string, staleAfterMs: number): boolean {
  const reference = Date.parse(gmailSyncLockReferenceAt(account) ?? "");
  const current = Date.parse(now);
  if (!Number.isFinite(reference) || !Number.isFinite(current)) return false;
  return current - reference >= staleAfterMs;
}

function gmailSyncLockReferenceAt(account: ConnectorAccount): string | null {
  return account.lastHealthAt ?? account.lastSyncAt ?? account.updatedAt ?? null;
}

function lockAgeMs(referenceAt: string | null, now: string): number | null {
  const reference = Date.parse(referenceAt ?? "");
  const current = Date.parse(now);
  if (!Number.isFinite(reference) || !Number.isFinite(current)) return null;
  return Math.max(0, current - reference);
}

async function withTimeout<T>(promise: Promise<T>, ms: number, timeoutValue: T): Promise<T>;
async function withTimeout<T>(promise: Promise<T>, ms: number, timeoutError: Error): Promise<T>;
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  timeoutResult: T | Error
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve, reject) => {
        timeoutId = setTimeout(() => {
          if (timeoutResult instanceof Error) reject(timeoutResult);
          else resolve(timeoutResult);
        }, ms);
      })
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
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
      url.searchParams.set("format", "full");
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

async function syncGmailImapAccount(
  store: DentLinkStore,
  userId: EntityId,
  account: ConnectorAccount,
  env: GmailRuntimeEnv,
  accessToken: string,
  startedAtIso: string,
  startedAtMs: number,
  now: string,
  trigger: ConnectorSyncAttemptTrigger
): Promise<GmailSyncResult> {
  if (knownGmailScopesMissImap(account.settings)) {
    throw new StoreError("gmail_permission_denied", GMAIL_IMAP_RECONNECT_MESSAGE);
  }
  const emailAddress =
    typeof account.settings.googleEmail === "string" ? account.settings.googleEmail : "";
  if (!emailAddress)
    throw new StoreError("gmail_profile_missing", "Gmail account email is missing");
  const imap = gmailImapClient(env);
  const newerThanUid = gmailImapNewerThanUid(account.settings);
  const poll = await withTimeout(
    imap.poll({
      user: emailAddress,
      accessToken,
      now,
      recentWindowDays: GMAIL_IMAP_RECENT_WINDOW_DAYS,
      maxMessages: gmailImapMaxMessages(trigger),
      newerThanUid,
      expectedUidValidity: gmailImapUidValidity(account.settings)
    }),
    GMAIL_IMAP_POLL_TIMEOUT_MS,
    new StoreError("gmail_imap_timeout", "Gmail IMAP sync timed out. Try again.")
  );
  const result = await processGmailImapMessages(store, userId, account, poll.messages, env, now);
  const latest = await store.getConnectorAccount(userId, account.id);
  if (!latest) throw new StoreError("not_found", "Gmail account not found");
  const summary = summarizeGmailOutcomes(poll.discoveredUids.length, result.outcomes);
  const failed = result.outcomes.filter((outcome) => outcome.status === "failed");
  const elapsedMs = Date.now() - startedAtMs;
  const comparison =
    latest.settings.gmailImapComparisonMode === true && !newerThanUid
      ? await withTimeout(
          gmailImapApiComparison(env, accessToken, account, poll, summary),
          GMAIL_IMAP_COMPARISON_TIMEOUT_MS,
          null
        )
      : null;
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
      settings: withGmailComparisonMetrics(
        withGmailImapCursor(
          withGmailImapSummary(
            withGmailOperationSummary(
              withGmailEngineDiagnostics(
                latest.settings,
                "gmail_imap",
                now,
                failed.length > 0 ? "partial" : "success",
                summary,
                elapsedMs
              ),
              "incremental",
              now,
              failed.length > 0 ? "partial" : "success",
              summary
            ),
            now,
            failed.length > 0 ? "partial" : "success",
            summary,
            elapsedMs
          ),
          failed.length === 0 ? poll : null
        ),
        comparison
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
  await recordGmailSyncAttempt(store, userId, updated, {
    trigger,
    engine: "gmail_imap",
    status: failed.length > 0 ? "partial" : "success",
    startedAt: startedAtIso,
    completedAt: now,
    durationMs: elapsedMs,
    errorCode: failed.length > 0 ? "gmail_partial_sync_failed" : null,
    errorMessage:
      failed.length > 0
        ? `${failed.length} Gmail message${failed.length === 1 ? "" : "s"} failed processing`
        : null,
    summary,
    details: gmailAttemptDetails(updated, {
      operation: "incremental",
      discoveredUids: poll.discoveredUids,
      fetchedCount: poll.messages.length,
      newerThanUid,
      uidValidity: poll.uidValidity,
      outcomes: result.outcomes,
      comparison
    })
  });
  return {
    account: updated,
    processed: summary.examined,
    createdNotifications: result.createdNotifications,
    summary,
    progress: gmailImapProgress(poll),
    outcomes: result.outcomes
  };
}

function gmailImapMaxMessages(trigger: ConnectorSyncAttemptTrigger): number {
  return trigger === "refresh_all" ? GMAIL_IMAP_REFRESH_ALL_MAX_MESSAGES : GMAIL_IMAP_MAX_MESSAGES;
}

function gmailImapProgress(poll: GmailImapPollResult): GmailSyncResult["progress"] {
  const discovered = poll.discoveredUids.length;
  const examined = poll.messages.length;
  const remaining = Math.max(0, discovered - examined);
  return {
    discovered,
    examined,
    remaining,
    hasMore: remaining > 0
  };
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
  env: GmailRuntimeEnv,
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
      const outcome = await ingestGmailMessage(store, userId, account, message, env, now);
      outcomes.push(outcome);
      if (outcome.status === "notification_created") createdNotifications += 1;
    } catch (error) {
      outcomes.push(await recordGmailMessageFailure(store, userId, account, messageId, error, now));
    }
  }
  return { createdNotifications, nextCursor, outcomes };
}

async function processGmailImapMessages(
  store: DentLinkStore,
  userId: EntityId,
  account: ConnectorAccount,
  messages: GmailImapMessage[],
  env: GmailRuntimeEnv,
  now: string
): Promise<{
  createdNotifications: number;
  outcomes: GmailSyncResult["outcomes"];
}> {
  let createdNotifications = 0;
  const outcomes: GmailSyncResult["outcomes"] = [];
  for (const message of messages) {
    try {
      const existingRecord = await store.findConnectorSourceRecord(
        userId,
        account.id,
        message.sourceExternalId
      );
      if (existingRecord && !shouldRetryGmailSourceRecord(existingRecord.status)) {
        outcomes.push(
          await recordGmailMessageDuplicate(store, userId, account, existingRecord, now)
        );
        continue;
      }
      const outcome = await ingestNormalizedGmailEmail(
        store,
        userId,
        account,
        normalizedGmailEmailFromImap(message, now),
        env,
        now
      );
      outcomes.push(outcome);
      if (outcome.status === "notification_created") createdNotifications += 1;
    } catch (error) {
      outcomes.push(
        await recordGmailMessageFailure(
          store,
          userId,
          account,
          message.sourceExternalId,
          error,
          now
        )
      );
    }
  }
  return { createdNotifications, outcomes };
}

async function ingestGmailMessage(
  store: DentLinkStore,
  userId: EntityId,
  account: ConnectorAccount,
  message: GmailMessage,
  env: GmailRuntimeEnv,
  now: string
): Promise<GmailSyncResult["outcomes"][number]> {
  return ingestNormalizedGmailEmail(
    store,
    userId,
    account,
    normalizedGmailEmailFromApi(message, now),
    env,
    now
  );
}

async function ingestNormalizedGmailEmail(
  store: DentLinkStore,
  userId: EntityId,
  account: ConnectorAccount,
  email: NormalizedGmailEmail,
  env: GmailRuntimeEnv,
  now: string
): Promise<GmailSyncResult["outcomes"][number]> {
  const context: GmailRuleContext = {
    sender: email.sender,
    senderAddress: email.senderAddress,
    senderDomain: email.senderAddress.includes("@")
      ? (email.senderAddress.split("@").pop() ?? "")
      : "",
    subject: email.subject,
    body: email.normalizedBody,
    labels: email.labels,
    recipients: email.recipients,
    hasAttachment: email.hasAttachment,
    unread: email.unread,
    automatedSender: email.automatedSender,
    mailingList: email.mailingList
  };
  const ruleDecision = evaluateGmailRules(gmailRulesFromSettings(account.settings), context);
  const bodyHash =
    email.normalizedBody.length > 0
      ? await hashSessionToken(`${email.subject}\n${email.senderAddress}\n${email.normalizedBody}`)
      : null;
  const emailMetadata = {
    accountId: account.id,
    provider: "gmail" as const,
    providerMessageId: email.providerItemId,
    messageId: email.messageId,
    xGmMsgId: email.sourceExternalId.startsWith("x-gm-msgid:")
      ? email.sourceExternalId.slice("x-gm-msgid:".length)
      : null,
    senderAddress: email.senderAddress,
    senderDisplayName: email.sender,
    recipients: email.recipients,
    subject: email.subject,
    receivedAt: email.receivedAt,
    labels: email.labels,
    unread: email.unread,
    automatedSender: email.automatedSender,
    mailingList: email.mailingList,
    attachments: email.attachments,
    snippet: email.normalizedBody.slice(0, 300),
    normalizedBodyHash: bodyHash,
    sourceUrl: email.permalink
  };
  const ruleMetadata = {
    ruleId: ruleDecision.rule?.id ?? null,
    ruleName: ruleDecision.rule?.name ?? null,
    action: ruleDecision.action,
    category: ruleDecision.category ?? null,
    tag: ruleDecision.tag ?? null,
    explanation: ruleDecision.rule
      ? `${gmailRuleActionLabel(ruleDecision.action)} rule matched: ${ruleDecision.rule.name}`
      : "No sorting rule matched; default notify action applied."
  };
  const normalizedPayload = {
    provider: "gmail",
    provider_item_id: email.providerItemId,
    history_id: email.historyId,
    thread_id: email.threadId,
    message_id: email.messageId,
    internal_date: email.internalDate,
    imap_uid: email.imapUid,
    imap_uid_validity: email.imapUidValidity,
    received_at: email.receivedAt,
    labels: email.labels,
    unread: email.unread,
    sender: email.sender,
    sender_address: email.senderAddress,
    subject: email.subject,
    recipients: email.recipients,
    has_attachment: email.hasAttachment,
    attachments: email.attachments,
    automated_sender: email.automatedSender,
    mailing_list: email.mailingList,
    html_present: email.htmlPresent,
    snippet: email.normalizedBody.slice(0, 500),
    normalized_body_hash: bodyHash,
    matched_rule_id: ruleDecision.rule?.id ?? null,
    matched_rule_name: ruleDecision.rule?.name ?? null,
    matched_rule_action: ruleDecision.action,
    assigned_category: ruleDecision.category ?? null,
    assigned_tag: ruleDecision.tag ?? null,
    permalink: email.permalink,
    connector_account: account.id
  };
  const payloadHash = await hashSessionToken(JSON.stringify(normalizedPayload));
  const { record, created } = await store.createConnectorSourceRecordIfAbsent(
    userId,
    {
      accountId: account.id,
      sourceExternalId: email.sourceExternalId,
      sourceType: "email",
      payloadHash,
      normalizedPayload
    },
    now
  );
  if (!created && record.status !== "failed") {
    return recordGmailMessageDuplicate(store, userId, account, record, now);
  }
  if (ruleDecision.action === "suppress") {
    const updatedRecord = await store.updateConnectorSourceRecordProcessing(
      userId,
      account.id,
      email.sourceExternalId,
      {
        status: "notification_suppressed",
        processingReason: ruleDecision.rule
          ? `Suppressed by Gmail rule: ${ruleDecision.rule.name}`
          : "Suppressed by Gmail rule",
        normalizedPayload,
        payloadHash
      },
      now
    );
    return {
      messageId: email.sourceExternalId,
      status: "notification_suppressed",
      reason: updatedRecord.processingReason ?? "Suppressed by Gmail rule",
      recordId: updatedRecord.id
    };
  }
  const severity = gmailNotificationSeverity(ruleDecision.action, email.unread);
  const notification = await store.createNotification(
    userId,
    {
      title: email.subject,
      summary:
        email.normalizedBody.slice(0, 240) || `${email.sender}${email.unread ? " · unread" : ""}`,
      body: ruleMetadata.explanation,
      source: "connector",
      sourceLabel: "Gmail",
      sourceUrl: email.permalink,
      severity,
      rank: notificationRankForRule(ruleDecision.action),
      email: emailMetadata,
      rule: ruleMetadata,
      ai: await initialEmailAiMetadata(store, userId, account.id, env, email, now)
    },
    now
  );
  const enrichedNotification = await maybeProcessEmailAi(
    store,
    userId,
    notification,
    email,
    account.id,
    env,
    now
  );
  const updatedPayload = {
    ...normalizedPayload,
    notification_id: enrichedNotification.id,
    ai_status: enrichedNotification.ai.status,
    ai_model: enrichedNotification.ai.model,
    ai_content_hash: enrichedNotification.ai.contentHash
  };
  const updatedRecord = await store.updateConnectorSourceRecordProcessing(
    userId,
    account.id,
    email.sourceExternalId,
    {
      status: "notification_created",
      processingReason: "Created a Gmail notification",
      normalizedPayload: updatedPayload,
      payloadHash: await hashSessionToken(JSON.stringify(updatedPayload))
    },
    now
  );
  return {
    messageId: email.sourceExternalId,
    status: "notification_created",
    reason: updatedRecord.processingReason ?? "Created a Gmail notification",
    recordId: updatedRecord.id
  };
}

function normalizedGmailEmailFromApi(message: GmailMessage, now: string): NormalizedGmailEmail {
  const headers = headersByName(message);
  const subject = headers.get("subject") ?? "(no subject)";
  const sender = headers.get("from") ?? "Unknown sender";
  const senderAddress = emailAddressFromHeader(sender);
  const messageId = headers.get("message-id") ?? null;
  const recipients = [
    ...(headers.get("to") ? [headers.get("to") ?? ""] : []),
    ...(headers.get("cc") ? [headers.get("cc") ?? ""] : [])
  ];
  const receivedAt = message.internalDate
    ? new Date(Number(message.internalDate)).toISOString()
    : now;
  const unread = message.labelIds?.includes("UNREAD") ?? false;
  const body = gmailMessageBody(message);
  return {
    sourceExternalId: message.id,
    providerItemId: message.id,
    threadId: message.threadId,
    historyId: message.historyId ?? null,
    messageId,
    internalDate: message.internalDate ?? null,
    receivedAt,
    labels: message.labelIds ?? [],
    unread,
    sender,
    senderAddress,
    subject,
    recipients,
    hasAttachment: gmailMessageHasAttachment(message),
    attachments: [],
    automatedSender: isAutomatedSender(headers),
    mailingList: isMailingList(headers),
    permalink: gmailPermalink(message.threadId),
    normalizedBody: body.normalizedBody,
    normalizedBodyHash: null,
    htmlPresent: body.htmlPresent,
    imapUid: null,
    imapUidValidity: null
  };
}

function normalizedGmailEmailFromImap(
  message: GmailImapMessage,
  now: string
): NormalizedGmailEmail {
  const headers = message.parsed.headers;
  const subject = message.parsed.subject ?? "(no subject)";
  const sender = message.parsed.from ?? "Unknown sender";
  const senderAddress = emailAddressFromHeader(sender);
  const recipients = [
    ...(message.parsed.to ? [message.parsed.to] : []),
    ...(message.parsed.cc ? [message.parsed.cc] : [])
  ];
  const receivedAt = message.parsed.date ? validIsoOrFallback(message.parsed.date, now) : now;
  const normalizedBody = normalizeEmailBody({
    plainText: message.parsed.plainText,
    html: message.parsed.html,
    maxChars: DEFAULT_EMAIL_AI_MAX_INPUT_CHARS
  });
  return {
    sourceExternalId: message.sourceExternalId,
    providerItemId: message.sourceExternalId,
    threadId: null,
    historyId: null,
    messageId: message.parsed.messageId ?? message.identifiers.messageId,
    internalDate: message.identifiers.internalDate,
    receivedAt,
    labels: [],
    unread: false,
    sender,
    senderAddress,
    subject,
    recipients,
    hasAttachment: message.parsed.attachments.length > 0,
    attachments: message.parsed.attachments,
    automatedSender: isAutomatedSender(headers),
    mailingList: isMailingList(headers),
    permalink: "https://mail.google.com/mail/u/0/#inbox",
    normalizedBody,
    normalizedBodyHash: null,
    htmlPresent: Boolean(message.parsed.html),
    imapUid: message.uid,
    imapUidValidity: message.identifiers.uidValidity
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

export async function reprocessSameDayEmailAi(
  store: DentLinkStore,
  userId: EntityId,
  env: GmailRuntimeEnv,
  input: { timezone: string; accountId?: EntityId | null },
  now: string
): Promise<EmailAiReprocessResult> {
  const startedAt = now;
  const day = dateKeyInTimeZone(now, input.timezone);
  const accounts = (await store.listConnectorAccounts(userId)).accounts.filter(
    (account) =>
      account.connectorKey === GMAIL_CONNECTOR_KEY &&
      account.status !== "deleted" &&
      (!input.accountId || account.id === input.accountId)
  );
  const notifications = (await store.listNotifications(userId)).notifications;
  const notificationsById = new Map(
    notifications.map((notification) => [notification.id, notification])
  );
  const result: EmailAiReprocessResult = {
    id: crypto.randomUUID(),
    startedAt,
    completedAt: startedAt,
    timezone: input.timezone,
    day,
    status: "success",
    processed: 0,
    updated: 0,
    suppressed: 0,
    restored: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };
  for (const account of accounts) {
    const records = await store.listConnectorSourceRecords(userId, account.id);
    for (const record of records) {
      if (record.sourceType !== "email") continue;
      const email = normalizedGmailEmailFromSourceRecord(record, now);
      if (!email || dateKeyInTimeZone(email.receivedAt, input.timezone) !== day) continue;
      const notificationId =
        typeof record.normalizedPayload.notification_id === "string"
          ? record.normalizedPayload.notification_id
          : null;
      const notification = notificationId ? notificationsById.get(notificationId) : null;
      if (!notification || notification.status === "deleted") {
        result.skipped += 1;
        continue;
      }
      try {
        const updated = await reprocessNotificationAi(
          store,
          userId,
          account.id,
          notification,
          email,
          env,
          now
        );
        notificationsById.set(updated.id, updated);
        const payload = {
          ...record.normalizedPayload,
          ai_status: updated.ai.status,
          ai_model: updated.ai.model,
          ai_content_hash: updated.ai.contentHash
        };
        await store.updateConnectorSourceRecordProcessing(
          userId,
          account.id,
          record.sourceExternalId,
          {
            status: "notification_updated",
            processingReason: "Reprocessed same-day AI metadata",
            normalizedPayload: payload,
            payloadHash: await hashSessionToken(JSON.stringify(payload))
          },
          now
        );
        result.processed += 1;
        result.updated += 1;
        if (updated.status === "suppressed") result.suppressed += 1;
        if (notification.status === "suppressed" && updated.status === "active")
          result.restored += 1;
      } catch (error) {
        result.failed += 1;
        result.errors.push({
          recordId: record.id,
          messageId: record.sourceExternalId,
          code:
            error instanceof EmailAiError
              ? error.code
              : error instanceof StoreError
                ? error.code
                : "ai_reprocess_failed",
          message: safeAiMessage(error instanceof Error ? error.message : "AI reprocessing failed.")
        });
      }
    }
  }
  result.completedAt = new Date().toISOString();
  result.status = result.failed === 0 ? "success" : result.updated > 0 ? "partial" : "failed";
  return result;
}

async function reprocessNotificationAi(
  store: DentLinkStore,
  userId: EntityId,
  accountId: EntityId,
  notification: Notification,
  email: NormalizedGmailEmail,
  env: GmailRuntimeEnv,
  now: string
): Promise<Notification> {
  const config = await emailAiUserConfig(store, userId, env, accountId);
  if (!config.enabled) {
    if (notification.ai.status === "disabled") return notification;
    return store.updateNotification(
      userId,
      notification.id,
      notification.version,
      { ai: notificationAiState("disabled", config.model) },
      now
    );
  }
  if (!email.normalizedBody.trim()) {
    if (notification.ai.status === "skipped") return notification;
    return store.updateNotification(
      userId,
      notification.id,
      notification.version,
      { ai: notificationAiState("skipped", config.model, now) },
      now
    );
  }
  const inputBody = email.normalizedBody.slice(0, config.maxInputChars);
  const contentHash = await emailContentHash({
    subject: email.subject,
    body: inputBody,
    sender: email.senderAddress,
    promptVersion: emailAiPromptFingerprint(config),
    model: config.model
  });
  if (
    notification.ai.status === "complete" &&
    notification.ai.contentHash === contentHash &&
    notification.ai.importance !== null
  ) {
    const status = thresholdStatus(
      notification.status,
      notification.ai.importance,
      config.threshold
    );
    if (status === notification.status) return notification;
    return store.updateNotification(userId, notification.id, notification.version, { status }, now);
  }
  const client =
    env.emailAiClient ?? createOpenAIEmailAiClient({ apiKey: config.apiKey, model: config.model });
  const ai = await client.summarizeEmail({
    sender: email.sender,
    subject: email.subject,
    body: inputBody,
    receivedAt: email.receivedAt,
    labels: email.labels,
    importanceInstruction: config.importanceInstruction,
    summaryInstruction: config.summaryInstruction
  });
  const title = applyEmailAiTextReplacements(email.subject, config.textReplacements);
  const summary = applyEmailAiTextReplacements(ai.summary, config.textReplacements);
  await store.recordAiUsage(
    userId,
    {
      provider: "openai",
      model: config.model,
      inputChars: inputBody.length,
      outputTokens: ai.outputTokens,
      failed: false
    },
    now
  );
  return store.updateNotification(
    userId,
    notification.id,
    notification.version,
    {
      title,
      email: notification.email ? { ...notification.email, subject: title } : notification.email,
      summary,
      severity: ai.requiresAction || ai.importance >= 75 ? "high" : notification.severity,
      rank: notification.rank + Math.round(ai.importance / 2),
      status: thresholdStatus(notification.status, ai.importance, config.threshold),
      ai: {
        status: "complete",
        model: config.model,
        promptVersion: EMAIL_AI_PROMPT_VERSION,
        processedAt: now,
        inputChars: inputBody.length,
        outputTokens: ai.outputTokens,
        contentHash,
        summary,
        category: ai.category,
        importance: ai.importance,
        requiresAction: ai.requiresAction,
        suggestedAction: ai.suggestedAction,
        deadline: ai.deadline,
        reason: ai.reason,
        errorCode: null,
        errorMessage: null
      }
    },
    now
  );
}

function normalizedGmailEmailFromSourceRecord(
  record: ConnectorSourceRecord,
  now: string
): NormalizedGmailEmail | null {
  const payload = record.normalizedPayload;
  if (payload.provider !== "gmail") return null;
  const subject = stringPayload(payload.subject, "(no subject)");
  const sender = stringPayload(payload.sender, "Unknown sender");
  const senderAddress = stringPayload(payload.sender_address, emailAddressFromHeader(sender));
  const receivedAt = validIsoOrFallback(stringPayload(payload.received_at, now), now);
  return {
    sourceExternalId: record.sourceExternalId,
    providerItemId: stringPayload(payload.provider_item_id, record.sourceExternalId),
    threadId: stringPayload(payload.thread_id, "") || null,
    historyId: stringPayload(payload.history_id, "") || null,
    messageId: stringPayload(payload.message_id, "") || null,
    internalDate: stringPayload(payload.internal_date, "") || null,
    receivedAt,
    labels: Array.isArray(payload.labels)
      ? payload.labels.filter((item): item is string => typeof item === "string")
      : [],
    unread: payload.unread === true,
    sender,
    senderAddress,
    subject,
    recipients: Array.isArray(payload.recipients)
      ? payload.recipients.filter((item): item is string => typeof item === "string")
      : [],
    hasAttachment: payload.has_attachment === true,
    attachments: Array.isArray(payload.attachments)
      ? (payload.attachments as EmailAttachmentMetadata[])
      : [],
    automatedSender: payload.automated_sender === true,
    mailingList: payload.mailing_list === true,
    permalink: stringPayload(payload.permalink, "") || null,
    normalizedBody:
      stringPayload(payload.normalized_body, "") || stringPayload(payload.snippet, ""),
    normalizedBodyHash: stringPayload(payload.normalized_body_hash, "") || null,
    htmlPresent: payload.html_present === true,
    imapUid: stringPayload(payload.imap_uid, "") || null,
    imapUidValidity: stringPayload(payload.imap_uid_validity, "") || null
  };
}

function stringPayload(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function dateKeyInTimeZone(iso: string, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(new Date(iso));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function summarizeGmailOutcomes(
  discovered: number,
  outcomes: GmailSyncResult["outcomes"]
): GmailSyncResult["summary"] {
  const summary = emptyGmailSummary(discovered, outcomes.length);
  for (const outcome of outcomes) {
    if (outcome.status === "notification_created") summary.created += 1;
    if (outcome.status === "notification_updated") summary.updated += 1;
    if (outcome.status === "notification_suppressed") summary.filtered += 1;
    if (outcome.status === "notification_grouped") summary.skipped += 1;
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
    if (message.outcome === "notification_suppressed") summary.filtered += 1;
    if (message.outcome === "notification_grouped") summary.skipped += 1;
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
    status === "notification_suppressed" ||
    status === "notification_grouped" ||
    status === "skipped" ||
    status === "duplicate" ||
    status === "filtered" ||
    status === "failed"
  );
}

type GmailRuleContext = {
  sender: string;
  senderAddress: string;
  senderDomain: string;
  subject: string;
  body: string;
  labels: string[];
  recipients: string[];
  hasAttachment: boolean;
  unread: boolean;
  automatedSender: boolean;
  mailingList: boolean;
};

type GmailRuleDecision = {
  action: GmailRule["action"];
  rule: GmailRule | null;
  category?: string;
  tag?: string;
};

function gmailRulesFromSettings(settings: ConnectorAccount["settings"]): GmailRule[] {
  const raw = settings[GMAIL_RULES_SETTING_KEY];
  if (typeof raw !== "string" || raw.trim().length === 0) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeGmailRules(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
}

function normalizeGmailRules(rules: unknown[]): GmailRule[] {
  return rules
    .slice(0, 50)
    .map((rule, index) => {
      const object = rule && typeof rule === "object" ? (rule as Record<string, unknown>) : {};
      const action = gmailRuleAction(object.action);
      const matchMode: GmailRule["matchMode"] = object.matchMode === "any" ? "any" : "all";
      return {
        id: stringValue(object.id) ?? `gmail-rule-${index + 1}`,
        name: stringValue(object.name) ?? `Gmail rule ${index + 1}`,
        enabled: object.enabled === undefined ? true : object.enabled === true,
        priority: numberValue(object.priority) ?? index + 1,
        matchMode,
        senderAddress: stringValue(object.senderAddress),
        senderDomain: stringValue(object.senderDomain),
        subjectContains: stringValue(object.subjectContains),
        gmailLabel: stringValue(object.gmailLabel),
        recipient: stringValue(object.recipient),
        bodyContains: stringValue(object.bodyContains),
        hasAttachment: booleanValue(object.hasAttachment),
        unread: booleanValue(object.unread),
        automatedSender: booleanValue(object.automatedSender),
        mailingList: booleanValue(object.mailingList),
        alwaysNotify: booleanValue(object.alwaysNotify),
        neverNotify: booleanValue(object.neverNotify),
        action,
        category: stringValue(object.category),
        tag: stringValue(object.tag)
      };
    })
    .sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0));
}

function gmailRuleAction(value: unknown): GmailRule["action"] {
  if (
    value === "notify" ||
    value === "suppress" ||
    value === "low_priority" ||
    value === "high_priority" ||
    value === "assign_category" ||
    value === "assign_tag"
  ) {
    return value;
  }
  return "notify";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().slice(0, 200)
    : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function evaluateGmailRules(rules: GmailRule[], context: GmailRuleContext): GmailRuleDecision {
  const rule = rules.find((candidate) => candidate.enabled && gmailRuleMatches(candidate, context));
  if (!rule) return { action: "notify", rule: null };
  if (rule.neverNotify) return { action: "suppress", rule, category: rule.category };
  if (rule.alwaysNotify) return { action: "notify", rule, category: rule.category };
  return { action: rule.action, rule, category: rule.category, tag: rule.tag };
}

function gmailRuleMatches(rule: GmailRule, context: GmailRuleContext): boolean {
  if (rule.alwaysNotify || rule.neverNotify) return true;
  const conditions = [
    rule.senderAddress ? equalsIgnoreCase(context.senderAddress, rule.senderAddress) : null,
    rule.senderDomain ? equalsIgnoreCase(context.senderDomain, rule.senderDomain) : null,
    rule.subjectContains ? includesIgnoreCase(context.subject, rule.subjectContains) : null,
    rule.bodyContains ? includesIgnoreCase(context.body, rule.bodyContains) : null,
    rule.gmailLabel
      ? context.labels.some((label) => equalsIgnoreCase(label, rule.gmailLabel ?? ""))
      : null,
    rule.recipient
      ? context.recipients.some((recipient) => includesIgnoreCase(recipient, rule.recipient ?? ""))
      : null,
    rule.hasAttachment !== undefined ? context.hasAttachment === rule.hasAttachment : null,
    rule.unread !== undefined ? context.unread === rule.unread : null,
    rule.automatedSender !== undefined ? context.automatedSender === rule.automatedSender : null,
    rule.mailingList !== undefined ? context.mailingList === rule.mailingList : null
  ].filter((value): value is boolean => value !== null);
  if (conditions.length === 0) return false;
  return rule.matchMode === "any" ? conditions.some(Boolean) : conditions.every(Boolean);
}

function gmailNotificationSeverity(
  action: GmailRule["action"],
  unread: boolean
): "info" | "low" | "medium" | "high" {
  if (action === "low_priority") return "low";
  if (action === "high_priority") return "high";
  return unread ? "medium" : "info";
}

function notificationRankForRule(action: GmailRule["action"]): number {
  if (action === "high_priority") return 90;
  if (action === "low_priority") return -20;
  return 0;
}

function gmailRuleActionLabel(action: GmailRule["action"]): string {
  if (action === "high_priority") return "High priority";
  if (action === "low_priority") return "Low priority";
  if (action === "suppress") return "Suppress";
  if (action === "assign_category") return "Category";
  if (action === "assign_tag") return "Tag";
  return "Notify";
}

async function initialEmailAiMetadata(
  store: DentLinkStore,
  userId: EntityId,
  accountId: EntityId,
  env: GmailRuntimeEnv,
  email: NormalizedGmailEmail,
  now: string
): Promise<Notification["ai"]> {
  const config = await emailAiUserConfig(store, userId, env, accountId);
  if (!config.enabled) return notificationAiState("disabled", config.model);
  if (!email.normalizedBody.trim()) return notificationAiState("skipped", config.model, now);
  return notificationAiState("pending", config.model);
}

async function maybeProcessEmailAi(
  store: DentLinkStore,
  userId: EntityId,
  notification: Notification,
  email: NormalizedGmailEmail,
  accountId: EntityId,
  env: GmailRuntimeEnv,
  now: string
): Promise<Notification> {
  const config = await emailAiUserConfig(store, userId, env, accountId);
  if (!config.enabled || notification.ai.status !== "pending") return notification;
  const inputBody = email.normalizedBody.slice(0, config.maxInputChars);
  const contentHash = await emailContentHash({
    subject: email.subject,
    body: inputBody,
    sender: email.senderAddress,
    promptVersion: emailAiPromptFingerprint(config),
    model: config.model
  });
  try {
    const client =
      env.emailAiClient ??
      createOpenAIEmailAiClient({ apiKey: config.apiKey, model: config.model });
    const result = await client.summarizeEmail({
      sender: email.sender,
      subject: email.subject,
      body: inputBody,
      receivedAt: email.receivedAt,
      labels: email.labels,
      importanceInstruction: config.importanceInstruction,
      summaryInstruction: config.summaryInstruction
    });
    const title = applyEmailAiTextReplacements(email.subject, config.textReplacements);
    const summary = applyEmailAiTextReplacements(result.summary, config.textReplacements);
    await store.recordAiUsage(
      userId,
      {
        provider: "openai",
        model: config.model,
        inputChars: inputBody.length,
        outputTokens: result.outputTokens,
        failed: false
      },
      now
    );
    return store.updateNotification(
      userId,
      notification.id,
      notification.version,
      {
        title,
        email: notification.email ? { ...notification.email, subject: title } : notification.email,
        summary,
        severity: result.requiresAction || result.importance >= 75 ? "high" : notification.severity,
        rank: notification.rank + Math.round(result.importance / 2),
        status: thresholdStatus(notification.status, result.importance, config.threshold),
        ai: {
          status: "complete",
          model: config.model,
          promptVersion: EMAIL_AI_PROMPT_VERSION,
          processedAt: now,
          inputChars: inputBody.length,
          outputTokens: result.outputTokens,
          contentHash,
          summary,
          category: result.category,
          importance: result.importance,
          requiresAction: result.requiresAction,
          suggestedAction: result.suggestedAction,
          deadline: result.deadline,
          reason: result.reason,
          errorCode: null,
          errorMessage: null
        }
      },
      now
    );
  } catch (error) {
    const code = error instanceof EmailAiError ? error.code : "ai_failed";
    const message = error instanceof Error ? error.message : "AI processing failed.";
    await store.recordAiUsage(
      userId,
      {
        provider: "openai",
        model: config.model,
        inputChars: inputBody.length,
        outputTokens: null,
        failed: true
      },
      now
    );
    return store.updateNotification(
      userId,
      notification.id,
      notification.version,
      {
        ai: {
          status: "failed",
          model: config.model,
          promptVersion: EMAIL_AI_PROMPT_VERSION,
          processedAt: now,
          inputChars: inputBody.length,
          outputTokens: null,
          contentHash,
          summary: null,
          category: null,
          importance: null,
          requiresAction: null,
          suggestedAction: null,
          deadline: null,
          reason: null,
          errorCode: code,
          errorMessage: safeAiMessage(message)
        }
      },
      now
    );
  }
}

function notificationAiState(
  status: Notification["ai"]["status"],
  model: string | null,
  processedAt: string | null = null
): Notification["ai"] {
  return {
    status,
    model,
    promptVersion: status === "disabled" ? null : EMAIL_AI_PROMPT_VERSION,
    processedAt,
    inputChars: null,
    outputTokens: null,
    contentHash: null,
    summary: null,
    category: null,
    importance: null,
    requiresAction: null,
    suggestedAction: null,
    deadline: null,
    reason: null,
    errorCode: null,
    errorMessage: null
  };
}

function emailAiConfig(env: GmailRuntimeEnv): {
  enabled: boolean;
  available: boolean;
  apiKey: string;
  model: string;
  maxInputChars: number;
  unavailableReason: string | null;
} {
  const apiKey = env.OPENAI_API_KEY ?? "";
  const globallyDisabled = env.DENTLINK_AI_ENABLED === "false";
  const available = apiKey.length > 0 && !globallyDisabled;
  const maxInputChars = Number.parseInt(env.DENTLINK_AI_MAX_INPUT_CHARS ?? "", 10);
  return {
    enabled: available,
    available,
    apiKey,
    model: env.DENTLINK_AI_MODEL || DEFAULT_EMAIL_AI_MODEL,
    unavailableReason:
      apiKey.length === 0 ? "missing_api_key" : globallyDisabled ? "disabled_by_environment" : null,
    maxInputChars:
      Number.isFinite(maxInputChars) && maxInputChars > 0
        ? Math.min(maxInputChars, 20_000)
        : DEFAULT_EMAIL_AI_MAX_INPUT_CHARS
  };
}

async function emailAiUserConfig(
  store: DentLinkStore,
  userId: EntityId,
  env: GmailRuntimeEnv,
  accountId?: EntityId
): Promise<EmailAiUserConfig> {
  const config = emailAiConfig(env);
  const preference = await store.getUserPreference(userId, EMAIL_AI_ENABLED_PREFERENCE_KEY);
  const preferences = emailAiPreferencesFromStoredJson(
    await store.getUserPreference(userId, EMAIL_AI_PREFERENCES_KEY)
  );
  const override = accountId
    ? preferences.accountOverrides.find((item) => item.accountId === accountId && item.enabled)
    : null;
  return {
    ...config,
    enabled: config.available && preference !== "false",
    importanceInstruction: override?.prompt?.trim() || preferences.globalPrompt,
    summaryInstruction: preferences.summaryPrompt,
    textReplacements: preferences.textReplacements,
    threshold:
      typeof override?.threshold === "number" && Number.isFinite(override.threshold)
        ? Math.max(0, Math.min(100, Math.round(override.threshold)))
        : preferences.threshold
  };
}

function emailAiPreferencesFromStoredJson(
  value: string | null
): NonNullable<EmailAiSettings["preferences"]> {
  const fallback: NonNullable<EmailAiSettings["preferences"]> = {
    globalPrompt: DEFAULT_IMPORTANCE_PROMPT,
    summaryPrompt: DEFAULT_SUMMARY_PROMPT,
    textReplacements: [],
    threshold: 0,
    presets: [],
    accountOverrides: []
  };
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value) as Partial<NonNullable<EmailAiSettings["preferences"]>>;
    return {
      globalPrompt:
        typeof parsed.globalPrompt === "string" && parsed.globalPrompt.trim()
          ? Array.from(parsed.globalPrompt.trim()).slice(0, 2000).join("")
          : fallback.globalPrompt,
      summaryPrompt:
        typeof parsed.summaryPrompt === "string" && parsed.summaryPrompt.trim()
          ? Array.from(parsed.summaryPrompt.trim()).slice(0, 2000).join("")
          : fallback.summaryPrompt,
      textReplacements: Array.isArray(parsed.textReplacements)
        ? parsed.textReplacements
            .map((replacement) => normalizeStoredTextReplacement(replacement))
            .filter(
              (
                replacement
              ): replacement is NonNullable<
                EmailAiSettings["preferences"]
              >["textReplacements"][number] => Boolean(replacement)
            )
            .slice(0, 50)
        : fallback.textReplacements,
      threshold:
        typeof parsed.threshold === "number" && Number.isFinite(parsed.threshold)
          ? Math.max(0, Math.min(100, Math.round(parsed.threshold)))
          : fallback.threshold,
      presets: Array.isArray(parsed.presets) ? parsed.presets : [],
      accountOverrides: Array.isArray(parsed.accountOverrides) ? parsed.accountOverrides : []
    };
  } catch {
    return fallback;
  }
}

function emailAiPromptFingerprint(config: EmailAiUserConfig): string {
  return `${EMAIL_AI_PROMPT_VERSION}:${config.importanceInstruction}:${config.summaryInstruction}:${JSON.stringify(config.textReplacements)}`;
}

function applyEmailAiTextReplacements(
  value: string,
  replacements: NonNullable<EmailAiSettings["preferences"]>["textReplacements"]
): string {
  return replacements.reduce((current, replacement) => {
    if (!replacement.find) return current;
    return current.split(replacement.find).join(replacement.replace);
  }, value);
}

function normalizeStoredTextReplacement(
  value: unknown
): NonNullable<EmailAiSettings["preferences"]>["textReplacements"][number] | null {
  if (typeof value !== "object" || value === null) return null;
  const object = value as Record<string, unknown>;
  const find =
    typeof object.find === "string" ? Array.from(object.find).slice(0, 200).join("").trim() : "";
  if (!find) return null;
  return {
    id: typeof object.id === "string" && object.id.trim() ? object.id : crypto.randomUUID(),
    find,
    replace:
      typeof object.replace === "string" ? Array.from(object.replace).slice(0, 200).join("") : ""
  };
}

function thresholdStatus(
  current: Notification["status"],
  importance: number,
  threshold: number
): Notification["status"] {
  if (current === "done" || current === "dismissed" || current === "deleted") return current;
  return importance >= threshold ? "active" : "suppressed";
}

function safeAiMessage(message: string): string {
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 300);
}

function emailAddressFromHeader(value: string): string {
  const match = value.match(/<([^<>@\s]+@[^<>\s]+)>/);
  const address = match?.[1] ?? value.match(/[^\s<>;,]+@[^\s<>;,]+/)?.[0] ?? value;
  return address.trim().toLowerCase();
}

function isAutomatedSender(headers: Map<string, string>): boolean {
  const autoSubmitted = headers.get("auto-submitted");
  const precedence = headers.get("precedence");
  return (
    Boolean(autoSubmitted && !equalsIgnoreCase(autoSubmitted, "no")) ||
    equalsIgnoreCase(precedence ?? "", "bulk") ||
    equalsIgnoreCase(precedence ?? "", "list") ||
    Boolean(headers.get("x-auto-response-suppress"))
  );
}

function isMailingList(headers: Map<string, string>): boolean {
  return Boolean(
    headers.get("list-id") || headers.get("list-unsubscribe") || headers.get("mailing-list")
  );
}

function gmailMessageHasAttachment(message: GmailMessage): boolean {
  const visit = (part: unknown): boolean => {
    if (!part || typeof part !== "object") return false;
    const object = part as Record<string, unknown>;
    if (typeof object.filename === "string" && object.filename.length > 0) return true;
    const parts = object.parts;
    return Array.isArray(parts) && parts.some(visit);
  };
  return visit(message.payload);
}

function gmailMessageBody(message: GmailMessage): { normalizedBody: string; htmlPresent: boolean } {
  const textParts: string[] = [];
  const htmlParts: string[] = [];
  collectGmailMessageTextParts(message.payload, textParts, htmlParts);
  const normalizedBody = normalizeEmailBody({
    plainText: textParts.join("\n\n") || null,
    html: htmlParts.join("\n\n") || message.snippet || null,
    maxChars: DEFAULT_EMAIL_AI_MAX_INPUT_CHARS
  });
  return {
    normalizedBody,
    htmlPresent: htmlParts.length > 0
  };
}

function collectGmailMessageTextParts(
  part: GmailMessagePayloadPart | undefined,
  textParts: string[],
  htmlParts: string[]
): void {
  if (!part) return;
  const mimeType = part.mimeType?.split(";")[0]?.trim().toLowerCase() ?? "";
  const disposition =
    part.headers
      ?.find((header) => header.name.toLowerCase() === "content-disposition")
      ?.value.toLowerCase() ?? "";
  const isAttachment =
    Boolean(part.filename?.trim()) ||
    Boolean(part.body?.attachmentId) ||
    disposition.includes("attachment");
  if (!isAttachment && part.body?.data) {
    const decoded = decodeGmailBodyData(part.body.data).trim();
    if (decoded) {
      if (mimeType === "text/plain") textParts.push(decoded);
      if (mimeType === "text/html") htmlParts.push(decoded);
    }
  }
  for (const child of part.parts ?? []) collectGmailMessageTextParts(child, textParts, htmlParts);
}

function decodeGmailBodyData(value: string): string {
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0) & 0xff);
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return "";
  }
}

function equalsIgnoreCase(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function includesIgnoreCase(left: string, right: string): boolean {
  return left.toLowerCase().includes(right.toLowerCase());
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

async function requestedGmailOAuthScope(
  store: DentLinkStore,
  userId: EntityId,
  url: URL
): Promise<string> {
  if (url.searchParams.get("engine") === "gmail_imap") return GMAIL_IMAP_SCOPE;
  const reconnectAccountId = url.searchParams.get("accountId");
  if (!reconnectAccountId) return GMAIL_DEFAULT_SCOPE;
  const account = await store.getConnectorAccount(userId, reconnectAccountId);
  if (!account || account.connectorKey !== GMAIL_CONNECTOR_KEY) return GMAIL_DEFAULT_SCOPE;
  return requestedGmailIngestionEngine(account.settings) === "gmail_imap"
    ? GMAIL_IMAP_SCOPE
    : GMAIL_DEFAULT_SCOPE;
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

async function verifyGmailImapCapability(
  env: GmailRuntimeEnv,
  user: string,
  accessToken: string,
  now: string
): Promise<void> {
  await gmailImapClient(env).verify({ user, accessToken, now });
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
    requestedScopes: input.grantedScopes.includes(GMAIL_IMAP_SCOPE)
      ? [GMAIL_IMAP_SCOPE]
      : [GMAIL_DEFAULT_SCOPE],
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

function gmailImapClient(env: GmailRuntimeEnv): GmailImapClient {
  if (env.gmailImapClient) return env.gmailImapClient;
  return {
    async poll(options) {
      const client = await openImapClient(cloudflareImapSocketFactory, "imap.gmail.com", 993);
      try {
        return await pollGmailImap(client, options);
      } finally {
        await client.logout().catch(() => client.close());
      }
    },
    async verify(options) {
      const client = await openImapClient(cloudflareImapSocketFactory, "imap.gmail.com", 993);
      try {
        await pollGmailImap(client, { ...options, recentWindowDays: 1, maxMessages: 1 });
      } finally {
        await client.logout().catch(() => client.close());
      }
    }
  };
}

async function cloudflareImapSocketFactory(host: string, port: number): Promise<ImapSocket> {
  const moduleName = "cloudflare:sockets";
  const sockets = (await import(/* @vite-ignore */ moduleName)) as {
    connect(
      address: { hostname: string; port: number },
      options?: { secureTransport?: "off" | "on" | "starttls" }
    ): ImapSocket;
  };
  return sockets.connect(
    { hostname: host, port },
    { secureTransport: port === 993 ? "on" : "starttls" }
  );
}

function gmailIngestionEngine(settings: ConnectorAccount["settings"]): GmailIngestionEngine {
  return settings[GMAIL_INGESTION_ENGINE_SETTING_KEY] === "gmail_imap" ? "gmail_imap" : "gmail_api";
}

function requestedGmailIngestionEngine(
  settings: ConnectorAccount["settings"]
): GmailIngestionEngine {
  return settings.gmailRequestedIngestionEngine === "gmail_imap"
    ? "gmail_imap"
    : gmailIngestionEngine(settings);
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

function validIsoOrFallback(value: string, fallback: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
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
  const reconnectRequired =
    requestedGmailIngestionEngine(settings) === "gmail_imap"
      ? knownGmailScopesMissImap(settings)
      : knownGmailScopesMissReadonly(settings);
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

function withGmailEngineDiagnostics(
  settings: ConnectorAccount["settings"],
  engine: GmailIngestionEngine,
  now: string,
  status: "success" | "partial",
  summary: GmailSyncResult["summary"],
  elapsedMs: number
): ConnectorAccount["settings"] {
  const priorAverage =
    typeof settings.gmailAverageSyncMs === "number" ? settings.gmailAverageSyncMs : elapsedMs;
  const average = Math.round((priorAverage + elapsedMs) / 2);
  const actualNotifications = summary.created + summary.duplicate;
  const expectedMessages = summary.discovered;
  const difference = Math.max(0, expectedMessages - actualNotifications - summary.filtered);
  return {
    ...settings,
    gmailLastSyncEngine: engine,
    gmailLastSyncAt: now,
    gmailLastSyncStatus: status,
    gmailLastSyncDurationMs: elapsedMs,
    gmailLastSyncScanned: summary.discovered,
    gmailLastSyncProcessed: summary.examined,
    gmailLastSyncCreated: summary.created,
    gmailLastSyncDuplicate: summary.duplicate,
    gmailLastSyncSuppressed: summary.filtered,
    gmailLastSyncFailed: summary.failed,
    gmailLastSuccessfulSyncAt:
      summary.failed === 0 ? now : (settings.gmailLastSuccessfulSyncAt ?? null),
    gmailAverageSyncMs: average,
    gmailExpectedMessages: expectedMessages,
    gmailActualNotifications: actualNotifications,
    gmailMissingMessageDifference: difference
  };
}

function withGmailImapSummary(
  settings: ConnectorAccount["settings"],
  now: string,
  status: "success" | "partial",
  summary: GmailSyncResult["summary"],
  elapsedMs: number
): ConnectorAccount["settings"] {
  const priorAverage =
    typeof settings.gmailLastImapAverageSyncMs === "number"
      ? settings.gmailLastImapAverageSyncMs
      : elapsedMs;
  const average = Math.round((priorAverage + elapsedMs) / 2);
  return {
    ...settings,
    gmailLastImapAt: now,
    gmailLastImapStatus: status,
    gmailLastImapDiscovered: summary.discovered,
    gmailLastImapExamined: summary.examined,
    gmailLastImapCreated: summary.created,
    gmailLastImapDuplicate: summary.duplicate,
    gmailLastImapFailed: summary.failed,
    gmailLastImapAverageSyncMs: average,
    gmailLastImapErrorCode: null,
    gmailLastImapErrorMessage: null
  };
}

function withGmailImapCursor(
  settings: ConnectorAccount["settings"],
  poll: GmailImapPollResult | null
): ConnectorAccount["settings"] {
  if (!poll) return settings;
  const maxUid = maxNumericString(poll.messages.map((message) => message.uid));
  if (!poll.uidValidity || !maxUid) {
    return settings;
  }
  return {
    ...settings,
    gmailLastImapUidValidity: poll.uidValidity,
    gmailLastImapUid: maxUid
  };
}

function gmailImapNewerThanUid(settings: ConnectorAccount["settings"]): string | null {
  const uid = typeof settings.gmailLastImapUid === "string" ? settings.gmailLastImapUid : null;
  return uid && gmailImapUidValidity(settings) ? uid : null;
}

function gmailImapUidValidity(settings: ConnectorAccount["settings"]): string | null {
  return typeof settings.gmailLastImapUidValidity === "string"
    ? settings.gmailLastImapUidValidity
    : null;
}

function maxNumericString(values: string[]): string | null {
  let max: bigint | null = null;
  for (const value of values) {
    if (!/^\d+$/.test(value)) continue;
    const parsed = BigInt(value);
    if (max === null || parsed > max) max = parsed;
  }
  return max === null ? null : max.toString();
}

type GmailComparisonMetrics = {
  at: string;
  apiDiscovered: number;
  imapDiscovered: number;
  imapNotificationsCreated: number;
  imapDuplicates: number;
  imapFailures: number;
  mismatch: boolean;
};

function withGmailComparisonMetrics(
  settings: ConnectorAccount["settings"],
  comparison: GmailComparisonMetrics | null
): ConnectorAccount["settings"] {
  if (!comparison) return settings;
  return {
    ...settings,
    gmailLastComparisonAt: comparison.at,
    gmailLastComparisonApiDiscovered: comparison.apiDiscovered,
    gmailLastComparisonImapDiscovered: comparison.imapDiscovered,
    gmailLastComparisonNotificationsCreated: comparison.imapNotificationsCreated,
    gmailLastComparisonDuplicates: comparison.imapDuplicates,
    gmailLastComparisonFailures: comparison.imapFailures,
    gmailLastComparisonMismatch: comparison.mismatch
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
  scope: string,
  requestedScope = GMAIL_DEFAULT_SCOPE
): ConnectorAccount["settings"] {
  const scopes = normalizeScopes(scope);
  const requiredScope =
    requestedScope === GMAIL_IMAP_SCOPE ? GMAIL_IMAP_SCOPE : GMAIL_READONLY_SCOPE;
  return {
    ...settings,
    gmailGrantedScopes: scopes.join(" "),
    gmailReadOnlyGranted: scopes.includes(GMAIL_READONLY_SCOPE),
    gmailImapGranted: scopes.includes(GMAIL_IMAP_SCOPE),
    gmailReconnectRequired: !scopes.includes(requiredScope),
    gmailRequestedScope: requestedScope
  };
}

function knownGmailScopesMissReadonly(settings: ConnectorAccount["settings"]): boolean {
  const scopeValue = settings.gmailGrantedScopes;
  if (typeof scopeValue !== "string" || scopeValue.length === 0) return false;
  return !normalizeScopes(scopeValue).includes(GMAIL_READONLY_SCOPE);
}

function knownGmailScopesMissImap(settings: ConnectorAccount["settings"]): boolean {
  const scopeValue = settings.gmailGrantedScopes;
  if (typeof scopeValue !== "string" || scopeValue.length === 0) return false;
  return !normalizeScopes(scopeValue).includes(GMAIL_IMAP_SCOPE);
}

async function gmailImapApiComparison(
  env: GmailRuntimeEnv,
  accessToken: string,
  account: ConnectorAccount,
  poll: GmailImapPollResult,
  summary: GmailSyncResult["summary"]
): Promise<GmailComparisonMetrics | null> {
  try {
    const apiMessages = await messagesForSync(gmailClient(env), accessToken, account.syncCursor);
    const comparison = {
      at: new Date().toISOString(),
      apiDiscovered: apiMessages.messageIds.length,
      imapDiscovered: poll.discoveredUids.length,
      imapNotificationsCreated: summary.created,
      imapDuplicates: summary.duplicate,
      imapFailures: summary.failed,
      mismatch: apiMessages.messageIds.length !== poll.discoveredUids.length
    };
    console.log(
      JSON.stringify({
        level: "info",
        event: "gmail_imap_parallel_comparison",
        accountId: account.id,
        imapDiscovered: comparison.imapDiscovered,
        imapFetched: poll.messages.length,
        imapCreated: comparison.imapNotificationsCreated,
        imapDuplicate: comparison.imapDuplicates,
        imapFailed: comparison.imapFailures,
        apiDiscovered: comparison.apiDiscovered,
        mismatch: comparison.mismatch
      })
    );
    return comparison;
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "gmail_imap_parallel_comparison_failed",
        accountId: account.id,
        errorCode: gmailErrorCode(error),
        message: safeErrorMessage(error)
      })
    );
    return null;
  }
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
