# Working with `filters_data` — the recommended way to look up catalog IDs

> 🇬🇧 English version — you are here · [🇷🇺 Русская версия](filters-data.ru.md)

Most Taiga write operations need **numeric IDs** for catalog values: status, type, severity, priority, swimlane, points, etc. Those catalogs are **per-project** — the same status name can have a different ID in different projects.

Taiga provides a single endpoint per resource — **`filters_data`** — that returns every catalog used by that resource in one call. **Prefer it over fetching `/issue-statuses`, `/issue-types`, `/severities`, `/priorities`, … separately.**

## Why prefer `filters_data`

- ✅ **One HTTP request** instead of 4–5 separate catalog calls.
- ✅ **Project-scoped** — only the values configured for this project, with usage `count` for each.
- ✅ Includes related collections that are not separate endpoints (`tags`, `owners`, `assigned_to`, `roles`).
- ✅ Easy to cache — catalogs change rarely, one cached response covers a whole session.

## What you get back

```ts
const data = await client.issues.filtersData({ project: 42 });
// {
//   statuses:    [{ id: 1, name: "New",    color: "#999", count: 12 }, ...],
//   types:       [{ id: 1, name: "Bug",    color: "#e44", count: 5  }, ...],
//   severities:  [{ id: 1, name: "Normal", color: "...",  count: 4  }, ...],
//   priorities:  [{ id: 1, name: "Normal", color: "...",  count: 4  }, ...],
//   assigned_to: [{ id: 7, full_name: "Alice", count: 3 }, ...],
//   owners:      [...],
//   tags:        [["bug", null], ["wontfix", "#888"], ...],
//   roles:       [...]
// }
```

The exact key set depends on the resource: `userStories.filtersData` returns `statuses`, `epics`, `tags`, etc.; `tasks.filtersData` and `epics.filtersData` have their own subsets.

> ⚠️ The current return type is `Record<string, unknown>` — narrow it on your side with a small type cast or zod schema.

## Look up an ID by name

```ts
import { TaigaClient } from "taiga-api-client";

interface CatalogItem {
  id: number;
  name: string;
}

const client = new TaigaClient({ baseUrl: "https://api.taiga.io", token });

const data = await client.issues.filtersData({ project: 42 });
const statuses = data["statuses"] as CatalogItem[];
const inProgress = statuses.find((s) => s.name === "In progress");

await client.issues.create({
  project: 42,
  subject: "Login button broken in Safari",
  status: inProgress!.id,
});
```

## Cache the lookup for the whole session

Catalogs change rarely (admin actions). A simple per-project memoization is usually enough:

```ts
const cache = new Map<number, Record<string, unknown>>();

async function getIssueCatalogs(client: TaigaClient, projectId: number) {
  const cached = cache.get(projectId);
  if (cached) return cached;
  const data = await client.issues.filtersData({ project: projectId });
  cache.set(projectId, data);
  return data;
}
```

For longer-lived processes, set a TTL (5–15 minutes is usually fine) or invalidate on admin events.

## Available `filters_data` endpoints

| Resource         | Method                                     | Returned catalogs (typical)                                                |
| ---------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| User stories     | `client.userStories.filtersData({ project })` | `statuses`, `tags`, `assigned_to`, `owners`, `epics`, `roles`           |
| Tasks            | `client.tasks.filtersData({ project })`    | `statuses`, `tags`, `assigned_to`, `owners`, `roles`                       |
| Issues           | `client.issues.filtersData({ project })`   | `statuses`, `types`, `severities`, `priorities`, `tags`, `assigned_to`, `owners`, `roles` |
| Epics            | `client.epics.filtersData({ project })`    | `statuses`, `tags`, `assigned_to`, `owners`                                |

## When `filters_data` is _not_ enough

- ❌ **Modifying** the catalog itself — `filters_data` is read-only. To add an issue type, rename a status, or delete a severity you need the dedicated catalog endpoints (`/issue-types`, `/issue-statuses`, `/severities`, `/priorities`, …). They are not yet wrapped as resources in this client — fall back to `client.http`:

  ```ts
  const types = await client.http.get("/issue-types", { query: { project: 42 } });
  await client.http.post("/issue-types", {
    body: { project: 42, name: "Spike", color: "#abc" },
  });
  ```

- ❌ **Catalogs that are not used as filters**: `points` (story-point scale), `swimlanes`, project-wide `roles` for memberships. Use the dedicated endpoints (also via `client.http` for now).
- ❌ **Full catalog metadata** (`order`, `is_closed`, `slug`, …). `filters_data` returns the trimmed projection used by the UI; the dedicated endpoint returns everything.

## TL;DR

For 95% of "I need an ID for a status/type/priority/assignee in this project" — call `filters_data` once, cache it per project. Reach for individual catalog endpoints only when you need to **modify** them or need fields that `filters_data` does not include.
