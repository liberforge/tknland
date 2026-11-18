export type ClientErrorRecord = {
  code: string;
  step: string;
  name: string;
  message: string;
  method?: string;
  path?: string;
  online: boolean;
};

const STEP = /^[a-z0-9._-]{1,64}$/;
const CODE = /^[a-z0-9]{6}$/;
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const METHOD = /^(GET|POST|PUT|DELETE)$/;
const PATH = /^\/[A-Za-z0-9/_\-.]{0,120}$/;

function redact(text: string): string {
  return text
    .replace(/bearer\s+\S+/gi, "bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, "[redacted]")
    .replace(
      /\b(secret|mnemonic|seed|api[_-]?key|access[_-]?token|authorization)\b\s*[:=]\s*\S+/gi,
      "$1 [redacted]",
    )
    .replace(/\b[a-fA-F0-9]{64,}\b/g, "[redacted]")
    .replace(/https?:\/\/\S+/gi, (url) => {
      try {
        return new URL(url).pathname || "/";
      } catch {
        return "/";
      }
    })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

/** Accept only the fixed fields. Anything else is dropped and never logged. */
export function acceptClientError(
  body: unknown,
): { ok: true; record: ClientErrorRecord } | { ok: false } {
  if (!body || typeof body !== "object") return { ok: false };
  const raw = body as Record<string, unknown>;
  if (typeof raw.code !== "string" || !CODE.test(raw.code)) return { ok: false };
  if (typeof raw.step !== "string" || !STEP.test(raw.step)) return { ok: false };
  if (typeof raw.message !== "string") return { ok: false };
  const message = redact(raw.message);
  if (!message) return { ok: false };
  if (typeof raw.online !== "boolean") return { ok: false };

  const name =
    typeof raw.name === "string" && NAME.test(raw.name) ? raw.name : "Error";
  const method =
    typeof raw.method === "string" && METHOD.test(raw.method)
      ? raw.method
      : undefined;
  const path =
    typeof raw.path === "string" && PATH.test(raw.path) ? raw.path : undefined;

  return {
    ok: true,
    record: {
      code: raw.code,
      step: raw.step,
      name,
      message,
      method,
      path,
      online: raw.online,
    },
  };
}

export function logClientError(record: ClientErrorRecord): void {
  console.error(
    JSON.stringify({
      source: "client-error",
      at: new Date().toISOString(),
      code: record.code,
      step: record.step,
      name: record.name,
      message: record.message,
      method: record.method ?? null,
      path: record.path ?? null,
      online: record.online,
    }),
  );
}
