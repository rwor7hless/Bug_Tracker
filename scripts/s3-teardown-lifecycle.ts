import {
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
  DeleteBucketLifecycleCommand,
  type LifecycleRule,
} from "@aws-sdk/client-s3";
import { loadBackupConfig } from "../src/backup/config.js";
import { getS3Client } from "../src/backup/s3Client.js";

const RULE_ID = "paradise-bugs-retention";

async function main(): Promise<void> {
  const config = loadBackupConfig();
  const s3 = getS3Client();

  let existingRules: LifecycleRule[] = [];

  try {
    const current = await s3.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: config.s3.bucket }),
    );
    existingRules = current.Rules ?? [];
  } catch (err) {
    const code = (err as { name?: string; Code?: string }).name
      || (err as { name?: string; Code?: string }).Code;
    if (code === "NoSuchLifecycleConfiguration") {
      console.log(`[lifecycle] bucket "${config.s3.bucket}" has no lifecycle configuration — nothing to remove`);
      return;
    }
    throw err;
  }

  const hasOurRule = existingRules.some((r) => r.ID === RULE_ID);
  if (!hasOurRule) {
    console.log(`[lifecycle] rule "${RULE_ID}" not found on bucket "${config.s3.bucket}" — nothing to remove`);
    return;
  }

  const remaining = existingRules.filter((r) => r.ID !== RULE_ID);

  if (remaining.length === 0) {
    await s3.send(new DeleteBucketLifecycleCommand({ Bucket: config.s3.bucket }));
    console.log(`[lifecycle] removed rule "${RULE_ID}" (was the only rule — whole lifecycle config deleted)`);
    return;
  }

  await s3.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: config.s3.bucket,
      LifecycleConfiguration: { Rules: remaining },
    }),
  );
  console.log(
    `[lifecycle] removed rule "${RULE_ID}", kept ${remaining.length} other rule(s) on bucket "${config.s3.bucket}"`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
