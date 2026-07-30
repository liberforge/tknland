# tkn.land — Implementation Plan

## Product principle — simple by default

The default experience is for a crypto-inexperienced normies: no setup
screens for vaults, accounts, derivation paths, or seed-management choices.
On first use, the app automatically creates one device vault and its first
account; the user confirms biometrics, then sees their balance with prominent
**Receive** and **Send** actions. The app creates additional accounts only when
needed, without exposing the mechanism.

Anything aimed at advanced users—additional vaults/accounts, cold vaults,
import/recovery, backups, and technical details—lives behind the hamburger menu
and/or an explicit **Advanced mode**. “Vault” and “account” are implementation
terms unless an advanced workflow requires explaining them.

A mobile-first PWA wallet. No backend. Users hold one or more **vaults** (each
vault = one BIP-39 seed). A biometrics-protected passkey gates decryption of
**device vaults** stored on-phone; each sensitive action re-prompts biometrics,
signs, then discards key material immediately. **Cold vaults** never store a
seed on the device.

## Terminology

- **Vault** — one BIP-39 mnemonic (seed). The unit of backup and recovery.
- **Account** — one derived address inside a vault (BIP-32 index). A vault can
  have many accounts.
- **Device vault** — seed encrypted at rest on the phone (IndexedDB).
- **Cold vault** — seed is held offline, normally as a **paper backup**, and is
  **never** persisted or entered on the everyday device. The app keeps public
  metadata (labels, addresses) to receive funds and watch balances only.

## Decisions (locked)

- **Domain** — `tkn.land`
  Passkeys and storage are origin-bound to this domain.
- **Architecture** — Static SPA, no backend
  Pure client app; challenges self-generated (only used locally for PRF).
- **Build tool** — Vite + `vite-plugin-pwa`
  Static output, no server runtime, fast dev loop, less framework surface to audit.
- **UI** — React 19 + TypeScript + Tailwind CSS
  Mobile-first ergonomics
- **Biometric protocol** — WebAuthn passkey + **PRF extension**
  Passkey-as-vault-unlock, NOT passkey-as-signer. **One shared passkey** unlocks
  all device vaults on this origin (not passkey-per-vault).
- **Seed storage (device vaults)** — AES-256-GCM blob per vault in **IndexedDB**
  (+ `navigator.storage.persist()`). localStorage is sync, size-limited, more
  eviction-prone.
- **Key derivation** — PRF output → HKDF → AES-256-GCM key
  Deterministic, biometrics-gated, device-local.
- **Wallet standard** — BIP-39 mnemonic + BIP-32 HD derivation
  `@scure/bip39`, `@scure/bip32`, `@noble/curves`.
  Account paths: `m/44'/60'/0'/0/i` (multiple accounts per vault).
- **Multi-vault** — Users can create/import many vaults and switch active
  vaults in Advanced mode; each vault has its own accounts and backup state.
- **Cold vault** — Receive-only vault for security-conscious users
  - On create: generate mnemonic, **forced** write-down + quiz (paper is the
    only copy), derive account address(es), wipe seed from memory.
  - Persist only public data: `{ type: "cold", label, accounts[{ path, address }] }`.
  - **Never** write seed/ciphertext to IndexedDB (or anywhere on device).
  - Receive / watch balances normally; user can send funds **to** a cold vault
    from a device vault (or externally).
  - The everyday PWA cannot spend from it and never asks for its mnemonic.
    To spend, restore the paper backup only in a separately trusted environment
    (for example, another device or a locally verified/self-hosted build).
- **First chain** — **Base** (EVM, chainId 8453)
  Single secp256k1 curve; viem covers derivation, personal_sign, EIP-712, txs.
- **Chain library** — viem
  Lightweight, tree-shakable, no backend needed.
- **RPC** — Ordered multi-endpoint fallback for Base/EVM (same pattern as mettal
  `blockchain-backend-services` `createEvmTransport`: comma-separated URLs →
  viem `fallback(..., { rank: false })`). Primary e.g. `mainnet.base.org`, then
  publicnode / Alchemy / Infura as backups. Client talks to RPC directly.
