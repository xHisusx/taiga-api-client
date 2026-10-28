import { ResolutionError } from "./catalog.js";

/**
 * Time windows for `taiga_activity`.
 *
 * Everything here is pure arithmetic on epoch milliseconds plus a fixed UTC offset. Named
 * zones are deliberately not supported: a DST transition inside a window would make the
 * same call mean two different things, and a report has to be reproducible.
 */

/** Named windows `taiga_activity` accepts instead of explicit bounds. */
export const ACTIVITY_PERIODS = ["last_week", "this_week", "last_7_days", "last_14_days"] as const;

/** One of {@link ACTIVITY_PERIODS}. */
export type ActivityPeriod = (typeof ACTIVITY_PERIODS)[number];

/** A fixed UTC offset: minutes east of UTC plus the label to echo back. */
export interface TimeZoneOffset {
  minutes: number;
  label: string;
}

/** The resolved half-open window `[sinceMs, untilMs)` and the zone it was resolved in. */
export interface ActivityWindow {
  /** The period name when the window came from one, `null` for explicit bounds. */
  period: ActivityPeriod | null;
  /** Inclusive lower bound, epoch ms. */
  sinceMs: number;
  /** Exclusive upper bound, epoch ms. */
  untilMs: number;
  zone: TimeZoneOffset;
}

