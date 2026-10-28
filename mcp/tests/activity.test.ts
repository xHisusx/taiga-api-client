import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaigaMcpConfig } from "../src/config.js";
import { createServer } from "../src/server.js";
import type { TimelineEvent } from "../src/timeline.js";
import { MemoryTokenStore } from "../src/token-store.js";
import { FakeTaiga, fakeConfig, type FakeTaigaOptions } from "./fake-taiga.js";
import { APOLLO_TIMELINE, ORION_TIMELINE } from "./fixtures/timeline.js";

/**
 * Wednesday 2026-10-28, 10:00 Moscow time, so `last_week` is the week of Monday the 19th:
 * `[2026-10-18T21:00Z, 2026-10-25T21:00Z)`.
 */
const NOW = new Date("2026-10-28T07:00:00.000Z");

interface ActivityItem extends Record<string, unknown> {
  type: string;
  id: number;
  ref: number | null;
  project: string;
}

interface ActivityPayload extends Record<string, unknown> {
  window: Record<string, string>;
  projects: Array<Record<string, unknown>>;
  truncated: boolean;
  items?: ActivityItem[];
  events?: Array<Record<string, unknown>>;
  sprints: Array<Record<string, unknown>>;
}

/** Base fields shared by every work item the fake serves. */
function item(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    project: 7,
    project_extra_info: { id: 7, name: "Apollo", slug: "apollo" },
    is_blocked: false,
    owner: 1,
    watchers: [],
    version: 1,
    tags: [],
    assigned_to: 1,
    assigned_to_extra_info: { id: 1, username: "alice" },
    ...overrides,
  };
}

/**
 * Give the fake the inventory the timeline refers to.
 *
 * The timeline only ever names a card; status, tags, sprint and the finish date have to
 * come from the list endpoints, which is also where a retroactive closure shows up.
 */
function seed(fake: FakeTaiga): void {
  fake.timelines.set(7, [...APOLLO_TIMELINE]);
  fake.timelines.set(8, [...ORION_TIMELINE]);

  fake.stories.set(
    1001,
    item({
      id: 1001,
      ref: 12,
      subject: "Login with SSO",
      status: 103,
      status_extra_info: { name: "Done", is_closed: true },
      is_closed: true,
      finish_date: "2026-10-23T16:40:10.112Z",
      tags: [["ui", null], ["auth", null]],
      milestone: 902,
      milestone_name: "Sprint 2",
      assigned_to: 2,
      assigned_to_extra_info: { id: 2, username: "bob" },
    }),
  );
  fake.stories.set(
    1002,
    item({
      id: 1002,
      ref: 13,
      subject: "Rotate the signing keys",
      status: 102,
      status_extra_info: { name: "In progress", is_closed: false },
      tags: ["backend"],
      milestone: 902,
      milestone_name: "Sprint 2",
    }),
  );
  // Moved to Done on the 27th, but finished on the 21st — the retroactive closure.
  fake.stories.set(
    1003,
    item({
      id: 1003,
      ref: 14,
      subject: "Audit log retention",
      status: 103,
      status_extra_info: { name: "Done", is_closed: true },
      is_closed: true,
      finish_date: "2026-10-21T09:15:00.000Z",
      tags: ["support"],
    }),
  );
  fake.stories.set(
    1004,
    item({
      id: 1004,
      ref: 15,
      subject: "Publish the token endpoint",
      status: 101,
      status_extra_info: { name: "New", is_closed: false },
      // Taiga spells an empty date field "None".
      finish_date: "None",
    }),
  );
  fake.stories.set(
    1005,
    item({
      id: 1005,
      ref: 16,
      subject: "Retire the legacy session store",
      status: 101,
      status_extra_info: { name: "New", is_closed: false },
    }),
  );
  fake.stories.set(
    1006,
    item({
      id: 1006,
      ref: 17,
      subject: "Monday morning triage",
      status: 101,
      status_extra_info: { name: "New", is_closed: false },
    }),
  );
  fake.stories.set(
    5001,
    item({
      id: 5001,
      ref: 1,
      subject: "Migrate the billing job",
      project: 8,
      project_extra_info: { id: 8, name: "Orion", slug: "orion" },
      status: 102,
      status_extra_info: { name: "In progress", is_closed: false },
    }),
  );

  fake.tasks.set(
    2001,
    item({
      id: 2001,
      ref: 34,
      subject: "Wire up the OIDC callback",
      status: 202,
      status_extra_info: { name: "In progress", is_closed: false },
      user_story: 1001,
      user_story_extra_info: { id: 1001, ref: 12, subject: "Login with SSO" },
    }),
  );
  fake.issues.set(
    4001,
    item({
      id: 4001,
      ref: 183,
      subject: "Login loops on Safari",
      status: 301,
      status_extra_info: { name: "New", is_closed: false },
      tags: ["support"],
    }),
  );
  fake.epics.set(
    3001,
    item({
      id: 3001,
      ref: 97,
      subject: "Authentication",
      status: 401,
      status_extra_info: { name: "New", is_closed: false },
    }),
  );
}

async function connect(
  overrides: Record<string, unknown> = {},
  fakeOptions: FakeTaigaOptions = {},
) {
  const fake = new FakeTaiga(fakeOptions);
  seed(fake);

  const { server } = createServer({
    config: fakeConfig(overrides) as unknown as TaigaMcpConfig,
    deps: { fetch: fake.fetch, tokenStore: new MemoryTokenStore() },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const activity = async (args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name: "taiga_activity", arguments: args });
    const text = (result.content as Array<{ text?: string }>)[0]?.text ?? "";
    return {
      isError: result.isError === true,
      text,
      payload: () => JSON.parse(text) as ActivityPayload,
    };
  };

  return { fake, activity };
}

