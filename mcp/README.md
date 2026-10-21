# taiga-mcp-server

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
npx taiga-mcp-server --help

# from this repository
bun install
bun run build          # builds taiga-api-client into dist/
bun run build:mcp      # builds mcp/dist/cli.js
```

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
  -- npx -y taiga-mcp-server
```

### Claude Desktop / any client with a JSON config

```json
{
  "mcpServers": {
    "taiga": {
      "command": "npx",
      "args": ["-y", "taiga-mcp-server"],
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
bun run test        # 74 tests against an in-memory Taiga (no network)
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
