import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { aesKeyFromPrf, decryptUtf8 } from "@/lib/crypto/aes";
import {
  assertPasskeyWithPrf,
  canImmediateGet,
  createPasskeyWithPrf,
  formatCredentialId,
  parseCredentialId,
  WebAuthnCancelled,
  wipePrfOutput,
} from "@/lib/webauthn/prf";
import {
  getMeta,
  putVault,
  requestPersistentStorage,
  setMeta,
} from "@/lib/vault/db";
import { restoreVaultFromPasskey } from "@/lib/vault/passkey-store";
import {
  decryptPayload,
  encryptPayload,
  parsePayloadJson,
  type VaultPayload,
} from "@/lib/vault/payload";
import { VAULT_PRF_SALT } from "@/lib/vault/prf-salt";
import {
  createRemoteVault,
  fetchChallengeBytes,
  fetchRemoteBlob,
  updateRemoteVault,
} from "@/lib/vault/remote-vault";
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

export class AccountChoiceRequired extends Error {
  constructor() {
    super("Elige si ya tienes una cuenta o quieres crear una.");
    this.name = "AccountChoiceRequired";
  }
}

function newVaultId(): string {
  return bytesToBase64Url(randomBytes(16));
}

function saltBytes(): Uint8Array {
  return VAULT_PRF_SALT.slice();
}

