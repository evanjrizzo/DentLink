import { generateSessionToken, hashSessionToken } from "./auth";
import { StoreError, type DentLinkStore } from "./storage";

import type { EntityId } from "@dentlink/item-model";

export const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const GOOGLE_CREDENTIAL_ENCRYPTION_VERSION = 1;

export type GoogleRuntimeEnv = {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  GMAIL_CREDENTIAL_ENCRYPTION_KEY?: string;
  DENTLINK_WEB_ORIGIN?: string;
};

export type GoogleTokenResponse = {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
};

export class GoogleConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleConfigError";
  }
}

export async function createGoogleOAuthState(
  store: DentLinkStore,
  userId: EntityId,
  connectorKey: string,
  url: URL,
  env: GoogleRuntimeEnv,
  now: string,
  statePrefix: string
): Promise<{
  state: string;
  expiresAt: string;
  returnTo: string | null;
  reconnectAccountId: string | null;
}> {
  const state = generateSessionToken().replace("session_", statePrefix);
  const stateHash = await hashSessionToken(state);
  const reconnectAccountId = url.searchParams.get("accountId");
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"), env);
  const expiresAt = new Date(new Date(now).getTime() + GOOGLE_OAUTH_STATE_TTL_MS).toISOString();
  await store.createConnectorOAuthState(
    userId,
    {
      stateHash,
      connectorKey,
      reconnectAccountId,
      returnTo,
      expiresAt
    },
    now
  );
  return { state, expiresAt, returnTo, reconnectAccountId };
}

export function googleOAuthConfig(
  env: GoogleRuntimeEnv,
  url: URL,
  callbackPath: string
): { clientId: string; clientSecret: string; redirectUri: string } {
  if (!env.GOOGLE_CLIENT_ID) throw new GoogleConfigError("GOOGLE_CLIENT_ID is required");
  if (!env.GOOGLE_CLIENT_SECRET) throw new GoogleConfigError("GOOGLE_CLIENT_SECRET is required");
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI ?? `${url.origin}${callbackPath}`
  };
}

export async function tokenRequest(
  fetchImpl: typeof fetch,
  fields: Record<string, string>
): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams(fields);
  const response = await fetchImpl(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !json) {
    throw new StoreError("google_token_error", "Google token exchange failed");
  }
  const accessToken = json.access_token;
  if (typeof accessToken !== "string") {
    throw new StoreError("google_token_error", "Google token response was invalid");
  }
  return {
    accessToken,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : undefined,
    expiresIn: typeof json.expires_in === "number" ? json.expires_in : undefined,
    scope: typeof json.scope === "string" ? json.scope : undefined
  };
}

export async function encryptSecret(secret: string, env: GoogleRuntimeEnv): Promise<string> {
  const key = await importAesKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBufferSource(iv) },
    key,
    new TextEncoder().encode(secret)
  );
  return `v${GOOGLE_CREDENTIAL_ENCRYPTION_VERSION}.${toBase64Url(iv)}.${toBase64Url(
    new Uint8Array(encrypted)
  )}`;
}

export async function decryptSecret(value: string, env: GoogleRuntimeEnv): Promise<string> {
  const [version, ivValue, encryptedValue] = value.split(".");
  if (version !== `v${GOOGLE_CREDENTIAL_ENCRYPTION_VERSION}` || !ivValue || !encryptedValue) {
    throw new StoreError("invalid_credentials", "Stored Google credentials are invalid");
  }
  const key = await importAesKey(env);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBufferSource(fromBase64Url(ivValue)) },
    key,
    asBufferSource(fromBase64Url(encryptedValue))
  );
  return new TextDecoder().decode(decrypted);
}

export function safeReturnTo(value: string | null, env: GoogleRuntimeEnv): string | null {
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

async function importAesKey(env: GoogleRuntimeEnv): Promise<CryptoKey> {
  if (!env.GMAIL_CREDENTIAL_ENCRYPTION_KEY) {
    throw new GoogleConfigError("GMAIL_CREDENTIAL_ENCRYPTION_KEY is required");
  }
  const raw = fromBase64Flexible(env.GMAIL_CREDENTIAL_ENCRYPTION_KEY);
  if (raw.byteLength !== 32) {
    throw new GoogleConfigError("GMAIL_CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes");
  }
  return crypto.subtle.importKey("raw", asBufferSource(raw), { name: "AES-GCM" }, false, [
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
  return /[-_]/.test(value)
    ? fromBase64Url(value)
    : Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function asBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}