- **Hosting** — Start on **Vercel Hobby** (free); move to **Njalla VPS** later if needed
  Vercel: custom headers (CSP) via `vercel.json`, PR previews, easy `tkn.land` setup.
  Njalla later: same static `dist/` behind Caddy/nginx with identical CSP (~€15/mo).
  Keep the app host-agnostic (static output). GitHub Pages rejected: cannot set headers.
- **Code hosting** — GitHub (open source)
  Vercel deploys from the repo; static output means no vendor lock-in.
  Security-conscious users may self-host or verify release hashes (passkeys are
  origin-bound — a self-hosted origin is a separate wallet identity).
- **Backup timing (device vaults only)** — Deferred forced backup
  Soft-offer backup at device-vault creation (skippable). Force backup only after
  that vault’s balance stays ≥ **$500 USD for > 2 days** (continuous), then block
  signing / sends until mnemonic reveal + quiz. Optional early backup always
  available. Cold vaults require backup at creation (no on-device copy).
- **Non-PRF devices** — Unsupported-device wall
  Capability check at onboarding; if PRF is unavailable, block device-vault
  create/unlock with a clear “device not supported” screen. No password fallback.
  Cold vaults still work as watch/receive-only (no PRF needed).
- **Key lifetime** — Per-action unlock, no session seed
  Device vault: biometric → PRF → decrypt seed → derive → use → wipe.
  Cold vault: no seed or signing operation on the everyday device. UI may stay
  open for reads; device-vault key use never caches the seed. JS wipe is
  best-effort, not HSM erase.
- **Multi-device** — Mnemonic re-import only
  A second device/browser gets the vault by restoring from the BIP-39 backup,
  then encrypting under that device’s passkey. No passkey-to-passkey re-encrypt
  or cloud sync. (Advanced / recovery flow.)

## Core architecture

The passkey never signs blockchain messages. It gates decryption of **device
vault** seeds for each sensitive action only.

1. **Create device vault**
   - Generate BIP-39 mnemonic (`@scure/bip39`).
   - Create passkey on first device vault (reuse afterward) with
     `extensions: { prf: { eval: { first: salt } } }`, platform authenticator,
     `userVerification: "required"`.
   - Derive AES-256-GCM key: PRF output → HKDF.
   - Encrypt mnemonic; store vault record
     `{ id, type: "device", label, credentialId, prfSalt, iv, ciphertext,
        accounts[{ path, address }], backupCompleted }` in IndexedDB.
   - Optional backup offer (skippable); wipe mnemonic from memory.

2. **Create cold vault**
   - Generate mnemonic → forced paper backup + quiz → derive accounts → wipe seed.
   - Store only `{ id, type: "cold", label, accounts[{ path, address }] }`.
   - No ciphertext, no passkey requirement for storage.

3. **Sign / sensitive action (per use)**
   - **Device vault:** `navigator.credentials.get()` + PRF → decrypt → path
     `m/44'/60'/0'/0/i` → sign → wipe.
   - Same rule for mnemonic reveal / device-vault backup quiz.
   - Cold vaults are excluded: normal PWA operations cannot sign with them.

4. **Reads (no secret material)**
   - Cached addresses are public. Balances via RPC for any vault/account.

5. **Deferred forced backup (device vaults)**
   - Track USD value per vault; persist `balanceAtLeast500Since`; clear if under $500.
   - After ≥ $500 continuous for > 2 days and `backupCompleted: false`: hard gate
     before further signing/sends from that vault.

## Risks and mitigations

- **Data loss is the #1 risk for device vaults.** Clearing site data or losing
  the device destroys IndexedDB (passkey may sync; blob does not).
  Mitigation: deferred forced backup at ≥ $500 for > 2 days + restore-from-mnemonic.
  Cold vaults push this risk onto the user’s physical backup (by design).
- **PRF support is not universal.** Chrome/Android solid; iOS 18+ Safari yes; older iOS no.
  Mitigation: unsupported-device wall for device vaults; cold vaults still work.
