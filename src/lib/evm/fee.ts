import type { Address } from "viem";
import { FEE_CONTRACT_ADDRESS, PENMT_TOKEN_ADDRESS } from "@/lib/evm/config";
import { getPublicClient } from "@/lib/evm/client";

export const feeContractAbi = [
  {
    type: "function",
    name: "minFeeAmount",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "processFee",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "feeAmount", type: "uint256" },
      { name: "payer", type: "address" },
      { name: "sender", type: "address" },
      { name: "receiver", type: "address" },
    ],
    outputs: [],
  },
] as const;

export async function getMinFeeAmount(
  token: Address = PENMT_TOKEN_ADDRESS,
): Promise<bigint> {
  const client = getPublicClient();
  return client.readContract({
    address: FEE_CONTRACT_ADDRESS,
    abi: feeContractAbi,
    functionName: "minFeeAmount",
    args: [token],
  });
}

export { FEE_CONTRACT_ADDRESS };
