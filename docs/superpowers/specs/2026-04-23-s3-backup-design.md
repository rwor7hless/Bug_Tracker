# S3 Backup System — Design Spec

**Date:** 2026-04-23
**Status:** Approved, ready for implementation planning
**Target:** Weekly Postgres dumps to Cloud.ru S3 (`s3://backups/paradise_bugs/`), 12-week retention via bucket lifecycle.

## 1. Goals and non-goals

**Goals**
- Weekly automated backup of the Postgres database (schema + data, including `pgvector` embeddings).
- Upload to an existing Cloud.ru S3 bucket under a project-specific prefix.
- 12-week retention enforced server-side via S3 lifecycle rules (app cannot delete backups).
- CLI command for on-demand manual backup.
- Telegram notification when a backup fails.
- Zero disk writes on the backup path (stream pg_dump → S3).

**Non-goals**
- Backing up uploaded photos (`uploads/` volume). Photos are disposable: resolved-ticket photos are already purged by `cleanup.ts` after 30 days.
- Incremental / WAL-shipping backups. A weekly full dump is sufficient for this project's RPO.
- Automated restore. Restore is a manual, deliberate operation (section 7).
- Automated backup verification (e.g. weekly restore rehearsal). Manual rehearsal required once, then trusted.
- Alerting on missing backups (no backup produced in N days). Left for future work.

## 2. High-level architecture

```
┌──────────────────────────────────────────────────────────────┐
│ app container (Node + postgresql-client-16)                  │
│                                                              │
│   src/index.ts ──► startBackupScheduler()                    │
│                        │   node-cron: 0 9 * * 0              │
│                        │   timezone: Europe/Moscow           │
│                        ▼                                     │
│                 src/backup/runner.ts                         │
│                   │                                          │
│                   │ spawn pg_dump -Fc (stream)               │
│                   ▼                                          │
│               postgres service ──► stdout                    │
│                   │                                          │
│                   ▼                                          │
│            @aws-sdk/lib-storage Upload (multipart)           │
│                   │                                          │
│                   ▼                                          │
│         Cloud.ru S3: backups/paradise_bugs/db-<ts>.dump      │
└──────────────────────────────────────────────────────────────┘

Out-of-band, one-time setup:
   scripts/s3-setup-lifecycle.ts → PutBucketLifecycleConfiguration
      (Rule: Filter by prefix "paradise_bugs/", Expiration Days 84)
```

Key decisions:

- **pg_dump runs in the app container**, not in the postgres container. Dockerfile adds `postgresql-client-16` from the PGDG apt repo (the Debian bookworm main repo only carries pg-client-15, which cannot dump a pg-16 server).
- **Streaming, no disk**. pg_dump stdout pipes straight into `@aws-sdk/lib-storage` `Upload`, which buffers up to `queueSize * partSize` = 4 × 5 MB = 20 MB in memory at any time. No filesystem writes.
- **`pg_dump -Fc`** (custom format, pre-compressed with zlib). No extra gzip layer. Restore via `pg_restore`.
- **Lifecycle filter on prefix `paradise_bugs/`**, not the whole bucket, because the `backups` bucket may contain backups for other projects.
- **App has `PutObject` rights only** (no `DeleteObject`). Retention is a bucket-level concern. If the app is compromised, an attacker cannot erase historical backups.

## 3. File layout

```
src/backup/
├── config.ts         Parse and validate S3 + notification env vars at startup
├── s3Client.ts       Singleton @aws-sdk/client-s3 configured for Cloud.ru
├── pgDump.ts         spawn pg_dump, return stdout as Readable stream
├── runner.ts         runBackup() — orchestrates dump → upload → notify
├── scheduler.ts      startBackupScheduler() — node-cron wiring
└── notify.ts         Telegram failure/success messages via botInstance.getBot()

scripts/
├── backup-now.ts               Manual CLI trigger for runBackup()
└── s3-setup-lifecycle.ts       One-time bucket lifecycle setup

src/index.ts                    +1 line: startBackupScheduler()
Dockerfile                      Add postgresql-client-16 via PGDG repo
.env.example                    Add 6 new env vars (no secrets committed)
package.json                    +@aws-sdk/client-s3, +@aws-sdk/lib-storage, +node-cron
```

