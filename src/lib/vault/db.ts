import type { AppMeta, VaultRecord } from "@/lib/vault/types";
import type { PaymentIntent } from "@/lib/protocol/types";

const DB_NAME = "tknland";
const DB_VERSION = 2;
const VAULTS = "vaults";
const META = "meta";
const INTENTS = "intents";
const META_KEY = "app";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () =>
      reject(req.error ?? new Error("No se pudo abrir IndexedDB"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(VAULTS)) {
        db.createObjectStore(VAULTS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META);
      }
      if (!db.objectStoreNames.contains(INTENTS)) {
        db.createObjectStore(INTENTS, { keyPath: "id" });
      }
    };
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error("Falló la solicitud de IndexedDB"));
  });
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function getMeta(): Promise<AppMeta> {
  const db = await openDb();
  try {
    const tx = db.transaction(META, "readonly");
    const value = await idbReq<AppMeta | undefined>(
      tx.objectStore(META).get(META_KEY),
    );
    return value ?? { credentialId: null, activeVaultId: null };
  } finally {
    db.close();
  }
}

export async function setMeta(meta: AppMeta): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(META, "readwrite");
    await idbReq(tx.objectStore(META).put(meta, META_KEY));
  } finally {
    db.close();
  }
}

export async function listVaults(): Promise<VaultRecord[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(VAULTS, "readonly");
    return await idbReq(tx.objectStore(VAULTS).getAll());
  } finally {
    db.close();
  }
}

export async function getVault(id: string): Promise<VaultRecord | undefined> {
  const db = await openDb();
  try {
    const tx = db.transaction(VAULTS, "readonly");
    return await idbReq(tx.objectStore(VAULTS).get(id));
  } finally {
    db.close();
  }
}

export async function putVault(vault: VaultRecord): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(VAULTS, "readwrite");
    await idbReq(tx.objectStore(VAULTS).put(vault));
  } finally {
    db.close();
  }
}

export async function getActiveDeviceVault(): Promise<
  import("@/lib/vault/types").DeviceVaultRecord | null
> {
  const [meta, vaults] = await Promise.all([getMeta(), listVaults()]);
  const devices = vaults.filter((v) => v.type === "device");
  if (devices.length === 0) return null;
  if (meta.activeVaultId) {
    const active = devices.find((v) => v.id === meta.activeVaultId);
    if (active) return active;
  }
  return devices[0] ?? null;
}

export async function getIntent(
  id: string,
): Promise<PaymentIntent | undefined> {
  const db = await openDb();
  try {
    const tx = db.transaction(INTENTS, "readonly");
    return await idbReq<PaymentIntent | undefined>(
      tx.objectStore(INTENTS).get(id),
    );
  } finally {
    db.close();
  }
}

export async function putIntent(intent: PaymentIntent): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(INTENTS, "readwrite");
    await idbReq(tx.objectStore(INTENTS).put(intent));
  } finally {
    db.close();
  }
}

export async function listIntents(): Promise<PaymentIntent[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(INTENTS, "readonly");
    return await idbReq(tx.objectStore(INTENTS).getAll());
  } finally {
    db.close();
  }
}
