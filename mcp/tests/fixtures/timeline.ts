import type { TimelineEvent } from "../../src/timeline.js";

/**
 * A project timeline, in the shapes a real self-hosted Taiga serves.
 *
 * Captured from `GET /api/v1/timeline/project/19?page_size=100` (project `med-20`) on
 * 2026-10-28 and remapped onto the ids of the fake project, so the tests exercise the real
 * payload without a network. Everything that matters is kept verbatim:
 *
 * - events arrive newest first, strictly ordered by `created`;
 * - the card inside `data` carries only `id` / `ref` / `subject` — no status, no tags;
 * - `values_diff` is an object of `[before, after]` pairs on a change, and an empty
 *   **array** on a comment;
 * - `status` and `milestone` pairs hold names, not ids;
 * - an absent `finish_date` is the literal string `"None"`;
 * - `description_diff` is a fixed placeholder sentence, never the text of the change;
 * - `attachments.new[].url` carries an access token in the query string.
 *
 * The window the tests resolve against is the week of Monday 2026-10-19:
 * `[2026-10-19T00:00+03:00, 2026-10-26T00:00+03:00)` = `[2026-10-18T21:00Z, 2026-10-25T21:00Z)`.
 */

const ALICE = { id: 1, name: "Alice Example", photo: "https://taiga.test/media/user/alice.png" };
const BOB = { id: 2, name: "Bob Builder", photo: "https://taiga.test/media/user/bob.png" };

const STORY_1001 = { id: 1001, ref: 12, subject: "Login with SSO" };
const STORY_1002 = { id: 1002, ref: 13, subject: "Rotate the signing keys" };
const STORY_1003 = { id: 1003, ref: 14, subject: "Audit log retention" };
const STORY_1004 = { id: 1004, ref: 15, subject: "Publish the token endpoint" };
const STORY_1005 = { id: 1005, ref: 16, subject: "Retire the legacy session store" };
const STORY_1006 = { id: 1006, ref: 17, subject: "Monday morning triage" };

