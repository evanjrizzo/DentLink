import type { PasswordRecord } from "./storage";

const HASH_ALGORITHM = "SHA-256";
const ITERATIONS = 100_000;
const KEY_BITS = 256;
const TOKEN_BYTES = 32;

export async function hashPassword(password: string): Promise<PasswordRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return {
    hash: toBase64(hash),
    salt: toBase64(salt),
    iterations: ITERATIONS
  };
}

export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  const salt = fromBase64(record.salt);
  const hash = await derive(password, salt, record.iterations);
  return constantTimeEqual(toBase64(hash), record.hash);
}

export function generateSessionToken(): string {
  return `session_${toBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)))}`;
}

export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toBase64Url(new Uint8Array(digest));
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const saltBuffer = salt.buffer.slice(
    salt.byteOffset,
    salt.byteOffset + salt.byteLength
  ) as ArrayBuffer;
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: { name: HASH_ALGORITHM }, salt: saltBuffer, iterations },
    key,
    KEY_BITS
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
