import { connect } from "cloudflare:sockets";

type SpikeEnv = {
  GMAIL_IMAP_HOST?: string;
  GMAIL_IMAP_PORT?: string;
  GMAIL_IMAP_USER?: string;
  GMAIL_IMAP_ACCESS_TOKEN?: string;
  GMAIL_IMAP_REFRESH_TOKEN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  SPIKE_ADMIN_KEY?: string;
  SPIKE_STATE_SECRET?: string;
  SPIKE_TOKEN_ENCRYPTION_KEY?: string;
  TOKEN_KV?: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<void>;
  };
};

type SpikeResult = {
  ok: boolean;
  stage: string;
  host: string;
  port: number;
  mailbox: "INBOX";
  since: string;
  connected: boolean;
  authenticated: boolean;
  capability: CapabilitySummary | null;
  mailboxSelected: boolean;
  messageCount: number | null;
  uidCount: number;
  fetchedHeaderCount: number;
  fullMimeFetched: boolean;
  parsed: SafeParsedMessage | null;
  identifiers: IdentifierSummary;
  timings: Record<string, number>;
  responseBytes: Record<string, number>;
  limitations: string[];
  error?: SafeSpikeError;
};

type SafeSpikeError = {
  code: string;
  stage: string;
  message: string;
};

type CapabilitySummary = {
  xoauth2: boolean;
  idle: boolean;
  xGmExt1: boolean;
};

type IdentifierSummary = {
  xGmMsgIdAvailable: boolean;
  messageIdAvailable: boolean;
  uidAvailable: boolean;
  uidValidityAvailable: boolean;
  internalDateAvailable: boolean;
};

type SafeParsedMessage = {
  subjectPresent: boolean;
  fromPresent: boolean;
  toPresent: boolean;
  datePresent: boolean;
  messageIdPresent: boolean;
  plainTextPresent: boolean;
  htmlPresent: boolean;
  attachmentCount: number;
  attachmentContentTypes: string[];
};

type ParsedMessage = {
  subject: string | null;
  from: string | null;
  to: string | null;
  date: string | null;
  messageId: string | null;
  plainText: string | null;
  html: string | null;
  attachments: AttachmentMetadata[];
};

type AttachmentMetadata = {
  filename: string | null;
  contentType: string;
  disposition: string | null;
  contentId: string | null;
  sizeBytes: number | null;
};

type CommandResult = {
  tag: string;
  response: string;
  bytes: number;
};

type SocketLike = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  opened: Promise<unknown>;
  close(): Promise<void>;
};

const CRLF = "\r\n";
const XOAUTH2_SCOPE = "https://mail.google.com/";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKEN_KV_KEY = "gmail-imap-spike-refresh-token";
const DEFAULT_HEADER_FETCH_LIMIT = 5;

export default {
  async fetch(request: Request, env: SpikeEnv): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") return json({ ok: true, isolated: true });
      if (url.pathname === "/oauth/start") return startOAuth(request, env);
      if (url.pathname === "/oauth/callback") return completeOAuth(request, env);
      if (url.pathname === "/run") {
        await requireAdmin(request, env);
        return json(await runImapProbe(env, Number(url.searchParams.get("headers") ?? "")));
      }
      return json({ ok: false, error: "not_found" }, 404);
    } catch (error) {
      return json({ ok: false, error: safeError(error, "request") }, 500);
    }
  },

  async scheduled(
    _controller: { scheduledTime: number; cron: string },
    env: SpikeEnv,
    ctx: { waitUntil(promise: Promise<unknown>): void }
  ): Promise<void> {
    ctx.waitUntil(runScheduledProbe(env));
  }
};

