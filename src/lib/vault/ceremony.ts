import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { aesKeyFromPrf, decryptUtf8, encryptUtf8 } from "@/lib/crypto/aes";
import {
  assertPasskeyWithPrf,
  canImmediateGet,
  createPasskeyWithPrf,
  formatCredentialId,
  parseCredentialId,
  readPasskeyBlobAndPrf,
  WebAuthnCancelled,
  wipePrfOutput,
} from "@/lib/webauthn/prf";
import { decodePasskeyBlob } from "@/lib/vault/passkey-blob";
import {
  getMeta,
  putVault,
  requestPersistentStorage,
  setMeta,
} from "@/lib/vault/db";
import {
  commitDeviceSecrets,
  restoreVaultFromPasskey,
} from "@/lib/vault/passkey-store";
import {
  DEFAULT_EVM_ACCOUNT_PATH,
  deriveEvmAccountFromMnemonic,
} from "@/lib/vault/evm";
import type { DeviceVaultRecord } from "@/lib/vault/types";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  randomBytes,
  wipeBytes,
} from "@/lib/bytes";
import { isMockBiometrics } from "@/lib/webauthn/mock-biometrics";

/**
 * A biometric sheet cannot be dismissed this quickly. A faster
 * `NotAllowedError` means this device has no passkey for this site.
 */
const EMPTY_KEYCHAIN_MS = 1000;

function newVaultId(): string {
  return bytesToBase64Url(randomBytes(16));
}

/**
 * Create the first device vault: passkey + PRF → encrypt mnemonic → passkey blob.
 * Mnemonic is wiped before return (caller never holds it unless they use backup later).
 */
export async function createInitialDeviceVault(): Promise<DeviceVaultRecord> {
  await requestPersistentStorage();

  const mnemonic = generateMnemonic(wordlist, 128);
  const prfSalt = randomBytes(32);

  let prfOutput: Uint8Array | null = null;
  let credentialId: Uint8Array | null = null;

  try {
    const passkey = await createPasskeyWithPrf(prfSalt);
    prfOutput = passkey.prfOutput;
    credentialId = passkey.credentialId;

    const aesKey = await aesKeyFromPrf(prfOutput);
    wipePrfOutput(prfOutput);
    prfOutput = null;

    const { iv, ciphertext } = await encryptUtf8(mnemonic, aesKey);

    const vault: DeviceVaultRecord = {
      id: newVaultId(),
      type: "device",
      label: "Personal",
      credentialId: formatCredentialId(credentialId),
      prfSalt: bytesToBase64Url(prfSalt),
      iv: bytesToBase64Url(iv),
      ciphertext: bytesToBase64Url(ciphertext),
      accounts: [],
      backupCompleted: false,
      balanceAtLeast500Since: null,
    };

    wipeBytes(iv);
    wipeBytes(ciphertext);
    const stored = await commitDeviceSecrets(vault, { attemptBlob: true });
    await setMeta({
      credentialId: stored.credentialId,
      activeVaultId: stored.id,
    });
    return stored;
  } finally {
    wipeBytes(prfSalt);
    if (prfOutput) wipePrfOutput(prfOutput);
    if (credentialId) wipeBytes(credentialId);
  }
}

/**
 * One gesture, no choice: read a local passkey, or create one on this device.
 * Safari's discoverable sign-in shows a QR code when no passkey exists, so
 * that lookup runs only where the browser can fail it with no sheet.
 * Cancelling biometrics does not create a second vault.
 */
export async function openOrCreateDeviceVault(): Promise<DeviceVaultRecord> {
  if (isMockBiometrics()) return createInitialDeviceVault();

  if (canImmediateGet()) {
    const started = performance.now();
    try {
      const existing = await restoreVaultFromPasskey({ immediate: true });
      if (existing) return existing;
    } catch (err) {
      const emptyKeychain =
        err instanceof WebAuthnCancelled &&
        performance.now() - started < EMPTY_KEYCHAIN_MS;
      if (!emptyKeychain) throw err;
    }
  }

  return createInitialDeviceVault();
}

type VaultSecrets = {
  aesKey: CryptoKey;
  seedIv: Uint8Array;
  seedCiphertext: Uint8Array;
  mettalIv?: Uint8Array;
  mettalCiphertext?: Uint8Array;
};

/**
 * One biometric prompt. The encrypted seed and Mettal key come from the
 * passkey when that blob is the stored copy.
 */
