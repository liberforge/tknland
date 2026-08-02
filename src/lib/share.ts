export type ShareResult =
  | { method: "share" }
  | { method: "clipboard" }
  | { method: "cancelled" };

/**
 * Prefer the native share sheet; fall back to clipboard copy.
 */
export async function shareText(input: {
  title?: string;
  text: string;
  url?: string;
}): Promise<ShareResult> {
  const canShare =
    typeof navigator.share === "function" &&
    (!input.url ||
      typeof navigator.canShare !== "function" ||
      navigator.canShare({ url: input.url, text: input.text, title: input.title }));

  if (canShare) {
    try {
      await navigator.share({
        title: input.title,
        text: input.text,
        url: input.url,
      });
      return { method: "share" };
    } catch (err) {
      if (isAbortError(err)) return { method: "cancelled" };
      // Fall through to clipboard.
    }
  }

  const payload = input.url
    ? `${input.text}\n${input.url}`.trim()
    : input.text;
  await navigator.clipboard.writeText(payload);
  return { method: "clipboard" };
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}