async function startOAuth(request: Request, env: SpikeEnv): Promise<Response> {
  await requireAdmin(request, env);
  const state = await createState(env);
  const redirectUri = oauthRedirectUri(request, env);
  const clientId = requiredEnv(env.GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID");
  const authorizationUrl = new URL(GOOGLE_AUTH_URL);
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", XOAUTH2_SCOPE);
  authorizationUrl.searchParams.set("access_type", "offline");
  authorizationUrl.searchParams.set("prompt", "consent");
  authorizationUrl.searchParams.set("state", state);
  return json({
    ok: true,
    scope: XOAUTH2_SCOPE,
    authorizationUrl: authorizationUrl.toString(),
    redirectUri
  });
}

async function completeOAuth(request: Request, env: SpikeEnv): Promise<Response> {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) throw new SpikeFailure("oauth_denied", "oauth_callback", "Google OAuth was denied");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    throw new SpikeFailure("oauth_callback_invalid", "oauth_callback", "OAuth callback is invalid");
  }
  await verifyState(env, state);
  const token = await exchangeCode(env, code, oauthRedirectUri(request, env));
  if (!token.refresh_token) {
    throw new SpikeFailure(
      "oauth_refresh_token_missing",
      "oauth_callback",
      "Google did not return an offline refresh token for the spike"
    );
  }
  const scopes = token.scope?.split(/\s+/).filter(Boolean) ?? [];
  if (token.scope && !scopes.includes(XOAUTH2_SCOPE)) {
    throw new SpikeFailure(
      "oauth_scope_missing",
      "oauth_callback",
      "Google token response did not include the Gmail IMAP scope"
    );
  }
  await storeRefreshToken(env, token.refresh_token);
  return json({
    ok: true,
    scope: XOAUTH2_SCOPE,
    refreshTokenReturned: true,
    storedInEncryptedKv: Boolean(env.TOKEN_KV),
    tokenValuesReturned: false
  });
}

async function runScheduledProbe(env: SpikeEnv): Promise<void> {
  try {
    const result = await runImapProbe(env, DEFAULT_HEADER_FETCH_LIMIT);
    console.log(
      JSON.stringify({
        event: "gmail_imap_spike_scheduled_probe",
        ok: result.ok,
        stage: result.stage,
        uidCount: result.uidCount,
        fetchedHeaderCount: result.fetchedHeaderCount,
        fullMimeFetched: result.fullMimeFetched,
        timings: result.timings,
        error: result.error ?? null
      })
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        event: "gmail_imap_spike_scheduled_probe",
        ok: false,
        error: safeError(error, "scheduled")
      })
    );
  }
}

