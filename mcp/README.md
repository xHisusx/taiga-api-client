# taiga-api-mcp-server

MCP server for [Taiga](https://taiga.io). Connect your own Taiga account to an MCP client
(Claude Code, Claude Desktop, Cursor, …) and let it read your work and act on it with your
own permissions: see what is assigned to you, move items between statuses, create user
stories, tasks, issues and epics, assign people, estimate, comment and plan sprints.

Built on [`taiga-api-client`](../README.md), the typed Taiga REST client in this repository.

- 🇬🇧 English — you are here · [🇷🇺 Русская версия](README.ru.md)

## Why it is more than a REST wrapper

Taiga identifies almost everything by numeric ID, and those IDs are **per project** — the
status "In progress" is a different number in every project you work on. This server closes
that gap, so an agent can work in the terms a human uses:

- **Names, not IDs.** `status: "In progress"`, `assigned_to: "alice"`, `sprint: "Sprint 12"`,
  `severity: "Normal"`, `points: { all: 5 }`. Everything is resolved against the project's
  own catalogs, and an unknown name comes back with the list of valid ones — so the agent
  corrects itself instead of guessing.
- **One call per project to learn it.** `taiga_project_schema` returns every catalog
  (statuses per item kind, members and roles, sprints, issue types, severities, priorities,
  the point scale, tags and your permissions) from a single request, cached for five minutes.
- **`#ref` or `id`.** The number shown in the Taiga UI (`#34`) is per project; the API wants
  the global id. Every tool takes either.
- **Safe updates.** Updates carry the item's `version`, so a concurrent edit by a teammate
  fails loudly instead of being silently overwritten.
- **Your permissions, not more.** Everything runs as the authenticated user. A `403` is
  reported as "your account may not do this here", with a pointer at the project's
  permission list.

## Install

```bash
# from npm
npx taiga-api-mcp-server --help

# from this repository
bun install
bun run build          # builds taiga-api-client into dist/
bun run build:mcp      # builds mcp/dist/cli.js
```

Three names, on purpose: the npm package is **`taiga-api-mcp-server`** (the shorter name
belongs to an unrelated server), the command it installs is **`taiga-mcp-server`**, and the
name in the MCP Registry is **`io.github.xHisusx/taiga-mcp-server`**.

## Credentials

Set the instance URL and exactly one credential:

| Variable | Meaning |
| --- | --- |
| `TAIGA_URL` | **Required.** Instance root, without `/api/v1`. Taiga Cloud: `https://api.taiga.io` |
| `TAIGA_USERNAME` + `TAIGA_PASSWORD` | Username **or** email, and the password |
| `TAIGA_APP_TOKEN` | A long-lived Application token (bots, integrations) |
| `TAIGA_AUTH_TOKEN` (+ `TAIGA_REFRESH_TOKEN`) | An existing bearer pair |

With a username and password the server logs in on the first tool call — never at startup,
so a client that spawns it does not hang when Taiga is unreachable. The resulting token pair
is cached in `~/.taiga-mcp/tokens.json` (mode `0600`), so a restart is silent; when a session
expires it refreshes, and re-logs in if that fails. `TAIGA_MCP_NO_TOKEN_CACHE=1` keeps tokens
in memory only.

> Prefer an Application token for anything shared or long-running: it is scoped to the bot
> account and can be revoked in Taiga without touching your own password.

### Behaviour

| Variable | Default | Meaning |
| --- | --- | --- |
| `TAIGA_WEB_URL` | `tree.taiga.io` for Taiga Cloud, else `TAIGA_URL` | Used to build clickable links |
| `TAIGA_PROJECT` | — | Default project, so tool calls can omit `project` |
| `TAIGA_TZ` | `+03:00` | Fixed UTC offset `taiga_activity` resolves its windows in |
| `TAIGA_MCP_READ_ONLY` | `0` | Register the read tools only |
| `TAIGA_MCP_ALLOW_DELETE` | `0` | Also register `taiga_delete_item` |
| `TAIGA_MCP_TOKEN_FILE` | `~/.taiga-mcp/tokens.json` | Token cache location |
| `TAIGA_MCP_TIMEOUT_MS` | `30000` | Per-request timeout |
| `TAIGA_MCP_CATALOG_TTL_MS` | `300000` | Project catalog cache TTL |
| `TAIGA_MCP_MAX_RESULTS` | `100` | Hard cap on items per call |

The flags `--url=`, `--web-url=`, `--project=`, `--token-file=`, `--read-only`,
`--allow-delete`, `--no-token-cache`, `--help` and `--version` override the environment.

## Connect a client

### Claude Code

```bash
claude mcp add taiga \
  --env TAIGA_URL=https://api.taiga.io \
  --env TAIGA_USERNAME=you@example.com \
  --env TAIGA_PASSWORD=... \
  -- npx -y taiga-api-mcp-server
```

### Claude Desktop / any client with a JSON config

```json
{
  "mcpServers": {
    "taiga": {
      "command": "npx",
      "args": ["-y", "taiga-api-mcp-server"],
      "env": {
        "TAIGA_URL": "https://api.taiga.io",
        "TAIGA_USERNAME": "you@example.com",
        "TAIGA_PASSWORD": "your-password",
        "TAIGA_PROJECT": "my-project"
      }
    }
  }
}
```

Running a local checkout instead:

```json
{
  "command": "node",
  "args": ["/path/to/taiga-ts/mcp/dist/cli.js", "--read-only"],
  "env": { "TAIGA_URL": "http://localhost:9000", "TAIGA_APP_TOKEN": "..." }
}
```

The server speaks MCP over stdio and writes diagnostics to stderr only.

## When it does not connect

A client that reports `Connection closed` has usually started the server with no credentials
in its environment — the server validates its configuration and exits rather than serving
tools it cannot use. The reason is always on stderr, and MCP clients keep it:

- **Claude Code**: `claude mcp list` shows health, `claude mcp get <name>` shows the resolved
  command and environment, and the per-server log holds the stderr
  (`%LOCALAPPDATA%\claude-cli-nodejs\Cache\<project>\mcp-logs-<name>\` on Windows,
  `~/.cache/claude-cli-nodejs/...` elsewhere).
- **Windows `setx`**: it writes the variable for *future* processes only. An editor that is
  already running keeps its old environment, and so does every MCP server it spawns —
  reloading the window or restarting the extension is not enough, the whole editor has to be
  restarted. Baking the values into the server entry (`claude mcp add -e KEY=value`) avoids
  the problem entirely.
- **Unexpanded `${VAR}`**: a client that interpolates its config passes the literal text
  through when a variable is unset. The server treats such a value as absent, so you get
  "TAIGA_PASSWORD is missing" instead of a puzzling `401` from Taiga.
- **The server is simply not listed**: a client reads its server set once per session, so a
  config change needs a new session, not a reloaded window. And on Windows, Claude Code keys
  project- and local-scoped entries by the literal workspace path: the VS Code extension
  reports the drive letter in lower case (`e:\...`) while a terminal resolves it in upper
  case (`E:\...`), so a server added from a terminal can stay invisible to the editor.
  `claude mcp add --scope user` is not path-keyed and sidesteps the mismatch.

## Tools

Read (always registered):

| Tool | What it does |
| --- | --- |
| `taiga_whoami` | The authenticated account, and this server's limits (read-only, deletes) |
| `taiga_list_projects` | Your projects: slug, id, enabled modules |
| `taiga_project_schema` | Every per-project catalog needed to write, plus your permissions |
| `taiga_my_work` | What is assigned to you, grouped by kind, open items first |
| `taiga_list_items` | Filtered lists of user stories / tasks / issues / epics |
| `taiga_get_item` | One item in full, optionally with its tasks or linked stories |
| `taiga_search` | Full-text search inside a project |
| `taiga_list_comments` | The comment thread, and optionally the field changes |
| `taiga_activity` | What happened in a project over a period, in one call — see [below](#activity-what-happened-over-a-period) |

Write (unless `TAIGA_MCP_READ_ONLY=1`):

| Tool | What it does |
| --- | --- |
| `taiga_create_item` | Create a user story, task, issue or epic |
| `taiga_update_item` | Status, assignee, sprint, subject, description, tags, due date, blocked flag, points — and a comment in the same call |
| `taiga_add_comment` | Comment on an item |
| `taiga_create_sprint` | Create a sprint (milestone) |
| `taiga_link_epic` | Link or unlink a user story and an epic |

Only with `TAIGA_MCP_ALLOW_DELETE=1`:

| Tool | What it does |
| --- | --- |
| `taiga_delete_item` | Permanently delete an item. Requires `confirm: true` |

Deletion is off by default because Taiga has no undo — closing an item is almost always what
was meant.

## What a session looks like

> **"What am I supposed to be working on?"**
> `taiga_my_work` → three user stories and a task, with status, sprint, due date and a link each.

> **"Move the SSO story to In progress and tell the team I picked it up."**
> `taiga_project_schema` (once, cached) → `taiga_update_item { type: "userstory", ref: 12,
> project: "apollo", status: "In progress", assigned_to: "me", comment: "Taking this one." }`
> → `{ "changed": { "status": "New → In progress", "assigned_to": "none → alice",
> "comment": "added" } }`

> **"Break that story into tasks for the current sprint."**
> `taiga_create_item` per task with `user_story: 1001` and `sprint: "Sprint 12"`.

> **"What did the team do last week?"**
> `taiga_activity { projects: ["apollo", "orion"], period: "last_week" }` → one entry per card
> that was touched, with its status path, what was closed, the comments and the sprint changes.

## Activity: what happened over a period

`taiga_activity` answers "what did we do last week" in a single call, and it is the only way to
get a period of work out of Taiga: the list endpoints have **no date filters at all**, and
`modified_date` cannot tell work apart from a card being dragged across a board. Reconstructing a
week by hand — ordering by `-modified_date`, feeling for the edge of the window, then reading the
history of every card — costs thousands of tokens per card and gives a different answer depending
on where the agent decided to stop.

```jsonc
taiga_activity {
  "projects": ["apollo", "orion"],
  "period": "last_week"
}
```

```jsonc
{
  "window": {
    "period": "last_week",
    "since": "2026-10-19T00:00:00+03:00",
    "until": "2026-10-26T00:00:00+03:00",
    "tz": "+03:00",
    "since_utc": "2026-10-18T21:00:00Z",
    "until_utc": "2026-10-25T21:00:00Z"
  },
  "projects": [
    { "project": "apollo", "project_id": 7, "events_scanned": 316, "events_in_window": 184, "items": 23 },
    { "project": "orion", "project_id": 8, "events_scanned": 62, "events_in_window": 41, "items": 6 }
  ],
  "truncated": false,
  "items": [
    {
      "project": "apollo",
      "type": "userstory", "id": 1001, "ref": 12,
      "subject": "Login with SSO",
      "url": "https://tree.taiga.io/project/apollo/us/12",
      "status_now": "Done", "tags": ["ui", "auth"], "sprint": "Sprint 2", "assignees": ["bob"],
      "status_path": ["New", "In Progress", "Done"],
      "closed_in_period": true,
      "finish_date": "2026-10-23T16:40:10.112Z",
      "source": "both",
      "planning_only": false,
      "first_event_at": "2026-10-19T12:00:00.000Z",
      "last_event_at": "2026-10-23T16:40:11.004Z",
      "events_count": 5,
      "description_changed": true,
      "attachments_added": 1, "attachments_removed": 1,
      "reassigned": [["Alice Example", "Bob Builder"]],
      "comments": [
        { "at": "2026-10-19T12:00:00.000Z", "author": "Bob Builder", "text": "Picked this up." }
      ]
    }
  ],
  "sprints": [
    { "project": "apollo", "name": "Sprint 2", "change": "closed",
      "at": "2026-10-24T14:12:03.221Z", "by": "Alice Example" }
  ]
}
```

A task also carries `parent`, the user story above it — or sits nested under that story with
`fold_tasks: true`, which is how a weekly report is written. For the report itself, ask for
`include_planning: false` too: on a busy week more than half the cards were only planned, and
dropping them roughly halves the answer.

With `group_by: "event"` the answer holds `events` instead of `items`: the bare chronology,
oldest first, one entry per change. Each carries the `kind` of change (`created`, `status`,
`closed`, `finish_date`, `comment`, `sprint`, `assignee`, `attachment`, `description`,
`subject`, `tags`, `other`) **and** the `field` it happened to, so nothing arrives as an
unnamed "something changed".

| Parameter | Default | Meaning |
| --- | --- | --- |
| `projects` | `TAIGA_PROJECT` | One project or a list of them (slug, name or id) |
| `period` | `last_week` | `last_week`, `this_week`, `last_7_days`, `last_14_days`. The rolling two start at local midnight N days back, so the answer holds still for the rest of the day |
| `since` / `until` | — | Explicit bounds: `"2026-10-19"` or ISO-8601. Not combinable with `period`, and `until` needs `since` |
| `tz` | `TAIGA_TZ` | Fixed UTC offset the dates are read in (`"+03:00"`, `"Z"`) |
| `types` | all | `userstory`, `task`, `issue`, `epic`, `milestone` |
| `group_by` | `item` | `item` sums up each card; `event` returns the chronology |
| `include_comments` | `true` | Include comment text |
| `include_planning` | `true` | `false` drops the cards that were only planned — the cheapest way to cut the answer down to work done |
| `fold_tasks` | `false` | Nest each task under its parent story. A task whose story is not in the answer stays on its own |
| `tags` | — | Only cards carrying **all** of these tags |
| `users` | — | Only events by these people (`"me"` is the authenticated user) |
| `max_pages` | `20` | Safety stop, counted in pages of 100 events **that reach into the window** — paging past newer events to get there does not count against it |
| `comment_chars` | `1500` | Cap on one comment, which is then marked `truncated` |
| `drop_noise` | `true` | Board positions. `false` is only accepted with `group_by: "event"` |

### What the server decides, so a report does not have to

- **The window is local and half-open.** `[since, until)` in `tz`, and a bare date means the
  start of that day. `last_week` runs Monday 00:00 to Monday 00:00 — seven whole days, because
  work done on a Saturday is still work done that week. Both the local bounds and their UTC
  equivalents come back in `window`: three hours of offset is exactly enough to push a Monday
  morning out of the week it belongs to.
- **A closure entered after the fact still counts.** Teams move cards to Done days later, so
  `closed_in_period` is true either when the window holds the `is_closed` change, or when the
  card's `finish_date` falls inside it and the card is closed now. `source` says which:
  `"timeline"`, `"finish_date"` or `"both"`. A card whose only evidence is its finish date has
  no events in the window and is still reported.
- **Planning is not work.** `planning_only` marks a card that was only moved between sprints,
  reassigned, reordered or had its description edited — no status change, no closure, no
  comment, no attachment. Left to the reader, that call gets made differently every week.
- **Noise never reaches you.** Board positions (`*_order`) are dropped, `description_diff` — a
  fixed placeholder, never the actual text — becomes `description_changed`, attachments become
  counts, and the HTML renderings and tokenized attachment URLs are never emitted at all.
  The `token` query parameter is also blanked out inside comment text, because
  people paste attachment links into comments by hand and a comment travels verbatim into a
  report that is then mailed around.
- **Short data says so.** Paging stops at `since`, not at a page count. If `max_pages` runs out
  first, `truncated` is true in the answer and on the project — because "nobody did anything"
  and "the data did not all arrive" are different things to tell a manager. Only the pages that
  reach into the window are charged to the budget: a week-old window on a project with 60
  events a day sits behind a page and a half of newer events, and charging that seek to
  `max_pages` would spend it before the window was reached. If even the 100-page ceiling is
  spent getting there, the project says `window_reached: false`. A page that fails mid-walk
  returns what the earlier ones gave, marked `truncated`, rather than failing the call.
- **A project you cannot read does not sink the call.** A `403` is reported against that project
  and the others still answer; an unknown slug fails the call and lists the projects you have.

## Field support per item kind

Taiga does not give every field to every kind, and a call that mixes them up is rejected with
an explanation rather than a 400 from the API:

| | user story | task | issue | epic |
| --- | --- | --- | --- | --- |
| sprint (`milestone`) | ✅ | ✅ | ✅ | ❌ |
| `due_date` | ✅ | ✅ | ✅ | ❌ |
| story `points` | ✅ | ❌ | ❌ | ❌ |
| parent `user_story` | ❌ | ✅ | ❌ | ❌ |
| `issue_type` / `severity` / `priority` | ❌ | ❌ | ✅ | ❌ |
| `color` | ❌ | ❌ | ❌ | ✅ |

Two Taiga rules the server enforces for you instead of letting the field be dropped silently:

- A **task that belongs to a user story follows that story's sprint**. Setting a sprint on
  such a task is refused with a pointer at the story; a task without a parent can be put in
  a sprint directly.
- **`points` are per role and `total_points` is their sum**, so `{"all": 5}` on a project
  with four estimating roles leaves `total_points` at 20. Name a single role to estimate
  only that one.

## Development

```bash
bun run test        # 128 tests against an in-memory Taiga (no network)
bun run typecheck
bun run build
```

Tests drive the real `McpServer` through an in-memory MCP client, with a fake Taiga injected
as the client's `fetch` — so tool schemas, name resolution, request payloads and error
mapping are all covered without a live instance.

The build **bundles `taiga-api-client` from this repository's `src/`** (resolved through the
`paths` entry in `mcp/tsconfig.json`), so a local build always runs the client in the working
tree rather than the version published to npm. Only the MCP SDK and zod stay external.

## License

MIT
