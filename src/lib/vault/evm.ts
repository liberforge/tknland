import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { bytesToHex } from "viem";
import { wipeBytes } from "@/lib/bytes";
import { putVault } from "@/lib/vault/db";
import type { DeviceVaultRecord, VaultAccount } from "@/lib/vault/types";

/** First EVM account path (Base / Ethereum). */
export const DEFAULT_EVM_ACCOUNT_PATH = "m/44'/60'/0'/0/0";

export function deriveEvmAccountFromMnemonic(
  mnemonic: string,
  path: string = DEFAULT_EVM_ACCOUNT_PATH,
): PrivateKeyAccount {
  const seed = mnemonicToSeedSync(mnemonic);
  try {
    const root = HDKey.fromMasterSeed(seed);
    const child = root.derive(path);
    if (!child.privateKey) {
      throw new Error("No se pudo derivar la clave de la billetera.");
    }
    const privateKey = bytesToHex(child.privateKey);
    return privateKeyToAccount(privateKey);
  } finally {
    wipeBytes(seed);
  }
}

/** Returns vault account at index 0, deriving and persisting it when missing. */
export async function ensurePrimaryEvmAccount(
  vault: DeviceVaultRecord,
  mnemonic: string,
): Promise<{ vault: DeviceVaultRecord; account: VaultAccount; signer: PrivateKeyAccount }> {
  const existing = vault.accounts[0];
  const signer = deriveEvmAccountFromMnemonic(
    mnemonic,
    existing?.path ?? DEFAULT_EVM_ACCOUNT_PATH,
  );

  if (existing?.address.toLowerCase() === signer.address.toLowerCase()) {
    return { vault, account: existing, signer };
  }

  const account: VaultAccount = {
    path: existing?.path ?? DEFAULT_EVM_ACCOUNT_PATH,
    address: signer.address,
  };
  const updated: DeviceVaultRecord = {
    ...vault,
    accounts: [account, ...vault.accounts.slice(1)],
  };
  await putVault(updated);
  return { vault: updated, account, signer };
}

/** Public address only — no biometric when already persisted. */
export function getPrimaryAddress(
  vault: DeviceVaultRecord,
): `0x${string}` | null {
  const address = vault.accounts[0]?.address;
  if (!address) return null;
  return address as `0x${string}`;
}