/** `count` events newer than `until`, which the walk has to page past to reach the window. */
function newerThanWindow(count: number): TimelineEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    id: 7000 + index,
    created: new Date(Date.parse("2026-10-28T06:00:00.000Z") - index * 1_000).toISOString(),
    event_type: "userstories.userstory.change",
    object_id: 1001,
    project: 7,
    data: {
      user: { id: 1, name: "Alice Example" },
      userstory: { id: 1001, ref: 12, subject: "Login with SSO" },
      values_diff: { status: ["Done", "Done"] },
    },
  }));
}

/** `count` events inside the window, newest first. */
function insideWindow(count: number): TimelineEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    id: 8000 + index,
    created: new Date(Date.parse("2026-10-24T12:00:00.000Z") - index * 60_000).toISOString(),
    event_type: "userstories.userstory.change",
    object_id: 1001,
    project: 7,
    data: {
      user: { id: 1, name: "Alice Example" },
      userstory: { id: 1001, ref: 12, subject: "Login with SSO" },
      values_diff: { status: ["In Progress", "In Progress"] },
    },
  }));
}

/** What a compact answer leaves out: the values that say nothing. */
function isEmpty(value: unknown): boolean {
  if (value === null || value === false || value === 0 || value === "") return true;
  return Array.isArray(value) && value.length === 0;
}

/** One item of the answer, by `#ref`. */
function byRef(payload: ActivityPayload, ref: number): ActivityItem | undefined {
  return payload.items?.find((entry) => entry.ref === ref);
}

const LAST_WEEK = { projects: "apollo", period: "last_week" };

