import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { aesKeyFromPrf, decryptUtf8, encryptUtf8 } from "@/lib/crypto/aes";
import {
  assertPasskeyWithPrf,
  createPasskeyWithPrf,
  formatCredentialId,
  parseCredentialId,
  wipePrfOutput,
} from "@/lib/webauthn/prf";
import {
  getMeta,
  putVault,
  requestPersistentStorage,
  setMeta,
} from "@/lib/vault/db";
import type { DeviceVaultRecord } from "@/lib/vault/types";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  randomBytes,
  wipeBytes,
} from "@/lib/bytes";

function newVaultId(): string {
  return bytesToBase64Url(randomBytes(16));
}

/**
 * Create the first device vault: passkey + PRF → encrypt mnemonic → IndexedDB.
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

    await putVault(vault);
    await setMeta({
      credentialId: vault.credentialId,
      activeVaultId: vault.id,
    });

    wipeBytes(iv);
    wipeBytes(ciphertext);
    return vault;
  } finally {
    wipeBytes(prfSalt);
    if (prfOutput) wipePrfOutput(prfOutput);
    if (credentialId) wipeBytes(credentialId);
  }
}

/**
 * Per-action ceremony: biometric → PRF → derive the vault key → use.
 */
export async function withDeviceVaultKey<T>(
  vault: DeviceVaultRecord,
  useKey: (key: CryptoKey) => Promise<T> | T,
): Promise<T> {
  const credentialId = parseCredentialId(vault.credentialId);
  const prfSalt = base64UrlToBytes(vault.prfSalt);
  let prfOutput: Uint8Array | null = null;

  try {
    prfOutput = await assertPasskeyWithPrf({ credentialId, prfSalt });
    const aesKey = await aesKeyFromPrf(prfOutput);
    wipePrfOutput(prfOutput);
    prfOutput = null;
    return await useKey(aesKey);
  } finally {
    wipeBytes(credentialId);
    wipeBytes(prfSalt);
    if (prfOutput) wipePrfOutput(prfOutput);
  }
}

/**
 * Per-action ceremony: biometric → PRF → decrypt seed → use → wipe.
 */
export async function withDeviceVaultSeed<T>(
  vault: DeviceVaultRecord,
  useSeed: (mnemonic: string) => Promise<T> | T,
): Promise<T> {
  let mnemonic: string | null = null;
  const iv = base64UrlToBytes(vault.iv);
  const ciphertext = base64UrlToBytes(vault.ciphertext);

  try {
    return await withDeviceVaultKey(vault, async (aesKey) => {
      mnemonic = await decryptUtf8(
        {
          iv,
          ciphertext,
        },
        aesKey,
      );

      return await useSeed(mnemonic);
    });
  } finally {
    wipeBytes(iv);
    wipeBytes(ciphertext);
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
  await putVault(updated);
  return updated;
}

export async function hasSharedPasskey(): Promise<boolean> {
  const meta = await getMeta();
  return Boolean(meta.credentialId);
}
