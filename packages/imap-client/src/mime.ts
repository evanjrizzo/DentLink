import { byteLength } from "./protocol";

export type ParsedMimeMessage = {
  subject: string | null;
  from: string | null;
  to: string | null;
  cc: string | null;
  date: string | null;
  messageId: string | null;
  plainText: string | null;
  html: string | null;
  attachments: AttachmentMetadata[];
  headers: Map<string, string>;
};

export type AttachmentMetadata = {
  filename: string | null;
  contentType: string;
  disposition: string | null;
  contentId: string | null;
  sizeBytes: number | null;
};

type MimePart = {
  headers: Map<string, string>;
  contentType: string;
  body: string;
  attachment: AttachmentMetadata | null;
};

export function parseMime(raw: string): ParsedMimeMessage {
  const { headers, body } = splitMessage(raw);
  const contentType = headerValue(headers, "content-type") ?? "text/plain";
  const parts = collectParts(contentType, headers, body);
  return {
    subject: decodeHeader(headerValue(headers, "subject")),
    from: decodeHeader(headerValue(headers, "from")),
    to: decodeHeader(headerValue(headers, "to")),
    cc: decodeHeader(headerValue(headers, "cc")),
    date: headerValue(headers, "date"),
    messageId: headerValue(headers, "message-id"),
    plainText: firstPartText(parts, "text/plain"),
    html: firstPartText(parts, "text/html"),
    attachments: parts
      .filter((part) => part.attachment)
      .map((part) => part.attachment as AttachmentMetadata),
    headers
  };
}

export function splitMessage(raw: string): { headers: Map<string, string>; body: string } {
  const normalized = raw.replace(/\r\n/g, "\n");
  const splitAt = normalized.indexOf("\n\n");
  const headerBlock = splitAt >= 0 ? normalized.slice(0, splitAt) : normalized;
  const body = splitAt >= 0 ? normalized.slice(splitAt + 2) : "";
  return { headers: parseHeaders(headerBlock), body };
}

export function parseHeaders(headerBlock: string): Map<string, string> {
  const headers = new Map<string, string>();
  const unfolded = headerBlock.replace(/\n[ \t]+/g, " ");
  for (const line of unfolded.split("\n")) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return headers;
}

export function headerValue(headers: Map<string, string>, name: string): string | null {
  return headers.get(name.toLowerCase()) ?? null;
}

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
  const decodedBody = decodeBody(body, transferEncoding, parameter(contentType, "charset"));
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

function firstPartText(parts: MimePart[], contentType: string): string | null {
  return (
    parts.find((part) => part.contentType === contentType && !part.attachment)?.body.trim() || null
  );
}

function parameter(value: string, name: string): string | null {
  const pattern = new RegExp(`${name}\\*?=(?:"([^"]+)"|([^;]+))`, "i");
  const match = pattern.exec(value);
  return decodeHeader(match?.[1] ?? match?.[2] ?? null);
}

function decodeBody(body: string, encoding: string, charset: string | null): string {
  if (encoding === "base64") {
    try {
      return decodeBytes(binaryStringToBytes(atob(body.replace(/\s+/g, ""))), charset);
    } catch {
      return body;
    }
  }
  if (encoding === "quoted-printable") return decodeQuotedPrintable(body, charset);
  return body;
}

function decodeQuotedPrintable(value: string, charset: string | null = null): string {
  const binary = value
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    );
  return decodeBytes(binaryStringToBytes(binary), charset);
}

function decodeHeader(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/=\?([^?]+)\?([bqBQ])\?([^?]+)\?=/g, (_match, _charset, encoding, text) => {
    const charset = String(_charset);
    if (String(encoding).toLowerCase() === "b") {
      try {
        return decodeBytes(binaryStringToBytes(atob(String(text))), charset);
      } catch {
        return String(text);
      }
    }
    return decodeQuotedPrintable(String(text).replace(/_/g, " "), charset);
  });
}

function binaryStringToBytes(value: string): Uint8Array {
  return Uint8Array.from(value, (char) => char.charCodeAt(0) & 0xff);
}

function decodeBytes(bytes: Uint8Array, charset: string | null): string {
  const normalized = (charset ?? "utf-8").trim().toLowerCase();
  const label =
    normalized === "utf8"
      ? "utf-8"
      : normalized === "latin1" || normalized === "iso8859-1"
        ? "iso-8859-1"
        : normalized || "utf-8";
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}