/** The apollo (id 7) timeline, newest event first. */
export const APOLLO_TIMELINE: TimelineEvent[] = [
  {
    // Exactly at `until`. The window is half-open, so this one is outside it.
    id: 9001,
    created: "2026-10-25T21:00:00.000Z",
    event_type: "userstories.userstory.change",
    object_id: 1005,
    project: 7,
    data: {
      user: BOB,
      userstory: STORY_1005,
      comment: "",
      comment_html: "",
      values_diff: { status: ["New", "In Progress"] },
    },
  },
  {
    id: 9002,
    created: "2026-10-24T14:12:03.221Z",
    event_type: "milestones.milestone.change",
    object_id: 902,
    project: 7,
    data: {
      user: ALICE,
      milestone: { id: 902, name: "Sprint 2", slug: "sprint-2" },
      values_diff: {
        closed: [false, true],
        name: ["Sprint 2", "Sprint 2 — auth"],
        estimated_finish: ["2026-10-28", "2026-10-25"],
      },
    },
  },
  {
    id: 9003,
    created: "2026-10-23T16:40:11.004Z",
    event_type: "userstories.userstory.change",
    object_id: 1001,
    project: 7,
    data: {
      user: ALICE,
      userstory: STORY_1001,
      comment: "",
      comment_html: "",
      values_diff: {
        status: ["In Progress", "Done"],
        is_closed: [false, true],
        finish_date: ["None", "2026-10-23 16:40:10.112233+00:00"],
      },
    },
  },
  {
    id: 9004,
    created: "2026-10-23T11:05:00.000Z",
    event_type: "userstories.userstory.change",
    object_id: 1001,
    project: 7,
    data: {
      user: BOB,
      userstory: STORY_1001,
      values_diff: {
        attachments: {
          new: [
            {
              id: 300,
              filename: "sso-sequence.png",
              url: "https://taiga.test/media/attachments/8/sso-sequence.png?token=auICDQ%3A1v9ZkQ%3AsecretvalueHERE",
            },
          ],
          changed: [],
          deleted: [
            {
              id: 299,
              filename: "old-sequence.png",
              url: "https://taiga.test/media/attachments/8/old-sequence.png?token=auICDQ%3Aold%3Asecret",
            },
          ],
        },
      },
    },
  },
  {
    // A comment: `values_diff` is an empty ARRAY here, not an object.
    id: 9005,
    created: "2026-10-22T09:30:00.000Z",
    event_type: "issues.issue.change",
    object_id: 4001,
    project: 7,
    data: {
      user: BOB,
      issue: { id: 4001, ref: 183, subject: "Login loops on Safari" },
      comment: "Reproduced on staging — the callback drops the state parameter.",
      comment_html: "<p>Reproduced on staging — the callback drops the state parameter.</p>",
      values_diff: [],
    },
  },
  {
    id: 9006,
    created: "2026-10-22T08:15:00.000Z",
    event_type: "tasks.task.change",
    object_id: 2001,
    project: 7,
    data: {
      user: ALICE,
      task: {
        id: 2001,
        ref: 34,
        subject: "Wire up the OIDC callback",
        userstory: STORY_1001,
      },
      comment: "",
      values_diff: { status: ["New", "In progress"], taskboard_order: [1, 3] },
    },
  },
  {
    id: 9007,
    created: "2026-10-21T17:00:00.000Z",
    event_type: "userstories.userstory.change",
    object_id: 1001,
    project: 7,
    data: {
      user: ALICE,
      userstory: STORY_1001,
      values_diff: {
        description_diff: "Check the history API for the exact diff",
        backlog_order: [12, 3],
        kanban_order: [4, 1],
      },
    },
  },
  {
    id: 9008,
    created: "2026-10-21T10:00:00.000Z",
    event_type: "epics.epic.change",
    object_id: 3001,
    project: 7,
    data: {
      user: ALICE,
      epic: { id: 3001, ref: 97, subject: "Authentication" },
      values_diff: { status: ["New", "In progress"] },
    },
  },
  {
    // Order only — a fifth of a real timeline looks like this, and no report wants it.
    id: 9009,
    created: "2026-10-20T13:25:00.000Z",
    event_type: "userstories.userstory.change",
    object_id: 1002,
    project: 7,
    data: { user: ALICE, userstory: STORY_1002, values_diff: { sprint_order: [1, 7] } },
  },
  {
    id: 9010,
    created: "2026-10-20T13:22:41.760Z",
    event_type: "userstories.userstory.change",
    object_id: 1002,
    project: 7,
    data: {
      user: ALICE,
      userstory: STORY_1002,
      values_diff: { milestone: [null, "Sprint 2"], sprint_order: [0, 1] },
    },
  },
  {
    id: 9011,
    created: "2026-10-20T07:00:00.000Z",
    event_type: "userstories.userstory.change",
    object_id: 1001,
    project: 7,
    data: {
      user: ALICE,
      userstory: STORY_1001,
      comment: "",
      values_diff: {
        status: ["New", "In Progress"],
        assigned_to: ["Alice Example", "Bob Builder"],
      },
    },
  },
  {
    id: 9012,
    created: "2026-10-19T12:00:00.000Z",
    event_type: "userstories.userstory.change",
    object_id: 1001,
    project: 7,
    data: {
      user: BOB,
      userstory: STORY_1001,
      comment: "Picked this up, starting with the OIDC bits.",
      comment_html: "<p>Picked this up, starting with the OIDC bits.</p>",
      values_diff: [],
    },
  },
  {
    // 2026-10-19T00:30+03:00 — inside the Moscow week, outside the UTC one.
    id: 9013,
    created: "2026-10-18T21:30:00.000Z",
    event_type: "userstories.userstory.create",
    object_id: 1006,
    project: 7,
    data: { user: BOB, userstory: STORY_1006, values_diff: {} },
  },
  {
    // Exactly at `since`, which is the inclusive edge.
    id: 9014,
    created: "2026-10-18T21:00:00.000Z",
    event_type: "userstories.userstory.create",
    object_id: 1004,
    project: 7,
    data: { user: ALICE, userstory: STORY_1004, values_diff: {} },
  },
  {
    // One millisecond before the window: this closure is invisible to the timeline walk,
    // and only the item's finish_date puts the card in the report.
    id: 9015,
    created: "2026-10-18T20:59:59.999Z",
    event_type: "userstories.userstory.change",
    object_id: 1003,
    project: 7,
    data: {
      user: ALICE,
      userstory: STORY_1003,
      values_diff: { status: ["In progress", "Done"], is_closed: [false, true] },
    },
  },
  {
    id: 9016,
    created: "2026-10-12T08:00:00.000Z",
    event_type: "milestones.milestone.create",
    object_id: 901,
    project: 7,
    data: { user: ALICE, milestone: { id: 901, name: "Sprint 1", slug: "sprint-1" } },
  },
];

/** The orion (id 8) timeline, so a two-project call has something to merge. */
export const ORION_TIMELINE: TimelineEvent[] = [
  {
    id: 9101,
    created: "2026-10-22T15:45:00.000Z",
    event_type: "userstories.userstory.change",
    object_id: 5001,
    project: 8,
    data: {
      user: BOB,
      userstory: { id: 5001, ref: 1, subject: "Migrate the billing job" },
      comment: "Cutover done, watching the queue.",
      values_diff: [],
    },
  },
  {
    id: 9102,
    created: "2026-10-05T09:00:00.000Z",
    event_type: "userstories.userstory.create",
    object_id: 5001,
    project: 8,
    data: { user: BOB, userstory: { id: 5001, ref: 1, subject: "Migrate the billing job" } },
  },
];