export async function withDeviceVaultSecrets<T>(
  vault: DeviceVaultRecord,
  use: (secrets: VaultSecrets) => Promise<T> | T,
): Promise<T> {
  const credentialId = parseCredentialId(vault.credentialId);
  const prfSalt = base64UrlToBytes(vault.prfSalt);
  let prfOutput: Uint8Array | null = null;
  let seedIv: Uint8Array | null = null;
  let seedCiphertext: Uint8Array | null = null;
  let mettalIv: Uint8Array | null = null;
  let mettalCiphertext: Uint8Array | null = null;

  try {
    const useLocalCopy =
      isMockBiometrics() ||
      (vault.storage !== "largeBlob" &&
        vault.iv != null &&
        vault.ciphertext != null);

    if (useLocalCopy) {
      if (!vault.iv || !vault.ciphertext) {
        throw new Error("El llavero no tiene una billetera.");
      }
      prfOutput = await assertPasskeyWithPrf({ credentialId, prfSalt });
      seedIv = base64UrlToBytes(vault.iv);
      seedCiphertext = base64UrlToBytes(vault.ciphertext);
      if (vault.mettalCredentials) {
        mettalIv = base64UrlToBytes(vault.mettalCredentials.iv);
        mettalCiphertext = base64UrlToBytes(vault.mettalCredentials.ciphertext);
      }
    } else {
      const read = await readPasskeyBlobAndPrf({ credentialId, prfSalt });
      if (!read.blob || !read.prfOutput) {
        throw new Error("El llavero no tiene una billetera.");
      }
      prfOutput = read.prfOutput;
      const decoded = decodePasskeyBlob(read.blob);
      seedIv = decoded.seedIv;
      seedCiphertext = decoded.seedCiphertext;
      mettalIv = decoded.mettalIv ?? null;
      mettalCiphertext = decoded.mettalCiphertext ?? null;
    }

    const aesKey = await aesKeyFromPrf(prfOutput);
    wipePrfOutput(prfOutput);
    prfOutput = null;

    return await use({
      aesKey,
      seedIv,
      seedCiphertext,
      mettalIv: mettalIv ?? undefined,
      mettalCiphertext: mettalCiphertext ?? undefined,
    });
  } finally {
    wipeBytes(credentialId);
    wipeBytes(prfSalt);
    if (prfOutput) wipePrfOutput(prfOutput);
    if (seedIv) wipeBytes(seedIv);
    if (seedCiphertext) wipeBytes(seedCiphertext);
    if (mettalIv) wipeBytes(mettalIv);
    if (mettalCiphertext) wipeBytes(mettalCiphertext);
  }
}

/**
 * Per-action ceremony: biometric → PRF → derive the vault key → use.
 */
export async function withDeviceVaultKey<T>(
  vault: DeviceVaultRecord,
  useKey: (key: CryptoKey) => Promise<T> | T,
): Promise<T> {
  return withDeviceVaultSecrets(vault, ({ aesKey }) => useKey(aesKey));
}

/**
 * Per-action ceremony: biometric → PRF → decrypt seed → use → wipe.
 */
export async function withDeviceVaultSeed<T>(
  vault: DeviceVaultRecord,
  useSeed: (mnemonic: string) => Promise<T> | T,
): Promise<T> {
  let mnemonic: string | null = null;
  try {
    return await withDeviceVaultSecrets(
      vault,
      async ({ aesKey, seedIv, seedCiphertext }) => {
        mnemonic = await decryptUtf8(
          { iv: seedIv, ciphertext: seedCiphertext },
          aesKey,
        );
        return await useSeed(mnemonic);
      },
    );
  } finally {
    mnemonic = null;
  }
}

/** Round-trip helper for diagnostics: decrypt and return word count only. */
export async function verifyVaultUnlock(
  vault: DeviceVaultRecord,
): Promise<{ wordCount: number }> {
  return withDeviceVaultSeed(vault, (mnemonic) => ({
    wordCount: mnemonic.trim().split(/\s+/).length,
  }));
}

export async function markBackupCompleted(
  vault: DeviceVaultRecord,
): Promise<DeviceVaultRecord> {
  const updated: DeviceVaultRecord = {
    ...vault,
    backupCompleted: true,
  };
  const stored = await putVault(updated);
  if (stored.type !== "device") return updated;
  return stored;
}

export async function hasSharedPasskey(): Promise<boolean> {
  const meta = await getMeta();
  return Boolean(meta.credentialId);
}

function normalizeMnemonic(raw: string): string {
  return raw.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

/**
 * Replace the stored seed with a phrase the user already saved.
 * The passkey stays; only the encrypted mnemonic and its address change.
 */
export async function replaceDeviceVaultMnemonic(
  vault: DeviceVaultRecord,
  rawMnemonic: string,
): Promise<DeviceVaultRecord> {
  const mnemonic = normalizeMnemonic(rawMnemonic);
  if (!mnemonic || !validateMnemonic(mnemonic, wordlist)) {
    throw new Error("La frase secreta no es válida. Revisa las palabras y el orden.");
  }

  const account = deriveEvmAccountFromMnemonic(mnemonic, DEFAULT_EVM_ACCOUNT_PATH);
  if (!account.address) {
    throw new Error("Esa frase no produce una cuenta.");
  }

  const updated = await withDeviceVaultSecrets(
    vault,
    async ({ aesKey, mettalIv, mettalCiphertext }) => {
      const encrypted = await encryptUtf8(mnemonic, aesKey);
      try {
        const next: DeviceVaultRecord = {
          ...vault,
          iv: bytesToBase64Url(encrypted.iv),
          ciphertext: bytesToBase64Url(encrypted.ciphertext),
          accounts: [{ path: DEFAULT_EVM_ACCOUNT_PATH, address: account.address }],
          balanceAtLeast500Since: null,
          backupCompleted: true,
        };
        if (mettalIv && mettalCiphertext) {
          next.mettalCredentials = {
            iv: bytesToBase64Url(mettalIv),
            ciphertext: bytesToBase64Url(mettalCiphertext),
          };
          next.mettalConnected = true;
        }
        return next;
      } finally {
        wipeBytes(encrypted.iv);
        wipeBytes(encrypted.ciphertext);
      }
    },
  );

  return commitDeviceSecrets(updated);
}
