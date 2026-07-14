import { imapDate } from "./protocol";

export function recentSinceDate(now: string, days: number): string {
  return imapDate(new Date(Date.parse(now) - Math.max(1, days) * 24 * 60 * 60 * 1000));
}

export function boundedLatest<T>(values: T[], limit: number): T[] {
  return values.slice(-Math.max(0, limit));
}
