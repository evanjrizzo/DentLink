import type {
  ConflictResolution,
  ConnectorAccountInput,
  ConnectorAccountPatch,
  ConnectorSourceRecordInput,
  NotificationInput,
  NotificationPatch,
  NotificationSeverity,
  NoteInput,
  NotePatch,
  NotePriority,
  WebhookDestination,
  WebhookEndpointInput,
  WebhookEndpointPatch,
  WebhookIngestInput
} from "@dentlink/item-model";

const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 1024;
const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 20_000;
const MAX_NAME_LENGTH = 80;
const MAX_SLUG_LENGTH = 80;
const MAX_TAGS = 20;
const MAX_URL_LENGTH = 2048;
const MAX_SEARCH_LENGTH = 200;
const MAX_CONNECTOR_KEY_LENGTH = 80;
const MAX_EXTERNAL_ID_LENGTH = 256;
const MAX_HASH_LENGTH = 128;

export function parseCredentials(value: unknown): { email: string; password: string } {
  const object = asObject(value);
  const email = asString(object.email, "email").trim().toLowerCase();
  const password = asString(object.password, "password");
  if (email.length > MAX_EMAIL_LENGTH)
    throw new ValidationError("invalid_email", "Email is too long");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    throw new ValidationError("invalid_email", "Enter a valid email address");
  if (password.length < 8)
    throw new ValidationError("weak_password", "Password must be at least 8 characters");
  if (password.length > MAX_PASSWORD_LENGTH)
    throw new ValidationError("invalid_password", "Password is too long");
  return { email, password };
}

export function parseNoteInput(value: unknown): NoteInput {
  const object = asObject(value);
  const kind = object.kind === "task" || object.kind === "reference" ? object.kind : null;
  if (!kind) throw new ValidationError("invalid_kind", "Note kind must be task or reference");
  const title = asString(object.title, "title").trim();
  if (title.length === 0) throw new ValidationError("invalid_title", "Title is required");
  assertMax(title, MAX_TITLE_LENGTH, "title");
  const body = optionalString(object.body, "body") ?? "";
  assertMax(body, MAX_BODY_LENGTH, "body");
  const tagIds = optionalStringArray(object.tagIds, "tagIds") ?? [];
  if (tagIds.length > MAX_TAGS) throw new ValidationError("too_many_tags", "Too many tags");
  const dueAt = optionalNullableString(object.dueAt, "dueAt");
  validateDueAt(dueAt);
  const sourceUrl = optionalNullableString(object.sourceUrl, "sourceUrl");
  if (sourceUrl !== undefined && sourceUrl !== null)
    assertMax(sourceUrl, MAX_URL_LENGTH, "sourceUrl");
  return {
    kind,
    title,
    body,
    folderId: optionalNullableString(object.folderId, "folderId"),
    tagIds,
    dueAt,
    priority: parsePriority(object.priority),
    pinned: optionalBoolean(object.pinned, "pinned") ?? false,
    sourceUrl
  };
}

export function parseNotePatch(value: unknown): { expectedVersion: number; patch: NotePatch } {
  const object = asObject(value);
  const patch = asObject(object.patch);
  const status =
    patch.status === undefined || patch.status === "active" || patch.status === "done"
      ? patch.status
      : null;
  if (status === null) throw new ValidationError("invalid_status", "Status must be active or done");
  return {
    expectedVersion: asVersion(object.expectedVersion),
    patch: {
      kind:
        patch.kind === undefined
          ? undefined
          : patch.kind === "task" || patch.kind === "reference"
            ? patch.kind
            : invalid("invalid_kind"),
      title: boundedOptionalString(patch.title, "title", MAX_TITLE_LENGTH),
      body: boundedOptionalString(patch.body, "body", MAX_BODY_LENGTH),
      folderId: optionalNullableString(patch.folderId, "folderId"),
      tagIds: boundedOptionalStringArray(patch.tagIds, "tagIds"),
      dueAt: validatedOptionalDueAt(patch.dueAt),
      priority: patch.priority === undefined ? undefined : parsePriority(patch.priority),
      pinned: optionalBoolean(patch.pinned, "pinned"),
      sourceUrl: boundedOptionalNullableString(patch.sourceUrl, "sourceUrl", MAX_URL_LENGTH),
      status,
      globalOrder: optionalNumber(patch.globalOrder, "globalOrder")
    }
  };
}

