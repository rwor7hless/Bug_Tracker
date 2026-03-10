# MC Bug Report

Сервис для репорта багов Minecraft сервера. Модераторы репортят через Telegram бота, разработчик управляет тикетами через веб-панель.

## Запуск

### 1. Переменные окружения

```bash
cp .env.example .env
# Заполни .env: DATABASE_URL, JWT_SECRET, BOT_TOKEN
```

### 2. БД и зависимости

```bash
# Поднять PostgreSQL
docker-compose up -d postgres

# Установить зависимости
npm install
cd web && npm install && cd ..

# Применить миграции
npx prisma migrate dev
```

### 3. Создать первого пользователя (разработчик/admin)

```bash
npx tsx scripts/create-user.ts myusername
# Выведет сгенерированный пароль
```

### 4. Запуск в dev-режиме

```bash
# API + бот
npm run dev

# В другом терминале — фронт
cd web && npm run dev
```

Фронт: http://localhost:5173
API: http://localhost:3000

### 5. Production (Docker)

```bash
docker-compose up --build
```

---

## Управление

### Добавить модератора Telegram

На веб-панели → вкладка **Модераторы** (только для admin):
- Ввести Telegram ID пользователя (найти через @userinfobot) и имя
- Нажать "Добавить"

После этого пользователь сможет использовать бота.

### Сбросить пароль

Модератор пишет боту:
```
/password <username>
```
Бот генерирует новый пароль и отвечает в чат.

Или вручную:
```bash
npx tsx scripts/create-user.ts <username> --reset
```

---

## Бот — команды

| Команда | Описание |
|---|---|
| `/report` | Создать баг-репорт (пошагово) |
| `/bump <id>` | Увеличить счётчик бага |
| `/list` | Топ-10 открытых багов |
| `/password <username>` | Сбросить и получить пароль для веба |
