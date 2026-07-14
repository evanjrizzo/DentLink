export type ImapSocket = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  opened: Promise<unknown>;
  close(): Promise<void>;
};

export type ImapCommandResult = {
  tag: string;
  response: string;
  bytes: number;
};

const CRLF = "\r\n";

export class ImapProtocolError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ImapProtocolError";
  }
}

export class ImapProtocolClient {
  private tagCounter = 0;

  constructor(
    private readonly socket: ImapSocket,
    private readonly reader: ReadableStreamDefaultReader<Uint8Array>,
    private readonly writer: WritableStreamDefaultWriter<Uint8Array>
  ) {}

  static async fromSocket(socket: ImapSocket): Promise<ImapProtocolClient> {
    await socket.opened;
    const client = new ImapProtocolClient(
      socket,
      socket.readable.getReader(),
      socket.writable.getWriter()
    );
    const greeting = await client.readUntilLine();
    if (!greeting.startsWith("* OK")) {
      throw new ImapProtocolError("imap_greeting_invalid", "Unexpected IMAP greeting");
    }
    return client;
  }

  async authenticateXoauth2(initialResponse: string): Promise<ImapCommandResult> {
    const tag = this.nextTag();
    await this.write(`${tag} AUTHENTICATE XOAUTH2 ${initialResponse}${CRLF}`);
    const response = await this.readTaggedOrContinuation(tag);
    if (response.includes(`${CRLF}+ `) || response.startsWith("+ ")) {
      await this.write(CRLF);
      await this.readTagged(tag);
      throw new ImapProtocolError("imap_xoauth2_rejected", "XOAUTH2 rejected by IMAP server");
    }
    if (!tagOk(response, tag)) {
      throw new ImapProtocolError("imap_xoauth2_failed", "XOAUTH2 failed");
    }
    return { tag, response, bytes: byteLength(response) };
  }

  async command(command: string): Promise<ImapCommandResult> {
    const tag = this.nextTag();
    await this.write(`${tag} ${command}${CRLF}`);
    const response = await this.readTagged(tag);
    if (!tagOk(response, tag)) {
      throw new ImapProtocolError(
        "imap_command_failed",
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
      // Best-effort cleanup.
    }
    try {
      this.writer.releaseLock();
    } catch {
      // Best-effort cleanup.
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

export function selectedExistsCount(response: string): number | null {
  const match = /\* (\d+) EXISTS/i.exec(response);
  return match ? Number(match[1]) : null;
}

export function searchUids(response: string): string[] {
  const line = response
    .split(/\r?\n/)
    .find((candidate) => candidate.toUpperCase().startsWith("* SEARCH"));
  if (!line) return [];
  return line.split(/\s+/).slice(2).filter(Boolean);
}

export function extractFirstLiteral(response: string): string {
  const match = /\{(\d+)\}\r?\n/.exec(response);
  if (!match) return response;
  const start = match.index + match[0].length;
  return response.slice(start, start + Number(match[1]));
}

export function imapDate(date: Date): string {
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

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
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