export function parseExpectedVersion(value: unknown): number {
  return asVersion(asObject(value).expectedVersion);
}

export function parseName(value: unknown): string {
  const name = asString(asObject(value).name, "name").trim();
  if (name.length === 0) throw new ValidationError("invalid_name", "Name is required");
  assertMax(name, MAX_NAME_LENGTH, "name");
  return name;
}

export function parseNotificationInput(value: unknown): NotificationInput {
  const object = asObject(value);
  const title = boundedString(object.title, "title", MAX_TITLE_LENGTH).trim();
  if (title.length === 0) throw new ValidationError("invalid_title", "Title is required");
  const summary = boundedOptionalString(object.summary, "summary", MAX_TITLE_LENGTH);
  const body = boundedOptionalString(object.body, "body", MAX_BODY_LENGTH);
  const sourceUrl = boundedOptionalNullableString(object.sourceUrl, "sourceUrl", MAX_URL_LENGTH);
  return {
    title,
    summary,
    body,
    sourceUrl,
    severity: parseSeverity(object.severity),
    pinned: optionalBoolean(object.pinned, "pinned") ?? false,
    rank: optionalNumber(object.rank, "rank")
  };
}

export function parseNotificationPatch(value: unknown): {
  expectedVersion: number;
  patch: NotificationPatch;
} {
  const object = asObject(value);
  const patch = asObject(object.patch);
  return {
    expectedVersion: asVersion(object.expectedVersion),
    patch: {
      title: boundedOptionalString(patch.title, "title", MAX_TITLE_LENGTH),
      summary: boundedOptionalString(patch.summary, "summary", MAX_TITLE_LENGTH),
      body: boundedOptionalString(patch.body, "body", MAX_BODY_LENGTH),
      sourceUrl: boundedOptionalNullableString(patch.sourceUrl, "sourceUrl", MAX_URL_LENGTH),
      severity: patch.severity === undefined ? undefined : parseSeverity(patch.severity),
      pinned: optionalBoolean(patch.pinned, "pinned"),
      rank: optionalNumber(patch.rank, "rank"),
      globalOrder: optionalNumber(patch.globalOrder, "globalOrder"),
      status: parseNotificationStatus(patch.status)
    }
  };
}

export function parseWebhookEndpointInput(value: unknown): WebhookEndpointInput {
  const object = asObject(value);
  const name = boundedString(object.name, "name", MAX_NAME_LENGTH).trim();
  if (name.length === 0) throw new ValidationError("invalid_name", "Name is required");
  return {
    name,
    slug: parseSlug(object.slug),
    destination: parseDestination(object.destination),
    defaultSeverity: parseSeverity(object.defaultSeverity),
    defaultPriority: parsePriority(object.defaultPriority),
    enabled: optionalBoolean(object.enabled, "enabled") ?? true
  };
}

export function parseWebhookEndpointPatch(value: unknown): {
  expectedVersion: number;
  patch: WebhookEndpointPatch;
} {
  const object = asObject(value);
  const patch = asObject(object.patch);
  return {
    expectedVersion: asVersion(object.expectedVersion),
    patch: {
      name:
        patch.name === undefined
          ? undefined
          : boundedString(patch.name, "name", MAX_NAME_LENGTH).trim(),
      destination:
        patch.destination === undefined ? undefined : parseDestination(patch.destination),
      defaultSeverity:
        patch.defaultSeverity === undefined ? undefined : parseSeverity(patch.defaultSeverity),
      defaultPriority:
        patch.defaultPriority === undefined ? undefined : parsePriority(patch.defaultPriority),
      enabled: optionalBoolean(patch.enabled, "enabled")
    }
  };
}

