import type { IncomingMessage, ServerResponse } from "node:http";
import { handleVault } from "./vault-handler.ts";

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

function sendJson(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      res.setHeader(key, value);
    }
  }
  res.end(JSON.stringify(body));
}

const ALLOWED_ORIGINS = new Set(["https://tkn.land", "https://www.tkn.land"]);

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "origin",
  };
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const cors = corsHeaders(header(req, "origin"));
  try {
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      for (const [key, value] of Object.entries(cors)) res.setHeader(key, value);
      res.end();
      return;
    }

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
    sendJson(res, result.status, result.body, cors);
  } catch (err) {
    console.error("vault invocation", err);
    sendJson(res, 500, { error: "No se pudo guardar la billetera." }, cors);
  }
}
