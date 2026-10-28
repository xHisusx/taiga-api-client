import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ActivityService } from "./activity.js";
import { CatalogService } from "./catalog.js";
import type { TaigaMcpConfig } from "./config.js";
import { ItemService } from "./items.js";
import { TaigaSession, type TaigaSessionDeps } from "./session.js";
import { registerReadTools } from "./tools/read.js";
import { registerDeleteTool, registerWriteTools } from "./tools/write.js";
import type { ToolContext } from "./tools/schemas.js";

/** Version advertised to MCP clients. Kept in step with `package.json`. */
export const SERVER_VERSION = "0.1.1";

const INSTRUCTIONS = `Taiga project management, acting as the authenticated Taiga user. Every call is
subject to that user's own permissions — a 403 means the account may not do it, not that the
call was malformed.

Vocabulary: a project contains epics (themes), user stories (backlog items), tasks (work under
a story) and issues (bugs and requests). Sprints are called milestones in the API.

How to use these tools well:
- Statuses, members, sprints, issue types, severities, priorities and the story-point scale are
  configured PER PROJECT. Call taiga_project_schema once for a project, then pass plain names
  ("In progress", "alice", "Sprint 12") — they are resolved to ids for you, and an unknown name
  comes back with the list of valid ones.
- Every item has a global "id" and a per-project "ref" (the #12 shown in the UI). Tools take
  either; "ref" must be accompanied by "project".
- taiga_my_work answers "what is assigned to me"; taiga_search finds an item from a few words.
- taiga_activity answers "what happened between these dates". Taiga's list endpoints have no
  date filters, so it is the only way to get a period of work — do not try to rebuild one from
  modified_date and per-item history.
- taiga_update_item changes status, assignee, sprint, tags, estimates and can post a comment in
  the same call. It sends the item's version, so a concurrent edit fails loudly instead of being
  overwritten.
- Deleting is off unless the server was started with deletes enabled; move an item to a closed
  status instead.`;

/** Options for {@link createServer}. */
export interface CreateServerOptions {
  config: TaigaMcpConfig;
  /** Test seams: a fake `fetch` and/or token store. */
  deps?: TaigaSessionDeps;
}

/** The assembled server plus the session it talks to, exposed for tests. */
export interface TaigaMcpServer {
  server: McpServer;
  session: TaigaSession;
  tools: string[];
}

/**
 * Build the MCP server: one Taiga session, one catalog cache, one item service, and the
 * tool set the configuration allows (reads always; writes unless read-only; delete only
 * when explicitly enabled).
 */
export function createServer(options: CreateServerOptions): TaigaMcpServer {
  const { config } = options;
  const session = new TaigaSession(config, options.deps ?? {});
  const catalogs = new CatalogService(session);
  const items = new ItemService(session, catalogs);
  const activity = new ActivityService(session, catalogs);
  const context: ToolContext = { session, catalogs, items, activity, config };

  const server = new McpServer(
    { name: "taiga", version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  const tools = [
    "taiga_whoami",
    "taiga_list_projects",
    "taiga_project_schema",
    "taiga_my_work",
    "taiga_list_items",
    "taiga_get_item",
    "taiga_search",
    "taiga_list_comments",
    "taiga_activity",
  ];
  registerReadTools(server, context);

  if (!config.readOnly) {
    registerWriteTools(server, context);
    tools.push(
      "taiga_create_item",
      "taiga_update_item",
      "taiga_add_comment",
      "taiga_create_sprint",
      "taiga_link_epic",
    );
    if (config.allowDelete) {
      registerDeleteTool(server, context);
      tools.push("taiga_delete_item");
    }
  }

  return { server, session, tools };
}