export function parseWebhookIngest(value: unknown): WebhookIngestInput {
  const object = asObject(value);
  const notification = parseNotificationInput(object);
  return {
    ...notification,
    kind:
      object.kind === undefined
        ? undefined
        : object.kind === "task" || object.kind === "reference"
          ? object.kind
          : invalid("invalid_kind"),
    priority: object.priority === undefined ? undefined : parsePriority(object.priority),
    dueAt: validatedOptionalDueAt(object.dueAt)
  };
}

export function parseConnectorAccountInput(value: unknown): ConnectorAccountInput {
  const object = asObject(value);
  const connectorKey = boundedString(object.connectorKey, "connectorKey", MAX_CONNECTOR_KEY_LENGTH)
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(connectorKey)) {
    throw new ValidationError("invalid_connector", "Connector key is invalid");
  }
  const displayName = boundedString(object.displayName, "displayName", MAX_NAME_LENGTH).trim();
  if (displayName.length === 0)
    throw new ValidationError("invalid_name", "Display name is required");
  return {
    connectorKey,
    displayName,
    settings: parseSettings(object.settings),
    credentialRef: boundedOptionalNullableString(
      object.credentialRef,
      "credentialRef",
      MAX_NAME_LENGTH
    ),
    credentialStatus: parseCredentialStatus(object.credentialStatus)
  };
}

export function parseConnectorAccountPatch(value: unknown): {
  expectedVersion: number;
  patch: ConnectorAccountPatch;
} {
  const object = asObject(value);
  const patch = asObject(object.patch);
  return {
    expectedVersion: asVersion(object.expectedVersion),
    patch: {
      displayName:
        patch.displayName === undefined
          ? undefined
          : boundedString(patch.displayName, "displayName", MAX_NAME_LENGTH).trim(),
      status: parseConnectorAccountStatus(patch.status),
      healthStatus: parseConnectorHealthStatus(patch.healthStatus),
      syncStatus: parseConnectorSyncStatus(patch.syncStatus),
      settings: patch.settings === undefined ? undefined : parseSettings(patch.settings),
      credentialRef: boundedOptionalNullableString(
        patch.credentialRef,
        "credentialRef",
        MAX_NAME_LENGTH
      ),
      credentialStatus:
        patch.credentialStatus === undefined
          ? undefined
          : parseCredentialStatus(patch.credentialStatus),
      syncCursor: boundedOptionalNullableString(patch.syncCursor, "syncCursor", MAX_NAME_LENGTH),
      lastSyncAt: validatedOptionalDueAt(patch.lastSyncAt),
      nextSyncAt: validatedOptionalDueAt(patch.nextSyncAt),
      lastHealthAt: validatedOptionalDueAt(patch.lastHealthAt),
      errorCode: boundedOptionalNullableString(patch.errorCode, "errorCode", MAX_NAME_LENGTH),
      errorMessage: boundedOptionalNullableString(
        patch.errorMessage,
        "errorMessage",
        MAX_TITLE_LENGTH
      )
    }
  };
}

export function parseConnectorSourceRecordInput(value: unknown): ConnectorSourceRecordInput {
  const object = asObject(value);
  const sourceExternalId = boundedString(
    object.sourceExternalId,
    "sourceExternalId",
    MAX_EXTERNAL_ID_LENGTH
  ).trim();
  if (sourceExternalId.length === 0) {
    throw new ValidationError("invalid_source_external_id", "Source external id is required");
  }
  const payloadHash = boundedString(object.payloadHash, "payloadHash", MAX_HASH_LENGTH).trim();
  if (!/^[A-Za-z0-9:_-]+$/.test(payloadHash)) {
    throw new ValidationError("invalid_payload_hash", "Payload hash is invalid");
  }
  return {
    accountId: boundedString(object.accountId, "accountId", MAX_NAME_LENGTH),
    sourceExternalId,
    sourceType: parseSourceRecordType(object.sourceType),
    payloadHash,
    normalizedPayload: parseNormalizedPayload(object.normalizedPayload)
  };
}

