import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { guard } from "../errors.js";
import {
  itemTypeSchema,
  locatorShape,
  memberSchema,
  projectRef,
  projectSchema,
  requireProject,
  sprintSchema,
  statusSchema,
  type ToolContext,
} from "./schemas.js";

const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;

const pointsSchema = z
  .record(z.union([z.string(), z.number()]))
  .describe(
    'Story points per role, e.g. {"Back": 3, "Front": 2}. The key "all" applies one ' +
      'estimate to every estimating role, so {"all": 5} on a project with four such roles ' +
      "leaves Taiga's total_points at 20 — pass a single role to estimate only that one. " +
      "Role and point names come from taiga_project_schema. User stories only.",
  );

const tagsSchema = z.array(z.string()).describe("Tag names. Taiga creates unknown tags on the fly.");

const dueDateSchema = z.string().describe('Due date as YYYY-MM-DD, e.g. "2026-11-30".');

/**
 * Register the tools that change Taiga. Skipped entirely when the server runs with
 * `TAIGA_MCP_READ_ONLY=1`, so a read-only server does not even advertise them.
 */
export function registerWriteTools(server: McpServer, context: ToolContext): void {
  server.registerTool(
    "taiga_create_item",
    {
      title: "Taiga: create work item",
      description:
        "Create a user story, task, issue or epic. Status, assignee and sprint may be passed " +
        "by name. Taiga applies the project's default status when none is given. Fields that " +
        "do not exist for a kind are rejected (epics have no sprint or due date; only user " +
        "stories carry points; only tasks have a parent user story; type / severity / priority " +
        "are issue-only).",
      inputSchema: {
        type: itemTypeSchema,
        subject: z.string().min(1).describe("Title of the item. Keep it one line."),
        project: projectSchema.optional(),
        description: z.string().optional().describe("Body text. Markdown is supported."),
        status: statusSchema.optional(),
        assigned_to: memberSchema.optional(),
        sprint: sprintSchema
          .optional()
          .describe(
            "Sprint name or id. Not valid for epics, and not for a task that has a parent " +
              "user story — such a task always follows the sprint of its story.",
          ),
        tags: tagsSchema.optional(),
        due_date: dueDateSchema.optional(),
        points: pointsSchema.optional(),
        user_story: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Tasks only: id of the parent user story."),
        epic: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("User stories only: id of an epic to link the new story to."),
        issue_type: z.union([z.string(), z.number()]).optional().describe('Issues only, e.g. "Bug".'),
        severity: z.union([z.string(), z.number()]).optional().describe("Issues only."),
        priority: z.union([z.string(), z.number()]).optional().describe("Issues only."),
        color: z.string().optional().describe('Epics only: badge color, e.g. "#a8e6cf".'),
        is_blocked: z.boolean().optional(),
        blocked_note: z.string().optional().describe("Why the item is blocked."),
      },
      annotations: WRITE,
    },
    async (args) =>
      guard(() =>
        context.items.create({
          type: args.type,
          project: requireProject(context, args.project),
          subject: args.subject,
          description: args.description,
          status: args.status,
          assignedTo: args.assigned_to,
          sprint: args.sprint,
          tags: args.tags,
          dueDate: args.due_date,
          points: args.points,
          userStory: args.user_story,
          epic: args.epic,
          issueType: args.issue_type,
          severity: args.severity,
          priority: args.priority,
          color: args.color,
          isBlocked: args.is_blocked,
          blockedNote: args.blocked_note,
        }),
      ),
  );

  server.registerTool(
    "taiga_update_item",
    {
      title: "Taiga: update work item",
      description:
        "Change one work item: move it to another status, (re)assign it, put it in a sprint, " +
        "edit subject or description, manage tags, set a due date, block it, estimate it — and " +
        "optionally leave a comment in the same call. Pass only the fields you want to change. " +
        "The item's version is sent along, so a concurrent edit by someone else is rejected " +
        "instead of silently overwritten. Returns what actually changed.",
      inputSchema: {
        ...locatorShape,
        status: statusSchema.optional(),
        assigned_to: memberSchema.optional(),
        subject: z.string().min(1).optional(),
        description: z.string().optional().describe("Replaces the whole description."),
        sprint: sprintSchema.optional(),
        tags: tagsSchema.optional().describe("Replaces the whole tag list."),
        add_tags: z.array(z.string()).optional().describe("Tags to add, keeping the existing ones."),
        remove_tags: z.array(z.string()).optional().describe("Tags to drop."),
        due_date: dueDateSchema.nullable().optional().describe("Pass null to clear the due date."),
        points: pointsSchema.optional(),
        user_story: z
          .number()
          .int()
          .positive()
          .nullable()
          .optional()
          .describe("Tasks only: move the task under another user story, or null to detach it."),
        issue_type: z.union([z.string(), z.number()]).optional().describe("Issues only."),
        severity: z.union([z.string(), z.number()]).optional().describe("Issues only."),
        priority: z.union([z.string(), z.number()]).optional().describe("Issues only."),
        color: z.string().optional().describe("Epics only."),
        is_blocked: z.boolean().optional(),
        blocked_note: z.string().optional(),
        comment: z.string().optional().describe("Comment to post together with the change."),
      },
      // No idempotentHint: the call may carry a comment, and a replay would post it twice.
      annotations: WRITE,
    },
    async (args) =>
      guard(() =>
        context.items.update({
          type: args.type,
          id: args.id,
          ref: args.ref,
          project: projectRef(context, args.project),
          status: args.status,
          assignedTo: args.assigned_to,
          subject: args.subject,
          description: args.description,
          sprint: args.sprint,
          tags: args.tags,
          addTags: args.add_tags,
          removeTags: args.remove_tags,
          dueDate: args.due_date,
          points: args.points,
          userStory: args.user_story,
          issueType: args.issue_type,
          severity: args.severity,
          priority: args.priority,
          color: args.color,
          isBlocked: args.is_blocked,
          blockedNote: args.blocked_note,
          comment: args.comment,
        }),
      ),
  );

  server.registerTool(
    "taiga_add_comment",
    {
      title: "Taiga: comment on an item",
      description:
        "Post a comment on one work item. Use taiga_update_item when you also want to change " +
        "fields in the same action.",
      inputSchema: {
        ...locatorShape,
        comment: z.string().min(1).describe("Comment body. Markdown is supported."),
      },
      annotations: WRITE,
    },
    async ({ type, id, ref, project, comment }) =>
      guard(() =>
        context.items.comment({ type, id, ref, project: projectRef(context, project) }, comment),
      ),
  );

  server.registerTool(
    "taiga_create_sprint",
    {
      title: "Taiga: create sprint",
      description:
        "Create a sprint (Taiga calls it a milestone) in a project. Afterwards its name can be " +
        "used as the sprint of any user story, task or issue.",
      inputSchema: {
        name: z.string().min(1).describe('Sprint name, e.g. "Sprint 12".'),
        start: z.string().describe("First day, YYYY-MM-DD."),
        finish: z.string().describe("Last day, YYYY-MM-DD."),
        project: projectSchema.optional(),
      },
      annotations: WRITE,
    },
    async ({ name, start, finish, project }) =>
      guard(() =>
        context.items.createSprint({
          project: requireProject(context, project),
          name,
          start,
          finish,
        }),
      ),
  );

  server.registerTool(
    "taiga_link_epic",
    {
      title: "Taiga: link story to epic",
      description: "Attach a user story to an epic, or detach it again.",
      inputSchema: {
        action: z.enum(["link", "unlink"]).describe("Attach or detach."),
        epic_id: z.number().int().positive().optional().describe("Epic id."),
        epic_ref: z.number().int().positive().optional().describe("Epic #ref, needs project."),
        user_story_id: z.number().int().positive().optional().describe("User story id."),
        user_story_ref: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("User story #ref, needs project."),
        project: projectSchema.optional().describe("Required when referring to items by #ref."),
      },
      annotations: WRITE,
    },
    async ({ action, epic_id, epic_ref, user_story_id, user_story_ref, project }) =>
      guard(() => {
        const ref = projectRef(context, project);
        return context.items.linkEpic({
          action,
          epic: { type: "epic", id: epic_id, ref: epic_ref, project: ref },
          userStory: { type: "userstory", id: user_story_id, ref: user_story_ref, project: ref },
        });
      }),
  );
}

/**
 * Register `taiga_delete_item`. Opt-in via `TAIGA_MCP_ALLOW_DELETE=1`: deletion in Taiga
 * is permanent and has no undo, so it stays off the tool list by default.
 */
export function registerDeleteTool(server: McpServer, context: ToolContext): void {
  server.registerTool(
    "taiga_delete_item",
    {
      title: "Taiga: delete work item",
      description:
        "Permanently delete one user story, task, issue or epic. There is no undo in Taiga — " +
        "prefer moving the item to a closed status instead. Requires confirm: true.",
      inputSchema: {
        ...locatorShape,
        confirm: z
          .literal(true)
          .describe("Must be true. Guards against an accidental call with a wrong id."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ type, id, ref, project }) =>
      guard(() =>
        context.items.remove({ type, id, ref, project: projectRef(context, project) }),
      ),
  );
}
