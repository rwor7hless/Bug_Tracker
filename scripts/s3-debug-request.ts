import { createHash, createHmac } from "crypto";
import https from "https";
import { loadBackupConfig } from "../src/backup/config.js";

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function sha256hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function sign(
  secret: string | Buffer,
  dateStamp: string,
  region: string,
  service: string,
  stringToSign: string,
): string {
  const kSecret = typeof secret === "string"
    ? Buffer.from("AWS4" + secret, "utf8")
    : Buffer.concat([Buffer.from("AWS4", "utf8"), secret]);
  const kDate = hmac(kSecret, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  return hmac(kSigning, stringToSign).toString("hex");
}

interface Variant {
  name: string;
  accessKey: string;
  secretKey: string | Buffer;
  path: string;
  region?: string;
  service?: string;
  query?: string;
  payloadHashOverride?: string;
  host?: string;
}

async function tryVariant(v: Variant, config: ReturnType<typeof loadBackupConfig>): Promise<void> {
  const region = v.region ?? config.s3.region;
  const service = v.service ?? "s3";
  const url = new URL(config.s3.endpoint);
  const host = v.host ?? url.hostname;
  const method = "GET";
  const canonicalQuery = v.query ?? "lifecycle=";

  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  const amzDate =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = v.payloadHashOverride ?? sha256hex("");

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    method,
    v.path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256hex(canonicalRequest),
  ].join("\n");

  const signature = sign(v.secretKey, dateStamp, region, service, stringToSign);

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${v.accessKey}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const status = await new Promise<{ code: number; body: string }>((resolve, reject) => {
    const req = https.request(
      {
        method,
        hostname: host,
        path: `${v.path}?${canonicalQuery}`,
        headers: {
          Host: host,
          "X-Amz-Date": amzDate,
          "X-Amz-Content-SHA256": payloadHash,
          Authorization: authorization,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({ code: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
        );
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });

  const ok = status.code < 300;
  console.log(`\n----- ${v.name} -----`);
  console.log(`path=${v.path} region=${region} service=${service} query=${canonicalQuery}`);
  console.log(`HTTP ${status.code} ${ok ? "✅" : "❌"}`);
  if (!ok || status.body.length < 500) {
    console.log(`Body: ${status.body}`);
  }
}

function _unused(..._: unknown[]): Variant[] {
  return [];
}

async function main(): Promise<void> {
  const config = loadBackupConfig();

  const fullSecret = config.s3.secretKey;
  const [beforeDot, afterDot] = fullSecret.split(".");
  const tenantAndKey = config.s3.accessKey;
  const keyOnly = tenantAndKey.includes(":")
    ? tenantAndKey.split(":")[1]
    : tenantAndKey;

  const variants: Variant[] = [
    { name: "G: service=s3e", accessKey: tenantAndKey, secretKey: fullSecret, path: `/${config.s3.bucket}/`, service: "s3e" },
    { name: "H: region=ru-1", accessKey: tenantAndKey, secretKey: fullSecret, path: `/${config.s3.bucket}/`, region: "ru-1" },
    { name: "I: region=us-east-1", accessKey: tenantAndKey, secretKey: fullSecret, path: `/${config.s3.bucket}/`, region: "us-east-1" },
    { name: "J: query=lifecycle (no =)", accessKey: tenantAndKey, secretKey: fullSecret, path: `/${config.s3.bucket}/`, query: "lifecycle" },
    { name: "K: payload=UNSIGNED-PAYLOAD", accessKey: tenantAndKey, secretKey: fullSecret, path: `/${config.s3.bucket}/`, payloadHashOverride: "UNSIGNED-PAYLOAD" },
    { name: "L: try list-buckets (GET /)", accessKey: tenantAndKey, secretKey: fullSecret, path: "/", query: "" },
    { name: "M: virtual-host: bucket.s3.cloud.ru", accessKey: tenantAndKey, secretKey: fullSecret, path: "/", query: "lifecycle=", host: `${config.s3.bucket}.s3.cloud.ru` },
    { name: "N: region=ru-central1 (no dash)", accessKey: tenantAndKey, secretKey: fullSecret, path: `/${config.s3.bucket}/`, region: "ru-central1" },
    // suppress unused-var warnings on derived secrets
    ..._unused(beforeDot, afterDot, keyOnly),
  ];

  for (const v of variants) {
    try {
      await tryVariant(v, config);
    } catch (err) {
      console.log(`\n----- ${v.name} -----`);
      console.log("ERROR:", err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
