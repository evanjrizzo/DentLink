import { extractFirstLiteral, type ImapCommandResult } from "./protocol";
import { parseHeaders } from "./mime";

export type GmailImapIdentifiers = {
  xGmMsgId: string | null;
  messageId: string | null;
  uid: string | null;
  uidValidity: string | null;
  internalDate: string | null;
};

export function gmailIdentifiersFromFetch(
  response: string,
  uidValidity: string | null
): GmailImapIdentifiers {
  const headers = parseHeaders(extractFirstLiteral(response));
  return {
    xGmMsgId: response.match(/\bX-GM-MSGID\s+(\S+)/i)?.[1] ?? null,
    messageId: headers.get("message-id") ?? null,
    uid: response.match(/\bUID\s+(\d+)\b/i)?.[1] ?? null,
    uidValidity,
    internalDate: response.match(/\bINTERNALDATE\s+"([^"]+)"/i)?.[1] ?? null
  };
}

export function uidValidityFromSelect(response: string): string | null {
  return response.match(/\[UIDVALIDITY\s+(\d+)\]/i)?.[1] ?? null;
}

export function gmailSourceExternalId(input: GmailImapIdentifiers): string {
  if (input.xGmMsgId) return `x-gm-msgid:${input.xGmMsgId}`;
  if (input.messageId) return `message-id:${input.messageId}`;
  return `imap:${input.uidValidity ?? "unknown"}:${input.uid ?? "unknown"}:${input.internalDate ?? "unknown"}`;
}

export function headerFetchCommand(uid: string): string {
  return `UID FETCH ${uid} (UID X-GM-MSGID INTERNALDATE RFC822.SIZE FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM TO CC DATE MESSAGE-ID CONTENT-TYPE CONTENT-DISPOSITION CONTENT-TRANSFER-ENCODING AUTO-SUBMITTED PRECEDENCE X-AUTO-RESPONSE-SUPPRESS LIST-ID LIST-UNSUBSCRIBE MAILING-LIST)])`;
}

export function mimeFetchCommand(uid: string): string {
  return `UID FETCH ${uid} (UID X-GM-MSGID INTERNALDATE BODY.PEEK[])`;
}

export type GmailFetchedMessage = {
  uid: string;
  header: ImapCommandResult;
  mime: ImapCommandResult | null;
  identifiers: GmailImapIdentifiers;
};
