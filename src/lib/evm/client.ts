import {
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  type Account,
} from "viem";
import { EVM_CHAIN, EVM_CHAIN_ID } from "@/lib/evm/config";

/** Ordered Base mainnet RPCs (no ranking — try in order). */
const BASE_MAINNET_RPC_URLS = [
  "https://mainnet.base.org",
  "https://base.publicnode.com",
  "https://base-rpc.publicnode.com",
] as const;

/** Ordered Base Sepolia RPCs (no ranking — try in order). */
const BASE_SEPOLIA_RPC_URLS = [
  "https://sepolia.base.org",
  "https://base-sepolia.publicnode.com",
  "https://base-sepolia-rpc.publicnode.com",
] as const;

const RPC_URLS = import.meta.env.DEV
  ? BASE_SEPOLIA_RPC_URLS
  : BASE_MAINNET_RPC_URLS;

function assertConfiguredChain(): void {
  if (EVM_CHAIN_ID !== EVM_CHAIN.id) {
    throw new Error(
      `La cadena EVM configurada (${EVM_CHAIN_ID}) no coincide con ${EVM_CHAIN.name}.`,
    );
  }
}

/** Shared read transport — fallback across public RPCs. */
const readTransport = fallback(
  RPC_URLS.map((url) => http(url)),
  { rank: false },
);

/**
 * Writes + receipt waits stick to the primary RPC so sequential txs
 * (approve → transfer → fee) don't split across endpoints with divergent
 * pending nonces / mempools.
 */
const writeTransport = http(RPC_URLS[0]);

const publicClient = createPublicClient({
  chain: EVM_CHAIN,
  transport: readTransport,
});

/** Same node as wallet sends — use for nonce + waitForTransactionReceipt. */
const writePublicClient = createPublicClient({
  chain: EVM_CHAIN,
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
    chain: EVM_CHAIN,
    transport: writeTransport,
  });
}
