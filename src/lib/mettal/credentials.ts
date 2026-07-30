import {
  base64UrlToBytes,
  bytesToBase64Url,
  wipeBytes,
} from "@/lib/bytes";
import { decryptUtf8, encryptUtf8 } from "@/lib/crypto/aes";
import { putVault } from "@/lib/vault/db";
import { withDeviceVaultKey } from "@/lib/vault/ceremony";
import type { DeviceVaultRecord } from "@/lib/vault/types";

export const METTAL_API_URL = import.meta.env.DEV
  ? "https://api.v1.stg.mettal.io"
  : "https://api.v1.mettal.io";

export const METTAL_PORTAL_URL = "https://mettal.io";

export type MettalCredentials = {
  type: "mettal.api_key";
  key: string;
  secret: string;
};

export function parseMettalQrPayload(raw: string): MettalCredentials {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Este QR no contiene credenciales válidas de Mettal.");
  }

  if (
    !value ||
    typeof value !== "object" ||
    (value as Record<string, unknown>).type !== "mettal.api_key" ||
    typeof (value as Record<string, unknown>).key !== "string" ||
    typeof (value as Record<string, unknown>).secret !== "string" ||
    !(value as Record<string, string>).key.trim() ||
    !(value as Record<string, string>).secret.trim()
  ) {
    throw new Error("Este QR no contiene una API key y secret de Mettal.");
  }

  const payload = value as MettalCredentials;
  return {
    type: "mettal.api_key",
    key: payload.key.trim(),
    secret: payload.secret.trim(),
  };
}

export async function storeMettalCredentials(
  vault: DeviceVaultRecord,
  credentials: MettalCredentials,
): Promise<DeviceVaultRecord> {
  return withDeviceVaultKey(vault, async (key) => {
    const plaintext = JSON.stringify(credentials);
    const { iv, ciphertext } = await encryptUtf8(plaintext, key);

    try {
      const updated: DeviceVaultRecord = {
        ...vault,
        mettalCredentials: {
          iv: bytesToBase64Url(iv),
          ciphertext: bytesToBase64Url(ciphertext),
        },
      };
      await putVault(updated);
      return updated;
    } finally {
      wipeBytes(iv);
      wipeBytes(ciphertext);
    }
  });
}

export async function disconnectMettal(
  vault: DeviceVaultRecord,
): Promise<DeviceVaultRecord> {
  const updated = { ...vault };
  delete updated.mettalCredentials;
  await putVault(updated);
  return updated;
}

export async function withMettalCredentials<T>(
  vault: DeviceVaultRecord,
  useCredentials: (credentials: MettalCredentials) => Promise<T> | T,
): Promise<T> {
  const encrypted = vault.mettalCredentials;
  if (!encrypted) {
    throw new Error("Mettal no está conectado.");
  }

  const iv = base64UrlToBytes(encrypted.iv);
  const ciphertext = base64UrlToBytes(encrypted.ciphertext);
  let plaintext: string | null = null;
  let credentials: MettalCredentials | null = null;

  try {
    return await withDeviceVaultKey(vault, async (key) => {
      plaintext = await decryptUtf8({ iv, ciphertext }, key);
      credentials = parseMettalQrPayload(plaintext);
      return await useCredentials(credentials);
    });
  } finally {
    wipeBytes(iv);
    wipeBytes(ciphertext);
    plaintext = null;
    credentials = null;
  }
}