async function runImapProbe(env: SpikeEnv, requestedHeaderLimit: number): Promise<SpikeResult> {
  const started = performance.now();
  const host = env.GMAIL_IMAP_HOST ?? "imap.gmail.com";
  const port = Number(env.GMAIL_IMAP_PORT ?? "993");
  const since = imapDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const headerLimit =
    Number.isFinite(requestedHeaderLimit) && requestedHeaderLimit > 0
      ? Math.min(Math.floor(requestedHeaderLimit), 10)
      : DEFAULT_HEADER_FETCH_LIMIT;
  const timings: Record<string, number> = {};
  const responseBytes: Record<string, number> = {};
  const identifiers = emptyIdentifierSummary();
  let stage = "start";
  let connected = false;
  let authenticated = false;
  let mailboxSelected = false;
  let capability: CapabilitySummary | null = null;
  let messageCount: number | null = null;
  let uidCount = 0;
  let fetchedHeaderCount = 0;
  let fullMimeFetched = false;
  let parsed: SafeParsedMessage | null = null;
  let client: ImapClient | null = null;

  try {
    const user = requiredEnv(env.GMAIL_IMAP_USER, "GMAIL_IMAP_USER");
    stage = "token_refresh";
    const tokenStarted = performance.now();
    const accessToken = await accessTokenForSpike(env);
    timings.tokenMs = elapsed(tokenStarted);

    stage = "connect";
    const connectStarted = performance.now();
    client = await ImapClient.open(host, port);
    connected = true;
    timings.connectMs = elapsed(connectStarted);

    stage = "capability";
    const capabilityStarted = performance.now();
    const capabilityResult = await client.command("CAPABILITY");
    timings.capabilityMs = elapsed(capabilityStarted);
    responseBytes.capability = capabilityResult.bytes;
    capability = summarizeCapability(capabilityResult.response);

    stage = "authenticate";
    const authStarted = performance.now();
    const auth = await client.authenticateXoauth2(user, accessToken);
    authenticated = true;
    timings.authenticateMs = elapsed(authStarted);
    responseBytes.authenticate = auth.bytes;

    stage = "select_inbox";
    const selectStarted = performance.now();
    const select = await client.command("SELECT INBOX");
    mailboxSelected = true;
    timings.selectInboxMs = elapsed(selectStarted);
    responseBytes.selectInbox = select.bytes;
    messageCount = selectedExistsCount(select.response);
    identifiers.uidValidityAvailable = /\bUIDVALIDITY\b/i.test(select.response);

    stage = "uid_search";
    const searchStarted = performance.now();
    const search = await client.command(`UID SEARCH SINCE ${since}`);
    timings.searchMs = elapsed(searchStarted);
    responseBytes.search = search.bytes;
    const uids = searchUids(search.response);
    uidCount = uids.length;
    identifiers.uidAvailable = uids.length > 0;

    const uidsToFetch = uids.slice(-headerLimit);
    for (const uid of uidsToFetch) {
      stage = "fetch_headers";
      const headerStarted = performance.now();
      const header = await client.command(
        `UID FETCH ${uid} (UID X-GM-MSGID INTERNALDATE RFC822.SIZE FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM TO DATE MESSAGE-ID CONTENT-TYPE CONTENT-DISPOSITION CONTENT-TRANSFER-ENCODING)])`
      );
      timings.fetchHeadersMs = addTiming(timings.fetchHeadersMs, elapsed(headerStarted));
      responseBytes.fetchHeaders = addTiming(responseBytes.fetchHeaders, header.bytes);
      fetchedHeaderCount += 1;
      mergeIdentifierSummary(identifiers, identifiersFromFetch(header.response));
    }

    const uid = uids.at(-1);
    if (uid) {
      stage = "fetch_mime";
      const mimeStarted = performance.now();
      const mime = await client.command(
        `UID FETCH ${uid} (UID X-GM-MSGID INTERNALDATE BODY.PEEK[])`
      );
      timings.fetchMimeMs = elapsed(mimeStarted);
      responseBytes.fetchMime = mime.bytes;
      fullMimeFetched = true;
      mergeIdentifierSummary(identifiers, identifiersFromFetch(mime.response));

      stage = "parse_mime";
      const parseStarted = performance.now();
      parsed = safeParsedMessage(parseMime(extractFirstLiteral(mime.response)));
      timings.parseMimeMs = elapsed(parseStarted);
    }

    stage = "logout";
    await client.logout();
    timings.totalMs = elapsed(started);
    return {
      ok: true,
      stage: "complete",
      host,
      port,
      mailbox: "INBOX",
      since,
      connected,
      authenticated,
      capability,
      mailboxSelected,
      messageCount,
      uidCount,
      fetchedHeaderCount,
      fullMimeFetched,
      parsed,
      identifiers,
      timings,
      responseBytes,
      limitations: spikeLimitations()
    };
  } catch (error) {
    try {
      await client?.close();
    } catch {
      // Best-effort cleanup only.
    }
    timings.totalMs = elapsed(started);
    return {
      ok: false,
      stage,
      host,
      port,
      mailbox: "INBOX",
      since,
      connected,
      authenticated,
      capability,
      mailboxSelected,
      messageCount,
      uidCount,
      fetchedHeaderCount,
      fullMimeFetched,
      parsed,
      identifiers,
      timings,
      responseBytes,
      limitations: spikeLimitations(),
      error: safeError(error, stage)
    };
  }
}

class ImapClient {
  private tagCounter = 0;

  private constructor(
    private readonly socket: SocketLike,
    private readonly reader: ReadableStreamDefaultReader<Uint8Array>,
    private readonly writer: WritableStreamDefaultWriter<Uint8Array>
  ) {}

