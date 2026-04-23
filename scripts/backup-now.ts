import { runBackup } from "../src/backup/runner.js";

async function main(): Promise<void> {
  const result = await runBackup();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
