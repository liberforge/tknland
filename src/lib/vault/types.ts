export type VaultAccount = {
  path: string;
  address: string;
};

export type DeviceVaultRecord = {
  id: string;
  type: "device";
  label: string;
  credentialId: string;
  prfSalt: string;
  iv: string;
  ciphertext: string;
  accounts: VaultAccount[];
  backupCompleted: boolean;
  balanceAtLeast500Since: number | null;
};

export type ColdVaultRecord = {
  id: string;
  type: "cold";
  label: string;
  accounts: VaultAccount[];
};

export type VaultRecord = DeviceVaultRecord | ColdVaultRecord;

export type AppMeta = {
  /** Shared platform passkey for all device vaults on this origin. */
  credentialId: string | null;
  activeVaultId: string | null;
};