beforeEach(() => {
  // Only Date is faked: the transport and the HTTP timeout keep their real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("taiga_activity: the window", () => {
  it("echoes the resolved window in local and UTC form", async () => {
    const { activity } = await connect();
    const payload = (await activity(LAST_WEEK)).payload();

    expect(payload.window).toEqual({
      period: "last_week",
      since: "2026-10-19T00:00:00+03:00",
      until: "2026-10-26T00:00:00+03:00",
      tz: "+03:00",
      since_utc: "2026-10-18T21:00:00Z",
      until_utc: "2026-10-25T21:00:00Z",
    });
  });

  it("includes an event exactly at since and excludes one exactly at until", async () => {
    const { activity } = await connect();
    const payload = (await activity(LAST_WEEK)).payload();

    // #15 was created at 2026-10-18T21:00:00.000Z — the inclusive edge.
    expect(byRef(payload, 15)).toMatchObject({ subject: "Publish the token endpoint" });
    // #16 changed at 2026-10-25T21:00:00.000Z — the exclusive one.
    expect(byRef(payload, 16)).toBeUndefined();
  });

  it("decides a Monday-morning event by the time zone, not by UTC", async () => {
    const { activity } = await connect();

    // 2026-10-19T00:30+03:00 is inside the Moscow week...
    const moscow = (await activity(LAST_WEEK)).payload();
    expect(byRef(moscow, 17)).toMatchObject({ subject: "Monday morning triage" });

    // ...and 2026-10-18T21:30Z is before the UTC one.
    const utc = (await activity({ ...LAST_WEEK, tz: "Z" })).payload();
    expect(byRef(utc, 17)).toBeUndefined();
  });

  it("refuses a window that says two things at once", async () => {
    const { activity } = await connect();

    const both = await activity({ projects: "apollo", period: "last_week", since: "2026-10-19" });
    expect(both.isError).toBe(true);
    expect(both.text).toMatch(/either "period" \(last_week \| this_week/);

    const dangling = await activity({ projects: "apollo", until: "2026-10-26" });
    expect(dangling.isError).toBe(true);
    expect(dangling.text).toMatch(/"until" needs "since"/);
  });
});

describe("taiga_activity: what happened to a card", () => {
  it("sums up a card that was worked on and closed", async () => {
    const { activity } = await connect();
    const story = byRef((await activity(LAST_WEEK)).payload(), 12);

    expect(story).toMatchObject({
      project: "apollo",
      type: "userstory",
      id: 1001,
      subject: "Login with SSO",
      url: "https://board.taiga.test/project/apollo/us/12",
      status_now: "Done",
      tags: ["ui", "auth"],
      sprint: "Sprint 2",
      assignees: ["bob"],
      status_is_closed: true,
      status_path: [
        { name: "New", is_closed: false },
        { name: "In Progress", is_closed: false },
        { name: "Done", is_closed: true },
      ],
      event_kinds: [
        "assignee",
        "attachment",
        "close_flag",
        "comment",
        "description",
        "finish_date",
        "status",
      ],
      closed_in_period: true,
      closed_flag_in_period: true,
      closure_only: false,
      tasks_total: 1,
      tasks_done: 0,
      all_tasks_done: false,
      source: "both",
      planning_only: false,
      first_event_at: "2026-10-19T12:00:00.000Z",
      last_event_at: "2026-10-23T16:40:11.004Z",
      events_count: 5,
      description_changed: true,
      attachments_added: 1,
      attachments_removed: 1,
      reassigned: [["Alice Example", "Bob Builder"]],
    });
    expect(story?.["comments"]).toEqual([
      {
        at: "2026-10-19T12:00:00.000Z",
        author: "Bob Builder",
        text: "Picked this up, starting with the OIDC bits.",
      },
    ]);
  });

  it("carries the parent story of a task", async () => {
    const { activity } = await connect();
    expect(byRef((await activity(LAST_WEEK)).payload(), 34)).toMatchObject({
      type: "task",
      parent: { type: "userstory", id: 1001, ref: 12, subject: "Login with SSO" },
      status_path: [
        { name: "New", is_closed: false },
        { name: "In progress", is_closed: false },
      ],
    });
  });

  it("reads a comment whose values_diff is an empty array", async () => {
    const { activity } = await connect();
    const issue = byRef((await activity(LAST_WEEK)).payload(), 183);

    expect(issue).toMatchObject({ type: "issue", events_count: 1, planning_only: false });
    expect(issue?.["comments"]).toEqual([
      {
        at: "2026-10-22T09:30:00.000Z",
        author: "Bob Builder",
        text: "Reproduced on staging — the callback drops the state parameter.",
      },
    ]);
  });

  it("truncates a long comment and says so", async () => {
    const { activity } = await connect();
    const payload = (await activity({ ...LAST_WEEK, comment_chars: 10 })).payload();
    const comments = byRef(payload, 183)?.["comments"] as Array<Record<string, unknown>>;

    expect(comments[0]).toMatchObject({ text: "Reproduced…", truncated: true });
  });

  it("leaves comments out when they were not asked for", async () => {
    const { activity } = await connect();
    const payload = (await activity({ ...LAST_WEEK, include_comments: false })).payload();

    expect(byRef(payload, 183)?.["comments"]).toEqual([]);
    // The comment still counts as work, so the card is not reported as planning.
    expect(byRef(payload, 183)?.["planning_only"]).toBe(false);
    expect(JSON.stringify(payload)).not.toContain("Reproduced on staging");
  });
});

describe("taiga_activity: the rules a report would otherwise invent", () => {
  it("reports a closure entered after the fact, with no event in the window", async () => {
    const { activity } = await connect();
    const asked = { ...LAST_WEEK, include_by_finish_date: true };
    const story = byRef((await activity(asked)).payload(), 14);

    expect(story).toMatchObject({
      type: "userstory",
      id: 1003,
      subject: "Audit log retention",
      source: "finish_date",
      closed_in_period: true,
      finish_date: "2026-10-21T09:15:00.000Z",
      events_count: 0,
      first_event_at: null,
      last_event_at: null,
      planning_only: false,
      status_now: "Done",
      status_is_closed: true,
      // Nobody saw it happen, so there is no status path and nothing was only closed.
      status_events: [],
      event_kinds: [],
      closed_flag_in_period: false,
      closure_only: false,
    });
  });

  it('reads "None" as an absent finish date', async () => {
    const { activity } = await connect();
    expect(byRef((await activity(LAST_WEEK)).payload(), 15)).toMatchObject({
      finish_date: null,
      closed_in_period: false,
    });
  });

  it("marks a card that was only planned, and unmarks it once work lands", async () => {
    const { fake, activity } = await connect();

    const planned = byRef((await activity(LAST_WEEK)).payload(), 13);
    expect(planned).toMatchObject({
      moved_to_sprint: "Sprint 2",
      planning_only: true,
      status_path: [],
      // The board reordering next to the sprint move is not an event anybody worked.
      events_count: 1,
    });

    const commented: TimelineEvent = {
      id: 9999,
      created: "2026-10-21T08:00:00.000Z",
      event_type: "userstories.userstory.change",
      object_id: 1002,
      project: 7,
      data: {
        user: { id: 1, name: "Alice Example" },
        userstory: { id: 1002, ref: 13, subject: "Rotate the signing keys" },
        comment: "Blocked on the HSM ticket.",
        values_diff: [],
      },
    };
    fake.timelines.set(7, [...APOLLO_TIMELINE.slice(0, 8), commented, ...APOLLO_TIMELINE.slice(8)]);

    expect(byRef((await activity(LAST_WEEK)).payload(), 13)).toMatchObject({
      planning_only: false,
      events_count: 2,
    });
  });

  it("drops board positions entirely, and never counts them as events", async () => {
    const { activity } = await connect();
    const payload = (await activity(LAST_WEEK)).payload();
    const serialized = JSON.stringify(payload);

    for (const field of ["backlog_order", "sprint_order", "kanban_order", "taskboard_order"]) {
      expect(serialized).not.toContain(field);
    }
    // #13 was touched twice: a sprint move and a bare reorder. Only the move is an event.
    expect(byRef(payload, 13)).toMatchObject({ events_count: 1 });
  });

  it("reports a description change as a flag, never as text", async () => {
    const { activity } = await connect();
    const payload = (await activity(LAST_WEEK)).payload();

    expect(JSON.stringify(payload)).not.toContain("Check the history API");
    expect(JSON.stringify(payload)).not.toContain("description_diff");
    expect(byRef(payload, 12)).toMatchObject({ description_changed: true });
  });

  it("counts attachments without ever echoing their tokenized URLs", async () => {
    const { activity } = await connect();
    const serialized = JSON.stringify((await activity(LAST_WEEK)).payload());

    expect(serialized).not.toContain("token=");
    expect(serialized).not.toContain("sso-sequence.png");
    expect(serialized).not.toContain("/media/");
  });

  it("never leaks the HTML rendering of a comment", async () => {
    const { activity } = await connect();
    const serialized = JSON.stringify((await activity(LAST_WEEK)).payload());

    expect(serialized).not.toContain("comment_html");
    expect(serialized).not.toContain("<p>");
  });
});

describe("taiga_activity: collection", () => {
  it("counts what it scanned, what fell in the window, and stops at since", async () => {
    const { fake, activity } = await connect();
    const payload = (await activity(LAST_WEEK)).payload();

    expect(payload.projects).toEqual([
      {
        project: "apollo",
        project_id: 7,
        events_scanned: 16,
        events_in_window: 13,
        items: 7,
      },
    ]);
    expect(payload.truncated).toBe(false);
    expect(fake.find("GET", "/timeline/project/7")).toHaveLength(1);
  });

  it("says so when the page budget ran out before the window did", async () => {
    const { fake, activity } = await connect();
    const filler: TimelineEvent[] = Array.from({ length: 100 }, (_, index) => ({
      id: 8000 + index,
      created: new Date(Date.parse("2026-10-24T12:00:00.000Z") - index * 1000).toISOString(),
      event_type: "userstories.userstory.change",
      object_id: 1001,
      project: 7,
      data: {
        user: { id: 1, name: "Alice Example" },
        userstory: { id: 1001, ref: 12, subject: "Login with SSO" },
        values_diff: { subject: ["Login with SSO", "Login with SSO"] },
      },
    }));
    fake.timelines.set(7, [...filler, ...APOLLO_TIMELINE]);

    const payload = (await activity({ ...LAST_WEEK, max_pages: 1 })).payload();

    expect(payload.truncated).toBe(true);
    expect(payload.projects[0]).toMatchObject({ truncated: true, events_scanned: 100 });
    expect(fake.find("GET", "/timeline/project/7")[0]?.query).toMatchObject({
      page_size: "100",
      page: "1",
    });
  });

  it("enriches with one list request per kind, not one per card", async () => {
    const { fake, activity } = await connect();
    await activity(LAST_WEEK);

    expect(fake.find("GET", "/userstories")).toHaveLength(1);
    expect(fake.find("GET", "/tasks")).toHaveLength(1);
    expect(fake.find("GET", "/issues")).toHaveLength(1);
    expect(fake.find("GET", "/epics")).toHaveLength(1);
    expect(fake.find("GET", "/userstories/1001")).toHaveLength(0);
    // And nothing of the old, expensive way round.
    expect(fake.requests.filter((request) => request.path.startsWith("/history"))).toEqual([]);
  });

  it("falls back to reading the touched cards one by one when a list fails", async () => {
    const { fake, activity } = await connect(
      {},
      { failOnce: { "GET /issues": { status: 500, body: { _error_message: "boom" } } } },
    );
    const payload = (await activity(LAST_WEEK)).payload();

    expect(fake.find("GET", "/issues/4001")).toHaveLength(1);
    expect(byRef(payload, 183)).toMatchObject({ status_now: "New", tags: ["support"] });
    expect(String(payload.projects[0]?.["degraded"])).toMatch(/issues: Taiga API error 500/);
  });

  it("does not pass off one page as the whole project", async () => {
    const { fake, activity } = await connect({}, { listCap: 2 });
    const payload = (
      await activity({ ...LAST_WEEK, include_by_finish_date: true })
    ).payload();

    expect(String(payload.projects[0]?.["degraded"])).toMatch(
      /user stories: Taiga paginated the list anyway \(2 of 6\)/,
    );
    // The cards the window touched are still enriched, one request each...
    expect(byRef(payload, 12)).toMatchObject({ status_now: "Done", tags: ["ui", "auth"] });
    expect(fake.find("GET", "/userstories/1006")).toHaveLength(1);
    // ...but a closure nobody saw an event for cannot be claimed from half a list.
    expect(byRef(payload, 14)).toBeUndefined();
  });

  it("merges several projects, each card keeping its own", async () => {
    const { activity } = await connect();
    const both = { projects: ["apollo", "orion"], period: "last_week" };
    const payload = (await activity(both)).payload();

    expect(payload.projects.map((entry) => entry["project"])).toEqual(["apollo", "orion"]);
    expect(byRef(payload, 1)).toMatchObject({ project: "orion", id: 5001 });
    expect(byRef(payload, 12)).toMatchObject({ project: "apollo" });
    expect(payload.projects[1]).toMatchObject({ events_in_window: 1, items: 1 });
  });

  it("reports a project it may not read, and still answers for the others", async () => {
    const { activity } = await connect(
      {},
      { failOnce: { "GET /timeline/project/7": { status: 403, body: { _error_message: "no" } } } },
    );
    const both = { projects: ["apollo", "orion"], period: "last_week" };
    const payload = (await activity(both)).payload();

    expect(payload.projects[0]).toMatchObject({
      project: "apollo",
      items: 0,
      error: expect.stringContaining("may not read the activity"),
    });
    expect(payload.projects[1]).toMatchObject({ project: "orion", items: 1 });
    expect(byRef(payload, 1)).toMatchObject({ project: "orion" });
  });

  it("lists the known projects when a slug is unknown", async () => {
    const { activity } = await connect();
    const result = await activity({ projects: "med-20", period: "last_week" });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/Unknown project "med-20"\. Your projects: apollo/);
  });

  it("uses the server's default project", async () => {
    const { activity } = await connect({ defaultProject: "apollo" });
    expect((await activity({ period: "last_week" })).payload().projects[0]).toMatchObject({
      project: "apollo",
    });
  });

  it("answers the same thing twice for the same window", async () => {
    const { activity } = await connect();
    const first = (await activity(LAST_WEEK)).payload();
    const second = (await activity(LAST_WEEK)).payload();
    expect(second).toEqual(first);
  });
});

