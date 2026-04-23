export interface BackupConfig {
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    prefix: string;
    accessKey: string;
    secretKey: string;
  };
  notifyChatId: string | null;
  databaseUrl: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[backup] Missing required env var: ${name}`);
  }
  return value;
}

function normalizePrefix(prefix: string): string {
  if (!prefix) return "";
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

export function loadBackupConfig(): BackupConfig {
  const prefix = normalizePrefix(required("S3_PREFIX"));
  const notifyChatId =
    process.env.BACKUP_NOTIFY_CHAT_ID || process.env.ADMIN_TELEGRAM_ID || null;

  return {
    s3: {
      endpoint: required("S3_ENDPOINT"),
      region: required("S3_REGION"),
      bucket: required("S3_BUCKET"),
      prefix,
      accessKey: required("S3_ACCESS_KEY"),
      secretKey: required("S3_SECRET_KEY"),
    },
    notifyChatId,
    databaseUrl: required("DATABASE_URL"),
  };
}
