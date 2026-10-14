import type { AppMeta, DeviceVaultRecord, VaultRecord } from "@/lib/vault/types";
import type { PaymentIntent } from "@/lib/protocol/types";

const DB_NAME = "tknland";
const DB_VERSION = 2;
const VAULTS = "vaults";
const META = "meta";
const INTENTS = "intents";
const META_KEY = "app";

let queue: Promise<void> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => {
      reject(req.error ?? new Error("No se pudo abrir IndexedDB"));
    };
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

/**
 * iOS home-screen web apps drop a long-lived IndexedDB connection when the
 * screen locks, and the last write never reaches disk. Open, commit, and
 * close on every call so the write is finished before the app is frozen.
 */
function runTx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return enqueue(async () => {
    const db = await openDb();
    try {
      return await new Promise<T>((resolve, reject) => {
        let settled = false;
        const finish = (settle: () => void) => {
          if (settled) return;
          settled = true;
          try {
            db.close();
          } catch {
            // Already closed.
          }
          settle();
        };

        const tx = db.transaction(storeName, mode);
        const req = run(tx.objectStore(storeName));
        let value: T;
        let gotValue = false;
        req.onsuccess = () => {
          value = req.result;
          gotValue = true;
        };
        req.onerror = () => {
          finish(() =>
            reject(req.error ?? new Error("Falló la solicitud de IndexedDB")),
          );
        };
        tx.oncomplete = () => {
          finish(() => {
            if (!gotValue) {
              reject(new Error("La transacción de IndexedDB no devolvió datos"));
              return;
            }
            resolve(value);
          });
        };
        tx.onabort = () => {
          finish(() =>
            reject(tx.error ?? new Error("La transacción de IndexedDB se abortó")),
          );
        };
        tx.onerror = () => {
          finish(() =>
            reject(tx.error ?? new Error("Falló la transacción de IndexedDB")),
          );
        };

        if (mode === "readwrite") {
          try {
            tx.commit();
          } catch {
            // Already committing or finished.
          }
        }
      });
    } catch (err) {
      try {
        db.close();
      } catch {
        // Already closed.
      }
      throw err;
    }
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

export type PutVaultOptions = {
  /** Omit mettal credentials on purpose (disconnect), instead of keeping the stored ones. */
  replaceMettalCredentials?: boolean;
};

/**
 * Partial updates spread an in-memory vault that may predate the Mettal
 * connection. Keep credentials and the keychain flag already on disk unless
 * this write sets them explicitly.
 */
export async function putVault(
  vault: VaultRecord,
  options?: PutVaultOptions,
): Promise<VaultRecord> {
  let next: VaultRecord = vault;
  if (vault.type === "device") {
    const existing = await getVault(vault.id);
    if (existing?.type === "device") {
      const merged: DeviceVaultRecord = { ...existing, ...vault };
      if (
        !options?.replaceMettalCredentials &&
        !vault.mettalCredentials &&
        existing.mettalCredentials
      ) {
        merged.mettalCredentials = existing.mettalCredentials;
      }
      if (options?.replaceMettalCredentials && !vault.mettalCredentials) {
        delete merged.mettalCredentials;
      }
      if (!vault.storage && existing.storage) {
        merged.storage = existing.storage;
      }
      next = merged;
    }
  }
  await runTx(VAULTS, "readwrite", (store) => store.put(next));
  return next;
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
