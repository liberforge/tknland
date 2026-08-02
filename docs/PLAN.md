# tkn.land — Implementation Plan

> **IMPORTANT — Keep it simple first.** Default screens show only the minimum
> information needed for the user's next action. Hide security details,
> implementation terms, and explanations unless the user explicitly asks for
> them or opens an advanced view.

## Product principle — simple by default

The default experience targets users with little or no cryptocurrency
experience: no setup screens for vaults, accounts, derivation paths, or
seed-management choices. On first use, the application automatically creates
one device vault and its first account; the user confirms biometrics, then
lands on their balance with prominent **Receive** and **Send** actions. The
application creates additional accounts only when required, without exposing
the underlying mechanism.

Capabilities intended for advanced users—additional vaults and accounts, cold
vaults, import and recovery, backups, and technical detail—reside behind the
hamburger menu and/or an explicit **Advanced mode**. “Vault” and “account” are
implementation terms and are not surfaced unless an advanced workflow requires
explaining them.

tkn.land is a mobile-first progressive web application (PWA) wallet with no
backend. Users hold one or more **vaults** (each vault corresponds to one
BIP-39 seed). A biometrics-protected passkey gates decryption of **device
vaults** stored on the phone; each sensitive action re-prompts for biometrics,
signs, then discards key material immediately. **Cold vaults** never store a
seed on the device.

## Terminology

- **Vault** — one BIP-39 mnemonic (seed). The unit of backup and recovery.
- **Account** — one derived address within a vault (BIP-32 index). A vault may
  contain many accounts.
- **Device vault** — seed encrypted at rest, stored on the passkey itself
  (WebAuthn `largeBlob`) when supported; otherwise in IndexedDB.
- **Cold vault** — seed is held offline, typically as a **paper backup**, and is
  **never** persisted or entered on the everyday device. The application retains
  public metadata (labels, addresses) solely to receive funds and monitor
  balances.

## Decisions (locked)

- **Domain** — `tkn.land`
  Passkeys and storage are origin-bound to this domain.
- **Architecture** — Static SPA, no backend
  Pure client application; challenges are self-generated (used locally for PRF
  only).
- **Build tool** — Vite + `vite-plugin-pwa`
  Static output, no server runtime, fast development loop, and a smaller
  framework surface to audit.
- **UI** — React 19 + TypeScript + Tailwind CSS
  Mobile-first ergonomics.
- **Biometric protocol** — WebAuthn passkey + **PRF extension**
  Passkey-as-vault-unlock, not passkey-as-signer. **One shared passkey** unlocks
  all device vaults on this origin (not one passkey per vault).
- **Seed storage (device vaults)** — AES-256-GCM ciphertext per vault stored
  **on the passkey** via the WebAuthn **`largeBlob`** extension (Safari/iOS 17+,
  Chrome 113+ where writable); **IndexedDB as fallback** when largeBlob is
  unsupported (+ `navigator.storage.persist()`) — **except on iOS**, where the
  fallback is unsafe (7-day Safari eviction and PWA storage partitioning) and
  the application presents the incompatible-device wall instead.

  Rationale for largeBlob as primary storage: the blob resides in the credential
  store (for example, iCloud Keychain), so it is (a) shared between a Safari tab
  and the installed home-screen PWA on iOS—whose site storages are
  **partitioned** from each other, (b) exempt from Safari's 7-day
  script-storage eviction, and (c) synced across devices together with the
  passkey. IndexedDB always retains public metadata (labels, addresses, backup
  state); loss of that data is harmless. Capacity: 1 KB largeBlob limit — the
  default single vault fits (<200 B); additional vaults (Advanced mode) spill
  over to IndexedDB.
- **Key derivation** — PRF output → HKDF → AES-256-GCM key
  Deterministic, biometrics-gated, and device-local.
- **Wallet standard** — BIP-39 mnemonic + BIP-32 HD derivation
  `@scure/bip39`, `@scure/bip32`, `@noble/curves`.
  Account paths: `m/44'/60'/0'/0/i` (multiple accounts per vault).
- **Multi-vault** — Users may create or import multiple vaults and switch the
  active vault in Advanced mode; each vault maintains its own accounts and
  backup state.
