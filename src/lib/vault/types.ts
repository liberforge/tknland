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
  /** Fixed app salt. Not a secret. Present so this cache can run PRF after a reload. */
  prfSalt: string;
  /**
   * Cached ciphertext (`iv || AES-GCM payload`). Missing after Safari deletes
   * site data; the next unlock downloads it from Upstash and stores it again.
   */
  iv?: string;
  ciphertext?: string;
  accounts: VaultAccount[];
  backupCompleted: boolean;
  balanceAtLeast500Since: number | null;
  /**
   * `server` is the Upstash ciphertext. `idb` is the local mock (or an older
   * device copy). `largeBlob` is an older passkey that never received the seed.
   */
  storage?: "server" | "idb" | "largeBlob";
  mettalCredentials?: EncryptedMettalCredentials;
  /** The encrypted blob in this cache includes a Mettal API key. */
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