### Responsibilities per file

| File | Responsibilities | Boundaries |
|------|------------------|-----------|
| `config.ts` | Read and validate env: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_PREFIX`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `BACKUP_NOTIFY_CHAT_ID` (optional, falls back to `ADMIN_TELEGRAM_ID`). Throw at process start if anything required is missing. | Does not perform any I/O. |
| `s3Client.ts` | Export a singleton `S3Client` with `forcePathStyle: true`, `endpoint`, `region`, and static credentials from config. | Does not know about backups per se. |
| `pgDump.ts` | Parse `DATABASE_URL`, spawn `pg_dump -Fc --no-owner --no-privileges`, return `child.stdout` as `Readable`. Attach stderr to the logger. Non-zero exit → `stream.emit('error')`. | Writes to nothing. |
| `runner.ts` | `runBackup()`: call `pgDump.streamPgDump()`, feed into `new Upload({...}).done()`, return `{key, size, durationMs}`. Handle errors: call `notify.failure(err)` and rethrow. | Does not know about cron. |
| `scheduler.ts` | `cron.schedule('0 9 * * 0', runBackup, { timezone: 'Europe/Moscow' })`. Log next run. | Does not auto-run at app start. |
| `notify.ts` | `success(meta)` and `failure(err)`. Send to `BACKUP_NOTIFY_CHAT_ID` (or `ADMIN_TELEGRAM_ID` as fallback) via `getBot().telegram.sendMessage(...)`. Silent no-op if neither is set. | Does not log; runner logs separately. |

## 4. Environment variables

New variables (added to `.env.example`):

```
S3_ENDPOINT=https://s3.cloud.ru
S3_REGION=ru-central-1
S3_BUCKET=backups
S3_PREFIX=paradise_bugs/
S3_ACCESS_KEY=
S3_SECRET_KEY=
BACKUP_NOTIFY_CHAT_ID=
```

Reused (already in `.env`):
- `DATABASE_URL` — parsed by `pgDump.ts` for connection args.
- `ADMIN_TELEGRAM_ID` — fallback destination for backup failure notifications when `BACKUP_NOTIFY_CHAT_ID` is empty.

Defaults:
- `BACKUP_NOTIFY_ON_SUCCESS` — not introduced. Success is silent. If later desired, add the flag then.
- Retention days (84) — not exposed as env. Lives in `scripts/s3-setup-lifecycle.ts` as a constant. Changing it means editing the constant and rerunning the script.

## 5. Data flow (one backup run)

1. **T+0** — cron triggers (or `scripts/backup-now.ts` invoked).
2. `runner.runBackup()` starts; records `startedAt`.
3. Generates key: `${S3_PREFIX}db-${isoUtcNoColons}.dump` — e.g. `paradise_bugs/db-2026-04-26T06-00-00Z.dump`. UTC is used in the key to avoid DST ambiguity; colons are replaced with dashes to stay Windows-safe on download.
4. `pgDump.streamPgDump()` spawns:
   `pg_dump -h HOST -p PORT -U USER -d DB -Fc --no-owner --no-privileges --verbose`
   with `PGPASSWORD` in the environment. Returns `child.stdout`.
5. `new Upload({ client: s3, params: { Bucket, Key, Body: stdout, ContentType: 'application/octet-stream' }, partSize: 5*1024*1024, queueSize: 4 }).done()`.
6. On success: log `{key, size, durationMs}`. Return the same.
7. On any error: `notify.failure(err)`, then rethrow.

Error mapping:

| Stage | Failure mode | Handling |
|-------|--------------|----------|
| Config load | Missing env var | Throw at startup (fail fast, not at first backup) |
| `spawn('pg_dump')` | binary not in PATH | `spawn error` → propagates through stream → caught in runner → notify → rethrow |
| `pg_dump` nonzero exit | DB unreachable, auth bad | stderr captured in logs, stream emits error, caught → notify → rethrow |
| S3 `Upload` | network, 403, 500 | AWS SDK retries 3 times by default. Final failure → notify → rethrow |
| Data corruption | — | SDK computes MD5 per part; mismatch triggers SDK error |

## 6. Setup checklist (one-time, at deployment)

1. Create access key / secret key in Cloud.ru S3 console.
2. Append the 6 new env vars to `.env` (and commit `.env.example` with blank values).
3. Update `Dockerfile` runtime stage to add PGDG repo and install `postgresql-client-16`.
4. `npm install @aws-sdk/client-s3 @aws-sdk/lib-storage node-cron && npm install -D @types/node-cron`.
5. `npx tsx scripts/s3-setup-lifecycle.ts` — prints the applied `Rules` block on success. Merge semantics: read current lifecycle config, add/replace rule with `ID="paradise-bugs-retention"`, write back. Does not touch other projects' rules.
6. `docker compose build --no-cache app && docker compose up -d`. Log line `[backup] scheduler started, next run: ...` must appear.
7. `docker compose exec app npx tsx scripts/backup-now.ts` — verify object appears in bucket.

## 7. Restore procedure

This is the single most important thing to have rehearsed once. An un-rehearsed backup is not a backup.

```bash
# 1. Download latest dump
aws s3 cp s3://backups/paradise_bugs/db-<ts>.dump ./restore.dump \
  --endpoint-url https://s3.cloud.ru