describe("taiga_activity: shaping the answer", () => {
  it("returns a chronology oldest first when asked for events", async () => {
    const { activity } = await connect();
    const payload = (await activity({ ...LAST_WEEK, group_by: "event" })).payload();

    expect(payload.items).toBeUndefined();
    const times = (payload.events ?? []).map((event) => String(event["at"]));
    expect(times).toEqual([...times].sort());
    expect(payload.events?.[0]).toMatchObject({
      at: "2026-10-18T21:00:00.000Z",
      kind: "created",
      ref: 15,
      project: "apollo",
      url: "https://board.taiga.test/project/apollo/us/15",
    });
    expect(payload.events).toContainEqual(
      expect.objectContaining({
        kind: "status",
        ref: 12,
        from: "In Progress",
        to: "Done",
        author: "Alice Example",
      }),
    );
    expect(payload.events).toContainEqual(
      expect.objectContaining({ kind: "comment", ref: 183, text: expect.any(String) }),
    );
  });

  it("shows board positions only when they are explicitly asked for, as events", async () => {
    const { activity } = await connect();

    const refused = await activity({ ...LAST_WEEK, drop_noise: false });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/only be reported with group_by: "event"/);

    const payload = (
      await activity({ ...LAST_WEEK, group_by: "event", drop_noise: false })
    ).payload();
    expect(payload.events).toContainEqual(
      expect.objectContaining({ kind: "other", ref: 13, at: "2026-10-20T13:25:00.000Z" }),
    );
  });

  it("keeps only the kinds that were asked for", async () => {
    const { activity } = await connect();
    const payload = (await activity({ ...LAST_WEEK, types: ["task"] })).payload();

    expect(payload.items?.map((entry) => entry.type)).toEqual(["task"]);
    expect(payload.sprints).toEqual([]);
  });

  it("keeps only the cards carrying every requested tag", async () => {
    const { activity } = await connect();
    const payload = (
      await activity({ ...LAST_WEEK, tags: ["support"], include_by_finish_date: true })
    ).payload();

    expect(payload.items?.map((entry) => entry.id).sort()).toEqual([1003, 4001]);
    expect(payload["filters"]).toEqual({ tags: ["support"] });
  });

  it("keeps only the events of the people that were asked for", async () => {
    const { activity } = await connect();
    const payload = (
      await activity({ ...LAST_WEEK, users: ["bob"], include_by_finish_date: true })
    ).payload();

    const authors = new Set(
      (payload.items ?? []).flatMap((entry) =>
        (entry["comments"] as Array<Record<string, unknown>>).map((comment) => comment["author"]),
      ),
    );
    expect([...authors]).toEqual(["Bob Builder"]);
    // Alice's cards are gone, and so is the one that only a finish date vouched for.
    expect(byRef(payload, 13)).toBeUndefined();
    expect(byRef(payload, 14)).toBeUndefined();
    expect(byRef(payload, 183)).toMatchObject({ id: 4001 });
  });

  it("reports what happened to the sprints", async () => {
    const { activity } = await connect();
    const payload = (await activity(LAST_WEEK)).payload();

    expect(payload.sprints).toEqual([
      {
        project: "apollo",
        name: "Sprint 2",
        change: "closed",
        at: "2026-10-24T14:12:03.221Z",
        by: "Alice Example",
      },
      {
        project: "apollo",
        name: "Sprint 2 — auth",
        change: "renamed",
        at: "2026-10-24T14:12:03.221Z",
        by: "Alice Example",
      },
      {
        project: "apollo",
        name: "Sprint 2",
        change: "dates_changed",
        at: "2026-10-24T14:12:03.221Z",
        by: "Alice Example",
      },
    ]);
  });
});

