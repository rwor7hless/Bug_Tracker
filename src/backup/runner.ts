import { Upload } from "@aws-sdk/lib-storage";
import { loadBackupConfig } from "./config.js";
import { getS3Client } from "./s3Client.js";
import { streamPgDump } from "./pgDump.js";
import { notifyFailure } from "./notify.js";

export interface BackupResult {
  key: string;
  size: number;
  durationMs: number;
}

function timestampKey(prefix: string): string {
  const iso = new Date().toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "Z");
  return `${prefix}db-${iso}.dump`;
}

export async function runBackup(): Promise<BackupResult> {
  const config = loadBackupConfig();
  const key = timestampKey(config.s3.prefix);
  const startedAt = Date.now();

  console.log(`[backup] start → s3://${config.s3.bucket}/${key}`);

  const dumpStream = streamPgDump(config.databaseUrl);

  try {
    const upload = new Upload({
      client: getS3Client(),
      params: {
        Bucket: config.s3.bucket,
        Key: key,
        Body: dumpStream,
        ContentType: "application/octet-stream",
      },
      queueSize: 4,
      partSize: 5 * 1024 * 1024,
    });

    let size = 0;
    dumpStream.on("data", (chunk: Buffer) => {
      size += chunk.length;
    });

    await upload.done();
    const durationMs = Date.now() - startedAt;

    console.log(
      `[backup] done → key=${key} size=${size}B duration=${durationMs}ms`,
    );

    return { key, size, durationMs };
  } catch (err) {
    console.error("[backup] failed:", err);
    await notifyFailure(config.notifyChatId, err);
    throw err;
  }
}
