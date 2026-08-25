import {
  gmailIdentifiersFromFetch,
  gmailSourceExternalId,
  headerFetchCommand,
  mimeFetchCommand
} from "./gmail";
import { parseMime, type ParsedMimeMessage } from "./mime";
import {
  extractFirstLiteral,
  searchUids,
  selectedExistsCount,
  type ImapProtocolClient
} from "./protocol";
import { boundedOldest, recentSinceDate, uidSearchCommand } from "./search";
import { xoauth2InitialResponse } from "./xoauth2";

import type { GmailImapIdentifiers } from "./gmail";

export type GmailImapPollOptions = {
  user: string;
  accessToken: string;
  now: string;
  recentWindowDays?: number;
  maxMessages?: number;
  newerThanUid?: string | null;
  expectedUidValidity?: string | null;
  signal?: AbortSignal;
};

export type GmailImapMessage = {
  uid: string;
  sourceExternalId: string;
  identifiers: GmailImapIdentifiers;
  parsed: ParsedMimeMessage;
  rawSizeBytes: number;
};

export type GmailImapPollResult = {
  mailboxMessageCount: number | null;
  uidValidity: string | null;
  discoveredUids: string[];
  messages: GmailImapMessage[];
};

export async function pollGmailImap(
  client: ImapProtocolClient,
  options: GmailImapPollOptions
): Promise<GmailImapPollResult> {
  throwIfAborted(options.signal);
  await client.command("CAPABILITY");
  throwIfAborted(options.signal);
  await client.authenticateXoauth2(xoauth2InitialResponse(options.user, options.accessToken));
  throwIfAborted(options.signal);
  const select = await client.command("SELECT INBOX");
  const uidValidity = select.response.match(/\[UIDVALIDITY\s+(\d+)\]/i)?.[1] ?? null;
  const since = recentSinceDate(options.now, options.recentWindowDays ?? 2);
  const newerThanUid =
    options.expectedUidValidity && options.expectedUidValidity === uidValidity
      ? options.newerThanUid
      : null;
  throwIfAborted(options.signal);
  const search = await client.command(uidSearchCommand(since, newerThanUid));
  const discoveredUids = searchUids(search.response);
  const fetchUids = boundedOldest(discoveredUids, options.maxMessages ?? 25);
  const messages: GmailImapMessage[] = [];
  for (const uid of fetchUids) {
    throwIfAborted(options.signal);
    const header = await client.command(headerFetchCommand(uid));
    throwIfAborted(options.signal);
    const mime = await client.command(mimeFetchCommand(uid));
    const identifiers = gmailIdentifiersFromFetch(header.response, uidValidity);
    const parsed = parseMime(extractFirstLiteral(mime.response));
    messages.push({
      uid,
      sourceExternalId: gmailSourceExternalId(identifiers),
      identifiers,
      parsed,
      rawSizeBytes: mime.bytes
    });
  }
  return {
    mailboxMessageCount: selectedExistsCount(select.response),
    uidValidity,
    discoveredUids,
    messages
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("IMAP poll aborted");
}
