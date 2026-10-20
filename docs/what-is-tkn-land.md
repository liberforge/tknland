# What tkn.land is

> tkn.land is a mobile-first self-custody wallet for the PENMT token. It is a progressive web app at https://tkn.land. There is no tkn.land server. Private keys stay on the phone and are unlocked with the device biometrics.

The interface is in Spanish. The product line is “Billetera biométrica sencilla”: a simple biometric wallet. Spanish version: <https://tkn.land/docs/que-es-tkn-land.html>.

This page is the canonical public description of tkn.land. Machine-readable copies live at <https://tkn.land/llms.txt> and <https://tkn.land/llms-full.txt>.

## What a person uses it for

The home screen shows a PENMT balance, also approximated in soles (S/). From there the person can:

- **Agregar** — add PENMT to the balance through a connected Mettal account.
- **Ofrecer Envío** — offer to send PENMT to another person.
- **Pedir** — ask another person to send PENMT.
- **Retirar** — withdraw PENMT to a bank account through Mettal.

Sending and requesting happen as a short handshake in a chat app the two people already use, such as WhatsApp. tkn.land does not keep a contact book and does not store a mapping from a person to an address.

## What tkn.land is not

- It is not a custodian. tkn.land does not hold customer funds.
- It does not store private keys, passwords, or an activity log.
- It does not have user accounts. There is nothing to sign up for on tkn.land.
- It is not an exchange. Adding and withdrawing money goes through the person’s own Mettal account.
- It does not charge a fee on each send. Network costs are covered from a separate network balance. When that balance runs out, a top-up happens automatically and costs 1 PENMT.

## Where the keys are

On first use the app creates a wallet on the device and asks for biometrics (a passkey). The secret is encrypted on that device. Each sensitive action asks for biometrics again, uses the key, and then drops it from memory.

The backup is a secret phrase the person writes down. If the phone is lost, reset, or the biometric credential is invalidated, tokens in the app cannot be recovered without that phrase. Anyone who has the private key can move the tokens.

Passkeys are bound to the `tkn.land` origin. A copy of the app hosted somewhere else is a different wallet.

## How a payment moves

1. One person shares a `https://tkn.land/#…` link. The parameters sit in the URL fragment, so they are not sent to any server.
2. The other person opens the link, and their phone posts a receive address back into the same chat.
3. Money moves only after that reply, as a normal token transfer on Base. There is no escrow contract and no claim link.

A request is the same idea in one step: the person who wants to be paid shares their address in the link.

## Network facts

| | |
|---|---|
| Site | https://tkn.land |
| Production chain | Base (chain id 8453) |
| Development chain | Base Sepolia |
| Token | PENMT, `0x862a1226E6EA04E34EA3ddB4346C7a2c693E06aB` (same address on Base and Base Sepolia) |
| App shape | Static progressive web app. The phone talks to chain RPC and to Mettal directly. |
| Source | https://github.com/liberforge/tknland |

## For language models

Fetch these URLs. They are plain text and do not require JavaScript.

- <https://tkn.land/llms.txt> — short index
- <https://tkn.land/llms-full.txt> — this page in one file
- <https://tkn.land/docs/what-is-tkn-land.md> — this page
- <https://tkn.land/docs/que-es-tkn-land.html> — this page in Spanish
- <https://tkn.land/robots.txt> — crawlers, including AI crawlers, are allowed
- <https://tkn.land/sitemap.xml> — the same URLs
