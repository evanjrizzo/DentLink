import {
  ASSISTANT_PROMPT_VERSION,
  DEFAULT_EMAIL_AI_MODEL,
  EmailAiError,
  createOpenAIAssistantAiClient,
  type AssistantAiClient
} from "../../../packages/ai/src";
import type {
  AssistantChatResponse,
  AssistantChatSource,
  CalendarEvent,
  ConnectorAccount,
  ConnectorSourceRecord,
  EntityId,
  Notification
} from "@dentlink/item-model";

import type { DentLinkStore } from "./storage";

const DEFAULT_RECENT_CONTEXT_LIMIT = 5;

export type AssistantRuntimeEnv = {
  OPENAI_API_KEY?: string;
  DENTLINK_AI_ENABLED?: string;
  DENTLINK_AI_MODEL?: string;
  DENTLINK_ASSISTANT_MAX_EMAILS?: string;
  DENTLINK_ASSISTANT_MAX_NOTIFICATIONS?: string;
  assistantAiClient?: AssistantAiClient;
};

export class AssistantError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "AssistantError";
  }
}

export async function answerAssistantQuestion(
  store: DentLinkStore,
  userId: EntityId,
  env: AssistantRuntimeEnv,
  body: unknown,
  now: string
): Promise<AssistantChatResponse> {
  const request = parseAssistantRequest(body);
  const config = assistantConfig(env);
  if (!config.available) {
    throw new AssistantError(
      config.unavailableReason ?? "ai_unavailable",
      "Assistant AI is not available in this environment.",
      503
    );
  }
  const accounts = (await store.listConnectorAccounts(userId)).accounts;
  const notificationContext = await collectNotificationContext(store, userId, request.message, env);
  const emailContext = await collectEmailContext(store, userId, accounts, request.message, env);
  const calendarContext = await collectCalendarContext(store, userId, request.timezone, now);
  const client =
    env.assistantAiClient ??
    createOpenAIAssistantAiClient({ apiKey: config.apiKey, model: config.model });
  try {
    const result = await client.answer({
      question: request.message,
      timezone: request.timezone,
      now,
      context: {
        help: dentLinkAssistantHelp(),
        notifications: notificationContext.notifications,
        emails: emailContext.emails,
        calendarEvents: calendarContext.events
      }
    });
    const sourcesById = new Map<string, AssistantChatSource>(
      [...notificationContext.sources, ...emailContext.sources, ...calendarContext.sources].map(
        (source) => [source.id, source]
      )
    );
    const sources = result.sourceIds
      .map((sourceId) => sourcesById.get(sourceId))
      .filter((source): source is AssistantChatSource => Boolean(source))
      .sort(compareAssistantSources);
    return {
      answer: result.answer,
      sources,
      ai: {
        status: "complete",
        provider: "openai",
        model: config.model,
        promptVersion: ASSISTANT_PROMPT_VERSION,
        outputTokens: result.outputTokens
      }
    };
  } catch (caught) {
    if (caught instanceof EmailAiError) {
      throw new AssistantError(
        caught.code,
        caught.message,
        caught.code === "ai_rate_limited" ? 429 : 502
      );
    }
    throw caught;
  }
}

function parseAssistantRequest(value: unknown): { message: string; timezone: string } {
  if (!value || typeof value !== "object") {
    throw new AssistantError("invalid_assistant_request", "Assistant request is invalid.", 400);
  }
  const object = value as Record<string, unknown>;
  const message = typeof object.message === "string" ? object.message.trim() : "";
  if (message.length < 2) {
    throw new AssistantError("invalid_assistant_request", "Message must not be empty.", 400);
  }
  if (message.length > 2000) {
    throw new AssistantError(
      "invalid_assistant_request",
      "Message must be 2000 characters or fewer.",
      400
    );
  }
  const timezone =
    typeof object.timezone === "string" && validTimezone(object.timezone) ? object.timezone : "UTC";
  return { message, timezone };
}