export function parseReorder(
  value: unknown
): Array<{ id: string; expectedVersion: number; globalOrder: number }> {
  const noteOrders = asObject(value).noteOrders;
  if (!Array.isArray(noteOrders))
    throw new ValidationError("invalid_reorder", "noteOrders must be an array");
  const seenIds = new Set<string>();
  const seenOrders = new Set<number>();
  return noteOrders.map((item) => {
    const object = asObject(item);
    const parsed = {
      id: asString(object.id, "id"),
      expectedVersion: asVersion(object.expectedVersion),
      globalOrder: asNumber(object.globalOrder, "globalOrder")
    };
    if (seenIds.has(parsed.id))
      throw new ValidationError("invalid_reorder", "Duplicate note reorder id");
    if (seenOrders.has(parsed.globalOrder))
      throw new ValidationError("invalid_reorder", "Duplicate note order");
    seenIds.add(parsed.id);
    seenOrders.add(parsed.globalOrder);
    return parsed;
  });
}

export function parseResolution(value: unknown): ConflictResolution {
  const resolution = asObject(value).resolution;
  if (
    resolution === "keep_mine" ||
    resolution === "keep_theirs" ||
    resolution === "merge" ||
    resolution === "keep_both"
  ) {
    return resolution;
  }
  throw new ValidationError("invalid_resolution", "Unknown conflict resolution");
}

export function parseConflictResolution(value: unknown): {
  expectedVersion: number;
  resolution: ConflictResolution;
} {
  const object = asObject(value);
  return {
    expectedVersion: asVersion(object.expectedVersion),
    resolution: parseResolution(object)
  };
}

export function parseCursor(value: string | null): string {
  if (value === null || value === "") return "0";
  if (!/^\d+$/.test(value)) throw new ValidationError("invalid_cursor", "Sync cursor is invalid");
  return value;
}

export function parseSearch(value: string | null): string | undefined {
  if (!value) return undefined;
  assertMax(value, MAX_SEARCH_LENGTH, "search");
  return value;
}

export class ValidationError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError("invalid_json", "Expected a JSON object");
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string")
    throw new ValidationError("invalid_field", `${field} must be a string`);
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return asString(value, field);
}

function optionalNullableString(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return asString(value, field);
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new ValidationError("invalid_field", `${field} must be an array of strings`);
  }
  return value;
}

function boundedOptionalStringArray(value: unknown, field: string): string[] | undefined {
  const result = optionalStringArray(value, field);
  if (result && result.length > MAX_TAGS)
    throw new ValidationError("too_many_tags", "Too many tags");
  return result;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean")
    throw new ValidationError("invalid_field", `${field} must be a boolean`);
  return value;
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  return asNumber(value, field);
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ValidationError("invalid_field", `${field} must be a number`);
  }
  return value;
}

function asVersion(value: unknown): number {
  const version = asNumber(value, "expectedVersion");
  if (!Number.isInteger(version) || version < 1) {
    throw new ValidationError("invalid_version", "expectedVersion must be a positive integer");
  }
  return version;
}

function parsePriority(value: unknown): NotePriority {
  if (value === undefined) return "none";
  if (value === "none" || value === "low" || value === "medium" || value === "high") return value;
  throw new ValidationError("invalid_priority", "Priority is invalid");
}

function parseSeverity(value: unknown): NotificationSeverity {
  if (value === undefined) return "info";
  if (value === "info" || value === "low" || value === "medium" || value === "high") return value;
  throw new ValidationError("invalid_severity", "Severity is invalid");
}

function parseDestination(value: unknown): WebhookDestination {
  if (value === "notification" || value === "note") return value;
  throw new ValidationError("invalid_destination", "Webhook destination is invalid");
}

function parseCredentialStatus(value: unknown): "not_configured" | "configured" | undefined {
  if (value === undefined) return undefined;
  if (value === "not_configured" || value === "configured") return value;
  throw new ValidationError("invalid_credential_status", "Credential status is invalid");
}

