# Работа с `filters_data` — рекомендуемый способ получать ID справочников

> 🇷🇺 Русская версия — вы здесь · [🇬🇧 English](filters-data.md)

Большинство пишущих операций в Taiga требуют **числовые ID** значений из справочников: статус, тип, severity, priority, swimlane, points и т.д. Эти справочники — **отдельные для каждого проекта**: один и тот же статус «In progress» в разных проектах может иметь разные ID.

Taiga предоставляет на каждый ресурс единый эндпоинт — **`filters_data`** — который возвращает все нужные справочники одним запросом. **Это предпочтительнее, чем тянуть `/issue-statuses`, `/issue-types`, `/severities`, `/priorities`, … по отдельности.**

## Почему `filters_data` лучше

- ✅ **Один HTTP-запрос** вместо 4–5 отдельных запросов по каталогам.
- ✅ **Project-scoped** — только значения, настроенные в этом проекте, плюс `count` использования каждого.
- ✅ Включает связанные коллекции, у которых нет отдельных эндпоинтов (`tags`, `owners`, `assigned_to`, `roles`).
- ✅ Легко кешируется — справочники меняются редко, один кеш покрывает целую сессию.

## Что возвращается

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

Конкретный набор ключей зависит от ресурса: `userStories.filtersData` отдаёт `statuses`, `epics`, `tags` и т.д.; у `tasks.filtersData` и `epics.filtersData` свои подмножества.

> ⚠️ Сейчас тип возврата — `Record<string, unknown>`. Сужайте на своей стороне небольшим кастом или zod-схемой.

## Найти ID по имени

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
  subject: "Кнопка логина не работает в Safari",
  status: inProgress!.id,
});
```

## Кешировать на всю сессию

Справочники меняются редко (только админ их трогает). Простая мемоизация по проекту обычно достаточна:

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

Для долгоживущих процессов — добавьте TTL (5–15 минут обычно норм) или сбрасывайте по событиям из админки.

## Доступные `filters_data` эндпоинты

| Ресурс       | Метод                                          | Возвращаемые каталоги (типично)                                                |
| ------------ | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| User stories | `client.userStories.filtersData({ project })`  | `statuses`, `tags`, `assigned_to`, `owners`, `epics`, `roles`                  |
| Tasks        | `client.tasks.filtersData({ project })`        | `statuses`, `tags`, `assigned_to`, `owners`, `roles`                           |
| Issues       | `client.issues.filtersData({ project })`       | `statuses`, `types`, `severities`, `priorities`, `tags`, `assigned_to`, `owners`, `roles` |
| Epics        | `client.epics.filtersData({ project })`        | `statuses`, `tags`, `assigned_to`, `owners`                                    |

## Когда `filters_data` _не_ хватает

- ❌ **Изменять** сам справочник — `filters_data` только GET. Чтобы добавить тип issue, переименовать статус или удалить severity, нужны отдельные эндпоинты (`/issue-types`, `/issue-statuses`, `/severities`, `/priorities`, …). В этом клиенте они пока не обёрнуты в ресурсы — используйте `client.http` напрямую:

  ```ts
  const types = await client.http.get("/issue-types", { query: { project: 42 } });
  await client.http.post("/issue-types", {
    body: { project: 42, name: "Spike", color: "#abc" },
  });
  ```

- ❌ **Справочники, которые не используются как фильтры**: `points` (шкала story points), `swimlanes`, project-wide `roles` для memberships. Тоже через `client.http` пока что.
- ❌ **Полная мета каталога** (`order`, `is_closed`, `slug`, …). `filters_data` возвращает усечённую проекцию для UI; в отдельных эндпоинтах есть всё.

## TL;DR

В 95% случаев «мне нужен ID статуса/типа/приоритета/исполнителя в этом проекте» — вызовите `filters_data` один раз, закешируйте по проекту. К отдельным эндпоинтам каталогов идите только если их нужно **изменить** или нужны поля, которых нет в `filters_data`.
