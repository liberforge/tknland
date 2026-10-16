import { bytesToBase64Url, wipeBytes } from "@/lib/bytes";
import { decryptUtf8, encryptUtf8 } from "@/lib/crypto/aes";
import { withDeviceVaultSecrets } from "@/lib/vault/ceremony";
import { commitDeviceSecrets } from "@/lib/vault/passkey-store";
import type { DeviceVaultRecord } from "@/lib/vault/types";

/** Dev uses Vite proxy (`/mettal-api` → staging) to avoid CORS on localhost. */
export const METTAL_API_URL = import.meta.env.DEV
  ? "/mettal-api"
  : "https://v1.mettal.io";

export const METTAL_PORTAL_URL = "app.mettal.io";

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
  const updated = await withDeviceVaultSecrets(
    vault,
    async ({ aesKey, seedIv, seedCiphertext }) => {
      const plaintext = JSON.stringify(credentials);
      const encrypted = await encryptUtf8(plaintext, aesKey);

      try {
        return {
          ...vault,
          iv: bytesToBase64Url(seedIv),
          ciphertext: bytesToBase64Url(seedCiphertext),
          mettalConnected: true,
          mettalCredentials: {
            iv: bytesToBase64Url(encrypted.iv),
            ciphertext: bytesToBase64Url(encrypted.ciphertext),
          },
        };
      } finally {
        wipeBytes(encrypted.iv);
        wipeBytes(encrypted.ciphertext);
      }
    },
  );
  return commitDeviceSecrets(updated);
}

export async function disconnectMettal(
  vault: DeviceVaultRecord,
): Promise<DeviceVaultRecord> {
  const updated = await withDeviceVaultSecrets(
    vault,
    async ({ seedIv, seedCiphertext }) => {
      const next: DeviceVaultRecord = {
        ...vault,
        iv: bytesToBase64Url(seedIv),
        ciphertext: bytesToBase64Url(seedCiphertext),
        mettalConnected: false,
      };
      delete next.mettalCredentials;
      return next;
    },
  );
  return commitDeviceSecrets(updated, { replaceMettalCredentials: true });
}

export async function withMettalCredentials<T>(
  vault: DeviceVaultRecord,
  useCredentials: (credentials: MettalCredentials) => Promise<T> | T,
): Promise<T> {
  if (!vault.mettalCredentials && vault.mettalConnected !== true) {
    throw new Error("Mettal no está conectado.");
  }

  let plaintext: string | null = null;
  let credentials: MettalCredentials | null = null;

  try {
    return await withDeviceVaultSecrets(vault, async (secrets) => {
      if (!secrets.mettalIv || !secrets.mettalCiphertext) {
        throw new Error("Mettal no está conectado.");
      }
      plaintext = await decryptUtf8(
        { iv: secrets.mettalIv, ciphertext: secrets.mettalCiphertext },
        secrets.aesKey,
      );
      credentials = parseMettalQrPayload(plaintext);
      return await useCredentials(credentials);
    });
  } finally {
    plaintext = null;
    credentials = null;
  }
}

/** One biometric unlock: decrypt seed + Mettal credentials together. */
export async function withMettalCredentialsAndSeed<T>(
  vault: DeviceVaultRecord,
  use: (ctx: {
    credentials: MettalCredentials;
    mnemonic: string;
  }) => Promise<T> | T,
): Promise<T> {
  if (!vault.mettalCredentials && vault.mettalConnected !== true) {
    throw new Error("Mettal no está conectado.");
  }

  let mnemonic: string | null = null;
  let credPlaintext: string | null = null;
  let credentials: MettalCredentials | null = null;

  try {
    return await withDeviceVaultSecrets(vault, async (secrets) => {
      if (!secrets.mettalIv || !secrets.mettalCiphertext) {
        throw new Error("Mettal no está conectado.");
      }
      mnemonic = await decryptUtf8(
        { iv: secrets.seedIv, ciphertext: secrets.seedCiphertext },
        secrets.aesKey,
      );
      credPlaintext = await decryptUtf8(
        { iv: secrets.mettalIv, ciphertext: secrets.mettalCiphertext },
        secrets.aesKey,
      );
      credentials = parseMettalQrPayload(credPlaintext);
      return await use({ credentials, mnemonic });
    });
  } finally {
    mnemonic = null;
    credPlaintext = null;
    credentials = null;
  }
}