/** What a caller may say about the window. All four fields are optional. */
export interface WindowInput {
  period?: ActivityPeriod | undefined;
  since?: string | undefined;
  until?: string | undefined;
  tz?: string | undefined;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

function pad(value: number, width = 2): string {
  return String(Math.abs(value)).padStart(width, "0");
}

/** Render an offset in minutes as `+HH:MM`. */
export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  return `${sign}${pad(Math.trunc(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;
}

/**
 * Parse a fixed UTC offset: `"+03:00"`, `"+0300"`, `"+3"`, `"-05:30"`, `"Z"`, `"UTC"`.
 *
 * @throws {ResolutionError} For anything else, including named zones.
 */
export function parseTimeZone(value: string): TimeZoneOffset {
  const raw = value.trim();
  if (/^(z|utc|gmt)$/i.test(raw)) return { minutes: 0, label: "+00:00" };

  const match = /^([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(raw);
  const hours = match ? Number(match[2]) : NaN;
  const minutes = match?.[3] !== undefined ? Number(match[3]) : 0;
  if (!match || hours > 14 || minutes > 59) {
    throw new ResolutionError(
      `"${raw}" is not a usable time zone. Pass a fixed UTC offset — "+03:00", "+0530", ` +
        `"-08:00" or "Z". Named zones like "Europe/Moscow" are not accepted, because a ` +
        `daylight-saving change inside the window would make the same call mean two things.`,
    );
  }

  const total = (hours * 60 + minutes) * (match[1] === "-" ? -1 : 1);
  return { minutes: total, label: formatOffset(total) };
}

/** Start of the local calendar day containing `ms`, as an epoch ms instant. */
function startOfLocalDay(ms: number, offsetMinutes: number): number {
  const local = ms + offsetMinutes * MINUTE_MS;
  return Math.floor(local / DAY_MS) * DAY_MS - offsetMinutes * MINUTE_MS;
}

/** Start of the local Monday of the week containing `ms`. */
function startOfLocalWeek(ms: number, offsetMinutes: number): number {
  const dayStart = startOfLocalDay(ms, offsetMinutes);
  // getUTCDay on the shifted instant reads the *local* weekday; 0 = Sunday, so rotate
  // it to make Monday the first day of the week.
  const weekday = (new Date(dayStart + offsetMinutes * MINUTE_MS).getUTCDay() + 6) % 7;
  return dayStart - weekday * DAY_MS;
}

/**
 * Resolve one named period against `now`.
 *
 * `last_week` spans seven whole days — Monday through Sunday — because work done on a
 * Saturday is still work done that week. The rolling periods start at local midnight so
 * that the same call returns the same window for the whole day.
 */
function fromPeriod(
  period: ActivityPeriod,
  now: number,
  offsetMinutes: number,
): { sinceMs: number; untilMs: number } {
  const thisWeek = startOfLocalWeek(now, offsetMinutes);
  switch (period) {
    case "last_week":
      return { sinceMs: thisWeek - 7 * DAY_MS, untilMs: thisWeek };
    case "this_week":
      return { sinceMs: thisWeek, untilMs: now };
    case "last_7_days":
      return { sinceMs: startOfLocalDay(now, offsetMinutes) - 6 * DAY_MS, untilMs: now };
    case "last_14_days":
      return { sinceMs: startOfLocalDay(now, offsetMinutes) - 13 * DAY_MS, untilMs: now };
  }
}

/**
 * Parse an explicit bound. A bare date means the start of that local day; a timestamp
 * without a zone is read in `tz`; one with a zone is taken as it stands.
 *
 * @throws {ResolutionError} When the text is not a date or an ISO-8601 timestamp.
 */
function parseBound(value: string, field: string, offsetMinutes: number): number {
  const raw = value.trim();

  const dateOnly = DATE_ONLY.exec(raw);
  if (dateOnly) {
    return calendarMs(raw, field, {
      year: Number(dateOnly[1]),
      month: Number(dateOnly[2]),
      day: Number(dateOnly[3]),
      offsetMinutes,
    });
  }

  const dateTime = DATE_TIME.exec(raw);
  if (dateTime) {
    const zone = dateTime[7];
    return calendarMs(raw, field, {
      year: Number(dateTime[1]),
      month: Number(dateTime[2]),
      day: Number(dateTime[3]),
      hour: Number(dateTime[4]),
      minute: Number(dateTime[5]),
      second: dateTime[6] !== undefined ? Number(dateTime[6]) : 0,
      offsetMinutes: zone
        ? parseTimeZone(zone.toUpperCase() === "Z" ? "Z" : zone).minutes
        : offsetMinutes,
    });
  }

  throw new ResolutionError(
    `"${raw}" is not a usable "${field}". Pass a date ("2026-10-19", read as the start of ` +
      `that day in tz) or an ISO-8601 timestamp ("2026-10-19T09:30:00+03:00").`,
  );
}

/** Build an instant from local calendar parts, rejecting dates that do not exist. */
function calendarMs(
  raw: string,
  field: string,
  parts: {
    year: number;
    month: number;
    day: number;
    hour?: number;
    minute?: number;
    second?: number;
    offsetMinutes: number;
  },
): number {
  const { year, month, day, hour = 0, minute = 0, second = 0 } = parts;
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const probe = new Date(wall);
  const real =
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day &&
    hour < 24 &&
    minute < 60 &&
    second < 60;
  if (!real) {
    throw new ResolutionError(`"${raw}" is not a real date and time for "${field}".`);
  }
  return wall - parts.offsetMinutes * MINUTE_MS;
}

/**
 * Turn what the caller said into a window.
 *
 * A period and explicit bounds are mutually exclusive, and `until` alone is refused:
 * guessing a start date is how a weekly report silently becomes a monthly one.
 *
 * @param input What the tool call asked for.
 * @param defaults Server-side fallbacks: the configured zone and the period to use when
 *                 the call says nothing at all.
 * @param now Epoch ms treated as the present, for the rolling periods.
 * @throws {ResolutionError} On a contradictory or unparsable window.
 */
export function resolveWindow(
  input: WindowInput,
  defaults: { tz: string; period: ActivityPeriod },
  now: number = Date.now(),
): ActivityWindow {
  const zone = parseTimeZone(input.tz ?? defaults.tz);

  if (input.period !== undefined && (input.since !== undefined || input.until !== undefined)) {
    throw new ResolutionError(
      `Pass either "period" (${ACTIVITY_PERIODS.join(" | ")}) or "since"/"until", not both — ` +
        `they would describe two different windows.`,
    );
  }
  if (input.until !== undefined && input.since === undefined) {
    throw new ResolutionError(
      `"until" needs "since": without a start the window would reach back to the beginning ` +
        `of the project. Pass "since", or a "period" instead.`,
    );
  }

  if (input.since === undefined) {
    const period = input.period ?? defaults.period;
    return { period, ...fromPeriod(period, now, zone.minutes), zone };
  }

  const sinceMs = parseBound(input.since, "since", zone.minutes);
  const untilMs =
    input.until !== undefined ? parseBound(input.until, "until", zone.minutes) : now;
  if (sinceMs >= untilMs) {
    throw new ResolutionError(
      `"since" (${localIso(sinceMs, zone.minutes)}) is not earlier than "until" ` +
        `(${localIso(untilMs, zone.minutes)}). The window is read as [since, until).`,
    );
  }

  return { period: null, sinceMs, untilMs, zone };
}

/**
 * Parse a timestamp Taiga produced into epoch ms, or `null` when it is not one.
 *
 * Tolerant on purpose: the same instant arrives as `2026-10-27T12:05:41.760Z` from the
 * timeline and as `2026-10-19 11:45:20.324208+00:00` inside a `values_diff`, and the
 * literal string `"None"` stands for an empty date field.
 */
export function parseInstant(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (raw === "" || raw === "None") return null;
  const ms = Date.parse(raw.replace(" ", "T"));
  return Number.isFinite(ms) ? ms : null;
}

/** An instant as a local ISO-8601 string carrying its offset. */
export function localIso(ms: number, offsetMinutes: number): string {
  const local = new Date(ms + offsetMinutes * MINUTE_MS);
  const date =
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  const time =
    `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`;
  return `${date}T${time}${formatOffset(offsetMinutes)}`;
}

/** An instant as a UTC ISO-8601 string, to the second. */
export function utcIso(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}

/**
 * The `window` block of the answer.
 *
 * Both forms are reported on purpose: a report quotes the local dates it was asked for,
 * while the UTC pair is what the timeline timestamps were actually compared against — and
 * three hours of difference is exactly enough to lose a Monday morning.
 */
export function formatWindow(window: ActivityWindow): Record<string, unknown> {
  return {
    period: window.period,
    since: localIso(window.sinceMs, window.zone.minutes),
    until: localIso(window.untilMs, window.zone.minutes),
    tz: window.zone.label,
    since_utc: utcIso(window.sinceMs),
    until_utc: utcIso(window.untilMs),
  };
}