  static async open(host: string, port: number): Promise<ImapClient> {
    const socket = connect(
      { hostname: host, port },
      { secureTransport: port === 993 ? "on" : "starttls" }
    ) as SocketLike;
    await socket.opened;
    const client = new ImapClient(socket, socket.readable.getReader(), socket.writable.getWriter());
    const greeting = await client.readUntilLine();
    if (!greeting.startsWith("* OK")) {
      throw new SpikeFailure("imap_greeting_invalid", "connect", "Unexpected IMAP greeting");
    }
    return client;
  }

  async authenticateXoauth2(user: string, accessToken: string): Promise<CommandResult> {
    const tag = this.nextTag();
    const initialResponse = base64Ascii(`user=${user}\x01auth=Bearer ${accessToken}\x01\x01`);
    await this.write(`${tag} AUTHENTICATE XOAUTH2 ${initialResponse}${CRLF}`);
    const response = await this.readTaggedOrContinuation(tag);
    if (response.includes(`${CRLF}+ `) || response.startsWith("+ ")) {
      await this.write(CRLF);
      await this.readTagged(tag);
      throw new SpikeFailure(
        "imap_xoauth2_rejected",
        "authenticate",
        `XOAUTH2 rejected by Gmail: ${safeXoauthChallenge(response)}`
      );
    }
    if (!tagOk(response, tag)) {
      throw new SpikeFailure("imap_xoauth2_failed", "authenticate", "XOAUTH2 failed");
    }
    return { tag, response, bytes: byteLength(response) };
  }

  async command(command: string): Promise<CommandResult> {
    const tag = this.nextTag();
    await this.write(`${tag} ${command}${CRLF}`);
    const response = await this.readTagged(tag);
    if (!tagOk(response, tag)) {
      throw new SpikeFailure(
        "imap_command_failed",
        commandName(command).toLowerCase(),
        `IMAP command failed: ${commandName(command)}`
      );
    }
    return { tag, response, bytes: byteLength(response) };
  }

  async logout(): Promise<void> {
    try {
      await this.command("LOGOUT");
    } finally {
      await this.close();
    }
  }

  async close(): Promise<void> {
    try {
      this.reader.releaseLock();
    } catch {
      // Ignore cleanup failures.
    }
    try {
      this.writer.releaseLock();
    } catch {
      // Ignore cleanup failures.
    }
    await this.socket.close();
  }

  private nextTag(): string {
    this.tagCounter += 1;
    return `D${String(this.tagCounter).padStart(4, "0")}`;
  }

  private async write(value: string): Promise<void> {
    await this.writer.write(new TextEncoder().encode(value));
  }

  private async readUntilLine(): Promise<string> {
    return this.readUntil((value) => value.includes(CRLF));
  }

  private async readTagged(tag: string): Promise<string> {
    return this.readUntil((value) => hasTaggedLine(value, tag));
  }

  private async readTaggedOrContinuation(tag: string): Promise<string> {
    return this.readUntil(
      (value) => hasTaggedLine(value, tag) || value.includes(`${CRLF}+ `) || value.startsWith("+ ")
    );
  }

  private async readUntil(done: (value: string) => boolean): Promise<string> {
    const decoder = new TextDecoder();
    let output = "";
    while (!done(output)) {
      const chunk = await this.reader.read();
      if (chunk.done) break;
      output += decoder.decode(chunk.value, { stream: true });
    }
    output += decoder.decode();
    return output;
  }
}

class SpikeFailure extends Error {
  constructor(
    readonly code: string,
    readonly stage: string,
    message: string
  ) {
    super(message);
  }
}

async function accessTokenForSpike(env: SpikeEnv): Promise<string> {
  if (env.GMAIL_IMAP_ACCESS_TOKEN) return env.GMAIL_IMAP_ACCESS_TOKEN;
  const refreshToken = env.GMAIL_IMAP_REFRESH_TOKEN ?? (await loadRefreshToken(env));
  if (!refreshToken) {
    throw new SpikeFailure(
      "refresh_token_missing",
      "token_refresh",
      "No isolated Gmail IMAP refresh token is configured"
    );
  }
  const token = await refreshAccessToken(env, refreshToken);
  return token.access_token;
}

