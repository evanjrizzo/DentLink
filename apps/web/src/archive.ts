import type {
  AssistantArchivedNotificationContext,
  ArchiveKeyWrapper,
  ArchiveObjectEnvelope,
  ArchiveObjectInput,
  ArchiveObjectMetadata,
  Notification
} from "@dentlink/item-model";

export const ACCOUNT_ARCHIVE_KEY_ID = "account-archive-v1";
const WRAPPER_TYPE = "recovery-secret";
const WRAPPING_ALGORITHM = "PBKDF2-SHA-256+A256KW";
const ENCRYPTION_ALGORITHM = "AES-GCM-256";
const PBKDF2_ITERATIONS = 310_000;

export type ArchiveClient = {
  listArchiveKeyWrappers(): Promise<{ wrappers: ArchiveKeyWrapper[] }>;
  createArchiveKeyWrapper(input: {
    keyId: string;
    wrapperType: string;
    wrappingAlgorithm: string;
    wrappedKeyB64: string;
    saltB64?: string | null;
    publicMetadata?: Record<string, unknown>;
  }): Promise<{ wrapper: ArchiveKeyWrapper }>;
  listArchiveObjects(): Promise<{ objects: ArchiveObjectMetadata[] }>;
  createArchiveObject(input: ArchiveObjectInput): Promise<{ object: ArchiveObjectMetadata }>;
  getArchiveObject(objectId: string): Promise<{
    object: ArchiveObjectMetadata;
    envelope: ArchiveObjectEnvelope;
  }>;
  verifyArchiveObject(objectId: string): Promise<{ object: ArchiveObjectMetadata }>;
};

export type AccountArchiveKey = {
  keyId: string;
  key: CryptoKey;
  created: boolean;
};

export type EncryptedArchiveWrite = {
  object: ArchiveObjectMetadata;
  plaintextSha256B64: string;
};

export type NotificationArchiveWriterOptions = {
  enabled: boolean;
  recoverySecret: string | null;
  minAgeDays?: number;
  maxWrites?: number;
  now?: Date;
};

export type NotificationArchiveWriterResult = {
  enabled: boolean;
  candidates: number;
  archived: number;
  skippedAlreadyArchived: number;
  skippedMissingRecoverySecret: boolean;
  errors: Array<{ notificationId: string; message: string }>;
};

export type ArchivedNotificationReaderOptions = {
  maxObjects?: number;
};

export type ArchivedNotificationReaderResult = {
  notifications: Notification[];
  scanned: number;
  skippedUnsupported: number;
  errors: Array<{ objectId: string; message: string }>;
};

export type AssistantArchiveContextOptions = {
  recoverySecret: string | null;
  message: string;
  maxObjects?: number;
  maxItems?: number;
};

export async function buildAssistantArchiveNotificationContext(
  client: ArchiveClient,
  options: AssistantArchiveContextOptions,
  cryptoImpl: Crypto = crypto
): Promise<AssistantArchivedNotificationContext[]> {
  if (!options.recoverySecret?.trim()) return [];
  const archiveKey = await getOrCreateAccountArchiveKey(client, options.recoverySecret, cryptoImpl);
  const archived = await readArchivedNotifications(
    client,
    archiveKey,
    { maxObjects: options.maxObjects ?? 50 },
    cryptoImpl
  );
  const maxItems = Math.max(0, options.maxItems ?? 8);
  return selectAssistantArchiveNotifications(archived.notifications, options.message, maxItems);
}

export function selectAssistantArchiveNotifications(
  notifications: Notification[],
  message: string,
  maxItems = 8
): AssistantArchivedNotificationContext[] {
  const terms = archiveSearchTerms(message);
  const ranked = notifications
    .map((notification) => ({
      notification,
      score: archiveNotificationScore(notification, terms)
    }))
    .filter((entry) => terms.length === 0 || entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return archiveTimestamp(right.notification).localeCompare(
        archiveTimestamp(left.notification)
      );
    })
    .slice(0, Math.max(0, maxItems));

  return ranked.map(({ notification }) => ({
    id: notification.id,
    title: notification.title.slice(0, 240),
    summary: notification.summary.slice(0, 600),
    body: notification.body.slice(0, 1200),
    sourceLabel: notification.sourceLabel.slice(0, 120),
    severity: notification.severity,
    status: notification.status,
    createdAt: notification.createdAt,
    updatedAt: notification.updatedAt,
    sourceTimestamp: archiveTimestamp(notification),
    sourceUrl: notification.sourceUrl
  }));
}