describe("taiga_activity: reaching the window", () => {
  it("does not spend the page budget getting past the newer events", async () => {
    const { fake, activity } = await connect();
    // A week-old window on a busy project sits behind a page and a half of newer events:
    // charging that seek to max_pages used to answer with nothing at all.
    fake.timelines.set(7, [...newerThanWindow(100), ...APOLLO_TIMELINE]);

    const payload = (await activity({ ...LAST_WEEK, max_pages: 1 })).payload();

    expect(payload.projects[0]).toMatchObject({
      events_scanned: 116,
      events_in_window: 13,
    });
    expect(byRef(payload, 12)).toMatchObject({ closed_in_period: true });
    expect(fake.find("GET", "/timeline/project/7")).toHaveLength(2);
  });

  it("returns the pages it did collect when the budget runs out inside the window", async () => {
    const { activity, fake } = await connect();
    fake.timelines.set(7, [...newerThanWindow(100), ...insideWindow(100), ...APOLLO_TIMELINE]);

    const payload = (await activity({ ...LAST_WEEK, max_pages: 1 })).payload();

    // One page of the window was collected and handed over, not thrown away.
    expect(payload.truncated).toBe(true);
    expect(payload.projects[0]).toMatchObject({ truncated: true, events_in_window: 100 });
    expect(byRef(payload, 12)?.["events_count"]).toBe(100);
  });

  it("says when the window was never reached at all", async () => {
    const { activity, fake } = await connect();
    // 100 pages of nothing but newer events: the hard ceiling, not max_pages.
    fake.timelines.set(7, newerThanWindow(10_000));

    const payload = (await activity({ ...LAST_WEEK, max_pages: 50 })).payload();

    expect(payload.projects[0]).toMatchObject({
      events_scanned: 10_000,
      events_in_window: 0,
      truncated: true,
      window_reached: false,
    });
    expect(fake.find("GET", "/timeline/project/7")).toHaveLength(100);
  });

  it("keeps what it collected when a page fails mid-walk", async () => {
    const { activity, fake } = await connect(
      {},
      {
        failOnce: {
          "GET /timeline/project/7?page=2": { status: 500, body: { _error_message: "boom" } },
        },
      },
    );
    fake.timelines.set(7, [...insideWindow(100), ...APOLLO_TIMELINE]);

    const payload = (await activity(LAST_WEEK)).payload();

    expect(payload.projects[0]).toMatchObject({ events_in_window: 100, truncated: true });
    expect(String(payload.projects[0]?.["degraded"])).toMatch(/stopped early.*500/);
    expect(byRef(payload, 12)?.["events_count"]).toBe(100);
  });

  it("still reports a project it may not read at all", async () => {
    const { activity } = await connect(
      {},
      {
        failOnce: {
          "GET /timeline/project/7?page=1": { status: 403, body: { _error_message: "no" } },
        },
      },
    );
    const payload = (await activity(LAST_WEEK)).payload();

    expect(payload.projects[0]?.["error"]).toMatch(/may not read the activity/);
  });
});

