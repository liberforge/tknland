import { erc20Abi, formatUnits, parseUnits, type Address } from "viem";
import { PENMT_TOKEN_ADDRESS } from "@/lib/evm/config";
import { getPublicClient } from "@/lib/evm/client";

export async function getPenmtDecimals(): Promise<number> {
  const client = getPublicClient();
  return client.readContract({
    address: PENMT_TOKEN_ADDRESS,
    abi: erc20Abi,
    functionName: "decimals",
  });
}

export async function getPenmtBalance(address: string): Promise<{
  raw: bigint;
  formatted: string;
  decimals: number;
}> {
  const client = getPublicClient();
  const owner = address as Address;

  const [raw, decimals] = await Promise.all([
    client.readContract({
      address: PENMT_TOKEN_ADDRESS,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner],
    }),
    client.readContract({
      address: PENMT_TOKEN_ADDRESS,
      abi: erc20Abi,
      functionName: "decimals",
    }),
  ]);

  const major = formatUnits(raw, decimals);
  const asNumber = Number(major);
  return {
    raw,
    decimals,
    formatted: Number.isFinite(asNumber) ? asNumber.toFixed(2) : major,
  };
}

export async function parsePenmtMajorToRaw(amount: string): Promise<bigint> {
  const decimals = await getPenmtDecimals();
  const normalized = amount.trim().replace(/\s/g, "").replace(",", ".");
  if (!normalized || !/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error("Monto inválido.");
  }
  return parseUnits(normalized, decimals);
}

export function formatPenmtRaw(raw: bigint, decimals: number): string {
  const major = formatUnits(raw, decimals);
  const asNumber = Number(major);
  return Number.isFinite(asNumber) ? asNumber.toFixed(2) : major;
}
