import { base64UrlToBytes, bytesToBase64Url, wipeBytes } from "@/lib/bytes";
import { aesKeyFromPrf } from "@/lib/crypto/aes";
import { getVault, listVaults, putVault, setMeta } from "@/lib/vault/db";
import { deriveEvmAccountFromMnemonic } from "@/lib/vault/evm";
import { decryptPayload } from "@/lib/vault/payload";
import { VAULT_PRF_SALT } from "@/lib/vault/prf-salt";
import { fetchRemoteVault } from "@/lib/vault/remote-vault";
import type { DeviceVaultRecord } from "@/lib/vault/types";
import {
  WebAuthnCancelled,
  assertPasskeyWithPrf,
  formatCredentialId,
  isMockBiometrics,
  wipePrfOutput,
} from "@/lib/webauthn/prf";

const PRIMARY_ACCOUNT_PATH = "m/44'/60'/0'/0/0";

/**
 * Face ID → PRF → open the cached ciphertext, or download it once when missing.
 * The download replaces the local cache.
 */
export async function restoreVaultFromPasskey(options?: {
  immediate?: boolean;
}): Promise<DeviceVaultRecord | null> {
  if (isMockBiometrics()) return null;

  const prfSalt = VAULT_PRF_SALT.slice();
  let prfOutput: Uint8Array | null = null;
  let blob: Uint8Array | null = null;

  try {
    const asserted = await assertPasskeyWithPrf({
      prfSalt,
      immediate: options?.immediate,
    });
    prfOutput = asserted.prfOutput;
    const credentialId = formatCredentialId(asserted.credentialId);
    const vaults = await listVaults();
    const previous = vaults.find(
      (vault) => vault.type === "device" && vault.credentialId === credentialId,
    );
    const previousDevice = previous?.type === "device" ? previous : null;
    const storedById = previousDevice ? await getVault(previousDevice.id) : undefined;
    const prior = storedById?.type === "device" ? storedById : previousDevice;

    const aesKey = await aesKeyFromPrf(prfOutput);
    wipePrfOutput(prfOutput);
    prfOutput = null;

    let payload = null;
    let passkeyPublicKey = prior?.passkeyPublicKey;
    let remoteVaultSeen = prior?.remoteVaultSeen === true;
    if (prior?.iv && prior.ciphertext) {
      const iv = base64UrlToBytes(prior.iv);
      const ciphertext = base64UrlToBytes(prior.ciphertext);
      blob = new Uint8Array(iv.length + ciphertext.length);
      blob.set(iv, 0);
      blob.set(ciphertext, iv.length);
      try {
        payload = await decryptPayload(blob, aesKey);
      } catch (err) {
        if (err instanceof WebAuthnCancelled) throw err;
        payload = null;
        wipeBytes(blob);
        blob = null;
      }
    }
    if (!payload) {
      const remote = await fetchRemoteVault(credentialId);
      blob = remote?.blob ?? null;
      if (!blob) {
        throw new Error("Esa clave de acceso no tiene una billetera guardada.");
      }
      if (remote?.publicKey) passkeyPublicKey = remote.publicKey;
      remoteVaultSeen = true;
      try {
        payload = await decryptPayload(blob, aesKey);
      } catch (err) {
        if (err instanceof WebAuthnCancelled) throw err;
        throw new Error("No se pudo abrir la billetera guardada.");
      }
    }

    if (!payload || !blob) {
      throw new Error("Esa clave de acceso no tiene una billetera guardada.");
    }

    const account = deriveEvmAccountFromMnemonic(payload.seed, PRIMARY_ACCOUNT_PATH);
    const vault: DeviceVaultRecord = {
      id: prior?.id ?? bytesToBase64Url(asserted.credentialId.slice(0, 16)),
      type: "device",
      label: prior?.label ?? "Personal",
      credentialId,
      prfSalt: bytesToBase64Url(VAULT_PRF_SALT),
      iv: bytesToBase64Url(blob.slice(0, 12)),
      ciphertext: bytesToBase64Url(blob.slice(12)),
      accounts: [
        { path: PRIMARY_ACCOUNT_PATH, address: account.address },
      ],
      backupCompleted: prior?.backupCompleted ?? false,
      balanceAtLeast500Since: prior?.balanceAtLeast500Since ?? null,
      storage: "server",
      mettalConnected: payload.mettal != null || prior?.mettalConnected === true,
      ...(passkeyPublicKey ? { passkeyPublicKey } : {}),
      ...(remoteVaultSeen ? { remoteVaultSeen: true as const } : {}),
    };

    const stored = await putVault(vault, { replaceMettalCredentials: true });
    if (stored.type !== "device") return vault;
    await setMeta({
      credentialId: stored.credentialId,
      activeVaultId: stored.id,
    });
    return stored;
  } finally {
    wipeBytes(prfSalt);
    if (prfOutput) wipePrfOutput(prfOutput);
    if (blob) wipeBytes(blob);
  }
}
