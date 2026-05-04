# taiga-ts

TypeScript-клиент для [Taiga REST API](https://docs.taiga.io/api.html). Без зависимостей, ESM + CJS, работает на Node ≥18 и Bun ≥1.0.

## Установка

```bash
bun add taiga-ts        # или: npm i taiga-ts / pnpm add taiga-ts
```

## Быстрый старт

```ts
import { TaigaClient } from "taiga-ts";

const client = new TaigaClient({ baseUrl: "https://api.taiga.io" });

await client.auth.login({ username: "alice", password: "secret" });

const projects = await client.projects.list();
const story = await client.userStories.create({
  project: projects[0].id,
  subject: "Add OAuth login",
});

for await (const issue of client.issues.paginate({ project: projects[0].id })) {
  console.log(issue.subject);
}
```

## Аутентификация

Поддерживаются три режима:

1. **Bearer (login + refresh)** — основной путь.
2. **Application token** — статический токен, передаётся в `applicationToken` (без login).
3. **Восстановление сессии** — передайте сохранённые `token`/`refreshToken` в конструктор.

### Авто-refresh токенов

По умолчанию клиент **сам обновляет токен** при ответе `401`:

- Перехватывает 401, вызывает `POST /auth/refresh`, ретраит исходный запрос один раз.
- Параллельные 401-ы дедуплицируются — `/auth/refresh` дёргается один раз даже если десять запросов получили 401 одновременно.
- При ошибке самого refresh-а токены сбрасываются и кидается `TaigaAuthError`.

Чтобы сохранять токены между перезапусками процесса, подпишитесь на `onTokenChange`:

```ts
const client = new TaigaClient({
  baseUrl: "https://api.taiga.io",
  token: loadedToken,
  refreshToken: loadedRefresh,
  onTokenChange: async (tokens) => {
    if (tokens) await db.saveTokens(tokens);
    else await db.clearTokens();
  },
});
```

Отключить авто-refresh: `new TaigaClient({ ..., autoRefresh: false })` — тогда ловите `TaigaAuthError` и вызывайте `client.auth.refresh()` вручную.

## Покрытие API (v0.1)

| Ресурс | Доступно через |
|---|---|
| Auth (login, refresh, logout, application token) | `client.auth` |
| Users (`/me`, get, update, list, change password, stats) | `client.users` |
| Projects (CRUD, by_slug, stats, modules config) | `client.projects` |
| Memberships (CRUD, bulk_create, resend invitation) | `client.memberships` |
| User Stories (CRUD, bulk_create, bulk order, filters_data) | `client.userStories` |
| Tasks (CRUD, bulk_create, filters_data) | `client.tasks` |
| Issues (CRUD, voters, watchers, vote/watch) | `client.issues` |
| Milestones (CRUD, stats) | `client.milestones` |

Не покрыто в v0.1 (планируется): epics, wiki, webhooks, attachments, custom attributes, history/comments, importers, project templates, OAuth.

## Пагинация

`list()` возвращает только первую страницу. Для перебора всех элементов используйте `paginate()`:

```ts
for await (const story of client.userStories.paginate({ project: 42 })) { /* ... */ }
```

Чтобы попросить сервер не пагинировать, низкоуровневый `client.http.get(path, { disablePagination: true })` шлёт заголовок `x-disable-pagination: True`.

## Ошибки

```ts
import { TaigaApiError, TaigaAuthError, TaigaRateLimitError, TaigaNetworkError } from "taiga-ts";
```

- `TaigaApiError` — любой 4xx/5xx (`status`, `code`, `detail`, `body`).
- `TaigaAuthError` — 401/403.
- `TaigaRateLimitError` — 429, поле `retryAfter` (секунды).
- `TaigaNetworkError` — сетевая ошибка / abort / таймаут.

## Опции клиента

```ts
new TaigaClient({
  baseUrl: "https://api.taiga.io",
  token, refreshToken, applicationToken,
  autoRefresh: true,        // авто-refresh на 401
  timeoutMs: 30_000,        // таймаут запроса
  userAgent: "my-app/1.0",
  acceptLanguage: "en",
  apiPrefix: "/api/v1",     // если у вас другой префикс
  fetch: customFetch,       // DI для тестов / прокси
  onTokenChange: (tokens) => { /* persist */ },
});
```

## Разработка

```bash
bun install
bun run typecheck
bun run lint
bun run test
bun run build
```

Интеграционные тесты против реального Taiga: см. [tests/integration/README.md](tests/integration/README.md).

## Лицензия

MIT