describe("taiga_activity: a report of work done", () => {
  it("drops the cards that were only planned", async () => {
    const { activity } = await connect();
    const full = (await activity(LAST_WEEK)).payload();
    const work = (await activity({ ...LAST_WEEK, include_planning: false })).payload();

    const byNumber = (a: unknown, b: unknown): number => Number(a) - Number(b);
    const planned = (full.items ?? []).filter((entry) => entry["planning_only"] === true);
    expect(planned.map((entry) => entry.ref).sort(byNumber)).toEqual([13, 15, 17]);

    // With planning gone the flag is false on every row that is left, so it is not sent.
    expect(work.items?.every((entry) => !("planning_only" in entry))).toBe(true);
    expect(work.items?.map((entry) => entry.ref).sort(byNumber)).toEqual([12, 34, 97, 183]);
    // The per-project count follows the answer, rather than describing a longer one.
    expect(work.projects[0]).toMatchObject({ items: 4 });
  });

  it("takes the events of a dropped card out of the chronology too", async () => {
    const { activity } = await connect();
    const payload = (
      await activity({ ...LAST_WEEK, group_by: "event", include_planning: false })
    ).payload();

    expect(payload.events?.some((event) => event["ref"] === 13)).toBe(false);
    expect(payload.events?.some((event) => event["ref"] === 12)).toBe(true);
  });

  it("nests a task under its parent story", async () => {
    const { activity } = await connect();
    const payload = (await activity({ ...LAST_WEEK, fold_tasks: true })).payload();

    expect(byRef(payload, 34)).toBeUndefined();
    const tasks = byRef(payload, 12)?.["tasks"] as Array<Record<string, unknown>>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ type: "task", ref: 34, status_now: "In progress" });
    // The parent is implied by where the task now sits. The project is not: sorting the
    // answer by project would otherwise lose every nested task.
    expect(tasks[0]).toMatchObject({ project: "apollo" });
    expect(tasks[0]).not.toHaveProperty("parent");
  });

  it("leaves a task alone when its story is not in the answer", async () => {
    const { fake, activity } = await connect();
    // The task moved, its story did not — and the story has no finish date to bring it
    // into the answer either, so there is nothing to nest under.
    const orphan: TimelineEvent = {
      id: 9996,
      created: "2026-10-22T08:15:00.000Z",
      event_type: "tasks.task.change",
      object_id: 2001,
      project: 7,
      data: {
        user: { id: 1, name: "Alice Example" },
        task: {
          id: 2001,
          ref: 34,
          subject: "Wire up the OIDC callback",
          userstory: { id: 1002, ref: 13, subject: "Rotate the signing keys" },
        },
        values_diff: { status: ["New", "In progress"] },
      },
    };
    fake.timelines.set(7, [orphan]);

    const payload = (await activity({ ...LAST_WEEK, fold_tasks: true })).payload();

    expect(byRef(payload, 34)).toMatchObject({ type: "task", project: "apollo" });
    expect(byRef(payload, 13)).toBeUndefined();
  });
});