# 2. Bring up a throwaway postgres on a non-conflicting port
docker run --rm -d --name pg-restore-test \
  -e POSTGRES_USER=bugreport -e POSTGRES_PASSWORD=bugreport -e POSTGRES_DB=bugreport \
  -p 5433:5432 pgvector/pgvector:pg16

# 3. Enable pgvector (the dump references vector types but does not create the extension)
docker exec pg-restore-test psql -U bugreport -c "CREATE EXTENSION IF NOT EXISTS vector;"

# 4. Restore
pg_restore -h localhost -p 5433 -U bugreport -d bugreport \
  --no-owner --no-privileges ./restore.dump

# 5. Sanity check
psql postgresql://bugreport:bugreport@localhost:5433/bugreport \
  -c 'SELECT COUNT(*) FROM "Ticket"; SELECT COUNT(*) FROM "User";'
```

For real disaster recovery (replacing the production DB), the same steps apply, substituting the target DB connection.

## 8. Testing and verification

Automated tests are not added. Backup touches real S3 + real Postgres; mocking these is lower-value than manual smoke tests.

Verification gates before declaring the feature done:

- [ ] `npx tsx scripts/backup-now.ts` exits 0 and object appears in `backups/paradise_bugs/` with `size > 0`.
- [ ] Object size is in the expected range for current DB (KB for empty DB, MB with data).
- [ ] Restore rehearsal in section 7 completes: counts match production.
- [ ] Schedule test: temporarily change cron to `*/2 * * * *`, restart app, observe backup every 2 min, then revert.
- [ ] Failure test: set `S3_SECRET_KEY=invalid`, run `backup-now.ts`, confirm nonzero exit and Telegram message.
- [ ] `docker compose exec app pg_dump --version` reports 16.x (not 15.x).

## 9. Security considerations

- `.env` remains in `.gitignore`; secrets never leave the host.
- App container has `PutObject` rights on `paradise_bugs/` only (or whatever the Cloud.ru key is scoped to). `DeleteObject` is not required and not used — lifecycle handles deletions.
- Postgres dump contains `passwordHash` (bcrypt, not plaintext), `telegramId`, and bug descriptions. Treat S3 bucket access-controls accordingly — access key should not be shared beyond backup pipeline.
- No encryption-at-rest layer added in-app. Cloud.ru provides server-side encryption by default; if stronger requirements emerge, client-side encryption can be added later without changing the overall design.

## 10. Out-of-scope (for future consideration)

- Encrypting dumps client-side with a key the attacker cannot get from the app environment.
- Alerting when no backup was produced for > 8 days (e.g. via a second cron that lists objects and checks the newest `LastModified`).
- Including the `uploads/` volume in a separate schedule if photo retention becomes important.
- Replicating backups to a second provider for geo-diversity.
