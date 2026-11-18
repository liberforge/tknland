/** A failed request. The path has no query and no body. */
export class RequestError extends Error {
  readonly method: string;
  readonly path: string;

  constructor(method: string, path: string, message: string) {
    super(message);
    this.name = "RequestError";
    this.method = method;
    this.path = path;
  }
}

const CODE_ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789";

function newCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

/** Drop tokens, keys, and query strings before a message is stored or shown. */
export function redactErrorText(text: string): string {
  const cleaned = text
    .replace(/bearer\s+\S+/gi, "bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, "[redacted]")
    .replace(
      /\b(secret|mnemonic|seed|api[_-]?key|access[_-]?token|authorization)\b\s*[:=]\s*\S+/gi,
      "$1 [redacted]",
    )
    .replace(/\b[a-fA-F0-9]{64,}\b/g, "[redacted]")
    .replace(/https?:\/\/[^\s]+/gi, (url) => {
      try {
        const parsed = new URL(url);
        return parsed.pathname || "/";
      } catch {
        return "/";
      }
    })
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 240);
}

function errorUrl(): string {
  if (typeof window !== "undefined" && window.location.hostname === "tkn.land") {
    return "https://www.tkn.land/api/client-error";
  }
  return "/api/client-error";
}

function recordClientError(step: string, error: unknown): { message: string; code: string } {
  const name = error instanceof Error && error.name ? error.name : "Error";
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Error";
  const message = redactErrorText(raw) || "Error";
  const method = error instanceof RequestError ? error.method : undefined;
  const path = error instanceof RequestError ? error.path : undefined;
  const code = newCode();
  const online = typeof navigator !== "undefined" ? navigator.onLine : true;

  void fetch(errorUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      code,
      step,
      name,
      message,
      method,
      path,
      online,
    }),
  }).catch(() => {
    // A failed report must not replace the error the person is already seeing.
  });

  return { message, code };
}

/**
 * Store a failure that the screen is retrying. The visible text stays as it
 * is; the log is the record that this attempt failed.
 */
export function reportClientError(step: string, error: unknown): void {
  recordClientError(step, error);
}

/**
 * Record a user-visible error and return the message with its short code.
 * The report contains the step, the error name, the redacted message, and
 * the request method and path when the failure was a request.
 */
export function clientError(step: string, error: unknown): string {
  const { message, code } = recordClientError(step, error);
  return `${message} · ${code}`;
}
