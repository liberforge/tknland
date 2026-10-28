import { base64UrlToBytes, bytesToBase64Url } from "@/lib/bytes";

const VAULT_PATH = "/api/vault";

/** Apex redirects every path, including this API, and a home-screen app may not follow that. */
function vaultUrl(): string {
  if (typeof window !== "undefined" && window.location.hostname === "tkn.land") {
    return `https://www.tkn.land${VAULT_PATH}`;
  }
  return VAULT_PATH;
}

/**
 * The PRF output is the decryption key. `toJSON()` includes it under
 * `clientExtensionResults.prf.results`, and that object is the only part of
 * the ceremony the server needs for the signature. Drop the results first.
 */
function withoutPrfOutput(
  credential: Record<string, unknown>,
): Record<string, unknown> {
  const extensions = credential.clientExtensionResults;
  if (!extensions || typeof extensions !== "object") return credential;
  const prf = (extensions as Record<string, unknown>).prf;
  if (!prf || typeof prf !== "object" || !("results" in prf)) return credential;
  const nextPrf = { ...(prf as Record<string, unknown>) };
  delete nextPrf.results;
  return {
    ...credential,
    clientExtensionResults: {
      ...(extensions as Record<string, unknown>),
      prf: nextPrf,
    },
  };
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // A proxy or the SPA fallback can return HTML.
  }
  return "No se pudo contactar el almacén.";
}

async function postVault(body: unknown): Promise<void> {
  const res = await fetch(vaultUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

/** One-time server challenge. The passkey ceremony must use these exact bytes. */
export async function fetchChallengeBytes(): Promise<Uint8Array> {
  const res = await fetch(vaultUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ op: "challenge" }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  const body = (await res.json()) as { challenge?: unknown };
  if (typeof body.challenge !== "string" || !body.challenge) {
    throw new Error("El almacén no entregó un reto.");
  }
  return base64UrlToBytes(body.challenge);
}

/** Ciphertext for this passkey, or null when this credential has no row yet. */
export async function fetchRemoteBlob(
  credentialId: string,
): Promise<Uint8Array | null> {
  const res = await fetch(
    `${vaultUrl()}?credentialId=${encodeURIComponent(credentialId)}`,
    { cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await errorMessage(res));
  const body = (await res.json()) as { blob?: unknown };
  if (typeof body.blob !== "string" || !body.blob) return null;
  return base64UrlToBytes(body.blob);
}

export async function createRemoteVault(
  registration: Record<string, unknown>,
  blob: Uint8Array,
): Promise<void> {
  await postVault({
    op: "create",
    registration: withoutPrfOutput(registration),
    blob: bytesToBase64Url(blob),
  });
}

export async function updateRemoteVault(
  assertion: Record<string, unknown>,
  blob: Uint8Array,
): Promise<void> {
  await postVault({
    op: "update",
    assertion: withoutPrfOutput(assertion),
    blob: bytesToBase64Url(blob),
  });
}
