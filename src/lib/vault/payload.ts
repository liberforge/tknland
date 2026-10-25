import { decryptUtf8, encryptUtf8 } from "@/lib/crypto/aes";
import { wipeBytes } from "@/lib/bytes";

export type VaultMettal = {
  type: "mettal.api_key";
  key: string;
  secret: string;
};

/** Plaintext that is encrypted before it leaves the device. */
export type VaultPayload = {
  v: 1;
  seed: string;
  mettal?: VaultMettal;
};

function asMettal(value: unknown): VaultMettal | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.type !== "mettal.api_key" ||
    typeof record.key !== "string" ||
    typeof record.secret !== "string" ||
    !record.key ||
    !record.secret
  ) {
    return undefined;
  }
  return {
    type: "mettal.api_key",
    key: record.key,
    secret: record.secret,
  };
}

export function parsePayloadJson(text: string): VaultPayload | null {
  if (!text.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    if (record.v !== 1 || typeof record.seed !== "string" || !record.seed) {
      return null;
    }
    const mettal = asMettal(record.mettal);
    return mettal ? { v: 1, seed: record.seed, mettal } : { v: 1, seed: record.seed };
  } catch {
    return null;
  }
}

/** `iv (12) || AES-GCM ciphertext` of the JSON payload. */
export async function encryptPayload(
  payload: VaultPayload,
  key: CryptoKey,
): Promise<Uint8Array> {
  const encoded = await encryptUtf8(JSON.stringify(payload), key);
  const out = new Uint8Array(encoded.iv.byteLength + encoded.ciphertext.byteLength);
  out.set(encoded.iv, 0);
  out.set(encoded.ciphertext, encoded.iv.byteLength);
  wipeBytes(encoded.iv);
  wipeBytes(encoded.ciphertext);
  return out;
}

export async function decryptPayload(
  blob: Uint8Array,
  key: CryptoKey,
): Promise<VaultPayload> {
  if (blob.byteLength < 13) {
    throw new Error("La billetera guardada está incompleta.");
  }
  const iv = blob.slice(0, 12);
  const ciphertext = blob.slice(12);
  let json = "";
  try {
    json = await decryptUtf8({ iv, ciphertext }, key);
    const payload = parsePayloadJson(json);
    if (!payload) throw new Error("La billetera guardada no se pudo leer.");
    return payload;
  } finally {
    json = "";
    wipeBytes(iv);
    wipeBytes(ciphertext);
  }
}