function parseConnectorAccountStatus(value: unknown): ConnectorAccountPatch["status"] | undefined {
  if (value === undefined) return undefined;
  if (value === "connected" || value === "paused" || value === "error" || value === "deleted")
    return value;
  throw new ValidationError("invalid_status", "Connector account status is invalid");
}

function parseConnectorHealthStatus(
  value: unknown
): ConnectorAccountPatch["healthStatus"] | undefined {
  if (value === undefined) return undefined;
  if (value === "unknown" || value === "healthy" || value === "degraded" || value === "error")
    return value;
  throw new ValidationError("invalid_health_status", "Connector health status is invalid");
}

function parseConnectorSyncStatus(value: unknown): ConnectorAccountPatch["syncStatus"] | undefined {
  if (value === undefined) return undefined;
  if (value === "idle" || value === "syncing" || value === "error") return value;
  throw new ValidationError("invalid_sync_status", "Connector sync status is invalid");
}

function parseSourceRecordType(value: unknown): ConnectorSourceRecordInput["sourceType"] {
  if (
    value === "email" ||
    value === "calendar_event" ||
    value === "notification" ||
    value === "generic"
  ) {
    return value;
  }
  throw new ValidationError("invalid_source_type", "Connector source type is invalid");
}

function parseSettings(value: unknown): Record<string, string | number | boolean | null> {
  if (value === undefined) return {};
  const object = asObject(value);
  const entries = Object.entries(object);
  if (entries.length > 20) throw new ValidationError("too_many_settings", "Too many settings");
  const parsed: Record<string, string | number | boolean | null> = {};
  for (const [key, setting] of entries) {
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(key)) {
      throw new ValidationError("invalid_setting", "Setting key is invalid");
    }
    if (
      setting === null ||
      typeof setting === "string" ||
      typeof setting === "number" ||
      typeof setting === "boolean"
    ) {
      if (typeof setting === "string") assertMax(setting, MAX_TITLE_LENGTH, key);
      parsed[key] = setting;
      continue;
    }
    throw new ValidationError("invalid_setting", "Setting value is invalid");
  }
  return parsed;
}

function parseNormalizedPayload(value: unknown): Record<string, unknown> {
  const object = asObject(value);
  const serialized = JSON.stringify(object);
  if (serialized.length > 20_000) {
    throw new ValidationError("invalid_payload", "Normalized payload is too large");
  }
  return JSON.parse(serialized) as Record<string, unknown>;
}

function parseNotificationStatus(value: unknown): NotificationPatch["status"] {
  if (value === undefined) return undefined;
  if (value === "active" || value === "done" || value === "dismissed" || value === "deleted")
    return value;
  throw new ValidationError("invalid_status", "Status is invalid");
}

function parseSlug(value: unknown): string {
  const slug = boundedString(value, "slug", MAX_SLUG_LENGTH).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new ValidationError(
      "invalid_slug",
      "Slug must use lowercase letters, numbers, or dashes"
    );
  }
  return slug;
}

function boundedString(value: unknown, field: string, max: number): string {
  const result = asString(value, field);
  assertMax(result, max, field);
  return result;
}

function boundedOptionalString(value: unknown, field: string, max: number): string | undefined {
  const result = optionalString(value, field);
  if (result !== undefined) assertMax(result, max, field);
  return result;
}

function boundedOptionalNullableString(
  value: unknown,
  field: string,
  max: number
): string | null | undefined {
  const result = optionalNullableString(value, field);
  if (result !== undefined && result !== null) assertMax(result, max, field);
  return result;
}

function validatedOptionalDueAt(value: unknown): string | null | undefined {
  const result = optionalNullableString(value, "dueAt");
  validateDueAt(result);
  return result;
}

function validateDueAt(value: string | null | undefined): void {
  if (!value) return;
  if (Number.isNaN(Date.parse(value))) {
    throw new ValidationError("invalid_due_at", "Due date is invalid");
  }
}

function assertMax(value: string, max: number, field: string): void {
  if (value.length > max) throw new ValidationError("invalid_field", `${field} is too long`);
}

function invalid(code: string): never {
  throw new ValidationError(code, "Invalid value");
}
