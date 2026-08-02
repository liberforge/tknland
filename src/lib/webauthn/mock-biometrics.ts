import { utf8ToBytes } from "@/lib/bytes";

/**
 * DEV-only mock for WebAuthn PRF.
 * Active only when serving from http://127.0.0.1 (not localhost).
 * Use http://localhost:5173 for real platform biometrics.
 */
export function isMockBiometrics(): boolean {
  if (!import.meta.env.DEV) return false;
  const host = window.location.hostname;
  return host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

const MOCK_SECRET = utf8ToBytes("tkn.land/dev-mock-prf-v1");
const MOCK_CREDENTIAL_ID = utf8ToBytes("tkn.land-mock-credential-v1");

/** Fixed credential id so mock vaults stay stable across reloads. */
export function mockCredentialId(): Uint8Array {
  return new Uint8Array(MOCK_CREDENTIAL_ID);
}

/** Deterministic 32-byte stand-in for WebAuthn PRF(eval=salt). */
export async function mockPrfOutput(prfSalt: Uint8Array): Promise<Uint8Array> {
  const combined = new Uint8Array(MOCK_SECRET.length + prfSalt.length);
  combined.set(MOCK_SECRET, 0);
  combined.set(prfSalt, MOCK_SECRET.length);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", combined));
}