- **Cold vault** — Receive-only vault for security-conscious users
  - On create: generate mnemonic, **require** write-down and quiz (paper is the
    only copy), derive account address(es), wipe seed from memory.
  - Persist only public data: `{ type: "cold", label, accounts[{ path, address }] }`.
  - **Never** write seed or ciphertext to IndexedDB (or anywhere on device).
  - Receive and watch balances normally; the user may send funds **to** a cold
    vault from a device vault (or externally).
  - The everyday PWA cannot spend from a cold vault and never requests its
    mnemonic. To spend, restore the paper backup only in a separately trusted
    environment (for example, another device or a locally verified /
    self-hosted build).
- **First chain** — **Base** (EVM, chainId 8453)
  Single secp256k1 curve; viem covers derivation, `personal_sign`, EIP-712, and
  transactions.
- **Chain library** — viem
  Lightweight, tree-shakable, and requires no backend.
- **RPC** — Ordered multi-endpoint fallback for Base/EVM (same pattern as Mettal
  `blockchain-backend-services` `createEvmTransport`: comma-separated URLs →
  viem `fallback(..., { rank: false })`). Primary endpoint e.g.
  `mainnet.base.org`, then publicnode / Alchemy / Infura as backups. The client
  communicates with RPC directly.
- **Hosting** — Begin on **Vercel Hobby** (free); migrate to **Njalla VPS** later
  if required
  Vercel: custom headers (CSP) via `vercel.json`, PR previews, and straightforward
  `tkn.land` setup. Njalla later: same static `dist/` behind Caddy/nginx with
  identical CSP (~€15/mo). Keep the application host-agnostic (static output).
  GitHub Pages was rejected: custom headers cannot be set.
- **Code hosting** — GitHub (open source)
  Vercel deploys from the repository; static output avoids vendor lock-in.
  Security-conscious users may self-host or verify release hashes (passkeys are
  origin-bound — a self-hosted origin constitutes a separate wallet identity).
- **Backup timing (device vaults only)** — Deferred forced backup
  Soft-offer backup at device-vault creation (skippable). Force backup only after
  that vault’s balance remains ≥ **$500 USD for more than 2 consecutive days**,
  then block signing and sends until mnemonic reveal and quiz complete. Optional
  early backup remains available at all times. Cold vaults require backup at
  creation (no on-device copy exists).
- **Unsupported devices** — Incompatible-device wall
  Capability check at onboarding; block device-vault create/unlock with a clear
  “device not supported” screen when:
  - PRF is unavailable (any platform). No password fallback.
  - **iOS without largeBlob**: storing ciphertext in IndexedDB is unsafe there
    (7-day Safari eviction; PWA/Safari storage partition), so largeBlob is a
    hard requirement on iOS. On other platforms, IndexedDB fallback is
    acceptable.
  Cold vaults remain available as watch/receive-only (no PRF or largeBlob
  required).
- **Key lifetime** — Per-action unlock; no session seed
  Device vault: biometric → PRF → decrypt seed → derive → use → wipe.
  Cold vault: no seed or signing operation on the everyday device. The UI may
  remain open for reads; device-vault key use never caches the seed. JavaScript
  wipe is best-effort, not HSM erase.
- **Multi-device** — Passkey sync where available; mnemonic re-import otherwise
  With largeBlob storage, the ciphertext travels with the synced passkey
  (e.g. iCloud Keychain): a second device in the same ecosystem unlocks the
  vault directly (the PRF secret syncs with the credential). Cross-ecosystem
  moves or IndexedDB-fallback vaults still restore from the BIP-39 backup and
  re-encrypt under the new device’s passkey. (Advanced / recovery flow.)

## Core architecture

The passkey never signs blockchain messages. It gates decryption of **device
vault** seeds for each sensitive action only.

