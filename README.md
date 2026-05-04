# taiga-api-client

[![npm version](https://img.shields.io/npm/v/taiga-api-client.svg)](https://www.npmjs.com/package/taiga-api-client)
[![npm downloads](https://img.shields.io/npm/dm/taiga-api-client.svg)](https://www.npmjs.com/package/taiga-api-client)
[![bundle size](https://img.shields.io/bundlephobia/minzip/taiga-api-client)](https://bundlephobia.com/package/taiga-api-client)
[![types](https://img.shields.io/npm/types/taiga-api-client.svg)](https://www.npmjs.com/package/taiga-api-client)
[![license](https://img.shields.io/npm/l/taiga-api-client.svg)](LICENSE)
[![CI](https://github.com/xHisusx/taiga-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/xHisusx/taiga-ts/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/xHisusx/taiga-ts?style=social)](https://github.com/xHisusx/taiga-ts)

> 🇬🇧 English version — you are here · [🇷🇺 Русская версия](README.ru.md)

A TypeScript client for the [Taiga REST API](https://docs.taiga.io/api.html). Zero runtime dependencies, dual ESM + CJS, runs on Node ≥18, Bun ≥1.0 and any environment with a global `fetch`.

- 🔐 Bearer authentication with **automatic token refresh** and deduplication of concurrent refreshes
- 📦 Fully typed: types for every resource, payload and parameter
- 🚫 Zero runtime dependencies
- 🔄 Async iterators for pagination
- ⚠️ Typed errors (`TaigaApiError`, `TaigaAuthError`, `TaigaRateLimitError`, `TaigaNetworkError`)
- 🚀 Dual ESM + CJS build with `.d.ts` / `.d.cts` type maps

## Installation

```bash
npm install taiga-api-client
# or
bun add taiga-api-client
# or
pnpm add taiga-api-client
```

## Quick start

```ts
import { TaigaClient } from "taiga-api-client";

// baseUrl is the only required option.
const client = new TaigaClient({ baseUrl: "https://api.taiga.io" });

// Log in (the `username` field accepts both username and email).
await client.auth.login({ username: "alice@example.com", password: "secret" });

// Fetch projects you are a member of.
const me = await client.users.me();
const projects = await client.projects.list({ member: me.id });

// Create a user story.
const story = await client.userStories.create({
  project: projects[0].id,
  subject: "Add OAuth login",
  description: "Support GitHub OAuth in addition to password login",
});

// Iterate over every issue in the project (auto-pagination).
for await (const issue of client.issues.paginate({ project: projects[0].id })) {
  console.log(`#${issue.ref} ${issue.subject}`);
}
```

## Creating the client

**Minimum:**

```ts
const client = new TaigaClient({ baseUrl: "https://api.taiga.io" });
```

`baseUrl` is the **only required** option. Everything else is optional.

**Full example:**

```ts
const client = new TaigaClient({
  baseUrl: "https://api.taiga.io", // ← required

  // Authentication — pick one (or none, if you will call client.auth.login later):
  token: "...", // a previously obtained bearer token (session restore)
  refreshToken: "...", // its paired refresh token
  applicationToken: "...", // a static Application token, used instead of bearer

  // Behavior:
  autoRefresh: true, // auto-refresh the bearer token on 401 (default true)
  timeoutMs: 30000, // request timeout in ms (default 30000)
  userAgent: "my-app/1.0",
  acceptLanguage: "en",
  apiPrefix: "/api/v1", // change only for self-hosted with a non-default prefix
  fetch: customFetch, // dependency-injected fetch (proxies, mocks)

  // Token persistence hook:
  onTokenChange: async (tokens) => {
    if (tokens) await db.saveTokens(tokens);
    else await db.clearTokens();
  },
});
```

### `TaigaClientOptions`

| Option             | Required? | Type                                  | Default   | Description                                                                                   |
| ------------------ | :-------: | ------------------------------------- | --------- | --------------------------------------------------------------------------------------------- |
| `baseUrl`          |  ✅ yes   | `string`                              | —         | Root URL of your Taiga instance (without `/api/v1`). For Taiga Cloud: `https://api.taiga.io`. |
| `token`            |    no     | `string \| null`                      | `null`    | Bearer token. Pass it to restore an existing session.                                         |
| `refreshToken`     |    no     | `string \| null`                      | `null`    | Paired refresh token.                                                                         |
| `applicationToken` |    no     | `string \| null`                      | `null`    | Static Application token (mutually exclusive with bearer).                                    |
| `autoRefresh`      |    no     | `boolean`                             | `true`    | Automatically refresh the bearer token on 401.                                                |
| `timeoutMs`        |    no     | `number`                              | `30000`   | Per-request timeout in milliseconds.                                                          |
| `userAgent`        |    no     | `string`                              | —         | `User-Agent` header.                                                                          |
| `acceptLanguage`   |    no     | `string`                              | —         | `Accept-Language` header (i18n of response strings).                                          |
| `apiPrefix`        |    no     | `string`                              | `/api/v1` | API path prefix. Change only for non-standard self-hosted setups.                             |
| `fetch`            |    no     | `typeof fetch`                        | global    | Custom `fetch` implementation (proxy, mocking, MSW).                                          |
| `onTokenChange`    |    no     | `(tokens \| null) => void \| Promise` | —         | Callback fired after `login` and after a successful auto-refresh. Use it to persist tokens.   |

## Authentication

Three modes are supported:

| Mode              | When to use                                            | Header                         |
| ----------------- | ------------------------------------------------------ | ------------------------------ |
| Bearer + refresh  | Standard interactive login                             | `Authorization: Bearer X`      |
| Session restore   | Process restart — pass saved tokens to the constructor | `Authorization: Bearer X`      |
| Application token | Integrations / bots, long-lived static token           | `Authorization: Application X` |

### Automatic token refresh

With `autoRefresh: true` (the default), the client transparently intercepts `401` responses, calls `POST /auth/refresh`, and **retries the original request once**. Concurrent 401s are deduplicated — `/auth/refresh` is called exactly once even if 10 requests fail simultaneously. If the refresh itself fails, tokens are cleared and a `TaigaAuthError` is thrown.

### Persisting tokens across process restarts

```ts
const client = new TaigaClient({
  baseUrl: "https://api.taiga.io",
  token: await db.loadToken(),
  refreshToken: await db.loadRefreshToken(),
  onTokenChange: async (tokens) => {
    if (tokens) await db.saveTokens(tokens);
    else await db.clearTokens();
  },
});
```

`onTokenChange` is invoked:

- after `client.auth.login(...)` — with the new token pair;
- after a successful auto-refresh — with the new pair;
- after `client.auth.logout()` — with `null`.

The returned Promise is awaited before the request is retried, so your persistence is guaranteed to complete before the next request goes out.

## Resources and methods

Every resource extends `BaseResource`, which provides standard CRUD. Specific resources add their own methods on top.

### `BaseResource<T>` — common CRUD

| Method                         | HTTP                   | Returns                | Description                                                       |
| ------------------------------ | ---------------------- | ---------------------- | ----------------------------------------------------------------- |
| `list(params?)`                | `GET /resource`        | `T[]`                  | First page (or the entire response when `disablePagination`).     |
| `paginate(params?)`            | `GET /resource?page=N` | `AsyncIterable<T>`     | Lazy async iterator that walks `x-pagination-next` links.         |
| `listPage(params?, page?)`     | `GET /resource?page=N` | `{ data, pagination }` | A specific page plus pagination metadata.                         |
| `get(id)`                      | `GET /resource/:id`    | `T`                    | A single resource by ID.                                          |
| `create(payload)`              | `POST /resource`       | `T`                    | Create.                                                           |
| `update(id, payload)`          | `PUT /resource/:id`    | `T`                    | Full replace. Requires every required field.                      |
| `patch(id, payload, version?)` | `PATCH /resource/:id`  | `T`                    | Partial update. `version` enables optimistic concurrency control. |
| `delete(id)`                   | `DELETE /resource/:id` | `void`                 | Delete.                                                           |

### `client.auth` — authentication

| Method                          | Returns                 | Description                                                 |
| ------------------------------- | ----------------------- | ----------------------------------------------------------- |
| `login({ username, password })` | `Promise<AuthResponse>` | `POST /auth`. `username` accepts both username and email.   |
| `refresh()`                     | `Promise<string>`       | Manual refresh. Usually invoked automatically on 401.       |
| `logout()`                      | `Promise<void>`         | Clears tokens locally and calls `onTokenChange(null)`.      |
| `setTokens(tokens \| null)`     | `Promise<void>`         | Set tokens manually (e.g. after restoring from a database). |
| `getTokens()`                   | `AuthTokens \| null`    | Current in-memory tokens.                                   |
| `getCurrentUser()`              | `AuthUser \| null`      | The user profile from the last successful `login()`.        |
| `onTokenChange(handler)`        | `void`                  | Replace the persistence callback at runtime.                |

```ts
const auth = await client.auth.login({ username: "u", password: "p" });
console.log(auth.auth_token, auth.refresh, auth.full_name);
```

### `client.users` — users

Base CRUD plus:

| Method                                         | HTTP                          | Description                                  |
| ---------------------------------------------- | ----------------------------- | -------------------------------------------- |
| `me()`                                         | `GET /users/me`               | The currently authenticated user.            |
| `updateMe(payload)`                            | `PUT /users/:id` (own id)     | Convenience shortcut for `update(me.id, …)`. |
| `changePassword(currentPassword, newPassword)` | `POST /users/change_password` | Change the password.                         |
| `stats(id)`                                    | `GET /users/:id/stats`        | User statistics.                             |

> ⚠️ `users.create()` intentionally throws — registration uses dedicated endpoints (out of scope in v0.1).

```ts
const me = await client.users.me();
await client.users.updateMe({ bio: "TypeScript fan", lang: "en" });
await client.users.changePassword("oldPwd!", "newPwd!");
```

### `client.projects` — projects

Base CRUD plus:

| Method                         | HTTP                             | Description                                            |
| ------------------------------ | -------------------------------- | ------------------------------------------------------ |
| `getBySlug(slug)`              | `GET /projects/by_slug?slug=...` | Fetch a project by slug instead of id.                 |
| `stats(id)`                    | `GET /projects/:id/stats`        | Project statistics (points, milestones).               |
| `modulesConfig(id)`            | `GET /projects/:id/modules`      | Integrations config (GitHub, GitLab, Bitbucket, Gogs). |
| `setModulesConfig(id, config)` | `PATCH /projects/:id/modules`    | Update integrations config.                            |

```ts
const proj = await client.projects.create({ name: "Demo", description: "" });
const sameProj = await client.projects.getBySlug(proj.slug);
const updated = await client.projects.patch(proj.id, { description: "Updated" }, /* version */ 1);
const stats = await client.projects.stats(proj.id);
await client.projects.delete(proj.id);
```

### `client.memberships` — project memberships

Base CRUD plus:

| Method                 | HTTP                                      | Description                        |
| ---------------------- | ----------------------------------------- | ---------------------------------- |
| `bulkCreate(payload)`  | `POST /memberships/bulk_create`           | Invite multiple users in one call. |
| `resendInvitation(id)` | `POST /memberships/:id/resend_invitation` | Resend the invitation email.       |

```ts
await client.memberships.bulkCreate({
  project_id: proj.id,
  bulk_memberships: [
    { role_id: 1, username: "alice@example.com" },
    { role_id: 2, username: "bob@example.com" },
  ],
  invitation_extra_text: "Welcome to the team",
});
```

### `client.userStories` — user stories

Base CRUD plus:

| Method                            | HTTP                                          | Description                                              |
| --------------------------------- | --------------------------------------------- | -------------------------------------------------------- |
| `bulkCreate(payload)`             | `POST /userstories/bulk_create`               | Create multiple stories from a newline-separated string. |
| `bulkUpdateBacklogOrder(payload)` | `POST /userstories/bulk_update_backlog_order` | Reorder stories in the backlog.                          |
| `bulkUpdateKanbanOrder(payload)`  | `POST /userstories/bulk_update_kanban_order`  | Reorder stories on the kanban board.                     |
| `bulkUpdateSprintOrder(payload)`  | `POST /userstories/bulk_update_sprint_order`  | Reorder stories within a sprint.                         |
| `filtersData({ project })`        | `GET /userstories/filters_data?project=...`   | Available filters for the UI: statuses, tags, assignees. |

```ts
const story = await client.userStories.create({
  project: proj.id,
  subject: "User can log in via GitHub",
  description: "OAuth flow",
});

// Bulk create from a multi-line string (the way the Taiga UI does it):
await client.userStories.bulkCreate({
  project_id: proj.id,
  bulk_stories: "Story 1\nStory 2\nStory 3",
});

// Iterate over every story in the project:
for await (const s of client.userStories.paginate({ project: proj.id })) {
  console.log(s.subject);
}
```

### `client.tasks` — tasks

Base CRUD plus:

| Method                     | HTTP                                  | Description                    |
| -------------------------- | ------------------------------------- | ------------------------------ |
| `bulkCreate(payload)`      | `POST /tasks/bulk_create`             | Create multiple tasks at once. |
| `filtersData({ project })` | `GET /tasks/filters_data?project=...` | Available filters.             |

```ts
const task = await client.tasks.create({
  project: proj.id,
  subject: "Implement OAuth callback",
  user_story: story.id, // link to a user story
});
```

### `client.issues` — issues

Base CRUD plus:

| Method                     | HTTP                                   | Description                                        |
| -------------------------- | -------------------------------------- | -------------------------------------------------- |
| `filtersData({ project })` | `GET /issues/filters_data?project=...` | Available filters (types, severities, priorities). |
| `voters(id)`               | `GET /issues/:id/voters`               | Users that have upvoted the issue.                 |
| `upvote(id)`               | `POST /issues/:id/upvote`              | Upvote an issue.                                   |
| `downvote(id)`             | `POST /issues/:id/downvote`            | Remove your upvote.                                |
| `watchers(id)`             | `GET /issues/:id/watchers`             | Users watching the issue.                          |
| `watch(id)`                | `POST /issues/:id/watch`               | Subscribe to notifications.                        |
| `unwatch(id)`              | `POST /issues/:id/unwatch`             | Unsubscribe.                                       |

```ts
const issue = await client.issues.create({
  project: proj.id,
  subject: "Login button doesn't work in Safari",
  description: "Reproduces on macOS Safari 17.x",
});
await client.issues.upvote(issue.id);
await client.issues.watch(issue.id);
```

### `client.epics` — epics

Base CRUD plus:

| Method                                  | HTTP                                            | Description                                                |
| --------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| `bulkCreate(payload)`                   | `POST /epics/bulk_create`                       | Create multiple epics from a newline-separated string.     |
| `filtersData({ project })`              | `GET /epics/filters_data?project=...`           | Available filters for the UI.                              |
| `relatedUserStories(id)`                | `GET /epics/:id/related_userstories`            | User stories linked to the epic.                           |
| `addRelatedUserStory(id, { user_story })` | `POST /epics/:id/related_userstories`         | Link an existing user story to the epic.                   |
| `removeRelatedUserStory(id, usId)`      | `DELETE /epics/:id/related_userstories/:usId`   | Unlink a user story from the epic.                         |
| `voters(id)`                            | `GET /epics/:id/voters`                         | Users that have upvoted the epic.                          |
| `upvote(id)`                            | `POST /epics/:id/upvote`                        | Upvote an epic.                                            |
| `downvote(id)`                          | `POST /epics/:id/downvote`                      | Remove your upvote.                                        |
| `watchers(id)`                          | `GET /epics/:id/watchers`                       | Users watching the epic.                                   |
| `watch(id)`                             | `POST /epics/:id/watch`                         | Subscribe to notifications.                                |
| `unwatch(id)`                           | `POST /epics/:id/unwatch`                       | Unsubscribe.                                               |

```ts
const epic = await client.epics.create({
  project: proj.id,
  subject: "Q1 roadmap",
  color: "#ff8800",
});
await client.epics.addRelatedUserStory(epic.id, { user_story: story.id });
for (const link of await client.epics.relatedUserStories(epic.id)) {
  console.log(link.user_story);
}
```

> ℹ️ Epics must be enabled on the project (`is_epics_activated: true`) for these endpoints to work.

### `client.milestones` — sprints

Base CRUD plus:

| Method      | HTTP                        | Description                                      |
| ----------- | --------------------------- | ------------------------------------------------ |
| `stats(id)` | `GET /milestones/:id/stats` | Burndown data and completion progress in points. |

```ts
const sprint = await client.milestones.create({
  project: proj.id,
  name: "Sprint 1",
  estimated_start: "2026-01-01",
  estimated_finish: "2026-01-14",
});
const burndown = await client.milestones.stats(sprint.id);
```

## Pagination

`list()` always returns the **first page** of the response. There are three ways to iterate the full set:

```ts
// 1. Async iterator (recommended): lazy, walks the next links.
for await (const story of client.userStories.paginate({ project: 42 })) {
  await processStory(story);
}

// 2. A specific page plus metadata.
const page = await client.userStories.listPage({ project: 42 }, 3);
console.log(page.data, page.pagination); // { count, perPage, current, next, prev }

// 3. Disable pagination entirely (returns the full set as one array).
const all = await client.http.get("/userstories", {
  query: { project: 42 },
  disablePagination: true,
});
```

> ⚠️ `disablePagination` sends the `x-disable-pagination: True` header. Use it only on small collections — for large ones Taiga may respond with an error or time out.

## Errors

Every error inherits from the abstract `TaigaError`:

| Class                 | When it is thrown               | Useful fields                                       |
| --------------------- | ------------------------------- | --------------------------------------------------- |
| `TaigaApiError`       | Any unsuccessful 4xx/5xx        | `status`, `code`, `detail`, `body`                  |
| `TaigaAuthError`      | 401 / 403                       | + everything from `TaigaApiError`                   |
| `TaigaRateLimitError` | 429                             | + `retryAfter` (seconds, parsed from `Retry-After`) |
| `TaigaNetworkError`   | Network failure, abort, timeout | `cause` (the underlying fetch / AbortError)         |

```ts
import {
  TaigaApiError,
  TaigaAuthError,
  TaigaRateLimitError,
  TaigaNetworkError,
} from "taiga-api-client";

try {
  await client.projects.get(99999);
} catch (err) {
  if (err instanceof TaigaRateLimitError) {
    await sleep((err.retryAfter ?? 1) * 1000);
  } else if (err instanceof TaigaAuthError) {
    // Session is dead — log in again
  } else if (err instanceof TaigaApiError) {
    console.error(`Taiga ${err.status}: ${err.detail ?? err.message}`);
  } else if (err instanceof TaigaNetworkError) {
    // Network / timeout
  }
}
```

## Optimistic Concurrency Control (OCC)

Taiga prevents lost updates between concurrent users via a `version` field. When calling `patch()`, pass the version you received with the object — if someone updated it first, Taiga responds with `400` / `412` and you learn about the conflict.

```ts
const story = await client.userStories.get(42);
const updated = await client.userStories.patch(
  story.id,
  { subject: "Renamed" },
  story.version, // ← OCC
);
```

## Low-level access

For endpoints that are not yet wrapped as resources, use `client.http` directly:

```ts
const result = await client.http.get<{ id: number }[]>("/wiki", {
  query: { project: 1 },
});
console.log(result.data, result.pagination, result.headers);
```

The available methods are `get`, `post`, `put`, `patch`, `delete`. They all accept the same `RequestOptions`: `{ query, body, headers, signal, disablePagination, skipAuth }`.

## Coverage

**Implemented:**

- Auth: login, refresh, logout, application token, session restore, auto-refresh with deduplication
- Users: profile, list, update, change password, stats
- Projects: CRUD, by_slug, stats, modules config
- Memberships: CRUD, bulk_create, resend invitation
- User Stories: CRUD, bulk_create, bulk_update_order for every board, filters_data
- Tasks: CRUD, bulk_create, filters_data
- Issues: CRUD, filters_data, voters, watchers, upvote/downvote, watch/unwatch
- Milestones: CRUD, stats
- Epics _(new in v0.2)_: CRUD, bulk_create, filters_data, related_userstories (list/add/remove), voters, watchers, upvote/downvote, watch/unwatch

**Not implemented yet (planned for upcoming releases):** wiki, webhooks, attachments, custom attributes, history/comments, importers (Trello/Jira/GitHub), project templates, GitHub OAuth flow.

If the endpoint you need is not covered, fall back to [`client.http`](#low-level-access) and/or open an issue.

## Compatibility

| Runtime | Minimum            | Notes                                           |
| ------- | ------------------ | ----------------------------------------------- |
| Node.js | 18                 | Global `fetch` was introduced in Node 18.       |
| Bun     | 1.0                | Fully supported.                                |
| Deno    | 1.x                | Should work (global `fetch` is available).      |
| Browser | any modern browser | Requires CORS to be configured on Taiga's side. |

## License

[MIT](LICENSE)
