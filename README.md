# tkn.land

Mobile-first self-custody wallet for PENMT. What it is: [docs/what-is-tkn-land.md](./docs/what-is-tkn-land.md). En español: [docs/que-es-tkn-land.html](./docs/que-es-tkn-land.html). Those pages are also published for language models at [https://tkn.land/llms.txt](https://tkn.land/llms.txt).

Implementation plan: [docs/PLAN.md](./docs/PLAN.md).

## Develop

```bash
pnpm install
pnpm dev
```

## Build

```bash
pnpm build
pnpm preview
```

Static output lands in `dist/` (host on Vercel; Njalla later if needed).

## Staging user-journey battery

End-to-end check against Mettal staging and Base Sepolia: CORS → deposit simulate → mint → P2P send → gas pack → bank redeem.

```bash
cp scripts/.env.example.staging-test scripts/.env.staging-test
# fill METTAL_STG_KEY / SECRET and private keys; set ALLOW_* / TKN_ALLOW_* to 1 for side effects
./scripts/run-test.sh
# or: pnpm test:journeys
```

`scripts/.env.staging-test` is gitignored. Subsets: `pnpm test:journeys:mettal` (Mettal only), `pnpm test:journeys:onchain` (send / gas pack only).

## Storage

Safari on iPhone deletes IndexedDB, along with other script-writable storage, after 7 days of Safari use with no tap or keypress. `navigator.storage.persist()` does not stop that. IndexedDB here is a local cache: the encrypted blob, the address, the passkey id, UI flags, and payment handshakes. Upstash is read only when that blob is missing. A phrase restore writes the new blob to Upstash and replaces the local cache. Do not put the plaintext seed, or the only copy of something that must survive, in IndexedDB.

Agent notes for that rule: [AGENTS.md](./AGENTS.md).
