import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { guard } from "../errors.js";
import { formatCatalog, formatProjectSummary } from "../format.js";
import { ITEM_TYPES, type ItemType } from "../types.js";
import {
  clampLimit,
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

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

/** Register every tool that only reads from Taiga. Always available. */
export function registerReadTools(server: McpServer, context: ToolContext): void {
  server.registerTool(
    "taiga_whoami",
    {
      title: "Taiga: who am I",
      description:
        "The Taiga account this server is authenticated as, plus the server's own limits " +
        '(read-only mode, whether deletes are allowed). Call it once to learn which username "me" means.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      guard(async () => {
        const user = await context.session.currentUser();
        return {
          id: user.id,
          username: user.username,
          full_name: user.full_name_display ?? user.full_name,
          email: user.email,
          lang: user.lang,
          taiga_url: context.config.baseUrl,
          web_url: context.config.webUrl,
          mode: {
            read_only: context.config.readOnly,
            deletes_enabled: context.config.allowDelete,
            default_project: context.config.defaultProject ?? null,
          },
        };
      }),
  );

  server.registerTool(
    "taiga_list_projects",
    {
      title: "Taiga: list my projects",
      description:
        "Projects this account is a member of, with their slug, id and enabled modules " +
        "(backlog, kanban, issues, epics, wiki).",
      inputSchema: {
        refresh: z
          .boolean()
          .optional()
          .describe("Bypass the cache. Use after creating or joining a project."),
      },
      annotations: READ_ONLY,
    },
    async ({ refresh }) =>
      guard(async () => {
        const projects = await context.catalogs.listProjects({ refresh: refresh === true });
        return { total: projects.length, projects: projects.map(formatProjectSummary) };
      }),
  );

  server.registerTool(
    "taiga_project_schema",
    {
      title: "Taiga: project schema",
      description:
        "Everything that is configured per project and needed to write to it: status names " +
        "for each item kind, members and their roles, sprints, issue types / severities / " +
        "priorities, the story-point scale, tags, and your own permissions. Call this before " +
        "the first create or update in a project — statuses are NOT shared between projects. " +
        "Cached, so repeated calls are cheap.",
      inputSchema: {
        project: projectSchema.optional(),
        refresh: z.boolean().optional().describe("Re-read the project instead of using the cache."),
      },
      annotations: READ_ONLY,
    },
    async ({ project, refresh }) =>
      guard(async () => {
        const ref = requireProject(context, project);
        const catalog = await context.catalogs.catalog(ref, { refresh: refresh === true });
        return formatCatalog(catalog);
      }),
  );

  server.registerTool(
    "taiga_my_work",
    {
      title: "Taiga: my assigned work",
      description:
        "Work items assigned to the authenticated user, grouped by kind and ordered by due " +
        'date. Open items only, unless include_closed is true. This is the "what am I ' +
        'supposed to be doing" tool.',
      inputSchema: {
        project: projectSchema.optional().describe("Limit to one project. Omit to span every project."),
        types: z
          .array(itemTypeSchema)
          .optional()
          .describe("Item kinds to include. Defaults to all four."),
        include_closed: z.boolean().optional().describe("Also return items in a closed status."),
        limit: z.number().int().positive().optional().describe("Max items per kind. Default 25."),
      },
      annotations: READ_ONLY,
    },
    async ({ project, types, include_closed, limit }) =>
      guard(() =>
        context.items.myWork({
          project: projectRef(context, project),
          types: (types as ItemType[] | undefined) ?? [...ITEM_TYPES],
          includeClosed: include_closed === true,
          limit: clampLimit(context, limit, 25),
        }),
      ),
  );

  server.registerTool(
    "taiga_list_items",
    {
      title: "Taiga: list work items",
      description:
        "List user stories, tasks, issues or epics in a project. Statuses, assignees and " +
        "sprints can be given by name — they are resolved against the project's catalogs. " +
        "Closed items are excluded unless include_closed is true.",
      inputSchema: {
        type: itemTypeSchema,
        project: projectSchema.optional(),
        status: statusSchema.optional(),
        assigned_to: memberSchema.optional(),
        sprint: sprintSchema.optional(),
        tags: z.array(z.string()).optional().describe("Only items carrying all of these tags."),
        epic: z.number().int().positive().optional().describe("User stories of this epic id."),
        user_story: z.number().int().positive().optional().describe("Tasks of this user story id."),
        issue_type: z.union([z.string(), z.number()]).optional().describe("Issues only."),
        severity: z.union([z.string(), z.number()]).optional().describe("Issues only."),
        priority: z.union([z.string(), z.number()]).optional().describe("Issues only."),
        include_closed: z.boolean().optional(),
        order_by: z
          .string()
          .optional()
          .describe('Taiga ordering field, e.g. "-modified_date" or "due_date".'),
        limit: z.number().int().positive().optional().describe("Page size. Default 25."),
        page: z.number().int().positive().optional().describe("1-based page number. Default 1."),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      guard(() =>
        context.items.list({
          type: args.type,
          project: projectRef(context, args.project),
          status: args.status,
          assignedTo: args.assigned_to,
          sprint: args.sprint,
          tags: args.tags,
          epic: args.epic,
          userStory: args.user_story,
          issueType: args.issue_type,
          severity: args.severity,
          priority: args.priority,
          includeClosed: args.include_closed,
          orderBy: args.order_by,
          limit: clampLimit(context, args.limit, 25),
          page: args.page ?? 1,
        }),
      ),
  );

  server.registerTool(
    "taiga_get_item",
    {
      title: "Taiga: get work item",
      description:
        "Full detail of one work item, including description, points, blocked state and a " +
        'link to the UI. Identify it either by global "id", or by "ref" (the #number in the ' +
        'UI) together with "project".',
      inputSchema: {
        ...locatorShape,
        include_tasks: z
          .boolean()
          .optional()
          .describe("User stories only: also list the tasks under it."),
        include_user_stories: z
          .boolean()
          .optional()
          .describe("Epics only: also list the user stories linked to it."),
      },
      annotations: READ_ONLY,
    },
    async ({ type, id, ref, project, include_tasks, include_user_stories }) =>
      guard(() =>
        context.items.detail(
          { type, id, ref, project: projectRef(context, project) },
          {
            includeTasks: include_tasks === true,
            includeUserStories: include_user_stories === true,
          },
        ),
      ),
  );

  server.registerTool(
    "taiga_search",
    {
      title: "Taiga: search a project",
      description:
        "Full-text search inside one project across user stories, tasks, issues and epics. " +
        "Use it when the user names an item by words rather than by number.",
      inputSchema: {
        text: z.string().min(1).describe("Words to search for, in subject or description."),
        project: projectSchema.optional(),
        types: z.array(itemTypeSchema).optional().describe("Kinds to include. Defaults to all."),
        limit: z.number().int().positive().optional().describe("Max hits per kind. Default 10."),
      },
      annotations: READ_ONLY,
    },
    async ({ text, project, types, limit }) =>
      guard(() =>
        context.items.search({
          project: requireProject(context, project),
          text,
          types: (types as ItemType[] | undefined) ?? [...ITEM_TYPES],
          limit: clampLimit(context, limit, 10),
        }),
      ),
  );

  server.registerTool(
    "taiga_list_comments",
    {
      title: "Taiga: item history and comments",
      description:
        "Comments on one work item, oldest first. With include_changes it also reports field " +
        'changes ("status: New → In progress"), which is how you reconstruct what happened to an item.',
      inputSchema: {
        ...locatorShape,
        limit: z.number().int().positive().optional().describe("Most recent N entries. Default 20."),
        include_changes: z
          .boolean()
          .optional()
          .describe("Include status moves, reassignments and other field changes."),
      },
      annotations: READ_ONLY,
    },
    async ({ type, id, ref, project, limit, include_changes }) =>
      guard(() =>
        context.items.history(
          { type, id, ref, project: projectRef(context, project) },
          {
            limit: clampLimit(context, limit, 20),
            includeChanges: include_changes === true,
          },
        ),
      ),
  );
}
