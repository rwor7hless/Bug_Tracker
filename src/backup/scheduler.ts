import cron from "node-cron";
import { runBackup } from "./runner.js";

const CRON_EXPRESSION = "0 9 * * 0";
const TIMEZONE = "Europe/Moscow";
const MSK_OFFSET_HOURS = 3;

function computeNextRun(now: Date): Date {
  const nowMsk = new Date(now.getTime() + MSK_OFFSET_HOURS * 3600 * 1000);
  const dayMsk = nowMsk.getUTCDay();
  const hourMsk = nowMsk.getUTCHours();
  const minuteMsk = nowMsk.getUTCMinutes();

  let daysUntilSunday: number;
  if (dayMsk === 0 && (hourMsk < 9 || (hourMsk === 9 && minuteMsk === 0 && now.getUTCSeconds() === 0))) {
    daysUntilSunday = 0;
  } else {
    daysUntilSunday = (7 - dayMsk) % 7 || 7;
  }

  const nextMskMidnight = new Date(nowMsk);
  nextMskMidnight.setUTCHours(9, 0, 0, 0);
  nextMskMidnight.setUTCDate(nowMsk.getUTCDate() + daysUntilSunday);

  return new Date(nextMskMidnight.getTime() - MSK_OFFSET_HOURS * 3600 * 1000);
}

export function startBackupScheduler(): void {
  cron.schedule(
    CRON_EXPRESSION,
    async () => {
      try {
        await runBackup();
      } catch (err) {
        console.error("[backup] scheduled run failed:", err);
      }
    },
    {
      timezone: TIMEZONE,
      noOverlap: true,
      name: "s3-backup",
    },
  );

  const next = computeNextRun(new Date());
  console.log(
    `[backup] scheduler started (cron="${CRON_EXPRESSION}" tz=${TIMEZONE}), next run: ${next.toISOString()}`,
  );
}
