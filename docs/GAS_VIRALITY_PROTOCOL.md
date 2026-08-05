# Gas Virality Protocol

Gas on Base is subsidized so P2P PENMT sends feel free (Yape/Plin-like).
Users are not charged per transfer. ETH is seeded on acquire, spread one
limited hop on send, and topped up again via an occasional **S/1 gas pack**.

Design budget (Base): ~`1e-5` ETH ≈ one ERC-20 approve + up to four ERC-20
transfers. Prices below use ~**S/7,000 per ETH** (indicative).


## Goals

- Sends feel free most of the time.

- Cold receivers are not left stuck at 0 ETH.

- Virality is **limited to 2 hops** (Alice → Bob → Carol, then stop).

- No tkn.land backend required for normal sends; Mettal may sponsor
  **buy pack** when the user has ~0 ETH.

- Shared fee-contract ETH reserve is not drained for free (packs pay in PENMT).


## Constants

`acquire-top-up-amount`

- Value:  `1.5e-4` ETH  (~S/1.05)
- Role:   Minter/on-ramping (Mettal) tops buyer to this on each acquire

`pack-top-up-amount`

- Value:  `1e-4` ETH  (~S/0.70)
- Role:   After paying S/1 gas pack

`hop-seed-target`

- Value:  `2e-5` ETH  (~S/0.14)
- Role:   Receiver top-up target enabling **1 extra hop**

`terminal-seed-target`

- Value:  `1e-5` ETH  (~S/0.07)
- Role:   Receiver top-up target for **1 send only** to gas-having-accounts or to buy pack

`pack-floor`

- Value:  `0.8e-5` ETH  (~S/0.06)
- Role:   Below this, user cannot reliably self-serve buy pack

`gas-pack-price`

- Value:  1 PENMT  (S/1.00)
- Role:   Charged via fee contract `processFee`

**Do not** set `pack-top-up-amount` to `1.5e-4`: S/1 would not cover the ETH
delivered at current prices.


### Top-up semantics

Receiver are **top-up to target**

```text
gift = max(0, target - receiver.balance)
```

If `receiver.balance >= target`, gift is `0` (no ETH send).


## Funding sources

**Acquire**

- Who pays gas tx:   Minter/on-ramping
- Who provides ETH:  Minter/on-ramping  → user wallet to `acquire-top-up-amount`
- User PENMT:        — (in acquire economics)

Minter/on-ramping includes this in the acquire economics.

**Normal send + receiver top-up**

- Who pays gas tx:   Sender
- Who provides ETH:  Sender’s own ETH (`gift` to receiver)
- User PENMT:        0

**Gas pack (user has ≥ `pack-floor`)**

- Who pays gas tx:   User
- Who provides ETH:  Fee contract reserve → user to `pack-top-up-amount`
- User PENMT:        S/1 via `processFee`

In rare cases when a user has 0 or not enough gas to buy a pack, the solution is:
1) ask another account to send you (that account will top-up your account)
2) acquire from minter/on-ramping, that operation will top-up your account


## Limited virality (2 hops)

Seeds must **decrease** by hop. The same seed amount at every hop cannot
cap depth.

```text
Alice (acquire 1.5e-4)
  └─ tops Bob up to 2e-5
       → Bob can send + top Carol to 1e-5
       └─ tops Carol up to 1e-5
            → Carol can send once, cannot top Dave to 1e-5
            └─ STOP (Carol must buy pack to continue seeding)
```

**Hop-capable balance (`2e-5`)**

- Enough for one outbound send **and** topping another wallet to `1e-5`.

**Terminal balance (`1e-5`)**

- Enough for about one send; **not** enough to also top another wallet
  up to `1e-5`.


## Sender balance bands

Evaluate **before** the send (sender ETH balance).

**`≥ 3.5e-5`**

- May top receiver **to `hop-seed-target` (`2e-5`)** if needed.

**`2.2e-5` … `< 3.5e-5`**

- May top receiver **to `terminal-seed-target` (`1e-5`)** if needed.

**`0.8e-5` … `< 2.2e-5`**

- **No** receiver ETH gift by default.
- Can still send PENMT to receivers who already have gas.

**`< 0.8e-5`**