export function normalizeMnemonic(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/,/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function usesServer(vault: DeviceVaultRecord): boolean {
  return !isMockBiometrics() && vault.storage === "server";
}

function cacheFields(blob: Uint8Array): { iv: string; ciphertext: string } {
  return {
    iv: bytesToBase64Url(blob.slice(0, 12)),
    ciphertext: bytesToBase64Url(blob.slice(12)),
  };
}

type VaultSession = {
  aesKey: CryptoKey;
  payload: VaultPayload;
  commit: (
    next: VaultPayload,
    patch?: Partial<
      Pick<
        DeviceVaultRecord,
        "accounts" | "backupCompleted" | "balanceAtLeast500Since" | "label"
      >
    >,
  ) => Promise<DeviceVaultRecord>;
};

async function payloadFromLocal(
  vault: DeviceVaultRecord,
  aesKey: CryptoKey,
): Promise<VaultPayload> {
  if (!vault.iv || !vault.ciphertext) {
    throw new Error("El llavero no tiene una billetera.");
  }
  const seedText = await decryptUtf8(
    {
      iv: base64UrlToBytes(vault.iv),
      ciphertext: base64UrlToBytes(vault.ciphertext),
    },
    aesKey,
  );
  const parsed = parsePayloadJson(seedText);
  if (parsed) return parsed;

  let mettal: VaultPayload["mettal"];
  if (vault.mettalCredentials) {
    try {
      const mettalText = await decryptUtf8(
        {
          iv: base64UrlToBytes(vault.mettalCredentials.iv),
          ciphertext: base64UrlToBytes(vault.mettalCredentials.ciphertext),
        },
        aesKey,
      );
      mettal = parsePayloadJson(
        JSON.stringify({ v: 1, seed: "seed", mettal: JSON.parse(mettalText) as unknown }),
      )?.mettal;
    } catch {
      mettal = undefined;
    }
  }
  return { v: 1, seed: seedText, mettal };
}

async function storePayload(
  vault: DeviceVaultRecord,
  aesKey: CryptoKey,
  next: VaultPayload,
  patch: Partial<DeviceVaultRecord> | undefined,
  assertion: Record<string, unknown> | null,
): Promise<DeviceVaultRecord> {
  const blob = await encryptPayload(next, aesKey);
  try {
    const mettalConnected = next.mettal != null;
    if (usesServer(vault)) {
      if (!assertion) {
        throw new Error("No se pudo autorizar el guardado.");
      }
      await updateRemoteVault(assertion, blob);
      const updated: DeviceVaultRecord = {
        ...vault,
        ...patch,
        ...cacheFields(blob),
        storage: "server",
        mettalConnected,
      };
      delete updated.mettalCredentials;
      const stored = await putVault(updated, { replaceMettalCredentials: true });
      return stored.type === "device" ? stored : updated;
    }

    const record: DeviceVaultRecord = {
      ...vault,
      ...patch,
      storage: "idb",
      iv: bytesToBase64Url(blob.slice(0, 12)),
      ciphertext: bytesToBase64Url(blob.slice(12)),
      mettalConnected,
    };
    delete record.mettalCredentials;
    const stored = await putVault(record, { replaceMettalCredentials: true });
    return stored.type === "device" ? stored : record;
  } finally {
    wipeBytes(blob);
  }
}

async function rememberVault(vault: DeviceVaultRecord): Promise<DeviceVaultRecord> {
  const stored = await putVault(vault);
  const saved = stored.type === "device" ? stored : vault;
  await setMeta({
    credentialId: saved.credentialId,
    activeVaultId: saved.id,
  });
  return saved;
}

async function publishNewVault(
  mnemonic: string,
  options: { backupCompleted: boolean },
): Promise<DeviceVaultRecord> {
  await requestPersistentStorage();
  const prfSalt = saltBytes();
  let prfOutput: Uint8Array | null = null;
  let credentialId: Uint8Array | null = null;
  let blob: Uint8Array | null = null;

  try {
    const account = deriveEvmAccountFromMnemonic(
      mnemonic,
      DEFAULT_EVM_ACCOUNT_PATH,
    );
    const payload: VaultPayload = { v: 1, seed: mnemonic };

    if (isMockBiometrics()) {
      const passkey = await createPasskeyWithPrf(prfSalt, new Uint8Array(32));
      prfOutput = passkey.prfOutput;
      credentialId = passkey.credentialId;
      const aesKey = await aesKeyFromPrf(prfOutput);
      wipePrfOutput(prfOutput);
      prfOutput = null;
      blob = await encryptPayload(payload, aesKey);
      const vault: DeviceVaultRecord = {
        id: newVaultId(),
        type: "device",
        label: "Personal",
        credentialId: formatCredentialId(credentialId),
        prfSalt: bytesToBase64Url(VAULT_PRF_SALT),
        ...cacheFields(blob),
        accounts: [
          { path: DEFAULT_EVM_ACCOUNT_PATH, address: account.address },
        ],
        backupCompleted: options.backupCompleted,
        balanceAtLeast500Since: null,
        storage: "idb",
      };
      return rememberVault(vault);
    }

    const challenge = await fetchChallengeBytes();
    const passkey = await createPasskeyWithPrf(prfSalt, challenge);
    prfOutput = passkey.prfOutput;
    credentialId = passkey.credentialId;
    const aesKey = await aesKeyFromPrf(prfOutput);
    wipePrfOutput(prfOutput);
    prfOutput = null;
    blob = await encryptPayload(payload, aesKey);
    await createRemoteVault(passkey.registration, blob);

    const vault: DeviceVaultRecord = {
      id: newVaultId(),
      type: "device",
      label: "Personal",
      credentialId: formatCredentialId(credentialId),
      prfSalt: bytesToBase64Url(VAULT_PRF_SALT),
      ...cacheFields(blob),
      accounts: [
        { path: DEFAULT_EVM_ACCOUNT_PATH, address: account.address },
      ],
      backupCompleted: options.backupCompleted,
      balanceAtLeast500Since: null,
      storage: "server",
    };
    return rememberVault(vault);
  } finally {
    wipeBytes(prfSalt);
    if (prfOutput) wipePrfOutput(prfOutput);
    if (credentialId) wipeBytes(credentialId);
    if (blob) wipeBytes(blob);
  }
}

/**
 * Create the first device vault: passkey + PRF → encrypt the seed → Upstash.
 * The mnemonic is not returned.
 */
export async function createInitialDeviceVault(): Promise<DeviceVaultRecord> {
  return publishNewVault(generateMnemonic(wordlist, 128), {
    backupCompleted: false,
  });
}

/**
 * Unlock the passkey already on this device. IndexedDB is not required.
 * Closing the sheet does not create a wallet.
 */
export async function restoreDeviceVault(): Promise<DeviceVaultRecord> {
  const existing = await restoreVaultFromPasskey();
  if (!existing) {
    throw new Error("Esa clave de acceso no tiene una billetera guardada.");
  }
  return existing;
}

/** A new passkey and a new wallet. Does not look for an existing passkey. */
export async function createNewDeviceVault(): Promise<DeviceVaultRecord> {
  return createInitialDeviceVault();
}

/**
 * Browsers that can fail a passkey lookup with no sheet: open the passkey,
 * or create one when that lookup says there is none. Dismissing the prompt
 * does not create a second wallet.
 */
export async function openOrCreateDeviceVault(): Promise<DeviceVaultRecord> {
  if (isMockBiometrics()) return createInitialDeviceVault();
  if (!canImmediateGet()) throw new AccountChoiceRequired();

  const started = performance.now();
  try {
    const existing = await restoreVaultFromPasskey({ immediate: true });
    if (existing) return existing;
    throw new Error("No encontramos una billetera en este dispositivo.");
  } catch (err) {
    const emptyKeychain =
      err instanceof WebAuthnCancelled &&
      performance.now() - started < EMPTY_KEYCHAIN_MS;
    if (!emptyKeychain) throw err;
  }

  return createInitialDeviceVault();
}

/**
 * One biometric prompt. The encrypted blob in IndexedDB is a cache.
 * Upstash is read only when that cache is missing, then the cache is filled.
 */
export async function withDeviceVaultSecrets<T>(
  vault: DeviceVaultRecord,
  use: (secrets: VaultSession) => Promise<T> | T,
  options?: { write?: boolean },
): Promise<T> {
  const server = usesServer(vault);
  const credentialId = parseCredentialId(vault.credentialId);
  const prfSalt = vault.prfSalt ? base64UrlToBytes(vault.prfSalt) : saltBytes();
  let prfOutput: Uint8Array | null = null;
  let payload: VaultPayload | null = null;
  let remoteBlob: Uint8Array | null = null;
  const hasLocalBlob = Boolean(vault.iv && vault.ciphertext);

  try {
    const challenge =
      options?.write && server ? await fetchChallengeBytes() : undefined;
    const asserted = await assertPasskeyWithPrf({
      credentialId,
      prfSalt,
      challenge,
    });
    prfOutput = asserted.prfOutput;
    const aesKey = await aesKeyFromPrf(prfOutput);
    wipePrfOutput(prfOutput);
    prfOutput = null;

    if (hasLocalBlob) {
      try {
        payload = await payloadFromLocal(vault, aesKey);
      } catch (err) {
        if (err instanceof WebAuthnCancelled) throw err;
        payload = null;
      }
    }

    if (!payload) {
      if (!server) {
        throw new Error("No se pudo abrir la billetera guardada.");
      }
      remoteBlob = await fetchRemoteBlob(vault.credentialId);
      if (!remoteBlob) {
        throw new Error("Esa clave de acceso no tiene una billetera guardada.");
      }
      try {
        payload = await decryptPayload(remoteBlob, aesKey);
      } catch (err) {
        if (err instanceof WebAuthnCancelled) throw err;
        throw new Error("No se pudo abrir la billetera guardada.");
      }
      const cached: DeviceVaultRecord = {
        ...vault,
        ...cacheFields(remoteBlob),
        storage: server ? "server" : vault.storage,
        mettalConnected: payload.mettal != null,
      };
      delete cached.mettalCredentials;
      const stored = await putVault(cached, { replaceMettalCredentials: true });
      if (stored.type === "device") {
        vault.iv = stored.iv;
        vault.ciphertext = stored.ciphertext;
        vault.storage = stored.storage;
        vault.mettalConnected = stored.mettalConnected;
      }
    }

    const assertion = options?.write && server ? asserted.assertion : null;
    return await use({
      aesKey,
      payload,
      commit: (next, patch) =>
        storePayload(vault, aesKey, next, patch, assertion),
    });
  } finally {
    wipeBytes(credentialId);
    wipeBytes(prfSalt);
    if (prfOutput) wipePrfOutput(prfOutput);
    if (remoteBlob) wipeBytes(remoteBlob);
    if (payload) {
      payload.seed = "";
      if (payload.mettal) {
        payload.mettal = { type: "mettal.api_key", key: "", secret: "" };
      }
    }
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
    return await withDeviceVaultSecrets(vault, async ({ payload }) => {
      mnemonic = payload.seed;
      return await useSeed(mnemonic);
    });
  } finally {
    mnemonic = null;
  }
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

/**
 * Replace the stored seed with a phrase the user already saved.
 * The passkey stays; the encrypted payload and its address change.
 */
export async function replaceDeviceVaultMnemonic(
  vault: DeviceVaultRecord,
  rawMnemonic: string,
): Promise<DeviceVaultRecord> {
  const mnemonic = normalizeMnemonic(rawMnemonic);
  if (!mnemonic || !validateMnemonic(mnemonic, wordlist)) {
    throw new Error(
      "La frase secreta no es válida. Revisa las palabras y el orden.",
    );
  }

  const account = deriveEvmAccountFromMnemonic(mnemonic, DEFAULT_EVM_ACCOUNT_PATH);
  if (!account.address) {
    throw new Error("Esa frase no produce una cuenta.");
  }

  return withDeviceVaultSecrets(
    vault,
    ({ payload, commit }) =>
      commit(
        { ...payload, seed: mnemonic },
        {
          accounts: [
            { path: DEFAULT_EVM_ACCOUNT_PATH, address: account.address },
          ],
          balanceAtLeast500Since: null,
          backupCompleted: true,
        },
      ),
    { write: true },
  );
}
