export type VaultAccount = {
  path: string;
  address: string;
};

export type EncryptedMettalCredentials = {
  iv: string;
  ciphertext: string;
};

export type DeviceVaultRecord = {
  id: string;
  type: "device";
  label: string;
  credentialId: string;
  /** Also inside the passkey blob. Kept here so one biometric prompt can read it. */
  prfSalt: string;
  /**
   * Encrypted seed. Omitted once the passkey blob is the copy that survives
   * the browser deleting site data.
   */
  iv?: string;
  ciphertext?: string;
  accounts: VaultAccount[];
  backupCompleted: boolean;
  balanceAtLeast500Since: number | null;
  /** `largeBlob` is the passkey copy. `idb` means that write has not succeeded yet. */
  storage?: "largeBlob" | "idb";
  mettalCredentials?: EncryptedMettalCredentials;
  /** The passkey blob has a Mettal API key. Set without storing that key here. */
  mettalConnected?: boolean;
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
