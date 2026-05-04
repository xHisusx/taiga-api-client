# taiga-api-client

[![npm version](https://img.shields.io/npm/v/taiga-api-client.svg)](https://www.npmjs.com/package/taiga-api-client)
[![npm downloads](https://img.shields.io/npm/dm/taiga-api-client.svg)](https://www.npmjs.com/package/taiga-api-client)
[![bundle size](https://img.shields.io/bundlephobia/minzip/taiga-api-client)](https://bundlephobia.com/package/taiga-api-client)
[![types](https://img.shields.io/npm/types/taiga-api-client.svg)](https://www.npmjs.com/package/taiga-api-client)
[![license](https://img.shields.io/npm/l/taiga-api-client.svg)](LICENSE)
[![CI](https://github.com/xHisusx/taiga-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/xHisusx/taiga-ts/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/xHisusx/taiga-ts?style=social)](https://github.com/xHisusx/taiga-ts)

> 🇷🇺 Русская версия — вы здесь · [🇬🇧 English](README.md)

TypeScript-клиент для [Taiga REST API](https://docs.taiga.io/api.html). Без runtime-зависимостей, ESM + CJS, работает в Node ≥18, Bun ≥1.0 и в любых средах с глобальным `fetch`.

- 🔐 Bearer-аутентификация с **автоматическим refresh** токена и дедупликацией параллельных refresh-ов
- 📦 Полный TypeScript: типы для всех ресурсов, payload-ов и параметров
- 🪶 Zero dependencies в runtime
- 🔄 Async-итераторы для пагинации
- 🛡 Типизированные ошибки (`TaigaApiError`, `TaigaAuthError`, `TaigaRateLimitError`, `TaigaNetworkError`)
- 🚀 Дуальная сборка ESM + CJS, тип-карты `.d.ts` / `.d.cts`

## Установка

```bash
npm install taiga-api-client
# или
bun add taiga-api-client
# или
pnpm add taiga-api-client
```

## Быстрый старт

```ts
import { TaigaClient } from "taiga-api-client";

// baseUrl — единственное обязательное поле.
const client = new TaigaClient({ baseUrl: "https://api.taiga.io" });

// Логин (поле username принимает и юзернейм, и email)
await client.auth.login({ username: "alice@example.com", password: "secret" });

// Получаем мои проекты
const me = await client.users.me();
const projects = await client.projects.list({ member: me.id });

// Создаём user story
const story = await client.userStories.create({
  project: projects[0].id,
  subject: "Add OAuth login",
  description: "Support GitHub OAuth in addition to password login",
});

// Перебираем все issue-ы проекта (автоматическая пагинация)
for await (const issue of client.issues.paginate({ project: projects[0].id })) {
  console.log(`#${issue.ref} ${issue.subject}`);
}
```

## Создание клиента

**Минимально достаточный конструктор:**

```ts
const client = new TaigaClient({ baseUrl: "https://api.taiga.io" });
```

`baseUrl` — единственное обязательное поле. Всё остальное опционально.

**Полный пример со всеми опциями:**

```ts
const client = new TaigaClient({
  baseUrl: "https://api.taiga.io", // ← обязательно

  // Аутентификация — выберите один из вариантов (или вообще ни одного,
  // если будете логиниться позже через client.auth.login):
  token: "...", // ранее полученный bearer-токен (восстановление сессии)
  refreshToken: "...", // парный refresh-токен
  applicationToken: "...", // вместо bearer — статический Application token

  // Поведение:
  autoRefresh: true, // авто-refresh на 401 (по умолчанию true)
  timeoutMs: 30000, // таймаут запроса в мс (по умолчанию 30000)
  userAgent: "my-app/1.0",
  acceptLanguage: "en",
  apiPrefix: "/api/v1", // только если у self-hosted нестандартный префикс
  fetch: customFetch, // DI: подменить fetch (для прокси/тестов)

  // Хук персистентности токенов:
  onTokenChange: async (tokens) => {
    if (tokens) await db.saveTokens(tokens);
    else await db.clearTokens();
  },
});
```

### Опции `TaigaClientOptions`

| Опция              | Обязательно? | Тип                                   | По умолчанию | Описание                                                                              |
| ------------------ | :----------: | ------------------------------------- | ------------ | ------------------------------------------------------------------------------------- |
| `baseUrl`          |    ✅ да     | `string`                              | —            | Корень Taiga-инстанса (без `/api/v1`). Для Taiga Cloud: `https://api.taiga.io`.       |
| `token`            |     нет      | `string \| null`                      | `null`       | Bearer-токен. Передайте, если восстанавливаете сессию.                                |
| `refreshToken`     |     нет      | `string \| null`                      | `null`       | Refresh-токен.                                                                        |
| `applicationToken` |     нет      | `string \| null`                      | `null`       | Статический Application-токен (взаимоисключающий с bearer).                           |
| `autoRefresh`      |     нет      | `boolean`                             | `true`       | Автоматически обновлять токен при 401.                                                |
| `timeoutMs`        |     нет      | `number`                              | `30000`      | Таймаут одного HTTP-запроса в мс.                                                     |
| `userAgent`        |     нет      | `string`                              | —            | Заголовок `User-Agent`.                                                               |
| `acceptLanguage`   |     нет      | `string`                              | —            | Заголовок `Accept-Language` (i18n текстов в ответах).                                 |
| `apiPrefix`        |     нет      | `string`                              | `/api/v1`    | Префикс API. Менять только для нестандартных self-hosted конфигураций.                |
| `fetch`            |     нет      | `typeof fetch`                        | глобальный   | Кастомная реализация `fetch` (прокси, мокинг, MSW).                                   |
| `onTokenChange`    |     нет      | `(tokens \| null) => void \| Promise` | —            | Колбэк, вызываемый после login и после авто-refresh. Используйте для персистентности. |

## Аутентификация

Поддерживаются три режима:

| Режим                 | Когда использовать                                               | Заголовок                      |
| --------------------- | ---------------------------------------------------------------- | ------------------------------ |
| Bearer + refresh      | Обычный пользовательский логин                                   | `Authorization: Bearer X`      |
| Восстановление сессии | Перезапуск процесса — передайте сохранённые токены в конструктор | `Authorization: Bearer X`      |
| Application token     | Интеграции/боты, статический долгоживущий токен                  | `Authorization: Application X` |

### Авто-refresh токенов

При `autoRefresh: true` (по умолчанию) клиент сам перехватывает `401`, обновляет токен через `POST /auth/refresh` и **один раз** ретраит исходный запрос. Параллельные 401-ы дедуплицируются — `/auth/refresh` дёргается ровно один раз даже если сразу 10 запросов вернули 401. При фейле самого refresh-а токены сбрасываются, кидается `TaigaAuthError`.

### Сохранение токенов между перезапусками

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

`onTokenChange` вызывается:

- после `client.auth.login(...)` — с новой парой токенов;
- после успешного авто-refresh-а — с новой парой;
- после `client.auth.logout()` — с `null`.

Возвращаемый Promise дожидается перед ретраем, так что persistence гарантированно успеет до следующего запроса.

## Ресурсы и методы

Все ресурсы наследуются от `BaseResource`, который даёт стандартный CRUD. Конкретные ресурсы добавляют свои методы.

### `BaseResource<T>` — общий CRUD

| Метод                          | HTTP                   | Возвращает             | Описание                                                            |
| ------------------------------ | ---------------------- | ---------------------- | ------------------------------------------------------------------- |
| `list(params?)`                | `GET /resource`        | `T[]`                  | Первая страница (или весь ответ при `disablePagination`).           |
| `paginate(params?)`            | `GET /resource?page=N` | `AsyncIterable<T>`     | Async-итератор по всем страницам. Идёт по `x-pagination-next`.      |
| `listPage(params?, page?)`     | `GET /resource?page=N` | `{ data, pagination }` | Конкретная страница + meta пагинации.                               |
| `get(id)`                      | `GET /resource/:id`    | `T`                    | Один объект по ID.                                                  |
| `create(payload)`              | `POST /resource`       | `T`                    | Создание.                                                           |
| `update(id, payload)`          | `PUT /resource/:id`    | `T`                    | Полная замена. Требует все обязательные поля.                       |
| `patch(id, payload, version?)` | `PATCH /resource/:id`  | `T`                    | Частичное обновление. `version` для optimistic concurrency control. |
| `delete(id)`                   | `DELETE /resource/:id` | `void`                 | Удаление.                                                           |

### `client.auth` — аутентификация

| Метод                           | Возвращает              | Описание                                                         |
| ------------------------------- | ----------------------- | ---------------------------------------------------------------- |
| `login({ username, password })` | `Promise<AuthResponse>` | `POST /auth`. `username` принимает и юзернейм, и email.          |
| `refresh()`                     | `Promise<string>`       | Принудительный refresh. Обычно вызывается автоматически на 401.  |
| `logout()`                      | `Promise<void>`         | Локальный сброс токенов + вызов `onTokenChange(null)`.           |
| `setTokens(tokens \| null)`     | `Promise<void>`         | Установить токены руками (например, после восстановления из БД). |
| `getTokens()`                   | `AuthTokens \| null`    | Текущие токены в памяти.                                         |
| `getCurrentUser()`              | `AuthUser \| null`      | Профиль пользователя из последнего `login()`.                    |
| `onTokenChange(handler)`        | `void`                  | Заменить колбэк персистентности «на лету».                       |

```ts
const auth = await client.auth.login({ username: "u", password: "p" });
console.log(auth.auth_token, auth.refresh, auth.full_name);
```

### `client.users` — пользователи

Базовый CRUD + следующие методы:

| Метод                                          | HTTP                             | Описание                                    |
| ---------------------------------------------- | -------------------------------- | ------------------------------------------- |
| `me()`                                         | `GET /users/me`                  | Текущий пользователь.                       |
| `updateMe(payload)`                            | `PUT /users/:id` (для своего id) | Удобный шорткат к `update(me.id, payload)`. |
| `changePassword(currentPassword, newPassword)` | `POST /users/change_password`    | Смена пароля.                               |
| `stats(id)`                                    | `GET /users/:id/stats`           | Статистика пользователя.                    |

> ⚠️ `users.create()` намеренно бросает ошибку — регистрация идёт через отдельные endpoint-ы (вне scope v0.1).

```ts
const me = await client.users.me();
await client.users.updateMe({ bio: "TypeScript fan", lang: "ru" });
await client.users.changePassword("oldPwd!", "newPwd!");
```

### `client.projects` — проекты

Базовый CRUD + следующие методы:

| Метод                          | HTTP                             | Описание                                             |
| ------------------------------ | -------------------------------- | ---------------------------------------------------- |
| `getBySlug(slug)`              | `GET /projects/by_slug?slug=...` | Получить проект по slug, а не по id.                 |
| `stats(id)`                    | `GET /projects/:id/stats`        | Статистика по проекту (points, milestones).          |
| `modulesConfig(id)`            | `GET /projects/:id/modules`      | Конфиг интеграций (GitHub, GitLab, Bitbucket, Gogs). |
| `setModulesConfig(id, config)` | `PATCH /projects/:id/modules`    | Обновить конфиг интеграций.                          |

```ts
const proj = await client.projects.create({ name: "Demo", description: "" });
const sameProj = await client.projects.getBySlug(proj.slug);
const updated = await client.projects.patch(proj.id, { description: "Updated" }, /* version */ 1);
const stats = await client.projects.stats(proj.id);
await client.projects.delete(proj.id);
```

### `client.memberships` — членство в проектах

Базовый CRUD + следующие методы:

| Метод                  | HTTP                                      | Описание                                   |
| ---------------------- | ----------------------------------------- | ------------------------------------------ |
| `bulkCreate(payload)`  | `POST /memberships/bulk_create`           | Пригласить нескольких пользователей сразу. |
| `resendInvitation(id)` | `POST /memberships/:id/resend_invitation` | Повторно отправить email с приглашением.   |

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

### `client.userStories` — пользовательские истории

Базовый CRUD + следующие методы:

| Метод                             | HTTP                                          | Описание                                              |
| --------------------------------- | --------------------------------------------- | ----------------------------------------------------- |
| `bulkCreate(payload)`             | `POST /userstories/bulk_create`               | Создать несколько историй одной строкой (по `\n`).    |
| `bulkUpdateBacklogOrder(payload)` | `POST /userstories/bulk_update_backlog_order` | Перепорядочивание в backlog.                          |
| `bulkUpdateKanbanOrder(payload)`  | `POST /userstories/bulk_update_kanban_order`  | Перепорядочивание в kanban.                           |
| `bulkUpdateSprintOrder(payload)`  | `POST /userstories/bulk_update_sprint_order`  | Перепорядочивание внутри спринта.                     |
| `filtersData({ project })`        | `GET /userstories/filters_data?project=...`   | Доступные фильтры для UI: статусы, теги, исполнители. |

```ts
const story = await client.userStories.create({
  project: proj.id,
  subject: "User can log in via GitHub",
  description: "OAuth flow",
});

// Bulk-создание из мульти-строки (как в Taiga UI):
await client.userStories.bulkCreate({
  project_id: proj.id,
  bulk_stories: "Story 1\nStory 2\nStory 3",
});

// Перебор всех историй проекта:
for await (const s of client.userStories.paginate({ project: proj.id })) {
  console.log(s.subject);
}
```

### `client.tasks` — задачи

Базовый CRUD + следующие методы:

| Метод                      | HTTP                                  | Описание                               |
| -------------------------- | ------------------------------------- | -------------------------------------- |
| `bulkCreate(payload)`      | `POST /tasks/bulk_create`             | Создать несколько задач одной строкой. |
| `filtersData({ project })` | `GET /tasks/filters_data?project=...` | Доступные фильтры.                     |

```ts
const task = await client.tasks.create({
  project: proj.id,
  subject: "Implement OAuth callback",
  user_story: story.id, // привязка к user story
});
```

### `client.issues` — баги/тикеты

Базовый CRUD + следующие методы:

| Метод                      | HTTP                                   | Описание                                           |
| -------------------------- | -------------------------------------- | -------------------------------------------------- |
| `filtersData({ project })` | `GET /issues/filters_data?project=...` | Доступные фильтры (типы, серьёзность, приоритеты). |
| `voters(id)`               | `GET /issues/:id/voters`               | Список тех, кто проголосовал «за».                 |
| `upvote(id)`               | `POST /issues/:id/upvote`              | Проголосовать «за».                                |
| `downvote(id)`             | `POST /issues/:id/downvote`            | Снять свой голос.                                  |
| `watchers(id)`             | `GET /issues/:id/watchers`             | Список наблюдателей.                               |
| `watch(id)`                | `POST /issues/:id/watch`               | Подписаться на уведомления.                        |
| `unwatch(id)`              | `POST /issues/:id/unwatch`             | Отписаться.                                        |

```ts
const issue = await client.issues.create({
  project: proj.id,
  subject: "Login button doesn't work in Safari",
  description: "Reproduces on macOS Safari 17.x",
});
await client.issues.upvote(issue.id);
await client.issues.watch(issue.id);
```

### `client.epics` — эпики

Базовый CRUD + следующие методы:

| Метод                                     | HTTP                                          | Описание                                                |
| ----------------------------------------- | --------------------------------------------- | ------------------------------------------------------- |
| `bulkCreate(payload)`                     | `POST /epics/bulk_create`                     | Создать несколько эпиков мульти-строкой (по `\n`).      |
| `filtersData({ project })`                | `GET /epics/filters_data?project=...`         | Доступные фильтры для UI.                               |
| `relatedUserStories(id)`                  | `GET /epics/:id/related_userstories`          | User-стори, привязанные к эпику.                        |
| `addRelatedUserStory(id, { user_story })` | `POST /epics/:id/related_userstories`         | Привязать существующую историю к эпику.                 |
| `removeRelatedUserStory(id, usId)`        | `DELETE /epics/:id/related_userstories/:usId` | Отвязать историю от эпика.                              |
| `voters(id)`                              | `GET /epics/:id/voters`                       | Список тех, кто проголосовал за эпик.                   |
| `upvote(id)`                              | `POST /epics/:id/upvote`                      | Проголосовать «за».                                     |
| `downvote(id)`                            | `POST /epics/:id/downvote`                    | Снять свой голос.                                       |
| `watchers(id)`                            | `GET /epics/:id/watchers`                     | Список наблюдателей.                                    |
| `watch(id)`                               | `POST /epics/:id/watch`                       | Подписаться на уведомления.                             |
| `unwatch(id)`                             | `POST /epics/:id/unwatch`                     | Отписаться.                                             |

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

> ℹ️ Эпики должны быть включены в проекте (`is_epics_activated: true`), иначе эндпоинты вернут ошибку.

### `client.milestones` — спринты

Базовый CRUD + следующие методы:

| Метод       | HTTP                        | Описание                             |
| ----------- | --------------------------- | ------------------------------------ |
| `stats(id)` | `GET /milestones/:id/stats` | Burndown-данные, прогресс по точкам. |

```ts
const sprint = await client.milestones.create({
  project: proj.id,
  name: "Sprint 1",
  estimated_start: "2026-01-01",
  estimated_finish: "2026-01-14",
});
const burndown = await client.milestones.stats(sprint.id);
```

## Пагинация

`list()` всегда возвращает **первую страницу** ответа. Для перебора всего набора есть три варианта:

```ts
// 1. Async-итератор (рекомендуется): идёт по next-ссылкам, ленивый
for await (const story of client.userStories.paginate({ project: 42 })) {
  await processStory(story);
}

// 2. Конкретная страница + meta
const page = await client.userStories.listPage({ project: 42 }, 3);
console.log(page.data, page.pagination); // { count, perPage, current, next, prev }

// 3. Отключить пагинацию полностью (вернётся весь набор одним массивом)
const all = await client.http.get("/userstories", {
  query: { project: 42 },
  disablePagination: true,
});
```

> ⚠️ `disablePagination` шлёт `x-disable-pagination: True`. Используйте на маленьких коллекциях — на больших Taiga может ответить ошибкой или таймаутом.

## Ошибки

Все ошибки наследуются от абстрактного `TaigaError`:

| Класс                 | Когда бросается            | Полезные поля                                       |
| --------------------- | -------------------------- | --------------------------------------------------- |
| `TaigaApiError`       | Любой неуспешный 4xx/5xx   | `status`, `code`, `detail`, `body`                  |
| `TaigaAuthError`      | 401 / 403                  | + всё из `TaigaApiError`                            |
| `TaigaRateLimitError` | 429                        | + `retryAfter` (секунды из заголовка `Retry-After`) |
| `TaigaNetworkError`   | Сеть упала, abort, таймаут | `cause` (исходная ошибка fetch / AbortError)        |

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
    // Сессия умерла — перелогиньте
  } else if (err instanceof TaigaApiError) {
    console.error(`Taiga ${err.status}: ${err.detail ?? err.message}`);
  } else if (err instanceof TaigaNetworkError) {
    // Сеть/таймаут
  }
}
```

## Optimistic Concurrency Control (OCC)

Taiga защищает работу нескольких пользователей через `version`. При `patch()` укажите номер версии, который вы получили вместе с объектом — если кто-то успел обновить его раньше, Taiga вернёт `400`/`412` и вы узнаете о конфликте.

```ts
const story = await client.userStories.get(42);
const updated = await client.userStories.patch(
  story.id,
  { subject: "Renamed" },
  story.version, // ← OCC
);
```

## Низкоуровневый доступ

Для эндпоинтов, которые ещё не обёрнуты в ресурсы, используйте `client.http` напрямую:

```ts
const result = await client.http.get<{ id: number }[]>("/wiki", {
  query: { project: 1 },
});
console.log(result.data, result.pagination, result.headers);
```

Доступны методы `get`, `post`, `put`, `patch`, `delete`. Все принимают одинаковые `RequestOptions`: `{ query, body, headers, signal, disablePagination, skipAuth }`.

## Что покрыто и что нет

**Покрыто:**

- Auth: login, refresh, logout, application token, восстановление сессии, авто-refresh с дедупликацией
- Users: профиль, list, update, смена пароля, stats
- Projects: CRUD, by_slug, stats, modules config
- Memberships: CRUD, bulk_create, resend invitation
- User Stories: CRUD, bulk_create, bulk_update_order для всех досок, filters_data
- Tasks: CRUD, bulk_create, filters_data
- Issues: CRUD, filters_data, voters, watchers, upvote/downvote, watch/unwatch
- Milestones: CRUD, stats
- Epics _(новое в v0.2)_: CRUD, bulk_create, filters_data, related_userstories (list/add/remove), voters, watchers, upvote/downvote, watch/unwatch

**Не покрыто (планируется в следующих релизах):** wiki, webhooks, attachments, custom attributes, history/comments, importers (Trello/Jira/GitHub), project templates, OAuth-флоу через GitHub.

Если нужный эндпоинт не покрыт — используйте [`client.http`](#низкоуровневый-доступ) напрямую и/или откройте issue.

## Совместимость

| Среда   | Минимум           | Прим.                                      |
| ------- | ----------------- | ------------------------------------------ |
| Node.js | 18                | Глобальный `fetch` появился в 18.          |
| Bun     | 1.0               | Полная поддержка.                          |
| Deno    | 1.x               | Должно работать (есть глобальный `fetch`). |
| Браузер | любой современный | Требуется CORS-конфиг на стороне Taiga.    |

## Лицензия

[MIT](LICENSE)