async function refreshAccessToken(
  env: SpikeEnv,
  refreshToken: string
): Promise<{ access_token: string; scope?: string }> {
  const clientId = requiredEnv(env.GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID");
  const clientSecret = requiredEnv(env.GOOGLE_CLIENT_SECRET, "GOOGLE_CLIENT_SECRET");
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  const payload = (await response.json().catch(() => null)) as {
    access_token?: string;
    scope?: string;
  } | null;
  if (!response.ok || !payload?.access_token) {
    throw new SpikeFailure(
      "token_refresh_failed",
      "token_refresh",
      `Google token refresh failed with HTTP ${response.status}`
    );
  }
  const scopes = (payload.scope ?? "").split(/\s+/).filter(Boolean);
  if (payload.scope && !scopes.includes(XOAUTH2_SCOPE)) {
    throw new SpikeFailure(
      "token_scope_missing",
      "token_refresh",
      "Google access token does not include the Gmail IMAP scope"
    );
  }
  return { access_token: payload.access_token, scope: payload.scope };
}

async function exchangeCode(
  env: SpikeEnv,
  code: string,
  redirectUri: string
): Promise<{ refresh_token?: string; scope?: string }> {
  const clientId = requiredEnv(env.GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID");
  const clientSecret = requiredEnv(env.GOOGLE_CLIENT_SECRET, "GOOGLE_CLIENT_SECRET");
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code"
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  const payload = (await response.json().catch(() => null)) as {
    refresh_token?: string;
    scope?: string;
  } | null;
  if (!response.ok || !payload) {
    throw new SpikeFailure(
      "oauth_token_exchange_failed",
      "oauth_callback",
      `Google OAuth token exchange failed with HTTP ${response.status}`
    );
  }
  return payload;
}

async function storeRefreshToken(env: SpikeEnv, refreshToken: string): Promise<void> {
  if (!env.TOKEN_KV) {
    throw new SpikeFailure(
      "token_storage_missing",
      "oauth_callback",
      "TOKEN_KV binding is required for isolated encrypted refresh token storage"
    );
  }
  const encrypted = await encryptString(env, refreshToken);
  await env.TOKEN_KV.put(TOKEN_KV_KEY, encrypted);
}

async function loadRefreshToken(env: SpikeEnv): Promise<string | null> {
  if (!env.TOKEN_KV) return null;
  const encrypted = await env.TOKEN_KV.get(TOKEN_KV_KEY);
  if (!encrypted) return null;
  return decryptString(env, encrypted);
}

async function encryptString(env: SpikeEnv, value: string): Promise<string> {
  const key = await aesKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(value)
  );
  return JSON.stringify({
    v: 1,
    iv: base64Bytes(iv),
    ciphertext: base64Bytes(new Uint8Array(encrypted))
  });
}

async function decryptString(env: SpikeEnv, encoded: string): Promise<string> {
  const parsed = JSON.parse(encoded) as { iv?: string; ciphertext?: string };
  if (!parsed.iv || !parsed.ciphertext) {
    throw new SpikeFailure(
      "token_storage_invalid",
      "token_refresh",
      "Stored token payload is invalid"
    );
  }
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytesFromBase64(parsed.iv) },
    await aesKey(env),
    bytesFromBase64(parsed.ciphertext)
  );
  return new TextDecoder().decode(decrypted);
}

