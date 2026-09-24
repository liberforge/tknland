import type { AppMeta, VaultRecord } from "@/lib/vault/types";
import type { PaymentIntent } from "@/lib/protocol/types";

const DB_NAME = "tknland";
const DB_VERSION = 2;
const VAULTS = "vaults";
const META = "meta";
const INTENTS = "intents";
const META_KEY = "app";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error("No se pudo abrir IndexedDB"));
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
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

  return dbPromise;
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error("Falló la solicitud de IndexedDB"));
  });
}

/**
 * Safari aborts a transaction if the database is closed before `complete`,
 * and iOS freezes the page as soon as the user leaves. Wait for the commit
 * (and ask for it immediately) so the write is on disk before that happens.
 */
function runTx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then((db) => {
    const tx = db.transaction(storeName, mode);
    const committed = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(tx.error ?? new Error("La transacción de IndexedDB se abortó"));
      tx.onerror = () =>
        reject(tx.error ?? new Error("Falló la transacción de IndexedDB"));
    });

    const result = idbReq(run(tx.objectStore(storeName)));

    if (mode === "readwrite") {
      try {
        tx.commit();
      } catch {
        // Already committing or finished.
      }
    }

    return Promise.all([result, committed]).then(([value]) => value);
  });
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function getMeta(): Promise<AppMeta> {
  const value = await runTx<AppMeta | undefined>(META, "readonly", (store) =>
    store.get(META_KEY),
  );
  return value ?? { credentialId: null, activeVaultId: null };
}

export async function setMeta(meta: AppMeta): Promise<void> {
  await runTx(META, "readwrite", (store) => store.put(meta, META_KEY));
}

export async function listVaults(): Promise<VaultRecord[]> {
  return runTx(VAULTS, "readonly", (store) => store.getAll());
}

export async function getVault(id: string): Promise<VaultRecord | undefined> {
  return runTx(VAULTS, "readonly", (store) => store.get(id));
}

export async function putVault(vault: VaultRecord): Promise<void> {
  await runTx(VAULTS, "readwrite", (store) => store.put(vault));
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
  return runTx(INTENTS, "readonly", (store) => store.get(id));
}

export async function putIntent(intent: PaymentIntent): Promise<void> {
  await runTx(INTENTS, "readwrite", (store) => store.put(intent));
}

export async function listIntents(): Promise<PaymentIntent[]> {
  return runTx(INTENTS, "readonly", (store) => store.getAll());
}
