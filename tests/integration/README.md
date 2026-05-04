# Integration tests

Тесты против **реального Taiga-инстанса**. Не запускаются вместе с `bun run test` (там только unit) и не идут в CI по умолчанию.

## Чувствительные данные → `.env`

Все секреты читаются из переменных окружения. Bun автоматически загружает `.env` из корня репозитория, поэтому достаточно скопировать шаблон:

```bash
cp .env.example .env
# отредактируйте .env под свой инстанс
```

`.env` уже в `.gitignore` — никаких секретов в репо.

Требуемые переменные (см. [.env.example](../../.env.example)):

| Переменная              | Назначение                           |
| ----------------------- | ------------------------------------ |
| `TAIGA_INTEGRATION_URL` | Базовый URL Taiga (без `/api/v1`)    |
| `TAIGA_TEST_USER`       | Логин тестового аккаунта             |
| `TAIGA_TEST_PASSWORD`   | Пароль тестового аккаунта            |
| `TAIGA_TEMPLATE_SLUG`   | _(опционально)_ slug шаблона проекта |

> **ВАЖНО**: используйте dedicated тестовый аккаунт. Тесты создают и удаляют проекты — на этом аккаунте не должно быть ничего важного.

Если переменные не заданы, тесты **автоматически skip-аются** (безопасно для CI и для разработчиков без локального Taiga).

## Запуск локального Taiga (опционально)

Официальный `docker-compose`: https://github.com/taigaio/taiga-docker

```bash
git clone https://github.com/taigaio/taiga-docker.git
cd taiga-docker
./launch-all.sh
# создайте суперпользователя:
docker compose -f docker-compose.yml -f docker-compose-inits.yml \
  run --rm taiga-manage createsuperuser
```

После `http://localhost:9000/api/v1/` должен отвечать.

## Запуск тестов

```bash
bun run test:integration
```

Bun подхватит `.env`, vitest прогонит файлы из `tests/integration/**/*.test.ts` последовательно (`fileParallelism: false` в [vitest.integration.config.ts](../../vitest.integration.config.ts)).

## Что покрыто

- **[auth.test.ts](auth.test.ts)** — login, refresh (новый refresh-токен ротируется), `/users/me`, logout, `onTokenChange`.
- **[lifecycle.test.ts](lifecycle.test.ts)** — end-to-end на временном проекте:
  - создание проекта в `beforeAll`, удаление в `afterAll` (даже при упавшем тесте);
  - проекты: `get`, `getBySlug`, `patch` с OCC, `stats`, `list({ member })`;
  - milestones: create / list / stats;
  - user stories: create / patch / list / `paginate()` / `filters_data` / delete;
  - tasks: create связанной с историей задачи / list / delete;
  - issues: create / upvote+voters / watch+watchers / delete;
  - memberships: list (owner как минимум один член).

## Изоляция

- Каждый прогон создаёт **новый** временный проект с уникальным именем (`taiga-api-client-test-<timestamp>-<rand>`).
- `afterAll` удаляет проект — каскадно удаляются все его user stories, tasks, issues, milestones и memberships.
- Если `afterAll` падает (например, сеть отвалилась), останется висеть один тестовый проект — можно удалить вручную.