async function aesKey(env: SpikeEnv): Promise<CryptoKey> {
  const secret = requiredEnv(env.SPIKE_TOKEN_ENCRYPTION_KEY, "SPIKE_TOKEN_ENCRYPTION_KEY");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function createState(env: SpikeEnv): Promise<string> {
  const payload = {
    nonce: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + 10 * 60
  };
  const encoded = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await signState(env, encoded);
  return `${encoded}.${signature}`;
}

async function verifyState(env: SpikeEnv, state: string): Promise<void> {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) {
    throw new SpikeFailure("oauth_state_invalid", "oauth_callback", "OAuth state is invalid");
  }
  const expected = await signState(env, encoded);
  if (!constantTimeEqual(signature, expected)) {
    throw new SpikeFailure("oauth_state_invalid", "oauth_callback", "OAuth state is invalid");
  }
  const payload = JSON.parse(new TextDecoder().decode(bytesFromBase64Url(encoded))) as {
    exp?: number;
  };
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new SpikeFailure("oauth_state_expired", "oauth_callback", "OAuth state expired");
  }
}

async function signState(env: SpikeEnv, encodedPayload: string): Promise<string> {
  const secret = requiredEnv(env.SPIKE_STATE_SECRET, "SPIKE_STATE_SECRET");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encodedPayload));
  return base64Url(new Uint8Array(signature));
}

async function requireAdmin(request: Request, env: SpikeEnv): Promise<void> {
  const expected = requiredEnv(env.SPIKE_ADMIN_KEY, "SPIKE_ADMIN_KEY");
  const url = new URL(request.url);
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  const provided = bearer ?? url.searchParams.get("key") ?? "";
  if (!constantTimeEqual(provided, expected)) {
    throw new SpikeFailure("unauthorized", "auth", "Spike diagnostic key is invalid");
  }
}

function oauthRedirectUri(request: Request, env: SpikeEnv): string {
  return env.GOOGLE_REDIRECT_URI ?? new URL("/oauth/callback", request.url).toString();
}

function parseMime(raw: string): ParsedMessage {
  const { headers, body } = splitMessage(raw);
  const contentType = headerValue(headers, "content-type") ?? "text/plain";
  const parts = collectParts(contentType, headers, body);
  return {
    subject: decodeHeader(headerValue(headers, "subject")),
    from: decodeHeader(headerValue(headers, "from")),
    to: decodeHeader(headerValue(headers, "to")),
    date: headerValue(headers, "date"),
    messageId: headerValue(headers, "message-id"),
    plainText: firstPartText(parts, "text/plain"),
    html: firstPartText(parts, "text/html"),
    attachments: parts
      .filter((part) => part.attachment)
      .map((part) => part.attachment as AttachmentMetadata)
  };
}

type MimePart = {
  headers: Map<string, string>;
  contentType: string;
  body: string;
  attachment: AttachmentMetadata | null;
};

function collectParts(contentType: string, headers: Map<string, string>, body: string): MimePart[] {
  const boundary = parameter(contentType, "boundary");
  if (!contentType.toLowerCase().startsWith("multipart/") || !boundary) {
    return [mimePart(headers, contentType, body)];
  }
  const sections = body.split(`--${boundary}`).slice(1, -1);
  const parts: MimePart[] = [];
  for (const section of sections) {
    const nested = splitMessage(section.replace(/^\r?\n/, ""));
    const nestedContentType = headerValue(nested.headers, "content-type") ?? "text/plain";
    parts.push(...collectParts(nestedContentType, nested.headers, nested.body));
  }
  return parts;
}

function mimePart(headers: Map<string, string>, contentType: string, body: string): MimePart {
  const transferEncoding = headerValue(headers, "content-transfer-encoding")?.toLowerCase() ?? "";
  const disposition = headerValue(headers, "content-disposition");
  const filename = parameter(disposition ?? "", "filename") ?? parameter(contentType, "name");
  const decodedBody = decodeBody(body, transferEncoding);
  return {
    headers,
    contentType: contentType.split(";")[0]?.trim().toLowerCase() ?? "application/octet-stream",
    body: decodedBody,
    attachment:
      filename || disposition?.toLowerCase().includes("attachment")
        ? {
            filename,
            contentType:
              contentType.split(";")[0]?.trim().toLowerCase() ?? "application/octet-stream",
            disposition: disposition?.split(";")[0]?.trim().toLowerCase() ?? null,
            contentId: headerValue(headers, "content-id"),
            sizeBytes: byteLength(body)
          }
        : null
  };
}

