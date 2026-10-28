import { ITEM_TYPES, type ItemType } from "./types.js";

/**
 * Shapes and parsing rules of `GET /timeline/project/{id}`.
 *
 * The timeline is the only Taiga endpoint that answers "what happened between these two
 * dates" — the list endpoints have no date filters at all. In exchange its payload is
 * raw: board positions outnumber real work, descriptions arrive as a placeholder, and
 * attachment URLs carry access tokens. Everything in this module is about turning one
 * event into the few facts a report may repeat.
 */

/** Identification of a work item as the timeline embeds it: no status, no tags. */
export interface TimelineObject {
  id?: number;
  ref?: number;
  subject?: string;
  /** Present on a task: the user story it belongs to. */
  userstory?: TimelineObject;
}

/** The author of an event. `name` is the display name, which is all the timeline carries. */
export interface TimelineUser {
  id?: number;
  name?: string;
  username?: string;
}

/** A sprint as the timeline embeds it. */
export interface TimelineMilestone {
  id?: number;
  name?: string;
  slug?: string;
}

/** One entry of the project timeline. */
export interface TimelineEvent {
  id?: number;
  created?: string;
  event_type?: string;
  object_id?: number;
  project?: number;
  data?: {
    user?: TimelineUser;
    userstory?: TimelineObject;
    task?: TimelineObject;
    issue?: TimelineObject;
    epic?: TimelineObject;
    milestone?: TimelineMilestone;
    comment?: string;
    /** An object of `[before, after]` pairs — but an empty **array** on a comment. */
    values_diff?: Record<string, unknown> | unknown[];
    [key: string]: unknown;
  };
}

/** What kind of change one entry of `values_diff` describes. */
export const ACTIVITY_KINDS = [
  "created",
  "status",
  "closed",
  "finish_date",
  "comment",
  "sprint",
  "assignee",
  "attachment",
  "description",
  "subject",
  "tags",
  "other",
] as const;

/** One of {@link ACTIVITY_KINDS}. */
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** What an event is about: one of the four item kinds, or a sprint. */
export type TargetType = ItemType | "milestone";

/** The subject of an event, as far as the timeline identifies it. */
export interface EventTarget {
  type: TargetType;
  id: number;
  ref?: number | undefined;
  subject?: string | undefined;
  /** For a task: the user story above it. */
  parent?: { type: "userstory"; id: number; ref?: number | undefined; subject?: string | undefined };
  /** For a sprint: its name at the time of the event. */
  name?: string | undefined;
}

/** One field change, already reduced to what may leave the server. */
export interface EventChange {
  kind: ActivityKind;
  field: string;
  from?: string | null;
  to?: string | null;
}

/** One timeline event, parsed. `null` fields mean the event did not say. */
export interface ParsedEvent {
  at: string;
  author: string | null;
  authorId: number | null;
  target: EventTarget;
  /** Empty when the event only carried noise. */
  changes: EventChange[];
  /** Comment text, already trimmed. `null` for a change-only event. */
  comment: string | null;
  /** How many files the event attached and removed. */
  attachmentsAdded: number;
  attachmentsRemoved: number;
}

/**
 * The placeholder Taiga puts in `values_diff.description_diff`. It is the same sentence on
 * every event and never the text of the change, so it is reduced to a flag and dropped.
 */
const DESCRIPTION_FIELDS = new Set(["description", "description_diff", "description_html"]);

/** Fields that only ever restate something in HTML, or point at a user's avatar. */
const DROPPED_FIELDS = new Set([
  "comment",
  "comment_html",
  "comment_diff",
  "photo",
  "blocked_note_html",
]);

/** Board position. A fifth of all events carry nothing else, and no report ever wants one. */
function isOrderField(field: string): boolean {
  return field === "order" || field.endsWith("_order");
}

/** `values_diff` is an object on a change — and an empty array on a comment. */
function asDiff(values: unknown): Record<string, unknown> {
  if (!values || typeof values !== "object" || Array.isArray(values)) return {};
  return values as Record<string, unknown>;
}

/**
 * Blank out the access token in a link.
 *
 * Taiga puts a token in every attachment URL, and people paste those links into comments
 * by hand. The tool itself only ever reports attachment counts, but a comment travels
 * verbatim into a report that is then mailed around, and a live token in it is a way into
 * the file for anyone down that chain.
 */
export function maskTokens(text: string): string {
  return text.replace(/([?&](?:token|auth_token|signature|sig)=)[^&\s"'<>)\]]+/gi, "$1***");
}

/**
 * Render one side of a `[before, after]` pair.
 *
 * Taiga writes an absent value three ways — `null`, `""` and the literal string `"None"` —
 * and all three mean the same thing. Anything that is not a scalar is reported as absent
 * rather than serialized: an unknown nested shape is exactly where a token or a body of
 * text would leak out.
 */
export function renderValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const text = value.trim();
    return text === "" || text === "None" ? null : maskTokens(text);
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(renderValue).filter((part): part is string => part !== null);
    return parts.length ? parts.join(", ") : null;
  }
  return null;
}

/** Split `userstories.userstory.change` into the object kind and the verb. */
export function parseEventType(
  eventType: string | undefined,
): { target: TargetType; verb: string } | null {
  const parts = (eventType ?? "").split(".");
  const kind = parts[1];
  const verb = parts[2] ?? "change";
  if (kind === "milestone") return { target: "milestone", verb };
  if (kind !== undefined && (ITEM_TYPES as readonly string[]).includes(kind)) {
    return { target: kind as ItemType, verb };
  }
  return null;
}

