import { spawn } from "child_process";
import { Readable } from "stream";

interface PgConnection {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

function parseDatabaseUrl(url: string): PgConnection {
  const parsed = new URL(url);
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error(`[backup] Unsupported DATABASE_URL protocol: ${parsed.protocol}`);
  }
  const database = parsed.pathname.replace(/^\//, "");
  if (!database) {
    throw new Error(`[backup] DATABASE_URL is missing database name`);
  }
  return {
    host: parsed.hostname,
    port: parsed.port || "5432",
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
  };
}

export function streamPgDump(databaseUrl: string): Readable {
  const conn = parseDatabaseUrl(databaseUrl);

  const child = spawn(
    "pg_dump",
    [
      "-h", conn.host,
      "-p", conn.port,
      "-U", conn.user,
      "-d", conn.database,
      "-Fc",
      "--no-owner",
      "--no-privileges",
    ],
    {
      env: { ...process.env, PGPASSWORD: conn.password },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const stderrChunks: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk);
  });

  child.on("error", (err) => {
    child.stdout.destroy(err);
  });

  child.on("close", (code) => {
    if (code !== 0) {
      const stderrText = Buffer.concat(stderrChunks).toString("utf8").trim();
      const message = stderrText
        ? `pg_dump exited with code ${code}: ${stderrText}`
        : `pg_dump exited with code ${code}`;
      child.stdout.destroy(new Error(message));
    }
  });

  return child.stdout;
}