export async function archiveEligibleNotifications(
  client: ArchiveClient,
  notifications: Notification[],
  options: NotificationArchiveWriterOptions,
  cryptoImpl: Crypto = crypto
): Promise<NotificationArchiveWriterResult> {
  if (!options.enabled) return emptyArchiveWriterResult(false, false);
  if (!options.recoverySecret?.trim()) return emptyArchiveWriterResult(true, true);

  const now = options.now ?? new Date();
  const candidates = archiveNotificationCandidates(notifications, options.minAgeDays ?? 30, now);
  if (candidates.length === 0) {
    return { ...emptyArchiveWriterResult(true, false), candidates: 0 };
  }

  const archivedObjects = await client.listArchiveObjects();
  const archivedNotificationIds = new Set(
    archivedObjects.objects
      .filter((object) => object.sourceEntityType === "notification" && object.sourceEntityId)
      .map((object) => object.sourceEntityId as string)
  );
  const archiveKey = await getOrCreateAccountArchiveKey(client, options.recoverySecret, cryptoImpl);
  let archived = 0;
  let skippedAlreadyArchived = 0;
  const errors: NotificationArchiveWriterResult["errors"] = [];
  for (const notification of candidates) {
    if (archived >= (options.maxWrites ?? 5)) break;
    if (archivedNotificationIds.has(notification.id)) {
      skippedAlreadyArchived += 1;
      continue;
    }
    try {
      const write = await encryptNotificationArchive(client, archiveKey, notification, cryptoImpl);
      await verifyNotificationArchiveWrite(client, archiveKey, notification, write, cryptoImpl);
      archived += 1;
      archivedNotificationIds.add(notification.id);
    } catch (caught) {
      errors.push({
        notificationId: notification.id,
        message: caught instanceof Error ? caught.message : "Archive write failed"
      });
    }
  }
  return {
    enabled: true,
    candidates: candidates.length,
    archived,
    skippedAlreadyArchived,
    skippedMissingRecoverySecret: false,
    errors
  };
}

export function archiveNotificationCandidates(
  notifications: Notification[],
  minAgeDays: number,
  now: Date = new Date()
): Notification[] {
  const cutoff = now.getTime() - Math.max(1, minAgeDays) * 24 * 60 * 60 * 1000;
  return notifications.filter((notification) => {
    if (notification.pinned) return false;
    if (notification.status !== "done" && notification.status !== "dismissed") return false;
    const reference =
      notification.completedAt ??
      notification.dismissedAt ??
      notification.updatedAt ??
      notification.createdAt;
    const timestamp = Date.parse(reference);
    return Number.isFinite(timestamp) && timestamp <= cutoff;
  });
}

export async function readArchivedNotifications(
  client: ArchiveClient,
  archiveKey: AccountArchiveKey,
  options: ArchivedNotificationReaderOptions = {},
  cryptoImpl: Crypto = crypto
): Promise<ArchivedNotificationReaderResult> {
  const listed = await client.listArchiveObjects();
  const notificationObjects = listed.objects.filter(
    (object) => object.objectType === "notification" && object.sourceEntityType === "notification"
  );
  const maxObjects = Math.max(0, options.maxObjects ?? 50);
  const objectsToRead = notificationObjects.slice(0, maxObjects);
  const result: ArchivedNotificationReaderResult = {
    notifications: [],
    scanned: objectsToRead.length,
    skippedUnsupported: listed.objects.length - notificationObjects.length,
    errors: []
  };

  for (const object of objectsToRead) {
    try {
      const { envelope } = await client.getArchiveObject(object.id);
      if (envelope.objectType !== "notification" || envelope.sourceEntityType !== "notification") {
        result.skippedUnsupported += 1;
        continue;
      }
      result.notifications.push(await decryptNotificationArchive(archiveKey, envelope, cryptoImpl));
    } catch (caught) {
      result.errors.push({
        objectId: object.id,
        message: caught instanceof Error ? caught.message : "Archive read failed"
      });
    }
  }

  return result;
}

