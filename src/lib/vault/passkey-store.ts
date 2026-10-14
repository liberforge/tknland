import { base64UrlToBytes, bytesToBase64Url } from "@/lib/bytes";
import { putVault, setMeta } from "@/lib/vault/db";
import { decodePasskeyBlob, encodePasskeyBlob } from "@/lib/vault/passkey-blob";
import type { DeviceVaultRecord } from "@/lib/vault/types";
import {
  WebAuthnCancelled,
  formatCredentialId,
  isIosDevice,
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
 * Write secrets to the passkey, then cache them in IndexedDB.
 * On iOS the keychain write is required. Elsewhere a failed write falls back
 * to IndexedDB so Android is not blocked on flaky largeBlob support.
 */
export async function commitDeviceSecrets(
  vault: DeviceVaultRecord,
  options?: { replaceMettalCredentials?: boolean; attemptBlob?: boolean },
): Promise<DeviceVaultRecord> {
  let next: DeviceVaultRecord = vault;
  // Android platform authenticators rarely implement largeBlob. IndexedDB is
  // durable there, so only write the passkey when it is already in use, the
  // device just reported support, or this is iOS.
  const shouldWriteBlob =
    !isMockBiometrics() &&
    vault.storage !== "idb" &&
    (vault.storage === "largeBlob" ||
      isIosDevice() ||
      options?.attemptBlob === true);
  if (shouldWriteBlob) {
    try {
      await writePasskeyBlob(
        parseCredentialId(vault.credentialId),
        encodeVault(vault),
      );
      next = { ...vault, storage: "largeBlob" };
    } catch (err) {
      if (err instanceof WebAuthnCancelled) throw err;
      // iOS often completes Face ID and then refuses the keychain write
      // (`written` is false). Keep the wallet in IndexedDB so setup can finish.
      next = { ...vault, storage: "idb" };
    }
  } else if (isMockBiometrics()) {
    next = { ...vault, storage: "idb" };
  }

  const stored = await putVault(next, {
    replaceMettalCredentials: options?.replaceMettalCredentials,
  });
  if (stored.type !== "device") return next;
  return stored;
}

export async function restoreVaultFromPasskey(): Promise<DeviceVaultRecord | null> {
  if (isMockBiometrics()) return null;
  const { credentialId, blob } = await readPasskeyBlob();
  if (!blob) return null;

  let decoded;
  try {
    decoded = decodePasskeyBlob(blob);
  } catch {
    return null;
  }

  const vault: DeviceVaultRecord = {
    id: decoded.vaultId,
    type: "device",
    label: "Personal",
    credentialId: formatCredentialId(credentialId),
    prfSalt: bytesToBase64Url(decoded.prfSalt),
    iv: bytesToBase64Url(decoded.seedIv),
    ciphertext: bytesToBase64Url(decoded.seedCiphertext),
    accounts: decoded.address
      ? [{ path: PRIMARY_ACCOUNT_PATH, address: formatAddress(decoded.address) }]
      : [],
    backupCompleted: false,
    balanceAtLeast500Since: null,
    storage: "largeBlob",
  };
  if (decoded.mettalIv && decoded.mettalCiphertext) {
    vault.mettalCredentials = {
      iv: bytesToBase64Url(decoded.mettalIv),
      ciphertext: bytesToBase64Url(decoded.mettalCiphertext),
    };
  }

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