describe("taiga_activity: naming what changed", () => {
  it("names the field of every change, so no event is just other", async () => {
    const { fake, activity } = await connect();
    const tagged: TimelineEvent = {
      id: 9998,
      created: "2026-10-21T09:00:00.000Z",
      event_type: "userstories.userstory.change",
      object_id: 1002,
      project: 7,
      data: {
        user: { id: 1, name: "Alice Example" },
        userstory: { id: 1002, ref: 13, subject: "Rotate the signing keys" },
        values_diff: { tags: [null, "bugfix"] },
      },
    };
    fake.timelines.set(7, [...APOLLO_TIMELINE.slice(0, 8), tagged, ...APOLLO_TIMELINE.slice(8)]);

    const payload = (await activity({ ...LAST_WEEK, group_by: "event" })).payload();
    const changes = (payload.events ?? []).filter((event) => event["kind"] !== "comment");

    expect(changes.every((event) => typeof event["field"] === "string")).toBe(true);
    // Tags and the finish date used to arrive as a nameless "other".
    expect(payload.events).toContainEqual(
      expect.objectContaining({ kind: "tags", field: "tags", to: "bugfix" }),
    );
    expect(payload.events).toContainEqual(
      expect.objectContaining({ kind: "finish_date", field: "finish_date", from: null }),
    );
    expect(changes.some((event) => event["kind"] === "other" && event["from"] !== undefined)).toBe(
      false,
    );
  });

  it("masks the access token in a link somebody pasted into a comment", async () => {
    const { fake, activity } = await connect();
    const pasted: TimelineEvent = {
      id: 9997,
      created: "2026-10-21T09:00:00.000Z",
      event_type: "issues.issue.change",
      object_id: 4001,
      project: 7,
      data: {
        user: { id: 2, name: "Bob Builder" },
        issue: { id: 4001, ref: 183, subject: "Login loops on Safari" },
        comment:
          "Log is here: https://taiga.test/media/attachments/8/safari.har?token=auICDQ%3AsecretVALUE",
        values_diff: [],
      },
    };
    fake.timelines.set(7, [...APOLLO_TIMELINE.slice(0, 4), pasted, ...APOLLO_TIMELINE.slice(4)]);

    const payload = (await activity(LAST_WEEK)).payload();
    const serialized = JSON.stringify(payload);

    expect(serialized).not.toContain("secretVALUE");
    expect(serialized).toContain("safari.har?token=***");
  });
});

describe("taiga_activity: the task composition of a story", () => {
  /** The question a report answers about a story is whether its tasks are done. */
  function secondTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return item({
      id: 2002,
      ref: 35,
      subject: "Document the callback",
      status: 201,
      status_extra_info: { name: "New", is_closed: false },
      user_story: 1001,
      user_story_extra_info: { id: 1001, ref: 12, subject: "Login with SSO" },
      ...overrides,
    });
  }

  it("counts every task of the story, not only the ones that moved", async () => {
    const { fake, activity } = await connect();
    // Nothing happened to either of these this week.
    fake.tasks.set(2002, secondTask());
    fake.tasks.set(
      2003,
      secondTask({
        id: 2003,
        ref: 36,
        subject: "Delete the old callback",
        status: 203,
        status_extra_info: { name: "Closed", is_closed: true },
      }),
    );

    const story = byRef((await activity(LAST_WEEK)).payload(), 12);
    expect(story).toMatchObject({ tasks_total: 3, tasks_done: 1, all_tasks_done: false });
  });

  it("says when every task of the story is done", async () => {
    const { fake, activity } = await connect();
    const task = fake.tasks.get(2001) as Record<string, unknown>;
    fake.tasks.set(2001, {
      ...task,
      status: 203,
      status_extra_info: { name: "Closed", is_closed: true },
    });

    const story = byRef((await activity(LAST_WEEK)).payload(), 12);
    expect(story).toMatchObject({ tasks_total: 1, tasks_done: 1, all_tasks_done: true });
  });

  it("counts the tasks of a story that was closed without being touched", async () => {
    const { fake, activity } = await connect();
    fake.tasks.set(2002, secondTask({ user_story: 1003, user_story_extra_info: { id: 1003 } }));

    const asked = { ...LAST_WEEK, include_by_finish_date: true };
    expect(byRef((await activity(asked)).payload(), 14)).toMatchObject({
      tasks_total: 1,
      tasks_done: 0,
      all_tasks_done: false,
    });
  });

  it("names the tasks the window never touched when asked for all of them", async () => {
    const { fake, activity } = await connect();
    fake.tasks.set(2002, secondTask());

    const payload = (
      await activity({ ...LAST_WEEK, fold_tasks: true, tasks_scope: "all" })
    ).payload();
    const tasks = byRef(payload, 12)?.["tasks"] as Array<Record<string, unknown>>;

    expect(tasks).toHaveLength(2);
    // The one that moved is there in full; the other one is named and no more.
    expect(tasks[0]).toMatchObject({
      ref: 34,
      events_count: 1,
      project: "apollo",
      in_period: true,
    });
    expect(tasks[1]).toEqual({
      type: "task",
      id: 2002,
      ref: 35,
      subject: "Document the callback",
      status_now: "New",
      status_is_closed: false,
      in_period: false,
    });
  });

  it("leaves the counters out rather than count half a task list", async () => {
    const { activity } = await connect(
      {},
      { failOnce: { "GET /tasks": { status: 500, body: { _error_message: "boom" } } } },
    );
    const payload = (await activity(LAST_WEEK)).payload();

    expect(byRef(payload, 12)).not.toHaveProperty("tasks_total");
    expect(String(payload.projects[0]?.["degraded"])).toMatch(/tasks: /);
  });
});

