import { describe, expect, it } from "vitest";
import { ResolutionError } from "../src/catalog.js";
import { formatWindow, parseInstant, parseTimeZone, resolveWindow } from "../src/window.js";

/** Wednesday 2026-10-28, 10:00 in Moscow. */
const NOW = Date.parse("2026-10-28T07:00:00.000Z");

const MSK = { tz: "+03:00", period: "last_week" } as const;

function resolved(input: Parameters<typeof resolveWindow>[0], now = NOW) {
  return formatWindow(resolveWindow(input, MSK, now));
}

describe("parseTimeZone", () => {
  it("accepts every spelling of a fixed offset", () => {
    expect(parseTimeZone("+03:00")).toEqual({ minutes: 180, label: "+03:00" });
    expect(parseTimeZone("+0300")).toEqual({ minutes: 180, label: "+03:00" });
    expect(parseTimeZone("+3")).toEqual({ minutes: 180, label: "+03:00" });
    expect(parseTimeZone("-05:30")).toEqual({ minutes: -330, label: "-05:30" });
    expect(parseTimeZone("Z")).toEqual({ minutes: 0, label: "+00:00" });
    expect(parseTimeZone("UTC")).toEqual({ minutes: 0, label: "+00:00" });
  });

  it("refuses a named zone, and says why", () => {
    expect(() => parseTimeZone("Europe/Moscow")).toThrow(/fixed UTC offset/);
    expect(() => parseTimeZone("Europe/Moscow")).toThrow(/daylight-saving/);
    expect(() => parseTimeZone("+99:00")).toThrow(ResolutionError);
  });
});

describe("resolveWindow", () => {
  it("spans the seven whole days of the previous week", () => {
    expect(resolved({ period: "last_week" })).toEqual({
      period: "last_week",
      since: "2026-10-19T00:00:00+03:00",
      until: "2026-10-26T00:00:00+03:00",
      tz: "+03:00",
      // Three hours of offset is what decides whether Monday morning belongs to the week.
      since_utc: "2026-10-18T21:00:00Z",
      until_utc: "2026-10-25T21:00:00Z",
    });
  });

  it("resolves the same week differently in another zone", () => {
    expect(resolved({ period: "last_week", tz: "Z" })).toMatchObject({
      since: "2026-10-19T00:00:00+00:00",
      since_utc: "2026-10-19T00:00:00Z",
      until_utc: "2026-10-26T00:00:00Z",
    });
  });

  it("runs this week up to now, and the rolling windows back from today", () => {
    expect(resolved({ period: "this_week" })).toMatchObject({
      since: "2026-10-26T00:00:00+03:00",
      until: "2026-10-28T10:00:00+03:00",
    });
    expect(resolved({ period: "last_7_days" })).toMatchObject({
      since: "2026-10-22T00:00:00+03:00",
      until: "2026-10-28T10:00:00+03:00",
    });
    expect(resolved({ period: "last_14_days" })).toMatchObject({
      since: "2026-10-15T00:00:00+03:00",
    });
  });

  it("defaults to last week when the call says nothing", () => {
    expect(resolved({})).toMatchObject({ period: "last_week", since: "2026-10-19T00:00:00+03:00" });
  });

  it("reads a bare date as the start of that local day", () => {
    expect(resolved({ since: "2026-10-19", until: "2026-10-24" })).toEqual({
      period: null,
      since: "2026-10-19T00:00:00+03:00",
      until: "2026-10-24T00:00:00+03:00",
      tz: "+03:00",
      since_utc: "2026-10-18T21:00:00Z",
      until_utc: "2026-10-23T21:00:00Z",
    });
  });

  it("takes a timestamp's own offset, and reads one without a zone in tz", () => {
    expect(resolved({ since: "2026-10-19T09:30:00+05:00" })).toMatchObject({
      since_utc: "2026-10-19T04:30:00Z",
    });
    expect(resolved({ since: "2026-10-19T09:30:00" })).toMatchObject({
      since_utc: "2026-10-19T06:30:00Z",
    });
    expect(resolved({ since: "2026-10-19T09:30:00Z" })).toMatchObject({
      since_utc: "2026-10-19T09:30:00Z",
    });
  });

  it("runs an open-ended since up to now", () => {
    expect(resolved({ since: "2026-10-27" })).toMatchObject({
      until: "2026-10-28T10:00:00+03:00",
    });
  });

  it("refuses a window that describes two things at once", () => {
    expect(() => resolved({ period: "last_week", since: "2026-10-19" })).toThrow(
      /either "period" .* or "since"\/"until"/,
    );
    expect(() => resolved({ until: "2026-10-26" })).toThrow(/"until" needs "since"/);
    expect(() => resolved({ since: "2026-10-26", until: "2026-10-19" })).toThrow(
      /not earlier than "until"/,
    );
    expect(() => resolved({ since: "last monday" })).toThrow(/not a usable "since"/);
    expect(() => resolved({ since: "2026-02-31" })).toThrow(/not a real date/);
  });
});

describe("parseInstant", () => {
  it("reads both timestamp spellings Taiga uses, and None as absent", () => {
    expect(parseInstant("2026-10-27T12:05:41.760Z")).toBe(Date.parse("2026-10-27T12:05:41.760Z"));
    expect(parseInstant("2026-10-19 11:45:20.324208+00:00")).toBe(
      Date.parse("2026-10-19T11:45:20.324Z"),
    );
    expect(parseInstant("None")).toBeNull();
    expect(parseInstant("")).toBeNull();
    expect(parseInstant(null)).toBeNull();
    expect(parseInstant("not a date")).toBeNull();
  });
});