function assistantConfig(env: AssistantRuntimeEnv): {
  available: boolean;
  apiKey: string;
  model: string;
  unavailableReason: string | null;
} {
  const apiKey = env.OPENAI_API_KEY ?? "";
  const disabled = env.DENTLINK_AI_ENABLED === "false";
  return {
    available: apiKey.length > 0 && !disabled,
    apiKey,
    model: env.DENTLINK_AI_MODEL || DEFAULT_EMAIL_AI_MODEL,
    unavailableReason:
      apiKey.length === 0 ? "missing_api_key" : disabled ? "disabled_by_environment" : null
  };
}

function dentLinkAssistantHelp(): Array<{ topic: string; guidance: string[] }> {
  return [
    {
      topic: "Home",
      guidance: [
        "Use Home for the read-only assistant chat.",
        "The assistant can answer from recent notifications, Gmail-derived source records, upcoming calendar events, and this product help context when AI is configured."
      ]
    },
    {
      topic: "Notifications",
      guidance: [
        "Use Notifications to review active items from connected sources.",
        "Pin important notifications, open source links when available, complete actionable items, or dismiss items that no longer need attention."
      ]
    },
    {
      topic: "Notes",
      guidance: [
        "Use Notes for tasks and reference notes with folders, tags, due dates, priority, pinning, and search.",
        "The completed-notes toggle controls whether completed notes are visible; visible completed notes are grouped after active notes in each folder."
      ]
    },
    {
      topic: "Calendar",
      guidance: [
        "Use Calendar to review upcoming local and connected events with dates, times, locations, and calendar names.",
        "Calendar source cards in assistant answers are ordered earliest upcoming first."
      ]
    },
    {
      topic: "Settings and connections",
      guidance: [
        "Use Settings -> Connections to manage connected Gmail and Google Calendar accounts.",
        "Refresh All asks the backend to sync connected sources; sync timing and outcomes are recorded by the backend."
      ]
    },
    {
      topic: "AI settings",
      guidance: [
        "Use Settings -> AI to control optional AI behavior for email summaries and importance handling.",
        "AI is server-configured and optional; provider credentials are never shown in the client."
      ]
    }
  ];
}

async function collectNotificationContext(
  store: DentLinkStore,
  userId: EntityId,
  question: string,
  env: AssistantRuntimeEnv
): Promise<{
  notifications: Array<{
    id: string;
    title: string;
    summary: string;
    body: string;
    sourceLabel: string;
    severity: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    sourceTimestamp: string;
    sourceUrl: string | null;
  }>;
  sources: AssistantChatSource[];
}> {
  const requestedLimit = requestedItemLimit(question);
  const recencyQuestion = asksRecency(question);
  const maxNotifications =
    requestedLimit ??
    (recencyQuestion
      ? DEFAULT_RECENT_CONTEXT_LIMIT
      : boundedInteger(env.DENTLINK_ASSISTANT_MAX_NOTIFICATIONS, 30, 5, 80));
  const notifications = (await store.listNotifications(userId)).notifications
    .filter((notification) => notification.status !== "deleted")
    .sort((left, right) =>
      timestampForNotification(right).localeCompare(timestampForNotification(left))
    )
    .slice(0, maxNotifications)
    .map((notification) => ({
      id: notification.id,
      title: notification.title,
      summary: notification.summary.slice(0, 600),
      body: notification.body.slice(0, 1200),
      sourceLabel: notification.sourceLabel,
      severity: notification.severity,
      status: notification.status,
      createdAt: notification.createdAt,
      updatedAt: notification.updatedAt,
      sourceTimestamp: timestampForNotification(notification),
      sourceUrl: notification.sourceUrl
    }));
  return {
    notifications,
    sources: notifications.map((notification) => ({
      id: notification.id,
      kind: "notification",
      title: notification.title,
      subtitle: `${notification.sourceLabel} - ${notification.status}`,
      timestamp: notification.sourceTimestamp,
      sourceUrl: notification.sourceUrl
    }))
  };
}

