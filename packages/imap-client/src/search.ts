import { imapDate } from "./protocol";

export function recentSinceDate(now: string, days: number): string {
  return imapDate(new Date(Date.parse(now) - Math.max(1, days) * 24 * 60 * 60 * 1000));
}

export function uidSearchCommand(since: string, newerThanUid?: string | null): string {
  const nextUid = nextImapUid(newerThanUid);
  return nextUid ? `UID SEARCH UID ${nextUid}:*` : `UID SEARCH SINCE ${since}`;
}

export function boundedLatest<T>(values: T[], limit: number): T[] {
  return values.slice(-Math.max(0, limit));
}

function nextImapUid(uid?: string | null): string | null {
  if (!uid || !/^\d+$/.test(uid)) return null;
  const next = BigInt(uid) + 1n;
  if (next <= 0n || next > 4_294_967_295n) return null;
  return next.toString();
}
