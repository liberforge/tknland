# Agent instructions

## IndexedDB is disposable on iPhone Safari

Safari on iPhone deletes script-writable storage after 7 days of Safari use with no tap or keypress. The clock counts days Safari is actually used, not calendar days. Scrolling does not count. The deletion includes IndexedDB, localStorage, sessionStorage, and service-worker caches.

`navigator.storage.persist()` does not exempt the site. A Home Screen web app is a separate storage area and is exempt; a Safari tab is not.

The database `tknland` is a local cache:

- `vaults` and `meta` keep the encrypted blob, the address, the passkey id, the fixed PRF salt, and UI flags. Read Upstash only when `iv` and `ciphertext` are missing, then store that blob again. The salt is not a secret. The plaintext seed never goes in IndexedDB.
- Restoring a phrase from the menu, on an empty wallet, replaces that wallet's blob in Upstash and in this cache. It keeps the same passkey.
- `intents` is the only copy of an in-progress payment handshake. A wipe drops it. Do not describe those rows as a cache of the server.

The durable copy of the encrypted seed and the Mettal key is the Upstash row keyed by the passkey id. The passkey PRF decrypts it on the device. Every change writes Upstash and replaces the local blob in the same step.

The mock at `http://127.0.0.1` has no server row. Its encrypted payload stays in IndexedDB with `storage: "idb"`.
