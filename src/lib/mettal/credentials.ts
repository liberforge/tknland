import { withDeviceVaultSecrets } from "@/lib/vault/ceremony";
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
  return withDeviceVaultSecrets(
    vault,
    ({ payload, commit }) =>
      commit({
        ...payload,
        mettal: {
          type: "mettal.api_key",
          key: credentials.key,
          secret: credentials.secret,
        },
      }),
    { write: true },
  );
}

export async function disconnectMettal(
  vault: DeviceVaultRecord,
): Promise<DeviceVaultRecord> {
  return withDeviceVaultSecrets(
    vault,
    ({ payload, commit }) => {
      const next = { ...payload };
      delete next.mettal;
      return commit(next);
    },
    { write: true },
  );
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
    return await withDeviceVaultSecrets(vault, async ({ payload }) => {
      if (!payload.mettal) throw new Error("Mettal no está conectado.");
      plaintext = JSON.stringify(payload.mettal);
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
    return await withDeviceVaultSecrets(vault, async ({ payload }) => {
      if (!payload.mettal) throw new Error("Mettal no está conectado.");
      mnemonic = payload.seed;
      credPlaintext = JSON.stringify(payload.mettal);
      credentials = parseMettalQrPayload(credPlaintext);
      return await use({ credentials, mnemonic });
    });
  } finally {
    mnemonic = null;
    credPlaintext = null;
    credentials = null;
  }
}