- **Must buy gas pack** before sending (Mettal-sponsored if ≈0 ETH).

Bands keep a `pack-floor` cushion so the sender can still self-serve a pack
after gifting (worst case: receiver at 0).


### Cold receiver while sender is mid-low

If sender is in `0.8e-5` … `< 2.2e-5`
**and** `receiver.balance < pack-floor` (`0.8e-5`):

1. **Do not send** yet.

2. Require **buy S/1 gas pack** first (top sender to `pack-top-up-amount`).

3. Then send and apply normal gift rules (typically top receiver to `2e-5`).

This avoids leaving the receiver stuck at ~0 ETH.


## Decision tree (send)

```text
if sender.balance < pack-floor (0.8e-5):
    BUY_PACK
    // then continue

if sender.balance >= 3.5e-5:
    if receiver.balance < hop-seed-target:
        top_up receiver to hop-seed-target (2e-5)
    send PENMT

else if sender.balance >= 2.2e-5:  # and < 3.5e-5
    if receiver.balance < terminal-seed-target:
        top_up receiver to terminal-seed-target (1e-5)
    send PENMT

else if sender.balance >= pack-floor:  # 0.8e-5 … < 2.2e-5
    if receiver.balance < pack-floor:
        BUY_PACK first, then retry send rules
    else:
        send PENMT only  # soft prompt: buy pack soon
```


## Buy pack

### When

- Hard: `sender.balance < pack-floor` before any send.

- Hard: sender in `0.8e-5`–`2.2e-5` and receiver is cold (`< pack-floor`).

- Soft: sender in `0.8e-5`–`2.2e-5` even if receiver is fine (“recarga pronto”).


### What user gets

- Pays **S/1 PENMT** (`gas-pack-price`).

- Wallet topped **to `pack-top-up-amount` (`1e-4`)**.

- From ~0 ETH: ~S/0.70 of ETH delivered → ~S/0.30 margin vs pack price
  (at ~S/7k/ETH).


### How (no tkn.land backend)

1. **Self-serve** (balance ≥ `pack-floor`):
   user `approve` (if needed) + `processFee(PENMT, 1 PENMT, self, self, 0)`
   → fee contract tops up to `1e-4`.

2. **Sponsored** (balance ≈ 0): Mettal as fee-contract **operator**:
   - Prefer gasless allowance (Permit / Permit2) + operator `processFee`.
   - Fallback: tiny operator `topUpWallets` seed, then user self-serve
     (worse UX).

`processFee` with `feeAmount = 0` is **not** allowed when `minFeeAmount`
is set.


## Acquire

On each successful Mettal acquire/deposit that credits the user wallet:

- Top user ETH **to `acquire-top-up-amount` (`1.5e-4`)** if below that
  target (Mettal-sponsored).

- Prefer tying this to a real acquire (KYC/payment) so free ETH cannot
  be farmed.

Rough capacity after acquire `1.5e-4`: on the order of ~5 sends that top
receivers to `2e-5` (worst case from 0), then terminal gifts / plain sends
until `pack-floor`.


## UX framing

- Do **not** frame a per-transfer “gas commission”.

- Pack copy: **“Recarga de red”** (1 PENMT).

- Cold receiver + low sender:
  **“Para enviarle saldo de red a esta persona, primero haz una recarga de red.”**

- After acquire: gas is included in onboarding, not shown as a send fee.


## Fee contract alignment

- Direct ETH top-ups from the **sender** on P2P (virality).

- `processFee` mainly for **S/1 packs**.

Set fee-contract `minFeeAmount[PENMT] >= 1` and top-up the user to `pack-top-up-amount` when buying a pack.


## Summary checklist

Acquire top-up to

- `1.5e-4`

Pack price / top-up to

- S/1 → `1e-4`

Receiver target (extra hop)

- to `2e-5` if sender `≥ 3.5e-5`

Receiver target (terminal)

- to `1e-5` if sender `≥ 2.2e-5`

No gift band

- `0.8e-5` … `< 2.2e-5`
  (unless cold receiver → buy pack first)

Must buy pack

- `< 0.8e-5`, or mid-low + cold receiver

Virality depth

- 2 hops max