async function collectEmailContext(
  store: DentLinkStore,
  userId: EntityId,
  accounts: ConnectorAccount[],
  question: string,
  env: AssistantRuntimeEnv
): Promise<{
  emails: Array<{
    id: string;
    accountLabel: string;
    sender: string;
    senderAddress: string | null;
    subject: string;
    receivedAt: string | null;
    snippet: string;
    body: string;
    sourceUrl: string | null;
  }>;
  sources: AssistantChatSource[];
}> {
  const gmailAccounts = accounts.filter(
    (account) => account.connectorKey === "gmail" && account.status !== "deleted"
  );
  const records = (
    await Promise.all(
      gmailAccounts.map(async (account) =>
        (await store.listConnectorSourceRecords(userId, account.id)).map((record) => ({
          account,
          record
        }))
      )
    )
  ).flat();
  const intent = emailQuestionIntent(question);
  const terms = intent.recencyOnly ? [] : senderTerms(question);
  const maxEmails =
    intent.requestedLimit ??
    (intent.recencyQuestion
      ? DEFAULT_RECENT_CONTEXT_LIMIT
      : boundedInteger(env.DENTLINK_ASSISTANT_MAX_EMAILS, 30, 5, 80));
  const ranked = records
    .filter(({ record }) => record.sourceType === "email")
    .map(({ account, record }) => ({ account, record, payload: record.normalizedPayload }))
    .filter(({ payload }) => stringField(payload, "provider") === "gmail" || "sender" in payload)
    .map((entry) => ({ ...entry, score: emailMatchScore(entry.payload, terms) }))
    .filter((entry) => terms.length === 0 || entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return timestampForEmail(b.record).localeCompare(timestampForEmail(a.record));
    })
    .filter(uniqueEmailEntry())
    .slice(0, maxEmails);
  const emails = ranked.map(({ account, record, payload }) => {
    const sender =
      stringField(payload, "sender") || stringField(payload, "sender_name") || "Unknown sender";
    const subject = stringField(payload, "subject") || "(no subject)";
    return {
      id: record.id,
      accountLabel: account.displayName,
      sender,
      senderAddress: stringField(payload, "sender_address"),
      subject,
      receivedAt: timestampForEmail(record) || null,
      snippet: stringField(payload, "snippet").slice(0, 500),
      body: (stringField(payload, "normalized_body") || stringField(payload, "snippet")).slice(
        0,
        2500
      ),
      sourceUrl: stringField(payload, "permalink") || stringField(payload, "source_url")
    };
  });
  return {
    emails,
    sources: emails.map((email) => ({
      id: email.id,
      kind: "email",
      title: email.subject,
      subtitle: `${email.sender}${email.accountLabel ? ` - ${email.accountLabel}` : ""}`,
      timestamp: email.receivedAt,
      sourceUrl: email.sourceUrl
    }))
  };
}

async function collectCalendarContext(
  store: DentLinkStore,
  userId: EntityId,
  timezone: string,
  now: string
): Promise<{
  events: Array<{
    id: string;
    title: string;
    startAt: string;
    endAt: string;
    allDay: boolean;
    location: string | null;
    calendarSummary: string;
    source: string;
    sourceUrl: string | null;
  }>;
  sources: AssistantChatSource[];
}> {
  const start = new Date(now);
  const end = new Date(start.getTime() + 1000 * 60 * 60 * 24 * 14);
  const listed = await store.listCalendarEvents(userId, {
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    includeHidden: false
  });
  const events = listed.events.slice(0, 80).map((event) => ({
    id: event.id,
    title: event.title,
    startAt: event.startAt,
    endAt: event.endAt,
    allDay: event.allDay,
    location: event.location,
    calendarSummary: event.calendarSummary,
    source: event.source,
    sourceUrl: event.sourceUrl
  }));
  return {
    events,
    sources: listed.events.slice(0, 80).map((event) => calendarSource(event, timezone))
  };
}

