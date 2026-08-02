# tkn.land — Handshake send/request protocol

> Status: design locked at the protocol level. Open items at the bottom.

P2P transfers happen through a **handshake over the users' existing messenger**
(WhatsApp etc.). The recipient always commits a receive address in-thread
before any money moves. There is **no escrow contract, no claim links, and no
stored contact→address book** — every payment is a plain ERC-20 transfer to a
freshly communicated address, with gas covered by the existing `FeeContract`
(sender + receiver top-ups).

## Why handshake (decisions)

- **Recipient consent** — the receiver explicitly accepts (or ignores) every
  incoming payment before it exists on-chain.
- **Non-repudiation** — the receiver's own phone posts their address in the
  chat thread; a transfer to that address is evidence they can't cleanly deny.
  (Bearer claim links were rejected: either party could claim the funds
  anonymously and blame the other.)
- **Privacy** — the app never persists a contact→address mapping. Addresses
  appear only inside links, fresh per exchange.
- **Lost-phone resilience** — a new vault (new address) needs no address-book
  updates anywhere; the next handshake simply carries the new address.
- **No new contracts** — both flows are direct ERC-20 transfers;
  `FeeContract.processFee` handles the fee and tops up sender and receiver ETH.

Trade-off accepted: the sender's money does not move until the recipient
replies. Payment intents are asynchronous by design.

## Link types

All links are `https://tkn.land/#<type>?<params>` — params live in the URL
**fragment**, which never reaches any server. `v` is a protocol version.

| Type | Direction | Params | Meaning |
|------|-----------|--------|---------|
| `invite` | sender → receiver | `v, id, token, amount` | "I want to send you X" (no addresses) |
| `pay` | receiver → sender | `v, id, addr, token, amount` | "Send X to this address" |
| `receipt` | sender → receiver | `v, id, tx` | "Sent ✓" + tx hash (optional) |

The `id` (UUID) ties a reply to its intent and dedupes replays. A **solicit**
(request money) is just a `pay` link with a fresh `id` and no prior invite.

## Flow A — send (Alice → Bob, Bob may not have the app)

1. **Alice**: Send → amount → app stores intent `{id, token, amount, label,
   createdAt}` locally → share sheet with the `invite` link → WhatsApp → Bob.
2. **Bob**: taps link → tkn.land opens → "Alice wants to send you 1000 PENTM"
   → **Accept**. If new user, one-tap onboarding runs first (auto vault +
   account + biometric). App opens the share sheet with the prefilled `pay`
   reply. He taps send. *(Decline = do nothing; no funds are at risk.)*
3. **Alice**: taps Bob's `pay` link → app verifies `id` against the stored
   intent (amount/token must match; warn on mismatch) → confirm screen →
   biometric → ERC-20 transfer + `processFee` (tops up Alice and Bob) → app
   marks intent completed with tx hash → offers the `receipt` share (optional).
4. **Bob**: taps `receipt` → app opens → balance shows 1000 PENTM.

Taps: Alice 3–4 across two moments; Bob 2–3 plus onboarding biometric.

## Flow B — solicit (Bob requests from Alice)

1. **Bob**: Request → amount → share sheet with a `pay` link (his address,
   fresh `id`) → WhatsApp → Alice.
2. **Alice**: taps link → confirm screen ("Send 1000 PENTM to Bob?") →
   biometric → transfer + fee/top-ups → optional `receipt` back.

One round trip. Requires Bob to have the app (he's authoring the request).

## Client rules

- **Replay protection**: the sender's app records completed `id`s with tx
  hashes. Tapping an already-completed `pay` link shows "already paid" + tx.
- **Intent matching**: a `pay` reply whose `id` matches a stored intent must
  match its token/amount; otherwise show an explicit tamper warning.
- **Expiry**: pending intents expire locally (e.g. 7 days); dismissible.
- **No address persistence**: addresses from `pay` links are used for the one
  transfer and never written to any contact record. Activity history stores
  the user-visible label + tx hash only.
- **Notification gap**: with no backend there is no push; the `receipt` link
  is the delivery notification. The app also refreshes balances on open.

## Privacy option (deferred)

Because addresses are exchanged fresh per handshake, the receiver can hand out
a **newly derived account** (`m/44'/60'/0'/0/i`) each time, preventing
counterparties from watching balance history. Protocol needs no changes.
Deferred: it spreads funds and gas top-ups across accounts.

## Open decisions

1. **iOS storage partition** — RESOLVED: vault ciphertext is stored on the
   passkey via WebAuthn `largeBlob` (see PLAN.md → Decisions → Seed storage and
   Milestone 2b), so Safari tabs and the installed PWA reach the same vault.
   Remaining task: on-device test of the WhatsApp in-app browser (tracked in
   Milestone 2b). Android is fine either way (link capturing + `share_target`).
2. Per-handshake fresh receive accounts: on by default, opt-in, or v2.
3. `receipt` step: always offer, or only when the recipient was a new user.
4. Explicit `decline` reply link so the sender's pending intent clears
   immediately (v2; local expiry covers v1).
