import type { IncomingMessage, ServerResponse } from "node:http";
import { handleVault } from "../server/vault-handler.ts";

export const config = {
  regions: ["fra1"],
  maxDuration: 10,
};

function header(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name];
  if (typeof value === "string" && value) return value;
  if (Array.isArray(value) && value[0]) return value[0];
  return null;
}

function readRawBody(req: IncomingMessage): Promise<string> {
  if (
    "body" in req &&
    req.body &&
    typeof req.body === "object" &&
    !Buffer.isBuffer(req.body)
  ) {
    return Promise.resolve(JSON.stringify(req.body));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const host = header(req, "x-forwarded-host") ?? header(req, "host") ?? "localhost";
  const proto = header(req, "x-forwarded-proto") ?? "https";
  const url = new URL(req.url ?? "/api/vault", `${proto}://${host}`);
  let body: unknown;
  if (req.method === "POST") {
    const raw = await readRawBody(req);
    if (raw) {
      try {
        body = JSON.parse(raw) as unknown;
      } catch {
        body = null;
      }
    }
  }

  const result = await handleVault({
    method: req.method ?? "GET",
    url,
    origin: header(req, "origin"),
    body,
  });
  res.statusCode = result.status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(result.body));
}