- **XSS is the real attack surface** (seed briefly exists in JS during a ceremony).
  Mitigations: per-action unlock (no long-lived seed); strict CSP via Vercel headers;
  zero third-party scripts/analytics; minimal audited dependencies; no CDN-loaded code.
  Residual: XSS can hijack a ceremony (presence ≠ intent).
  Cold vaults reduce phone-compromise risk for large balances: the everyday
  PWA never holds or requests their seed. Spending requires a separate trusted
  environment, whose integrity the user must verify.

## Build order

### Milestone 1 — Installable shell
- [x] Scaffold Vite + React + TS + Tailwind + `vite-plugin-pwa`.
- [x] Manifest, icons, mobile viewport (`viewport-fit=cover`), service worker.
- [x] GitHub repo + Vercel project + `tkn.land` domain + HTTPS.
- [x] Verify install-to-homescreen on Android and iOS.

### Milestone 2 — Vault core (device vault)
- [x] PRF capability detection.
- [x] Passkey creation with PRF extension.
- [x] PRF → HKDF → AES-GCM encrypt/decrypt round-trip of a test mnemonic.
- [x] IndexedDB vault records + `navigator.storage.persist()`.
- [x] Per-action ceremony: biometric → decrypt → use → wipe (no session key).

### Milestone 3 — Default onboarding & recovery UX
- [x] One-tap default: automatically create the initial device vault + account;
  never ask a default user to create either.
- [x] After biometric setup, land directly on balance + prominent Receive / Send.
- [ ] Optional (skippable) backup + verification quiz.
- [x] Unsupported-device wall when PRF is unavailable (device vaults).
- [ ] Put restore-from-mnemonic and multi-vault management in Advanced mode.

### Milestone 4 — Accounts + Base integration
- [ ] Create additional accounts automatically when needed; expose account
  selection/management only in Advanced mode (`m/44'/60'/0'/0/i`).
- [ ] HD derivation inside the sign ceremony only.
- [ ] Read: ETH + ERC-20 balances on Base (cached addresses, no key).
- [ ] viem transport: ordered RPC URL list with `fallback` (mettal-style).
- [ ] Sign: message, EIP-712, send tx (biometric for device vaults).
- [ ] Send from device vault → cold vault address.

### Milestone 4b — Cold vault (Advanced mode)
- [ ] Create cold vault: forced paper-backup quiz, store addresses only, never persist seed.
- [ ] Watch balances; receive UI.
- [ ] Exclude cold vaults from all signing flows; explain trusted-environment
  recovery for spending.

### Milestone 4c — Deferred backup gate (device vaults)
- [ ] USD valuation per vault (price source TBD).
- [ ] Persist `balanceAtLeast500Since`; reset when value drops below $500.
- [ ] After ≥ $500 continuous for > 2 days: hard-gate signing until backup quiz done.
- [ ] Settings: backup anytime before the gate (biometric → reveal).

### Milestone 5 — Hardening
- [ ] CSP + security headers in `vercel.json` (HSTS, `Permissions-Policy`, etc.).
- [ ] Dependency audit; pin versions.
- [ ] Memory hygiene: zero/clear buffers after every ceremony; avoid string copies of secrets.
- [ ] Docs: self-host / verify release hashes for security-conscious users.

## Reuse from reference projects
- `src/features/webauthn/lib/webauthnService.ts` — passkey create/assert patterns
  (add PRF extension; drop Supabase sync).
- `src/features/gift/lib/giftEncryption.ts`, `src/app/gift-card/_utils/encoder.ts` —
  AES-GCM patterns (replace PBKDF2-from-userId with PRF/HKDF derivation).
- `src/app/manifest.ts`, PWA config, favicon set — packaging reference.
- `docs/passkeys.md` — mental model for OS keychain vs local storage.

Not reused: Supabase/API routes, DefuseSDK/intents stack, Capacitor wrapper,
passkey-as-signer account model.

## Open decisions

1. Exact Base RPC URL list / order (public + optional Alchemy/Infura key).
2. USD price source for the $500 gate (client-side CoinGecko/DefiLlama vs on-chain oracle).
3. Soft nag before the hard gate? (e.g. banner after first crossing $500).
