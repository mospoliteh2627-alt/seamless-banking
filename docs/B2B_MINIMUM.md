# B2B-минимум: RBAC, аудит, аналитика и экспорт

Реализовано поверх прототипа `seamless-banking` без изменения протокола перехода.
Демо-контур работает на Redis; PostgreSQL-схема приложена для пилота.

## 1. Что добавлено

| Функция | Реализация | Проверка |
|---|---|---|
| RBAC | роли `client`, `support`, `analyst`, `admin`; роль в JWT и сессии | E2E: client → 403, admin → 200 |
| Аудит | append-only журнал с hash chain в Redis/памяти | `GET /v1/admin/audit/verify` → valid |
| Аналитика | воронка, p95, конверсия, состояние аудита | `GET /v1/admin/analytics` |
| Экспорт | CSV/JSON аудита и операций | `GET /v1/admin/export` |
| Админ-панель | `/admin`: карточки, воронка, канбан процессов, журнал, выгрузка | скриншоты `10-admin.png`, `13-admin-process.png` |

## 2. Роли и доступ

| Роль | Код | Доступ |
|---|---|---|
| `client` | не нужен | свои операции, handoff, submit |
| `support` | `ADMIN-2026` | аудит (чтение), операции (маскировано) |
| `analyst` | `ADMIN-2026` | аудит, аналитика, экспорт |
| `admin` | `ADMIN-2026` | всё перечисленное + конфигурация |

Демо-код задаётся `ADMIN_DEMO_CODE` (по умолчанию `ADMIN-2026`). В промышленном
контуре роли приходят из OIDC/Keycloak, демо-вход отключается.

```bash
curl -X POST http://localhost:8787/v1/auth/demo-login \
  -H 'Content-Type: application/json' \
  -d '{"channel":"web","role":"admin","adminCode":"ADMIN-2026","deviceId":"admin_1","deviceName":"Admin"}'
```

## 3. Аудит

События: `auth.login`, `handoff.ticket_issued`, `handoff.redeemed`,
`operation.submitted`, `lease.claimed`, `admin.export`.

Формат:

```json
{
  "id": "evt_...",
  "at": "2026-10-20T12:00:00.000Z",
  "type": "handoff.redeemed",
  "actor": { "userId": "user_42", "role": "client", "deviceId": "ios_..." },
  "opId": "op_...",
  "outcome": "success",
  "meta": { "jti": "...", "deviceName": "iPhone 15 · iOS" },
  "prevHash": "…",
  "hash": "…"
}
```

`hash = SHA256(canonical(event без hash) || prevHash)`. Проверка — пересчёт цепочки;
разрыв или несовпадение возвращает `valid: false` и `brokenAt`.

Ограничение: сериализация записи — в пределах процесса; для нескольких реплик
нужен Redis `WATCH`/Lua или PostgreSQL-транзакция с блокировкой последней строки.

## 4. API

| Метод | Путь | Роли | Назначение |
|---|---|---|---|
| GET | `/v1/admin/analytics` | admin, analyst | воронка, задержки, состояние аудита |
| GET | `/v1/admin/audit?limit=50` | admin, analyst, support | последние события (новые сверху) |
| GET | `/v1/admin/audit/verify` | admin, analyst | проверка hash chain |
| GET | `/v1/admin/export?type=audit&format=csv` | admin, analyst | выгрузка |
| GET | `/v1/admin/export?type=operations&format=json` | admin, analyst | выгрузка операций |
| GET | `/admin` | — | админ-панель (демо) |

CSV отдаётся с BOM и `Content-Disposition`; JSON — с массивом `items`.

## 5. Проверка

```
✔ seamless handoff: web → mobile → submit
✔ handoff via 6-digit code and access control
✔ B2B minimum: RBAC, audit chain and export
tests 3, pass 3, fail 0
```

Проверяется: неверный код роли → 403; client → 403 на аналитике; admin → 200;
аудит содержит `auth.login`; цепочка валидна; CSV содержит заголовок и событие;
JSON-экспорт возвращает массив.

## 6. Ограничения демо

- Пароли/коды ролей — демонстрационные; нет OIDC, MFA, сессий Keycloak.
- Аудит хранится в Redis (список) и памяти; WORM-архив не подключён.
- PostgreSQL-схема приложена, но рантайм всё ещё на Redis.
- Экспорт ограничен 10 000 событиями; пагинация не реализована.
- ABAC (владелец/устройство/риск) и KMS — в дорожной карте, не в этом срезе.

## 7. Следующий шаг

1. Перевести операции и аудит в PostgreSQL (схема `infra/postgres/schema.sql`).
2. Подключить Keycloak и убрать `demo-login`.
3. Добавить outbox + Redis Streams для вебхуков и уведомлений.
4. Включить ABAC и риск-ориентированный step-up.