function safeParsedMessage(parsed: ParsedMessage): SafeParsedMessage {
  return {
    subjectPresent: Boolean(parsed.subject),
    fromPresent: Boolean(parsed.from),
    toPresent: Boolean(parsed.to),
    datePresent: Boolean(parsed.date),
    messageIdPresent: Boolean(parsed.messageId),
    plainTextPresent: Boolean(parsed.plainText),
    htmlPresent: Boolean(parsed.html),
    attachmentCount: parsed.attachments.length,
    attachmentContentTypes: [
      ...new Set(parsed.attachments.map((attachment) => attachment.contentType))
    ]
  };
}

function firstPartText(parts: MimePart[], contentType: string): string | null {
  return (
    parts.find((part) => part.contentType === contentType && !part.attachment)?.body.trim() || null
  );
}

function splitMessage(raw: string): { headers: Map<string, string>; body: string } {
  const normalized = raw.replace(/\r\n/g, "\n");
  const splitAt = normalized.indexOf("\n\n");
  const headerBlock = splitAt >= 0 ? normalized.slice(0, splitAt) : normalized;
  const body = splitAt >= 0 ? normalized.slice(splitAt + 2) : "";
  return { headers: parseHeaders(headerBlock), body };
}

function parseHeaders(headerBlock: string): Map<string, string> {
  const headers = new Map<string, string>();
  const unfolded = headerBlock.replace(/\n[ \t]+/g, " ");
  for (const line of unfolded.split("\n")) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return headers;
}

function headerValue(headers: Map<string, string>, name: string): string | null {
  return headers.get(name.toLowerCase()) ?? null;
}

function parameter(value: string, name: string): string | null {
  const pattern = new RegExp(`${name}\\*?=(?:"([^"]+)"|([^;]+))`, "i");
  const match = pattern.exec(value);
  return decodeHeader(match?.[1] ?? match?.[2] ?? null);
}

function decodeBody(body: string, encoding: string): string {
  if (encoding === "base64") {
    try {
      return atob(body.replace(/\s+/g, ""));
    } catch {
      return body;
    }
  }
  if (encoding === "quoted-printable") return decodeQuotedPrintable(body);
  return body;
}

function decodeQuotedPrintable(value: string): string {
  return value
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    );
}

function decodeHeader(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/=\?([^?]+)\?([bqBQ])\?([^?]+)\?=/g, (_match, _charset, encoding, text) => {
    if (String(encoding).toLowerCase() === "b") {
      try {
        return atob(String(text));
      } catch {
        return String(text);
      }
    }
    return decodeQuotedPrintable(String(text).replace(/_/g, " "));
  });
}

function extractFirstLiteral(response: string): string {
  const match = /\{(\d+)\}\r?\n/.exec(response);
  if (!match) return response;
  const start = (match.index ?? 0) + match[0].length;
  return response.slice(start, start + Number(match[1]));
}

function selectedExistsCount(response: string): number | null {
  const match = /\* (\d+) EXISTS/i.exec(response);
  return match ? Number(match[1]) : null;
}

function searchUids(response: string): string[] {
  const line = response
    .split(/\r?\n/)
    .find((candidate) => candidate.toUpperCase().startsWith("* SEARCH"));
  if (!line) return [];
  return line.split(/\s+/).slice(2).filter(Boolean);
}

function identifiersFromFetch(response: string): IdentifierSummary {
  const headers = parseHeaders(extractFirstLiteral(response));
  return {
    xGmMsgIdAvailable: /\bX-GM-MSGID\b/i.test(response),
    messageIdAvailable: headers.has("message-id"),
    uidAvailable: /\bUID \d+\b/i.test(response),
    uidValidityAvailable: false,
    internalDateAvailable: /\bINTERNALDATE\b/i.test(response)
  };
}