function calendarSource(event: CalendarEvent, timezone: string): AssistantChatSource {
  return {
    id: event.id,
    kind: "calendar_event",
    title: event.title,
    subtitle: `${formatDateTime(event.startAt, timezone, event.allDay)}${event.location ? ` - ${event.location}` : ""}`,
    timestamp: event.startAt,
    sourceUrl: event.sourceUrl
  };
}

function senderTerms(question: string): string[] {
  const stop = new Set([
    "any",
    "what",
    "was",
    "the",
    "last",
    "latest",
    "new",
    "newer",
    "newest",
    "recent",
    "recently",
    "most",
    "current",
    "thing",
    "sent",
    "send",
    "me",
    "from",
    "email",
    "gmail",
    "message",
    "messages",
    "just",
    "only",
    "did",
    "say",
    "tell",
    "about",
    "have",
    "going",
    "on",
    "this",
    "week",
    "give"
  ]);
  return question
    .toLowerCase()
    .replace(/[^a-z0-9@._+\-\s]/g, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !stop.has(term))
    .filter((term) => !/^\d+$/.test(term))
    .slice(0, 8);
}

function emailQuestionIntent(question: string): {
  recencyOnly: boolean;
  recencyQuestion: boolean;
  requestedLimit: number | null;
} {
  const normalized = question.toLowerCase();
  const terms = senderTerms(question);
  const asksEmail =
    /\b(email|emails|mail|message|messages|gmail|inbox)\b/.test(normalized) ||
    /\b(sent me|from)\b/.test(normalized);
  const recencyQuestion = asksRecency(normalized);
  const requestedLimit = requestedItemLimit(normalized);
  return {
    recencyOnly: asksEmail && recencyQuestion && terms.length === 0,
    recencyQuestion,
    requestedLimit
  };
}

function asksRecency(question: string): boolean {
  return /\b(latest|newest|new|recent|most recent|last)\b/.test(question.toLowerCase());
}

function requestedItemLimit(question: string): number | null {
  const match =
    question.match(/\b(?:latest|newest|recent|last|new)\s+(\d{1,2})\b/) ??
    question.match(/\b(\d{1,2})\s+(?:latest|newest|recent|new)\b/);
  if (!match?.[1]) return null;
  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(20, parsed);
}

function uniqueEmailEntry(): (entry: {
  record: ConnectorSourceRecord;
  payload: Record<string, unknown>;
}) => boolean {
  const seen = new Set<string>();
  return (entry) => {
    const key = [
      stringField(entry.payload, "sender_address").toLowerCase(),
      stringField(entry.payload, "subject").toLowerCase(),
      timestampForEmail(entry.record)
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}

function timestampForNotification(notification: Notification): string {
  return notification.email?.receivedAt ?? notification.createdAt;
}

function compareAssistantSources(left: AssistantChatSource, right: AssistantChatSource): number {
  if (left.kind === "calendar_event" && right.kind === "calendar_event") {
    return timestampForSource(left).localeCompare(timestampForSource(right));
  }
  if (left.kind !== "calendar_event" && right.kind !== "calendar_event") {
    return timestampForSource(right).localeCompare(timestampForSource(left));
  }
  if (left.kind === "calendar_event") return 1;
  return -1;
}

function timestampForSource(source: AssistantChatSource): string {
  return source.timestamp ?? "";
}

function emailMatchScore(payload: Record<string, unknown>, terms: string[]): number {
  if (terms.length === 0) return 1;
  const haystack = [
    stringField(payload, "sender"),
    stringField(payload, "sender_name"),
    stringField(payload, "sender_address"),
    stringField(payload, "subject")
  ]
    .join(" ")
    .toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function timestampForEmail(record: ConnectorSourceRecord): string {
  return stringField(record.normalizedPayload, "received_at") || record.receivedAt;
}

function stringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function validTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function formatDateTime(value: string, timezone: string, allDay: boolean): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: allDay ? undefined : "short"
  }).format(date);
}
