-- Ensure telegramId column exists on User (may have been added via db push)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "telegramId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_telegramId_key" ON "User"("telegramId");

-- Migrate existing Moderator records into User table
-- Creates a web-panel account for each Telegram moderator that doesn't have one yet
INSERT INTO "User" ("id", "username", "passwordHash", "role", "telegramId", "createdAt")
SELECT
  gen_random_uuid()::text,
  COALESCE(m."name", 'tg_' || m."telegramId"),
  '$2b$10$placeholder000000000000000000000000000000000000000000',
  'MODERATOR',
  m."telegramId",
  m."createdAt"
FROM "Moderator" m
WHERE NOT EXISTS (
  SELECT 1 FROM "User" u WHERE u."telegramId" = m."telegramId"
);

-- Drop the now-redundant Moderator table
DROP TABLE IF EXISTS "Moderator";