function emptyIdentifierSummary(): IdentifierSummary {
  return {
    xGmMsgIdAvailable: false,
    messageIdAvailable: false,
    uidAvailable: false,
    uidValidityAvailable: false,
    internalDateAvailable: false
  };
}

function mergeIdentifierSummary(target: IdentifierSummary, source: IdentifierSummary): void {
  target.xGmMsgIdAvailable = target.xGmMsgIdAvailable || source.xGmMsgIdAvailable;
  target.messageIdAvailable = target.messageIdAvailable || source.messageIdAvailable;
  target.uidAvailable = target.uidAvailable || source.uidAvailable;
  target.uidValidityAvailable = target.uidValidityAvailable || source.uidValidityAvailable;
  target.internalDateAvailable = target.internalDateAvailable || source.internalDateAvailable;
}

function summarizeCapability(response: string): CapabilitySummary {
  return {
    xoauth2: /\bAUTH=XOAUTH2\b/i.test(response),
    idle: /\bIDLE\b/i.test(response),
    xGmExt1: /\bX-GM-EXT-1\b/i.test(response)
  };
}

function imapDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
  ];
  return `${day}-${months[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}

function base64Ascii(value: string): string {
  return btoa(value);
}

function base64Bytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytesFromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function base64Url(bytes: Uint8Array): string {
  return base64Bytes(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesFromBase64Url(value: string): Uint8Array {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`;
  return bytesFromBase64(padded.replace(/-/g, "+").replace(/_/g, "/"));
}

function tagOk(response: string, tag: string): boolean {
  return new RegExp(`(?:^|\\r?\\n)${tag} OK\\b`, "i").test(response);
}

function hasTaggedLine(response: string, tag: string): boolean {
  return new RegExp(`(?:^|\\r?\\n)${tag} (?:OK|NO|BAD)\\b`, "i").test(response);
}

function commandName(command: string): string {
  return command.split(/\s+/)[0] ?? "UNKNOWN";
}

function safeXoauthChallenge(response: string): string {
  const challenge = response
    .split(/\r?\n/)
    .find((line) => line.startsWith("+ "))
    ?.slice(2)
    .trim();
  if (!challenge) return "no challenge";
  try {
    const decoded = new TextDecoder().decode(bytesFromBase64(challenge));
    const parsed = JSON.parse(decoded) as { status?: string; scope?: string };
    return `status=${parsed.status ?? "unknown"} scope=${parsed.scope ?? "unknown"}`;
  } catch {
    return "unparseable challenge";
  }
}

function safeError(error: unknown, fallbackStage: string): SafeSpikeError {
  if (error instanceof SpikeFailure) {
    return { code: error.code, stage: error.stage, message: sanitizeMessage(error.message) };
  }
  return {
    code: "unexpected_error",
    stage: fallbackStage,
    message: sanitizeMessage(error instanceof Error ? error.message : String(error))
  };
}

function sanitizeMessage(value: string): string {
  return value
    .replace(/Bearer [^\s]+/g, "Bearer [redacted]")
    .replace(/code=[^&\s]+/g, "code=[redacted]")
    .slice(0, 400);
}

function elapsed(started: number): number {
  return Math.round((performance.now() - started) * 100) / 100;
}

function addTiming(current: number | undefined, next: number): number {
  return Math.round(((current ?? 0) + next) * 100) / 100;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function requiredEnv(value: string | undefined, name: string): string {
  if (!value) throw new SpikeFailure("missing_config", "config", `${name} is required`);
  return value;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let diff = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return diff === 0;
}

function spikeLimitations(): string[] {
  return [
    "Prototype only; not wired to DentLink connector storage or notifications.",
    "Requires a Gmail OAuth refresh token with https://mail.google.com/ scope.",
    "MIME parser is deliberately limited and intended for feasibility measurement only.",
    "Worker CPU and memory must be read from Wrangler or Cloudflare observability.",
    "No production migration decision should be made without reviewing remote reliability runs."
  ];
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