export async function getOrCreateAccountArchiveKey(
  client: ArchiveClient,
  recoverySecret: string,
  cryptoImpl: Crypto = crypto
): Promise<AccountArchiveKey> {
  if (!recoverySecret.trim()) {
    throw new Error("Archive recovery secret is required");
  }
  const wrappers = await client.listArchiveKeyWrappers();
  const existing = wrappers.wrappers.find(
    (wrapper) =>
      wrapper.keyId === ACCOUNT_ARCHIVE_KEY_ID &&
      wrapper.wrapperType === WRAPPER_TYPE &&
      wrapper.wrappingAlgorithm === WRAPPING_ALGORITHM
  );
  if (existing) {
    return {
      keyId: existing.keyId,
      key: await unwrapAccountArchiveKey(existing, recoverySecret, cryptoImpl),
      created: false
    };
  }

  const key = await cryptoImpl.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt"
  ]);
  const salt = randomBytes(cryptoImpl, 16);
  const wrappingKey = await deriveWrappingKey(recoverySecret, salt, cryptoImpl);
  const wrapped = await cryptoImpl.subtle.wrapKey("raw", key, wrappingKey, "AES-KW");
  await client.createArchiveKeyWrapper({
    keyId: ACCOUNT_ARCHIVE_KEY_ID,
    wrapperType: WRAPPER_TYPE,
    wrappingAlgorithm: WRAPPING_ALGORITHM,
    wrappedKeyB64: bytesToBase64(new Uint8Array(wrapped)),
    saltB64: bytesToBase64(salt),
    publicMetadata: {
      version: 1,
      kdf: "PBKDF2-SHA-256",
      iterations: PBKDF2_ITERATIONS,
      keyScope: "account"
    }
  });
  return { keyId: ACCOUNT_ARCHIVE_KEY_ID, key, created: true };
}

function emptyArchiveWriterResult(
  enabled: boolean,
  skippedMissingRecoverySecret: boolean
): NotificationArchiveWriterResult {
  return {
    enabled,
    candidates: 0,
    archived: 0,
    skippedAlreadyArchived: 0,
    skippedMissingRecoverySecret,
    errors: []
  };
}

export async function encryptNotificationArchive(
  client: ArchiveClient,
  archiveKey: AccountArchiveKey,
  notification: Notification,
  cryptoImpl: Crypto = crypto
): Promise<EncryptedArchiveWrite> {
  const plaintext = JSON.stringify({
    version: 1,
    type: "notification",
    notification
  });
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const nonce = randomBytes(cryptoImpl, 12);
  const ciphertext = new Uint8Array(
    await cryptoImpl.subtle.encrypt(
      { name: "AES-GCM", iv: arrayBuffer(nonce) },
      archiveKey.key,
      arrayBuffer(plaintextBytes)
    )
  );
  const ciphertextSha256 = new Uint8Array(
    await cryptoImpl.subtle.digest("SHA-256", arrayBuffer(ciphertext))
  );
  const plaintextSha256 = new Uint8Array(
    await cryptoImpl.subtle.digest("SHA-256", arrayBuffer(plaintextBytes))
  );
  const response = await client.createArchiveObject({
    objectType: "notification",
    sourceEntityType: "notification",
    sourceEntityId: notification.id,
    encryptionAlgorithm: ENCRYPTION_ALGORITHM,
    keyId: archiveKey.keyId,
    nonceB64: bytesToBase64(nonce),
    ciphertextSha256B64: bytesToBase64(ciphertextSha256),
    ciphertextB64: bytesToBase64(ciphertext),
    publicMetadata: {
      version: 1,
      schema: "dentlink.notification.archive.v1",
      archivedAt: new Date().toISOString()
    }
  });
  return {
    object: response.object,
    plaintextSha256B64: bytesToBase64(plaintextSha256)
  };
}

