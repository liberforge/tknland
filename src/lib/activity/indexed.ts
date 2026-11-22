import type { PenmtTransfer } from "@/lib/activity/chain";
import { RequestError } from "@/lib/client-error";
import { EVM_CHAIN_ID } from "@/lib/evm/config";

const PATH = "/api/penmt-transfers";

/** Apex redirects every path, including this API, and a home-screen app may not follow that. */
function endpoint(): string {
  if (typeof window !== "undefined" && window.location.hostname === "tkn.land") {
    return `https://www.tkn.land${PATH}`;
  }
  return PATH;
}

/** PENMT transfers for one wallet and block span, from the indexed backend. */
export async function fetchIndexedPenmtTransfers(options: {
  wallet: string;
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<PenmtTransfer[]> {
  let response: Response;
  try {
    response = await fetch(endpoint(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        address: options.wallet,
        fromBlock: options.fromBlock.toString(),
        toBlock: options.toBlock.toString(),
        chainId: EVM_CHAIN_ID,
      }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : "Failed to fetch";
    throw new RequestError("POST", PATH, message);
  }
  if (!response.ok) {
    throw new RequestError("POST", PATH, "No se pudo leer el índice de movimientos.");
  }
  let body: { transfers?: unknown };
  try {
    body = (await response.json()) as { transfers?: unknown };
  } catch {
    throw new RequestError("POST", PATH, "No se pudo leer el índice de movimientos.");
  }
  if (!Array.isArray(body.transfers)) {
    throw new RequestError("POST", PATH, "No se pudo leer el índice de movimientos.");
  }
  return body.transfers.map(parseTransfer);
}

function parseTransfer(item: unknown): PenmtTransfer {
  if (!item || typeof item !== "object") {
    throw new RequestError("POST", PATH, "No se pudo leer el índice de movimientos.");
  }
  const row = item as Record<string, unknown>;
  if (
    typeof row.hash !== "string" ||
    typeof row.from !== "string" ||
    typeof row.to !== "string" ||
    typeof row.value !== "string" ||
    !/^\d+$/.test(row.value) ||
    typeof row.logIndex !== "number" ||
    !Number.isInteger(row.logIndex) ||
    typeof row.at !== "number" ||
    !Number.isFinite(row.at)
  ) {
    throw new RequestError("POST", PATH, "No se pudo leer el índice de movimientos.");
  }
  return {
    hash: row.hash,
    logIndex: row.logIndex,
    from: row.from,
    to: row.to,
    value: BigInt(row.value),
    at: row.at,
  };
}
