const PENMT_TOKEN_ADDRESS = "0x862a1226e6ea04e34ea3ddb4346c7a2c693e06ab";
const BASE_MAINNET_CHAIN_ID = 8453;
const BASE_SEPOLIA_CHAIN_ID = 84532;
/** One Historial week on Base is about 3 million blocks. */
const MAX_BLOCK_SPAN = 4_000_000n;
const MAX_PAGES = 4;
const PAGE_SIZE = "0x3e8";

type ChainId = typeof BASE_MAINNET_CHAIN_ID | typeof BASE_SEPOLIA_CHAIN_ID;

type Query = {
  address: string;
  fromBlock: bigint;
  toBlock: bigint;
  chainId: ChainId;
};

export type IndexedPenmtTransfer = {
  hash: string;
  logIndex: number;
  from: string;
  to: string;
  /** Raw token amount, decimal. */
  value: string;
  /** Block timestamp in milliseconds. */
  at: number;
};

type HandlerResult = {
  status: number;
  body: Record<string, unknown>;
};

export async function handlePenmtTransfers(body: unknown): Promise<HandlerResult> {
  const query = parseQuery(body);
  if (!query.ok) return { status: 400, body: { error: query.error } };
  const url = alchemyUrl(query.chainId);
  if (!url) return { status: 503, body: { error: "El índice de movimientos no está configurado." } };

  try {
    const [outgoing, incoming] = await Promise.all([
      listDirection(url, query, "from"),
      listDirection(url, query, "to"),
    ]);
    return { status: 200, body: { transfers: mergeTransfers([outgoing, incoming]) } };
  } catch (err) {
    console.error(
      "penmt transfers",
      err instanceof Error ? err.message.replace(/https?:\/\/\S+/gi, "/") : "failed",
    );
    return { status: 502, body: { error: "No se pudo leer el índice de movimientos." } };
  }
}

function alchemyUrl(chainId: ChainId): string | null {
  const raw =
    chainId === BASE_MAINNET_CHAIN_ID
      ? process.env.ALCHEMY_BASE_MAINNET_URL
      : process.env.ALCHEMY_BASE_SEPOLIA_URL;
  const url = raw?.trim();
  if (!url?.startsWith("https://")) return null;
  return url;
}

function parseQuery(
  body: unknown,
): ({ ok: true } & Query) | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "La consulta no es válida." };
  }
  const record = body as Record<string, unknown>;
  const address = typeof record.address === "string" ? record.address.toLowerCase() : "";
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    return { ok: false, error: "La dirección no es válida." };
  }
  if (record.chainId !== BASE_MAINNET_CHAIN_ID && record.chainId !== BASE_SEPOLIA_CHAIN_ID) {
    return { ok: false, error: "La red no es válida." };
  }
  const fromBlock = decimal(record.fromBlock);
  const toBlock = decimal(record.toBlock);
  if (fromBlock == null || toBlock == null || fromBlock > toBlock) {
    return { ok: false, error: "El rango de bloques no es válido." };
  }
  if (toBlock - fromBlock > MAX_BLOCK_SPAN) {
    return { ok: false, error: "El rango de bloques es demasiado amplio." };
  }
  return { ok: true, address, fromBlock, toBlock, chainId: record.chainId };
}

function decimal(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^\d{1,20}$/.test(value)) return null;
  return BigInt(value);
}

async function listDirection(
  url: string,
  query: Query,
  direction: "from" | "to",
): Promise<IndexedPenmtTransfer[]> {
  const transfers: IndexedPenmtTransfer[] = [];
  let pageKey: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params: Record<string, unknown> = {
      fromBlock: `0x${query.fromBlock.toString(16)}`,
      toBlock: `0x${query.toBlock.toString(16)}`,
      category: ["erc20"],
      contractAddresses: [PENMT_TOKEN_ADDRESS],
      withMetadata: true,
      excludeZeroValue: true,
      maxCount: PAGE_SIZE,
      order: "desc",
      [direction === "from" ? "fromAddress" : "toAddress"]: query.address,
    };
    if (pageKey) params.pageKey = pageKey;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "alchemy_getAssetTransfers",
        params: [params],
      }),
      signal: AbortSignal.timeout(7_000),
    });
    if (!response.ok) throw new Error(`alchemy http ${response.status}`);
    const json = (await response.json()) as {
      error?: { message?: string };
      result?: { transfers?: unknown[]; pageKey?: string };
    };
    if (json.error) throw new Error(json.error.message ?? "alchemy error");
    for (const item of json.result?.transfers ?? []) {
      transfers.push(mapTransfer(item));
    }
    pageKey = json.result?.pageKey || undefined;
    if (!pageKey) return transfers;
  }
  throw new Error("alchemy page cap");
}

function mapTransfer(item: unknown): IndexedPenmtTransfer {
  if (!item || typeof item !== "object") throw new Error("alchemy transfer");
  const row = item as Record<string, unknown>;
  const raw =
    row.rawContract && typeof row.rawContract === "object"
      ? (row.rawContract as Record<string, unknown>)
      : {};
  const token = typeof raw.address === "string" ? raw.address.toLowerCase() : "";
  if (token !== PENMT_TOKEN_ADDRESS) throw new Error("alchemy token");
  const hash = typeof row.hash === "string" ? row.hash.toLowerCase() : "";
  const from = typeof row.from === "string" ? row.from.toLowerCase() : "";
  const to = typeof row.to === "string" ? row.to.toLowerCase() : "";
  const rawValue = typeof raw.value === "string" ? raw.value.toLowerCase() : "";
  const metadata =
    row.metadata && typeof row.metadata === "object"
      ? (row.metadata as Record<string, unknown>)
      : {};
  const stamp = typeof metadata.blockTimestamp === "string" ? metadata.blockTimestamp : "";
  const at = Date.parse(stamp);
  const logIndex = logIndexOf(typeof row.uniqueId === "string" ? row.uniqueId : "");
  if (
    !/^0x[0-9a-f]{64}$/.test(hash) ||
    !/^0x[0-9a-f]{40}$/.test(from) ||
    !/^0x[0-9a-f]{40}$/.test(to) ||
    !/^0x[0-9a-f]+$/.test(rawValue) ||
    !Number.isFinite(at) ||
    logIndex == null
  ) {
    throw new Error("alchemy transfer shape");
  }
  return {
    hash,
    logIndex,
    from,
    to,
    value: BigInt(rawValue).toString(),
    at,
  };
}

function logIndexOf(uniqueId: string): number | null {
  const marker = ":log:";
  const at = uniqueId.toLowerCase().lastIndexOf(marker);
  if (at < 0) return null;
  const text = uniqueId.slice(at + marker.length);
  if (!/^\d+$/.test(text)) return null;
  const index = Number(text);
  return Number.isSafeInteger(index) ? index : null;
}

function mergeTransfers(groups: IndexedPenmtTransfer[][]): IndexedPenmtTransfer[] {
  const seen = new Set<string>();
  const merged: IndexedPenmtTransfer[] = [];
  for (const transfer of groups.flat()) {
    const key = `${transfer.hash}:${transfer.logIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(transfer);
  }
  return merged;
}
