# MC Bug Report

Сервис для репорта багов Minecraft сервера. Модераторы репортят через Telegram бота, разработчик управляет тикетами через веб-панель.

## Стек

- **Backend:** Node.js + Fastify + Telegraf (один процесс — API + бот)
- **Frontend:** React 18 + Vite (SPA, роутер v6, без UI-библиотек)
- **БД:** PostgreSQL 16 + pgvector (для семантического поиска дублей через `@xenova/transformers`)
- **Прод:** Docker Compose

---

## Запуск

### 1. Переменные окружения

```bash
cp .env.example .env
```

Минимально необходимые:
- `DATABASE_URL` — строка подключения к Postgres
- `JWT_SECRET` — любая случайная строка (чем длиннее, тем лучше)
- `BOT_TOKEN` — токен бота от @BotFather

Опционально:
- `ADMIN_USERNAME`/`ADMIN_PASSWORD` — при старте приложение upsert'ит админа с этими данными
- `ADMIN_TELEGRAM_ID` — на этот чат пойдут уведомления о провалах бэкапов
- Секция `S3_*` — для бэкапов в Cloud.ru (см. раздел «Бэкапы» ниже)

### 2. БД и зависимости

```bash
# Поднять PostgreSQL
docker compose up -d postgres

# Установить зависимости
npm install
cd web && npm install && cd ..

# Применить миграции
npx prisma migrate dev
```

### 3. Создать первого пользователя (admin)

```bash
npx tsx scripts/create-user.ts myusername
# Выведет сгенерированный пароль
```

Потом в админке можно поставить этому пользователю `role: ADMIN`.

### 4. Запуск в dev-режиме

```bash
# API + бот
npm run dev

# В другом терминале — фронт
cd web && npm run dev
```

- Фронт: http://localhost:5173
- API: http://localhost:3000

### 5. Production (Docker)

```bash
docker compose up -d --build
```

Приложение само отдаёт собранный фронт как статику, отдельный nginx не нужен.

---

## Управление

### Добавить модератора Telegram

На веб-панели → вкладка **Пользователи** (только для admin):
- Создать пользователя с `username`, указать `telegramId` (найти через @userinfobot)
- Присвоить роль `MODERATOR`

После этого пользователь сможет использовать бота.

### Сбросить пароль

Через бота:
```
/password <username>
```
Бот генерирует новый пароль и отвечает в чат.

Через CLI:
```bash
npx tsx scripts/create-user.ts <username> --reset
```

---

## Бот — команды

| Команда | Кому | Описание |
|---|---|---|
| `/start` | Всем | Показать главное меню |
| `/password <username>` | Модераторам | Сбросить и получить пароль для веба |
| `/admin` | Админам | Войти в админ-меню |
| `/adminout` | Админам | Выйти из админ-режима |
| `/resolve <id>` | Админам | Закрыть тикет |
| `/reopen <id>` | Админам | Переоткрыть закрытый тикет |

Создание тикетов, bump, просмотр списка — через inline-кнопки в меню (`/start`).

---

## Автоматическая очистка фото

Фотографии из тикетов со статусами `RESOLVED` и `DUPLICATE`, которые старше 30 дней, удаляются из `uploads/` автоматически. Задача крутится при старте приложения и далее раз в 7 дней (`src/cleanup.ts`). Сам тикет при этом остаётся — только файлы фото удаляются, в БД ставится флаг `photosDeleted=true`.

---

## Бэкапы (Cloud.ru S3)

БД дампится раз в неделю и заливается в S3-совместимое хранилище Cloud.ru. Прод-код живёт в `src/backup/`, детальная спека — `docs/superpowers/specs/2026-04-23-s3-backup-design.md`.

### Настройка

В `.env`:

```
S3_ENDPOINT=https://s3.cloud.ru
S3_REGION=ru-central-1
S3_BUCKET=backups
S3_PREFIX=paradise_bugs/
S3_ACCESS_KEY=<tenant_id>:<key_id>
S3_SECRET_KEY=<key_secret>
BACKUP_NOTIFY_CHAT_ID=          # пусто = уведомления уйдут на ADMIN_TELEGRAM_ID
```

**Важно про креды:** в Cloud.ru `S3_ACCESS_KEY` — это связка `tenant_id:key_id` через двоеточие (берётся в UI → Object Storage → Ключи доступа). `S3_SECRET_KEY` — просто хекс-строка из того же диалога. Длинные «составные» значения с точкой из некоторых окон UI — не секреты, а display-identifier'ы, их использовать НЕ надо.

### Команды

Все — через `docker compose exec app npm run <cmd>`:

| Команда | Что делает |
|---|---|
| `npm run backup:now` | Сделать бэкап прямо сейчас (используется также для ручных проверок) |
| `npm run backup:setup-lifecycle` | Применить к бакету правило «удалять `paradise_bugs/*` старше 84 дней» (retention). Запустить один раз после первой настройки |
| `npm run backup:teardown-lifecycle` | Снять retention-правило. Уже залитые бэкапы при этом НЕ удаляются — просто перестают истекать |
| `npm run backup:debug-request` | Диагностика: делает сырой SigV4-запрос и печатает ответ Cloud.ru. Нужно, если `SignatureDoesNotMatch` и непонятно почему |

### Расписание

Cron `0 9 * * 0` в таймзоне `Europe/Moscow` — каждое воскресенье в 09:00 MSK. Код в `src/backup/scheduler.ts`. Расписание срабатывает внутри работающего `app`-контейнера, отдельный cron на хосте не нужен.

### Формат объектов

- Ключи: `paradise_bugs/db-YYYY-MM-DDTHH-MM-SSZ.dump` (UTC в имени, двоеточия заменены на дефисы)
- Формат: `pg_dump -Fc` (pg native custom, уже сжат)
- Права бота: только `PutObject` и `Get/Put/DeleteBucketLifecycle` — удалять объекты он не может (это делает lifecycle на бакете)

### Восстановление

```bash
# 1. Скачать дамп из S3 (любым S3-клиентом)
aws s3 cp s3://backups/paradise_bugs/db-<ts>.dump ./restore.dump \
  --endpoint-url https://s3.cloud.ru

# 2. Поднять чистый Postgres на другом порту
docker run --rm -d --name pg-restore \
  -e POSTGRES_USER=bugreport -e POSTGRES_PASSWORD=bugreport -e POSTGRES_DB=bugreport \
  -p 5433:5432 pgvector/pgvector:pg16

# 3. Включить pgvector (дамп ссылается на vector-тип, но не создаёт extension)
docker exec pg-restore psql -U bugreport -c "CREATE EXTENSION IF NOT EXISTS vector;"

# 4. Восстановить
pg_restore -h localhost -p 5433 -U bugreport -d bugreport \
  --no-owner --no-privileges ./restore.dump
```

Полная процедура — в спеке `docs/superpowers/specs/2026-04-23-s3-backup-design.md`.

### Уведомления

При провале бэкапа (S3 недоступен, креды протухли, pg_dump упал) в Telegram на `BACKUP_NOTIFY_CHAT_ID` (или `ADMIN_TELEGRAM_ID`, если первая пусто) приходит сообщение с текстом ошибки. Успешные бэкапы по умолчанию молчат.
