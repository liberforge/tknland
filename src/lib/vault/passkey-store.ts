import { base64UrlToBytes, bytesToBase64Url } from "@/lib/bytes";
import { getVault, putVault, setMeta } from "@/lib/vault/db";
import { decodePasskeyBlob, encodePasskeyBlob } from "@/lib/vault/passkey-blob";
import type { DeviceVaultRecord } from "@/lib/vault/types";
import {
  WebAuthnCancelled,
  formatCredentialId,
  isMockBiometrics,
  parseCredentialId,
  readPasskeyBlob,
  writePasskeyBlob,
} from "@/lib/webauthn/prf";

const PRIMARY_ACCOUNT_PATH = "m/44'/60'/0'/0/0";

function addressBytes(address: string | undefined): Uint8Array | undefined {
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return undefined;
  const out = new Uint8Array(20);
  for (let i = 0; i < 20; i++) {
    out[i] = Number.parseInt(address.slice(2 + i * 2, 4 + i * 2), 16);
  }
  return out;
}

function formatAddress(bytes: Uint8Array): string {
  let hex = "0x";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

function encodeVault(vault: DeviceVaultRecord): Uint8Array {
  if (!vault.iv || !vault.ciphertext) {
    throw new Error("El llavero no tiene una billetera.");
  }
  const mettal = vault.mettalCredentials;
  return encodePasskeyBlob({
    vaultId: vault.id,
    prfSalt: base64UrlToBytes(vault.prfSalt),
    seedIv: base64UrlToBytes(vault.iv),
    seedCiphertext: base64UrlToBytes(vault.ciphertext),
    mettalIv: mettal ? base64UrlToBytes(mettal.iv) : undefined,
    mettalCiphertext: mettal ? base64UrlToBytes(mettal.ciphertext) : undefined,
    address: addressBytes(vault.accounts[0]?.address),
  });
}

/**
 * Write secrets to the passkey on every real device. IndexedDB then stores
 * only the public cache. If this device cannot write the blob, the secrets
 * stay in IndexedDB so the wallet still opens.
 */
export async function commitDeviceSecrets(
  vault: DeviceVaultRecord,
  options?: { replaceMettalCredentials?: boolean; attemptBlob?: boolean },
): Promise<DeviceVaultRecord> {
  let next: DeviceVaultRecord = vault;
  if (isMockBiometrics()) {
    next = { ...vault, storage: "idb" };
  } else if (options?.attemptBlob !== false) {
    const ready = await vaultWithSecrets(vault, options);
    try {
      await writePasskeyBlob(
        parseCredentialId(ready.credentialId),
        encodeVault(ready),
      );
      next = {
        ...ready,
        storage: "largeBlob",
        mettalConnected:
          ready.mettalConnected === true || ready.mettalCredentials != null,
      };
    } catch (err) {
      if (err instanceof WebAuthnCancelled) throw err;
      next = { ...ready, storage: "idb" };
    }
  }

  const stored = await putVault(next, {
    replaceMettalCredentials: options?.replaceMettalCredentials,
  });
  if (stored.type !== "device") return next;
  return stored;
}

/** Fill seed fields from the passkey when IndexedDB no longer has them. */
async function vaultWithSecrets(
  vault: DeviceVaultRecord,
  options?: { replaceMettalCredentials?: boolean },
): Promise<DeviceVaultRecord> {
  if (vault.iv && vault.ciphertext && vault.prfSalt) return vault;
  const { blob } = await readPasskeyBlob(parseCredentialId(vault.credentialId));
  if (!blob) {
    throw new Error("El llavero no tiene una billetera.");
  }
  const decoded = decodePasskeyBlob(blob);
  const fromBlob =
    !options?.replaceMettalCredentials &&
    decoded.mettalIv &&
    decoded.mettalCiphertext
      ? {
          iv: bytesToBase64Url(decoded.mettalIv),
          ciphertext: bytesToBase64Url(decoded.mettalCiphertext),
        }
      : undefined;
  return {
    ...vault,
    prfSalt: vault.prfSalt || bytesToBase64Url(decoded.prfSalt),
    iv: bytesToBase64Url(decoded.seedIv),
    ciphertext: bytesToBase64Url(decoded.seedCiphertext),
    mettalCredentials: vault.mettalCredentials ?? fromBlob,
  };
}

export async function restoreVaultFromPasskey(options?: {
  immediate?: boolean;
}): Promise<DeviceVaultRecord | null> {
  if (isMockBiometrics()) return null;
  const { credentialId, blob } = await readPasskeyBlob(undefined, options);
  if (!blob) return null;

  let decoded;
  try {
    decoded = decodePasskeyBlob(blob);
  } catch {
    return null;
  }

  const previous = await getVault(decoded.vaultId);
  const previousDevice = previous?.type === "device" ? previous : null;
  const vault: DeviceVaultRecord = {
    id: decoded.vaultId,
    type: "device",
    label: previousDevice?.label ?? "Personal",
    credentialId: formatCredentialId(credentialId),
    prfSalt: bytesToBase64Url(decoded.prfSalt),
    accounts:
      previousDevice && previousDevice.accounts.length > 0
        ? previousDevice.accounts
        : decoded.address
          ? [{ path: PRIMARY_ACCOUNT_PATH, address: formatAddress(decoded.address) }]
          : [],
    backupCompleted: previousDevice?.backupCompleted ?? false,
    balanceAtLeast500Since: previousDevice?.balanceAtLeast500Since ?? null,
    storage: "largeBlob",
    mettalConnected: Boolean(decoded.mettalIv && decoded.mettalCiphertext),
  };

  const stored = await putVault(vault, { replaceMettalCredentials: true });
  if (stored.type !== "device") return null;
  await setMeta({
    credentialId: stored.credentialId,
    activeVaultId: stored.id,
  });
  return stored;
}

export async function restoreMettalCredentialsFromPasskey(
  vault: DeviceVaultRecord,
): Promise<DeviceVaultRecord | null> {
  if (isMockBiometrics()) return null;
  const { blob } = await readPasskeyBlob(parseCredentialId(vault.credentialId));
  if (!blob) return null;

  const decoded = decodePasskeyBlob(blob);
  if (decoded.vaultId !== vault.id) return null;
  if (!decoded.mettalIv || !decoded.mettalCiphertext) return null;

  const updated: DeviceVaultRecord = {
    ...vault,
    accounts:
      vault.accounts.length > 0
        ? vault.accounts
        : decoded.address
          ? [
              {
                path: PRIMARY_ACCOUNT_PATH,
                address: formatAddress(decoded.address),
              },
            ]
          : [],
    storage: "largeBlob",
    prfSalt: bytesToBase64Url(decoded.prfSalt),
    iv: bytesToBase64Url(decoded.seedIv),
    ciphertext: bytesToBase64Url(decoded.seedCiphertext),
    mettalCredentials: {
      iv: bytesToBase64Url(decoded.mettalIv),
      ciphertext: bytesToBase64Url(decoded.mettalCiphertext),
    },
  };
  const stored = await putVault(updated, { replaceMettalCredentials: true });
  if (stored.type !== "device") return updated;
  return stored;
}