1. **Create device vault**
   - Generate BIP-39 mnemonic (`@scure/bip39`).
   - Create passkey on first device vault (reuse thereafter) with
     `extensions: { prf: { eval: { first: salt } } }`, platform authenticator,
     `userVerification: "required"`.
   - Derive AES-256-GCM key: PRF output → HKDF.
   - Encrypt mnemonic; write `{ iv, ciphertext }` to the passkey **largeBlob**
     (write occurs in an assertion: PRF eval assertion first, then a
     `largeBlob: { write }` assertion — or IndexedDB first with opportunistic
     largeBlob sync on the next ceremony to keep a single biometric prompt).
   - Store metadata record `{ id, type: "device", label, credentialId, prfSalt,
     accounts[{ path, address }], backupCompleted, storage: "largeBlob"|"idb" }`
     in IndexedDB; on non-largeBlob devices the record also carries
     `{ iv, ciphertext }` (fallback).
   - Optional backup offer (skippable); wipe mnemonic from memory.

2. **Create cold vault**
   - Generate mnemonic → forced paper backup and quiz → derive accounts → wipe
     seed.
   - Store only `{ id, type: "cold", label, accounts[{ path, address }] }`.
   - No ciphertext; no passkey requirement for storage.

3. **Sign / sensitive action (per use)**
   - **Device vault:** `navigator.credentials.get()` with PRF eval +
     `largeBlob: { read: true }` (single biometric prompt) → decrypt → path
     `m/44'/60'/0'/0/i` → sign → wipe. Fallback vaults read ciphertext from
     IndexedDB instead of the blob.
   - Same rule applies to mnemonic reveal and device-vault backup quiz.
   - Cold vaults are excluded: normal PWA operations cannot sign with them.

4. **Reads (no secret material)**
   - Cached addresses are public. Balances are fetched via RPC for any
     vault/account.

5. **Deferred forced backup (device vaults)**
   - Track USD value per vault; persist `balanceAtLeast500Since`; clear if under
     $500.
   - After ≥ $500 continuous for more than 2 days and `backupCompleted: false`:
     hard-gate before further signing or sends from that vault.

## Risks and mitigations

- **Data loss is the primary risk for device vaults.** With largeBlob storage,
  the ciphertext survives site-data clearing and syncs with the passkey; losing
  IndexedDB only loses rebuildable metadata. Residual risk: deleting the
  passkey itself destroys the blob, and IndexedDB-fallback vaults retain the
  original exposure. Mitigation: deferred forced backup at ≥ $500 for more than
  2 days; restore-from-mnemonic remains the ultimate recovery path. Cold vaults
  shift this risk onto the user’s physical backup (by design).
- **iOS storage partition and Safari eviction.** An installed home-screen PWA
  has storage partitioned from Safari, and Safari-only storage is subject to the
  7-day script-storage eviction. Resolved by largeBlob-primary storage: both
  contexts reach the same passkey and blob, so links (which always open in the
  browser) and the installed application see the same vault.
- **PRF support is not universal.** Chrome/Android is solid; iOS 18+ Safari
  supports it; older iOS does not. Mitigation: unsupported-device wall for
  device vaults; cold vaults remain available.
- **largeBlob support is not universal.** Solid on Safari/iOS 17+; Chrome
  largeBlob writes with platform authenticators have been unreliable.
  Mitigation: capability check at vault creation (`largeBlob.supported`). On
  iOS, absence of largeBlob triggers the incompatible-device wall (IndexedDB is
  eviction- and partition-unsafe there). On Android and other platforms,
  IndexedDB fallback is acceptable (no partition problem, no 7-day eviction).
- **XSS is the principal attack surface** (the seed briefly exists in JavaScript
  during a ceremony). Mitigations: per-action unlock (no long-lived seed);
  strict CSP via Vercel headers; zero third-party scripts or analytics; minimal
  audited dependencies; no CDN-loaded code. Residual risk: XSS can hijack a
  ceremony (presence does not equal intent). Cold vaults reduce
  phone-compromise risk for large balances: the everyday PWA never holds or
  requests their seed. Spending requires a separate trusted environment, whose
  integrity the user must verify.

## Build order

### Milestone 1 — Installable shell
- [x] Scaffold Vite + React + TypeScript + Tailwind + `vite-plugin-pwa`.
- [x] Manifest, icons, mobile viewport (`viewport-fit=cover`), service worker.
- [x] GitHub repository + Vercel project + `tkn.land` domain + HTTPS.
- [x] Verify install-to-homescreen on Android and iOS.

