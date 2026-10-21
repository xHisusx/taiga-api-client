import { z } from "zod";
import { ResolutionError, type CatalogService, type ProjectRef } from "../catalog.js";
import type { TaigaMcpConfig } from "../config.js";
import type { ItemService } from "../items.js";
import type { TaigaSession } from "../session.js";
import { ITEM_TYPES } from "../types.js";

/** Everything a tool handler needs. Built once in `createServer`. */
export interface ToolContext {
  session: TaigaSession;
  catalogs: CatalogService;
  items: ItemService;
  config: TaigaMcpConfig;
}

/** Which of the four work-item kinds a call is about. */
export const itemTypeSchema = z
  .enum(ITEM_TYPES)
  .describe("Work item kind: userstory | task | issue | epic.");

/** A project by id, slug or name. */
export const projectSchema = z
  .union([z.string(), z.number()])
  .describe("Project id, slug or name. Slug is the safest.");

/** A status by name or id — names come from taiga_project_schema. */
export const statusSchema = z
  .union([z.string(), z.number()])
  .describe('Status name (case-insensitive, e.g. "In progress") or id.');

/** An assignee by username, full name, id, "me", or "unassigned". */
export const memberSchema = z
  .union([z.string(), z.number()])
  .describe('Member username, full name or id. "me" = the authenticated user, "unassigned" = nobody.');

/** A sprint by name or id, or "none" for the backlog. */
export const sprintSchema = z
  .union([z.string(), z.number()])
  .describe('Sprint (milestone) name or id. "none" moves the item out of any sprint.');

/** Shape fragment identifying one item: `id`, or `ref` plus `project`. */
export const locatorShape = {
  type: itemTypeSchema,
  id: z.number().int().positive().optional().describe("Global item id (as returned by list tools)."),
  ref: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Per-project reference number — the "#12" shown in the UI. Requires "project".'),
  project: projectSchema.optional(),
};

/** Resolve the project for a call, falling back to the server's default project. */
export function projectRef(
  context: ToolContext,
  value: ProjectRef | undefined,
): ProjectRef | undefined {
  return value ?? context.config.defaultProject;
}

/** Same, but for tools that cannot work without a project. */
export function requireProject(context: ToolContext, value: ProjectRef | undefined): ProjectRef {
  const resolved = projectRef(context, value);
  if (resolved === undefined) {
    throw new ResolutionError(
      'This tool needs a project — pass "project" (slug, name or id), or start the server with TAIGA_PROJECT.',
    );
  }
  return resolved;
}

/** Clamp a requested page size to the configured maximum. */
export function clampLimit(context: ToolContext, value: number | undefined, fallback: number): number {
  return Math.min(value ?? fallback, context.config.maxResults);
}