export async function verifyNotificationArchiveWrite(
  client: ArchiveClient,
  archiveKey: AccountArchiveKey,
  notification: Notification,
  write: EncryptedArchiveWrite,
  cryptoImpl: Crypto = crypto
): Promise<ArchiveObjectMetadata> {
  const fetched = await client.getArchiveObject(write.object.id);
  const restored = await decryptNotificationArchive(archiveKey, fetched.envelope, cryptoImpl);
  if (JSON.stringify(restored) !== JSON.stringify(notification)) {
    throw new Error("Archive verification failed");
  }
  const verified = await client.verifyArchiveObject(write.object.id);
  return verified.object;
}

export async function decryptNotificationArchive(
  archiveKey: AccountArchiveKey,
  envelope: ArchiveObjectEnvelope,
  cryptoImpl: Crypto = crypto
): Promise<Notification> {
  if (envelope.encryption.keyId !== archiveKey.keyId) {
    throw new Error("Archive object was encrypted with a different account key");
  }
  if (envelope.encryption.algorithm !== ENCRYPTION_ALGORITHM) {
    throw new Error("Archive object uses an unsupported encryption algorithm");
  }
  const plaintext = await cryptoImpl.subtle.decrypt(
    { name: "AES-GCM", iv: arrayBuffer(base64ToBytes(envelope.encryption.nonceB64)) },
    archiveKey.key,
    arrayBuffer(base64ToBytes(envelope.ciphertextB64))
  );
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as {
    type?: string;
    notification?: Notification;
  };
  if (parsed.type !== "notification" || !parsed.notification) {
    throw new Error("Archive object is not a notification");
  }
  return parsed.notification;
}

async function unwrapAccountArchiveKey(
  wrapper: ArchiveKeyWrapper,
  recoverySecret: string,
  cryptoImpl: Crypto
): Promise<CryptoKey> {
  if (!wrapper.saltB64) throw new Error("Archive key wrapper is missing its salt");
  const wrappingKey = await deriveWrappingKey(
    recoverySecret,
    base64ToBytes(wrapper.saltB64),
    cryptoImpl
  );
  return cryptoImpl.subtle.unwrapKey(
    "raw",
    arrayBuffer(base64ToBytes(wrapper.wrappedKeyB64)),
    wrappingKey,
    "AES-KW",
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

async function deriveWrappingKey(
  recoverySecret: string,
  salt: Uint8Array,
  cryptoImpl: Crypto
): Promise<CryptoKey> {
  const material = await cryptoImpl.subtle.importKey(
    "raw",
    arrayBuffer(new TextEncoder().encode(recoverySecret)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return cryptoImpl.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: arrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS
    },
    material,
    { name: "AES-KW", length: 256 },
    false,
    ["wrapKey", "unwrapKey"]
  );
}

function randomBytes(cryptoImpl: Crypto, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  cryptoImpl.getRandomValues(bytes);
  return bytes;
}

function archiveSearchTerms(message: string): string[] {
  const stop = new Set([
    "about",
    "alert",
    "alerts",
    "any",
    "archive",
    "archived",
    "can",
    "did",
    "find",
    "for",
    "from",
    "have",
    "latest",
    "look",
    "me",
    "my",
    "new",
    "newest",
    "notification",
    "notifications",
    "recent",
    "recently",
    "see",
    "show",
    "tell",
    "the",
    "there",
    "what",
    "with",
    "you"
  ]);
  return message
    .toLowerCase()
    .replace(/[^a-z0-9@._+\-\s]/g, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !stop.has(term))
    .filter((term) => !/^\d+$/.test(term))
    .slice(0, 10);
}

function archiveNotificationScore(notification: Notification, terms: string[]): number {
  if (terms.length === 0) return 1;
  const haystack = [
    notification.title,
    notification.summary,
    notification.body,
    notification.sourceLabel,
    notification.source
  ]
    .join(" ")
    .toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function archiveTimestamp(notification: Notification): string {
  return notification.completedAt ?? notification.dismissedAt ?? notification.updatedAt;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
