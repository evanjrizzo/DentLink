import { StoreError } from "./storage";

const CONTENT_ENCRYPTION_VERSION = 1;
const ENVELOPE_PREFIX = `dlenc:v${CONTENT_ENCRYPTION_VERSION}.`;
const JSON_ENVELOPE_MARKER = "__dentlinkEncrypted";

export type ContentEncryptionOptions = {
  keyB64?: string | null;
};

export class ContentEncryption {
  private keyPromise: Promise<CryptoKey> | null = null;

  constructor(private readonly options: ContentEncryptionOptions = {}) {}

  get enabled(): boolean {
    return Boolean(this.options.keyB64?.trim());
  }

  async encryptString(value: string | null): Promise<string | null> {
    if (value === null) return null;
    if (!this.enabled || isEncryptedString(value)) return value;
    const key = await this.importKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: bufferSource(iv) },
        key,
        new TextEncoder().encode(value)
      )
    );
    return `${ENVELOPE_PREFIX}${toBase64Url(iv)}.${toBase64Url(ciphertext)}`;
  }

  async decryptString(value: string | null): Promise<string | null> {
    if (value === null || !isEncryptedString(value)) return value;
    const parts = value.split(".");
    const iv = parts[1];
    const ciphertext = parts[2];
    if (parts[0] !== `dlenc:v${CONTENT_ENCRYPTION_VERSION}` || !iv || !ciphertext) {
      throw new StoreError("invalid_encrypted_content", "Stored user content is invalid");
    }
    const key = await this.importKey();
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bufferSource(fromBase64Url(iv)) },
      key,
      bufferSource(fromBase64Url(ciphertext))
    );
    return new TextDecoder().decode(plaintext);
  }

  async encryptJson(value: unknown): Promise<string | null> {
    if (value === null || value === undefined) return null;
    const plaintext = JSON.stringify(value);
    if (!this.enabled) return plaintext;
    return JSON.stringify({
      [JSON_ENVELOPE_MARKER]: CONTENT_ENCRYPTION_VERSION,
      ciphertext: await this.encryptString(plaintext)
    });
  }

  async decryptJson<T>(value: string | null): Promise<T | null> {
    if (!value) return null;
    const encrypted = encryptedJsonCiphertext(value);
    const plaintext = encrypted
      ? await this.decryptString(encrypted)
      : await this.decryptString(value);
    if (!plaintext) return null;
    try {
      return JSON.parse(plaintext) as T;
    } catch {
      return null;
    }
  }

  private importKey(): Promise<CryptoKey> {
    this.keyPromise ??= importContentKey(this.options.keyB64);
    return this.keyPromise;
  }
}

export function isEncryptedString(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(ENVELOPE_PREFIX);
}

function encryptedJsonCiphertext(value: string): string | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed?.[JSON_ENVELOPE_MARKER] === CONTENT_ENCRYPTION_VERSION &&
      typeof parsed.ciphertext === "string"
      ? parsed.ciphertext
      : null;
  } catch {
    return null;
  }
}

async function importContentKey(value: string | null | undefined): Promise<CryptoKey> {
  if (!value?.trim()) {
    throw new StoreError("missing_content_encryption_key", "Content encryption key is required");
  }
  const raw = fromBase64Flexible(value);
  if (raw.byteLength !== 32) {
    throw new StoreError(
      "invalid_content_encryption_key",
      "Content encryption key must decode to 32 bytes"
    );
  }
  return crypto.subtle.importKey("raw", bufferSource(raw), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt"
  ]);
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
  try {
    return fromBase64Url(value.trim());
  } catch {
    return Uint8Array.from(atob(value.trim()), (char) => char.charCodeAt(0));
  }
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