describe("taiga_activity: closed by status, not by the flag", () => {
  /** One event on #15, which starts the week in New and is touched by nothing else. */
  function changed(values: Record<string, unknown>): TimelineEvent {
    return {
      id: 9990,
      created: "2026-10-22T11:00:00.000Z",
      event_type: "userstories.userstory.change",
      object_id: 1004,
      project: 7,
      data: {
        user: { id: 1, name: "Alice Example" },
        userstory: { id: 1004, ref: 15, subject: "Publish the token endpoint" },
        values_diff: values,
      },
    };
  }

  it("closes a card that reached a closed status, flag or no flag", async () => {
    const { fake, activity } = await connect();
    fake.timelines.set(7, [changed({ status: ["New", "Done"] })]);

    const story = byRef((await activity(LAST_WEEK)).payload(), 15);
    expect(story).toMatchObject({ closed_in_period: true, closed_flag_in_period: false });
    expect(story?.["status_path"]).toEqual([
      { name: "New", is_closed: false },
      { name: "Done", is_closed: true },
    ]);
  });

  it("does not call a card closed when only the flag arrived", async () => {
    const { fake, activity } = await connect();
    fake.timelines.set(7, [changed({ is_closed: [false, true] })]);

    expect(byRef((await activity(LAST_WEEK)).payload(), 15)).toMatchObject({
      status_now: "New",
      status_is_closed: false,
      closed_in_period: false,
      closed_flag_in_period: true,
    });
  });

  it("does not close a card twice when it was closed already", async () => {
    const { fake, activity } = await connect();
    fake.timelines.set(7, [changed({ status: ["Done", "Done"] })]);

    expect(byRef((await activity(LAST_WEEK)).payload(), 15)).toMatchObject({
      closed_in_period: false,
    });
  });

  it("times every status move, so the work can be dated without a finish date", async () => {
    const { activity } = await connect();
    const story = byRef((await activity(LAST_WEEK)).payload(), 12);

    expect(story?.["status_events"]).toEqual([
      {
        at: "2026-10-20T07:00:00.000Z",
        from: "New",
        to: "In Progress",
        to_is_closed: false,
      },
      {
        at: "2026-10-23T16:40:11.004Z",
        from: "In Progress",
        to: "Done",
        to_is_closed: true,
      },
    ]);
  });
});

describe("taiga_activity: closing a card is not working on it", () => {
  it("marks a card the window only closed", async () => {
    const { fake, activity } = await connect();
    // The status move, the flag and the finish date of #12 — and nothing else.
    fake.timelines.set(7, [APOLLO_TIMELINE[2] as TimelineEvent]);

    expect(byRef((await activity(LAST_WEEK)).payload(), 12)).toMatchObject({
      closure_only: true,
      event_kinds: ["close_flag", "finish_date", "status"],
    });
  });

  it("does not mark a story whose tasks moved", async () => {
    const { fake, activity } = await connect();
    fake.timelines.set(7, [APOLLO_TIMELINE[2], APOLLO_TIMELINE[5]] as TimelineEvent[]);

    const payload = (await activity(LAST_WEEK)).payload();
    expect(byRef(payload, 12)).toMatchObject({ closure_only: false });
    expect(byRef(payload, 34)).toMatchObject({ type: "task" });
  });
});

describe("taiga_activity: a finish date is not an event", () => {
  it("leaves out a card that nothing but a finish date vouches for", async () => {
    const { activity } = await connect();
    const payload = (await activity(LAST_WEEK)).payload();

    expect(byRef(payload, 14)).toBeUndefined();
    // The date itself still travels with the cards that are in the answer.
    expect(byRef(payload, 12)?.["finish_date"]).toBe("2026-10-23T16:40:10.112Z");

    const asked = (await activity({ ...LAST_WEEK, include_by_finish_date: true })).payload();
    expect(byRef(asked, 14)).toMatchObject({ source: "finish_date", closed_in_period: true });
  });
});

describe("taiga_activity: one comment, edited", () => {
  it("does not read an edited comment as a second one", async () => {
    const { fake, activity } = await connect();
    const edited: TimelineEvent = {
      id: 9995,
      created: "2026-10-22T10:00:00.000Z",
      event_type: "issues.issue.change",
      object_id: 4001,
      project: 7,
      data: {
        user: { id: 2, name: "Bob Builder" },
        issue: { id: 4001, ref: 183, subject: "Login loops on Safari" },
        // Taiga has no "edited" event: the whole text arrives again.
        comment: "Reproduced on staging — the callback drops the state parameter.",
        values_diff: [],
      },
    };
    fake.timelines.set(7, [...APOLLO_TIMELINE.slice(0, 4), edited, ...APOLLO_TIMELINE.slice(4)]);

    const issue = byRef((await activity(LAST_WEEK)).payload(), 183);

    expect(issue).toMatchObject({ events_count: 1 });
    expect(issue?.["comments"]).toEqual([
      {
        at: "2026-10-22T10:00:00.000Z",
        author: "Bob Builder",
        text: "Reproduced on staging — the callback drops the state parameter.",
        edited: true,
      },
    ]);
  });
});

describe("taiga_activity: a compact answer", () => {
  it("drops the empty values, the URLs and the derived path", async () => {
    const { activity } = await connect();
    const asked = { ...LAST_WEEK, fold_tasks: true };
    const full = await activity(asked);
    const compact = await activity({ ...asked, verbosity: "compact" });

    const story = byRef(compact.payload(), 12);
    expect(story).toMatchObject({ ref: 12, status_now: "Done", closed_in_period: true });
    // status_events says everything status_path was derived from.
    expect(story).toHaveProperty("status_events");
    expect(story).not.toHaveProperty("url");
    expect(story).not.toHaveProperty("status_path");
    // closure_only is false here, tasks_done is 0: an absent key says the same thing.
    expect(Object.values(story ?? {}).every((value) => !isEmpty(value))).toBe(true);

    expect(compact.text).not.toContain("\n");
    expect(compact.text.length).toBeLessThan(full.text.length / 2);
  });
});
