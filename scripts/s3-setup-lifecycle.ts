import {
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
  type LifecycleRule,
} from "@aws-sdk/client-s3";
import { loadBackupConfig } from "../src/backup/config.js";
import { getS3Client } from "../src/backup/s3Client.js";

const RULE_ID = "paradise-bugs-retention";
const RETENTION_DAYS = 84;

async function main(): Promise<void> {
  const config = loadBackupConfig();
  const s3 = getS3Client();

  const desiredRule: LifecycleRule = {
    ID: RULE_ID,
    Status: "Enabled",
    Filter: { Prefix: config.s3.prefix },
    Expiration: { Days: RETENTION_DAYS },
  };

  let existingRules: LifecycleRule[] = [];

  try {
    const current = await s3.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: config.s3.bucket }),
    );
    existingRules = current.Rules ?? [];
    console.log(
      `[lifecycle] found ${existingRules.length} existing rule(s) on bucket "${config.s3.bucket}"`,
    );
  } catch (err) {
    const code = (err as { name?: string; Code?: string }).name
      || (err as { name?: string; Code?: string }).Code;
    if (code === "NoSuchLifecycleConfiguration") {
      console.log(`[lifecycle] no existing lifecycle configuration on bucket "${config.s3.bucket}"`);
    } else {
      throw err;
    }
  }

  const merged = existingRules.filter((r) => r.ID !== RULE_ID);
  merged.push(desiredRule);

  await s3.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: config.s3.bucket,
      LifecycleConfiguration: { Rules: merged },
    }),
  );

  console.log(
    `[lifecycle] applied: rule "${RULE_ID}" — expire ${config.s3.prefix}* after ${RETENTION_DAYS} days`,
  );

  const verify = await s3.send(
    new GetBucketLifecycleConfigurationCommand({ Bucket: config.s3.bucket }),
  );
  console.log("[lifecycle] current rules:");
  console.log(JSON.stringify(verify.Rules, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
