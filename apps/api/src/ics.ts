import type { CalendarEvent, CalendarEventInput } from "@dentlink/item-model";

export type ParsedIcsEvent = CalendarEventInput & { warnings: string[] };

export function parseIcsCalendar(input: string): ParsedIcsEvent[] {
  const lines = unfoldIcsLines(input);
  if (!lines.some((line) => line.toUpperCase() === "BEGIN:VCALENDAR")) {
    throw new IcsError("invalid_ics", "ICS must contain a VCALENDAR");
  }
  const events: ParsedIcsEvent[] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      current = [];
      continue;
    }
    if (upper === "END:VEVENT") {
      if (current) events.push(parseIcsEvent(current));
      current = null;
      continue;
    }
    if (current) current.push(line);
  }
  if (events.length === 0) throw new IcsError("invalid_ics", "ICS contains no events");
  return events;
}

export function serializeIcsCalendar(
  events: CalendarEvent[],
  now = new Date().toISOString()
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DentLink//Calendar Foundation//EN",
    "CALSCALE:GREGORIAN"
  ];
  for (const event of events) lines.push(...serializeEvent(event, now));
  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

export class IcsError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "IcsError";
  }
}

function parseIcsEvent(lines: string[]): ParsedIcsEvent {
  const props = new Map<string, Array<{ params: Record<string, string>; value: string }>>();
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const left = line.slice(0, separator);
    const value = unescapeText(line.slice(separator + 1));
    const [nameValue, ...paramValues] = left.split(";");
    const name = nameValue?.toUpperCase() ?? "";
    const params: Record<string, string> = {};
    for (const param of paramValues) {
      const [key, paramValue] = param.split("=");
      if (key && paramValue) params[key.toUpperCase()] = paramValue;
    }
    props.set(name, [...(props.get(name) ?? []), { params, value }]);
  }
  const uid = firstValue(props, "UID");
  const summary = firstValue(props, "SUMMARY")?.trim();
  const dtStart = firstProp(props, "DTSTART");
  const dtEnd = firstProp(props, "DTEND");
  if (!summary) throw new IcsError("invalid_ics_event", "ICS event summary is required");
  if (!dtStart) throw new IcsError("invalid_ics_event", "ICS event DTSTART is required");
  const start = parseIcsDateTime(dtStart.value, dtStart.params);
  const end = dtEnd ? parseIcsDateTime(dtEnd.value, dtEnd.params) : defaultEnd(start);
  const recurrence = firstValue(props, "RRULE");
  const warnings: string[] = [];
  if (lines.some((line) => /^EXDATE[:;]/i.test(line) || /^RDATE[:;]/i.test(line))) {
    warnings.push("RDATE and EXDATE are preserved only as unsupported recurrence metadata");
  }
  return {
    title: summary,
    description: firstValue(props, "DESCRIPTION") ?? "",
    location: firstValue(props, "LOCATION") ?? null,
    sourceUrl: safeIcsUrl(firstValue(props, "URL")),
    startAt: start.iso,
    endAt: end.iso,
    startDate: start.date,
    endDate: end.date,
    timezone: start.timezone ?? end.timezone,
    allDay: start.allDay,
    recurrenceRule: recurrence ? `RRULE:${recurrence}` : null,
    importedUid: uid ?? null,
    warnings
  };
}

function serializeEvent(event: CalendarEvent, now: string): string[] {
  const uid = event.importedUid ?? `${event.id}@dentlink.local`;
  const lines = [
    "BEGIN:VEVENT",
    `UID:${escapeText(uid)}`,
    `DTSTAMP:${toIcsUtc(now)}`,
    `CREATED:${toIcsUtc(event.createdAt)}`,
    `LAST-MODIFIED:${toIcsUtc(event.updatedAt)}`,
    `SUMMARY:${escapeText(event.title)}`
  ];
  if (event.allDay && event.startDate) {
    lines.push(`DTSTART;VALUE=DATE:${event.startDate.replaceAll("-", "")}`);
    if (event.endDate) lines.push(`DTEND;VALUE=DATE:${event.endDate.replaceAll("-", "")}`);
  } else {
    lines.push(`DTSTART:${toIcsUtc(event.startAt)}`);
    lines.push(`DTEND:${toIcsUtc(event.endAt)}`);
  }
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.sourceUrl) lines.push(`URL:${escapeText(event.sourceUrl)}`);
  if (event.recurrenceRule) lines.push(event.recurrenceRule);
  lines.push("END:VEVENT");
  return lines;
}

function unfoldIcsLines(input: string): string[] {
  return input
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .reduce<string[]>((lines, line) => {
      if (/^[ \t]/.test(line) && lines.length > 0) {
        lines[lines.length - 1] = `${lines[lines.length - 1]}${line.slice(1)}`;
      } else if (line.length > 0) {
        lines.push(line);
      }
      return lines;
    }, []);
}

function firstProp(
  props: Map<string, Array<{ params: Record<string, string>; value: string }>>,
  name: string
): { params: Record<string, string>; value: string } | undefined {
  return props.get(name)?.[0];
}

function firstValue(
  props: Map<string, Array<{ params: Record<string, string>; value: string }>>,
  name: string
): string | undefined {
  return firstProp(props, name)?.value;
}

function parseIcsDateTime(
  value: string,
  params: Record<string, string>
): { iso: string; date: string | null; timezone: string | null; allDay: boolean } {
  if (params.VALUE === "DATE" || /^\d{8}$/.test(value)) {
    const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    return { iso: `${date}T00:00:00.000Z`, date, timezone: null, allDay: true };
  }
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z|[+-]\d{4})?$/);
  if (!match) throw new IcsError("invalid_ics_datetime", "ICS datetime is invalid");
  const [, year, month, day, hour, minute, second, zone] = match;
  const base = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  if (zone === "Z") return { iso: `${base}.000Z`, date: null, timezone: "UTC", allDay: false };
  if (zone && /^[+-]\d{4}$/.test(zone)) {
    const offset = `${zone.slice(0, 3)}:${zone.slice(3)}`;
    return {
      iso: new Date(`${base}${offset}`).toISOString(),
      date: null,
      timezone: offset,
      allDay: false
    };
  }
  return {
    iso: `${base}.000Z`,
    date: null,
    timezone: params.TZID ?? null,
    allDay: false
  };
}

function defaultEnd(
  start: ReturnType<typeof parseIcsDateTime>
): ReturnType<typeof parseIcsDateTime> {
  const date = new Date(start.iso);
  date.setUTCHours(date.getUTCHours() + (start.allDay ? 24 : 1));
  return {
    iso: date.toISOString(),
    date: start.allDay ? date.toISOString().slice(0, 10) : null,
    timezone: start.timezone,
    allDay: start.allDay
  };
}

function safeIcsUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function toIcsUtc(value: string): string {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(".000", "");
}

function escapeText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

function unescapeText(value: string): string {
  return value
    .replaceAll("\\n", "\n")
    .replaceAll("\\,", ",")
    .replaceAll("\\;", ";")
    .replaceAll("\\\\", "\\");
}

function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    chunks.push(rest.slice(0, 75));
    rest = ` ${rest.slice(75)}`;
  }
  chunks.push(rest);
  return chunks.join("\r\n");
}
