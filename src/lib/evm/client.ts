import {
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  type Account,
} from "viem";
import { baseSepolia } from "viem/chains";
import { EVM_CHAIN_ID } from "@/lib/evm/config";

/** Ordered Base Sepolia RPCs (no ranking — try in order). */
const BASE_SEPOLIA_RPC_URLS = [
  "https://sepolia.base.org",
  "https://base-sepolia.publicnode.com",
  "https://base-sepolia-rpc.publicnode.com",
] as const;

function assertConfiguredChain(): void {
  if (EVM_CHAIN_ID !== baseSepolia.id) {
    throw new Error("La cadena EVM configurada no coincide con Base Sepolia.");
  }
}

/** Shared read transport — fallback across public RPCs. */
const readTransport = fallback(
  BASE_SEPOLIA_RPC_URLS.map((url) => http(url)),
  { rank: false },
);

/**
 * Writes + receipt waits stick to the primary RPC so sequential txs
 * (approve → transfer → fee) don't split across endpoints with divergent
 * pending nonces / mempools.
 */
const writeTransport = http(BASE_SEPOLIA_RPC_URLS[0]);

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: readTransport,
});

/** Same node as wallet sends — use for nonce + waitForTransactionReceipt. */
const writePublicClient = createPublicClient({
  chain: baseSepolia,
  transport: writeTransport,
});

export function getPublicClient() {
  assertConfiguredChain();
  return publicClient;
}

/** Public client pinned to the write RPC (nonce / receipts). */
export function getWritePublicClient() {
  assertConfiguredChain();
  return writePublicClient;
}

export function getWalletClient(account: Account) {
  assertConfiguredChain();
  return createWalletClient({
    account,
    chain: baseSepolia,
    transport: writeTransport,
  });
}