/** Pull the event's subject out of `data`, including a task's parent story. */
function targetOf(event: TimelineEvent, type: TargetType): EventTarget | null {
  const data = event.data ?? {};

  if (type === "milestone") {
    const milestone = data.milestone;
    const id = milestone?.id ?? event.object_id;
    if (id === undefined) return null;
    return { type, id, name: milestone?.name };
  }

  const object = data[type] as TimelineObject | undefined;
  const id = object?.id ?? event.object_id;
  if (id === undefined) return null;

  const base: EventTarget = { type, id, ref: object?.ref, subject: object?.subject };
  const parent = type === "task" ? object?.userstory : undefined;
  if (parent?.id !== undefined) {
    base.parent = { type: "userstory", id: parent.id, ref: parent.ref, subject: parent.subject };
  }
  return base;
}

/** Which kind of change a `values_diff` field describes. */
function kindOf(field: string): ActivityKind {
  if (field === "status") return "status";
  if (field === "is_closed") return "closed";
  if (field === "finish_date" || field === "finished_date") return "finish_date";
  // "is_closed" belongs to a card, "closed" to a sprint; the estimated dates are a
  // sprint's own, and all of them read as nonsense under "other".
  if (field === "closed") return "closed";
  if (field === "milestone" || field === "estimated_start" || field === "estimated_finish") {
    return "sprint";
  }
  if (field === "tags") return "tags";
  if (field === "assigned_to" || field === "assigned_users") return "assignee";
  if (field === "attachments") return "attachment";
  if (field === "subject" || field === "name") return "subject";
  if (DESCRIPTION_FIELDS.has(field)) return "description";
  return "other";
}

/** `{ new: [...], changed: [...], deleted: [...] }` — counted, never quoted. */
function countAttachments(value: unknown): { added: number; removed: number; changed: number } {
  const bucket = (key: string): number => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
    const list = (value as Record<string, unknown>)[key];
    return Array.isArray(list) ? list.length : 0;
  };
  return { added: bucket("new"), removed: bucket("deleted"), changed: bucket("changed") };
}

/**
 * Parse one timeline event into the facts that may leave the server.
 *
 * @param event The raw event.
 * @param options `keepOrderFields` reports board positions as plain changes instead of
 *                discarding them; everything else is unconditional, because a description
 *                body, an HTML rendering or a tokenized attachment URL must never be
 *                echoed whatever the caller asked for.
 * @returns The parsed event, or `null` when it carried nothing but noise.
 */
export function parseEvent(
  event: TimelineEvent,
  options: { keepOrderFields?: boolean } = {},
): ParsedEvent | null {
  const at = typeof event.created === "string" ? event.created : null;
  const parsedType = parseEventType(event.event_type);
  if (at === null || parsedType === null) return null;

  const target = targetOf(event, parsedType.target);
  if (target === null) return null;

  const data = event.data ?? {};
  const diff = asDiff(data.values_diff);
  const changes: EventChange[] = [];
  let attachmentsAdded = 0;
  let attachmentsRemoved = 0;

  for (const [field, value] of Object.entries(diff)) {
    if (DROPPED_FIELDS.has(field) || field.endsWith("_html")) continue;
    if (isOrderField(field)) {
      if (!options.keepOrderFields) continue;
      changes.push({ kind: "other", field });
      continue;
    }

    const kind = kindOf(field);
    if (kind === "description") {
      // The payload is a fixed placeholder sentence, not the diff. Only the fact survives.
      changes.push({ kind, field: "description" });
      continue;
    }
    if (kind === "attachment") {
      const counted = countAttachments(value);
      attachmentsAdded += counted.added;
      attachmentsRemoved += counted.removed;
      if (counted.added + counted.removed + counted.changed === 0) continue;
      changes.push({ kind, field });
      continue;
    }

    const pair = Array.isArray(value) && value.length === 2 ? value : null;
    changes.push({
      kind,
      field,
      ...(pair ? { from: renderValue(pair[0]), to: renderValue(pair[1]) } : {}),
    });
  }

  const rawComment = typeof data.comment === "string" ? data.comment.trim() : "";
  const comment = rawComment === "" ? null : maskTokens(rawComment);
  if (parsedType.verb === "create") {
    changes.unshift({ kind: "created", field: "created" });
  } else if (parsedType.verb === "delete") {
    changes.unshift({ kind: "other", field: "deleted" });
  }

  if (changes.length === 0 && comment === null) return null;

  const user = data.user;
  return {
    at,
    author: user?.name?.trim() || user?.username?.trim() || null,
    authorId: typeof user?.id === "number" ? user.id : null,
    target,
    changes,
    comment,
    attachmentsAdded,
    attachmentsRemoved,
  };
}

/** Whether a change counts as work done, as opposed to planning. See `planning_only`. */
export function isWork(change: EventChange): boolean {
  return change.kind === "status" || change.kind === "closed" || change.kind === "attachment";
}

/** Whether the pair says the item went from open to closed. */
export function isClosing(change: EventChange): boolean {
  return change.kind === "closed" && change.from === "false" && change.to === "true";
}