### Milestone 2 — Vault core (device vault)
- [x] PRF capability detection.
- [x] Passkey creation with PRF extension.
- [x] PRF → HKDF → AES-GCM encrypt/decrypt round-trip of a test mnemonic.
- [x] IndexedDB vault records + `navigator.storage.persist()`.
- [x] Per-action ceremony: biometric → decrypt → use → wipe (no session key).

### Milestone 2b — largeBlob vault storage (iOS-safe)
Ciphertext moves onto the passkey (see Decisions → Seed storage).
- [ ] largeBlob capability detection (`support: "preferred"` at create +
  `largeBlob.supported` output check).
- [ ] Write ciphertext via `largeBlob: { write }` assertion; decide ceremony
  ordering at vault creation (extra assertion vs opportunistic sync).
- [ ] Unlock ceremony reads PRF + `largeBlob: { read }` in one prompt.
- [ ] IndexedDB fallback path when unsupported or write fails
  (`storage: "largeBlob"|"idb"` per vault record) — non-iOS only; on iOS,
  absence of largeBlob → incompatible-device wall.
- [ ] Migrate existing IndexedDB-stored vaults to largeBlob opportunistically.
- [ ] On-device iOS test: Safari tab vs installed PWA vs WhatsApp in-app
  browser (passkey + blob reachable from all three).

### Milestone 3 — Default onboarding and recovery UX
- [x] One-tap default: automatically create the initial device vault and
  account; never ask a default user to create either.
- [x] After biometric setup, land directly on balance with prominent Receive /
  Send.
- [ ] Optional (skippable) backup and verification quiz.
- [x] Unsupported-device wall when PRF is unavailable (device vaults).
- [ ] Extend the wall: iOS without largeBlob is also incompatible (see
  Milestone 2b / Decisions → Unsupported devices).
- [ ] Place restore-from-mnemonic and multi-vault management in Advanced mode.

### Milestone 4 — Accounts and Base integration
- [ ] Create additional accounts automatically when needed; expose account
  selection and management only in Advanced mode (`m/44'/60'/0'/0/i`).
- [ ] HD derivation inside the sign ceremony only.
- [ ] Read: ETH and ERC-20 balances on Base (cached addresses, no key).
- [ ] viem transport: ordered RPC URL list with `fallback` (Mettal-style).
- [ ] Sign: message, EIP-712, send transaction (biometric for device vaults).
- [ ] Send from device vault → cold vault address.

### Milestone 4b — Cold vault (Advanced mode)
- [ ] Create cold vault: forced paper-backup quiz, store addresses only, never
  persist seed.
- [ ] Watch balances; receive UI.
- [ ] Exclude cold vaults from all signing flows; explain trusted-environment
  recovery for spending.

### Milestone 4c — Deferred backup gate (device vaults)
- [ ] USD valuation per vault (price source TBD).
- [ ] Persist `balanceAtLeast500Since`; reset when value drops below $500.
- [ ] After ≥ $500 continuous for more than 2 days: hard-gate signing until
  backup quiz is complete.
- [ ] Settings: backup anytime before the gate (biometric → reveal).

### Milestone 4d — Handshake send/request flows
See `docs/SEND-PROTOCOL.md`. No new contracts; plain transfers + `FeeContract`.
- [ ] Link parsing and generation for `invite` / `pay` / `receipt` (fragment
  params).
- [ ] Local intent store: create, match reply by `id`, replay guard, expiry.
- [ ] Send flow UI: invite share → pay-reply confirm (verify id/amount) →
  receipt share.
- [ ] Solicit flow UI: request amount → `pay` link share.
- [ ] Never persist contact→address mappings (labels and transaction hash only).
- [ ] Verify link flow end-to-end on iOS (largeBlob makes Safari and the
  installed PWA equivalent — see Milestone 2b; no handoff required).

### Milestone 5 — Hardening
- [ ] CSP and security headers in `vercel.json` (HSTS, `Permissions-Policy`,
  etc.).
- [ ] Dependency audit; pin versions.
- [ ] Memory hygiene: zero/clear buffers after every ceremony; avoid string
  copies of secrets.
- [ ] Documentation: self-host / verify release hashes for security-conscious
  users.
