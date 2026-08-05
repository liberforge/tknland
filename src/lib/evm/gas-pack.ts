import type { Address } from "viem";
import {
  GAS_PACK_CONTRACT_ADDRESS,
  PENMT_TOKEN_ADDRESS,
} from "@/lib/evm/config";
import { getPublicClient } from "@/lib/evm/client";

export const gasPackAbi = [
  {
    type: "function",
    name: "packPrice",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "packTopUpTarget",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "buyGasPack",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/** Fallback if on-chain price is unset (1 PENMT @ 6 decimals). */
export const DEFAULT_PACK_PRICE_RAW = 1_000_000n;

export async function getPackPrice(
  token: Address = PENMT_TOKEN_ADDRESS,
): Promise<bigint> {
  const client = getPublicClient();
  const price = await client.readContract({
    address: GAS_PACK_CONTRACT_ADDRESS,
    abi: gasPackAbi,
    functionName: "packPrice",
    args: [token],
  });
  return price > 0n ? price : DEFAULT_PACK_PRICE_RAW;
}

export async function getPackTopUpTarget(): Promise<bigint> {
  const client = getPublicClient();
  return client.readContract({
    address: GAS_PACK_CONTRACT_ADDRESS,
    abi: gasPackAbi,
    functionName: "packTopUpTarget",
  });
}

export { GAS_PACK_CONTRACT_ADDRESS };
