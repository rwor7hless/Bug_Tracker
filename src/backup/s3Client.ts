import { S3Client } from "@aws-sdk/client-s3";
import { loadBackupConfig } from "./config.js";

let _client: S3Client | null = null;

const HEADERS_TO_STRIP_EXACT = new Set([
  "x-amz-sdk-checksum-algorithm",
  "amz-sdk-invocation-id",
  "amz-sdk-request",
  "x-amz-user-agent",
]);

const HEADERS_TO_STRIP_PREFIX = ["x-amz-checksum-"];

function shouldStrip(headerName: string): boolean {
  const lower = headerName.toLowerCase();
  if (HEADERS_TO_STRIP_EXACT.has(lower)) return true;
  return HEADERS_TO_STRIP_PREFIX.some((prefix) => lower.startsWith(prefix));
}

function stripHeaders(headers: Record<string, unknown>): void {
  for (const key of Object.keys(headers)) {
    if (shouldStrip(key)) {
      delete headers[key];
    }
  }
}

const stripMiddleware =
  (next: (args: unknown) => unknown) => async (args: unknown) => {
    const request = (args as { request?: { headers?: Record<string, unknown> } }).request;
    if (request?.headers) {
      stripHeaders(request.headers);
    }
    return next(args);
  };

export function getS3Client(): S3Client {
  if (_client) return _client;

  const { s3 } = loadBackupConfig();
  const client = new S3Client({
    endpoint: s3.endpoint,
    region: s3.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: s3.accessKey,
      secretAccessKey: s3.secretKey,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  client.middlewareStack.add(stripMiddleware as never, {
    step: "build",
    name: "stripCloudRuHeadersBuild",
  });

  let positionedBeforeSigner = false;
  for (const signerName of ["awsAuthMiddleware", "httpSigningMiddleware", "signingMiddleware"]) {
    try {
      client.middlewareStack.addRelativeTo(stripMiddleware as never, {
        name: `stripCloudRuHeadersBefore_${signerName}`,
        relation: "before",
        toMiddleware: signerName,
      });
      positionedBeforeSigner = true;
      break;
    } catch {
      // signer with this name not registered — try next
    }
  }

  if (!positionedBeforeSigner) {
    client.middlewareStack.add(stripMiddleware as never, {
      step: "finalizeRequest",
      name: "stripCloudRuHeadersFinalizeFallback",
      priority: "low",
    });
  }

  if (process.env.S3_DEBUG === "1") {
    const stack = client.middlewareStack.identify();
    console.log("[S3-DEBUG] middleware stack (" + stack.length + " items):");
    for (const line of stack) console.log("  " + line);
    console.log(`[S3-DEBUG] stripper positionedBeforeSigner=${positionedBeforeSigner}`);

    client.middlewareStack.add(
      (next) => async (args) => {
        const request = args.request as {
          method?: string;
          hostname?: string;
          path?: string;
          query?: Record<string, unknown>;
          headers?: Record<string, unknown>;
        };
        console.log("\n[S3-DEBUG] ===== Outgoing request =====");
        console.log(`[S3-DEBUG] ${request.method} https://${request.hostname}${request.path}`);
        if (request.query && Object.keys(request.query).length > 0) {
          console.log("[S3-DEBUG] query:", request.query);
        }
        console.log("[S3-DEBUG] headers:", request.headers);
        console.log("[S3-DEBUG] ============================\n");

        try {
          return await next(args);
        } catch (err) {
          console.log("\n[S3-DEBUG] ===== Error =====");
          console.log("[S3-DEBUG]", err);
          console.log("[S3-DEBUG] =================\n");
          throw err;
        }
      },
      {
        step: "finalizeRequest",
        name: "debugLogger",
        priority: "low",
      },
    );
  }

  _client = client;
  return _client;
}
