import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ResolutionError } from "../catalog.js";
import { guard } from "../errors.js";
import { formatCatalog, formatProjectSummary } from "../format.js";
import type { TargetType } from "../timeline.js";
import { ITEM_TYPES, type ItemType } from "../types.js";
import { ACTIVITY_PERIODS } from "../window.js";
import {
  clampLimit,
  itemTypeSchema,
  locatorShape,
  memberSchema,
  projectList,
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

  server.registerTool(
    "taiga_activity",
    {
      title: "Taiga: what happened over a period",
      description:
        "What happened in a project over a period — in one call, instead of walking items one " +
        "by one. For every user story, task, issue and epic touched inside the window " +
        "[since, until) it reports what actually happened to it: status moves, closing " +
        "(including a closure entered after the fact), text comments, sprint moves, " +
        "attachments. Use it for weekly reports of work done, sprint summaries and questions " +
        'like "what did we do between the 19th and the 23rd". This is the only way to get a ' +
        "period of work: Taiga's list endpoints have no date filters, and modified_date does " +
        "not tell work apart from a card being moved. For a report, ask for " +
        "include_planning: false and fold_tasks: true — that is work done, one line per " +
        "story, with tasks_total / tasks_done / all_tasks_done saying whether the story is " +
        "finished. Judge a card by its statuses and its tasks rather than by dates: " +
        "finish_date and the is_closed flag are filled in by hand and often not at all, " +
        "which is why status_events carries the time of every status move and " +
        "closed_flag_in_period is reported apart from closed_in_period.",
      inputSchema: {
        projects: z
          .union([projectSchema, z.array(projectSchema)])
          .optional()
          .describe("One project or several (slug, name or id). Defaults to TAIGA_PROJECT."),
        period: z
          .enum(ACTIVITY_PERIODS)
          .optional()
          .describe(
            'Named window, resolved in "tz". "last_week" is Monday 00:00 of the previous ' +
              "calendar week to Monday 00:00 of this one — seven whole days, so Saturday work " +
              'is not lost. Defaults to "last_week". Not combinable with since/until.',
          ),
        since: z
          .string()
          .optional()
          .describe('Window start, inclusive: "2026-10-19" (start of that day in tz) or ISO-8601.'),
        until: z
          .string()
          .optional()
          .describe('Window end, exclusive. Needs "since". Defaults to now.'),
        tz: z
          .string()
          .optional()
          .describe('Fixed UTC offset the dates are read in, e.g. "+03:00". Defaults to TAIGA_TZ.'),
        types: z
          .array(z.enum([...ITEM_TYPES, "milestone"]))
          .optional()
          .describe('Kinds to report on. Defaults to all. "milestone" covers sprint changes.'),
        group_by: z
          .enum(["item", "event"])
          .optional()
          .describe(
            '"item" (default) sums up what happened to each card; "event" returns the bare ' +
              "chronology, oldest first.",
          ),
        include_comments: z
          .boolean()
          .optional()
          .describe("Include comment text. Default true."),
        include_planning: z
          .boolean()
          .optional()
          .describe(
            "Default true. Pass false to drop the cards that were only planned — moved " +
              "between sprints, reassigned, reordered or had their description edited, with " +
              "no status change, closure, comment or attachment. On a busy week that is more " +
              "than half the cards, so it is the cheapest way to cut the answer down to work " +
              "actually done.",
          ),
        fold_tasks: z
          .boolean()
          .optional()
          .describe(
            "Nest each task under its parent user story instead of listing it separately, " +
              "which is how a weekly report is written: one line per story, the tasks as the " +
              "evidence under it. A task whose story saw no activity stays on its own.",
          ),
        tasks_scope: z
          .enum(["period", "all"])
          .optional()
          .describe(
            'Default "period": a story lists the tasks that moved inside the window. ' +
              '"all" lists its whole task composition — every nested task then carries ' +
              "in_period, and the untouched ones are a short entry. The three counters " +
              "are there either way.",
          ),
        include_by_finish_date: z
          .boolean()
          .optional()
          .describe(
            "Default false. A card with no event in the window at all can still be pulled " +
              "in by a finish_date inside it; nothing in Taiga obliges anyone to fill that " +
              "date in, so pass true only when you want those cards. A card that did have " +
              "events keeps its finish_date in the answer either way.",
          ),
        verbosity: z
          .enum(["compact", "full"])
          .optional()
          .describe(
            'Default "full". "compact" leaves out every empty value, the web URLs and ' +
              "status_path (status_events says the same), and serialises without " +
              "indentation, which cuts the answer to between a third and a half its size " +
              "— for a multi-project week that would not otherwise fit in one answer.",
          ),
        tags: z
          .array(z.string())
          .optional()
          .describe("Only cards carrying all of these tags."),
        users: z
          .array(z.string())
          .optional()
          .describe(
            'Only events authored by these people ("me" = the authenticated user). Cards that ' +
              "surfaced only through a retroactive closure have no author and are left out.",
          ),
        max_pages: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Safety stop, counted in pages of 100 events that reach into the window — paging " +
              "past the newer events to get there does not count against it. Default 20. " +
              'Paging normally ends at "since"; hitting this cap instead sets "truncated".',
          ),
        comment_chars: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Cap on the length of one comment. Default 1500."),
        drop_noise: z
          .boolean()
          .optional()
          .describe(
            'Board positions (*_order) are dropped by default. Pass false with group_by: "event" ' +
              "to see them.",
          ),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      guard(async () => {
        const groupBy = args.group_by ?? "item";
        if (args.drop_noise === false && groupBy !== "event") {
          throw new ResolutionError(
            'Board positions can only be reported with group_by: "event" — in a per-item ' +
              "summary they say nothing a report could use.",
          );
        }

        const verbosity = args.verbosity === "compact" ? "compact" : "full";
        const payload = await context.activity.activity({
          projects: projectList(context, args.projects),
          includePlanning: args.include_planning !== false,
          foldTasks: args.fold_tasks === true,
          period: args.period,
          since: args.since,
          until: args.until,
          tz: args.tz,
          types: (args.types as TargetType[] | undefined) ?? [...ITEM_TYPES, "milestone"],
          groupBy,
          includeComments: args.include_comments !== false,
          tags: args.tags,
          users: args.users,
          maxPages: args.max_pages ?? 20,
          commentChars: args.comment_chars ?? 1500,
          dropNoise: args.drop_noise !== false,
          tasksScope: args.tasks_scope === "all" ? "all" : "period",
          includeByFinishDate: args.include_by_finish_date === true,
          verbosity,
        });

        // The indentation of a pretty-printed week is a third of its bytes, and a caller
        // asking for a compact answer is asking because the full one does not fit.
        return verbosity === "compact" ? JSON.stringify(payload) : payload;
      }),
  );
}
