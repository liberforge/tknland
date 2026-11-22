import { getPublicClient } from "@/lib/evm/client";
import { PENMT_TOKEN_ADDRESS } from "@/lib/evm/config";
import { parseAbiItem, type Address } from "viem";

export const ACTIVITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Used only when a recent block cannot be read. Base mainnet is about 2s. */
const FALLBACK_BLOCK_MS = 2_000;
const CHUNK_BLOCKS = 50_000n;
/**
 * A week of 0.2s blocks is about 61 chunks. The cap stays above that so one
 * tap covers the requested week; a further tap continues from the block reached.
 */
const MAX_CHUNKS_PER_SCAN = 80;
const LOG_CONCURRENCY = 2;

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

export type PenmtTransfer = {
  hash: string;
  logIndex: number;
  from: string;
  to: string;
  value: bigint;
  /** Block timestamp in milliseconds. */
  at: number;
};

type RawTransfer = Omit<PenmtTransfer, "at"> & { blockNumber: bigint };

export type ChainHead = {
  block: bigint;
  timestampMs: number;
  /** Measured milliseconds per block. */
  blockMs: number;
};

export async function chainHead(): Promise<ChainHead> {
  const client = getPublicClient();
  const block = await client.getBlock();
  const number = block.number ?? 0n;
  const timestampMs = Number(block.timestamp) * 1000;
  return {
    block: number,
    timestampMs,
    blockMs: await measureBlockMs(number, timestampMs),
  };
}

/** Block that is at least as old as `targetMs`, with a small buffer. */
export function blockForTimestamp(head: ChainHead, targetMs: number): bigint {
  if (targetMs >= head.timestampMs) return head.block;
  const blocks =
    BigInt(Math.ceil((head.timestampMs - targetMs) / head.blockMs)) + 5_000n;
  return head.block > blocks ? head.block - blocks : 0n;
}

export function approximateTimestamp(head: ChainHead, block: bigint): number {
  const behind = head.block > block ? head.block - block : 0n;
  return head.timestampMs - Number(behind) * head.blockMs;
}

async function measureBlockMs(headBlock: bigint, headTimestampMs: number): Promise<number> {
  const behind = 50_000n;
  if (headBlock <= behind) return FALLBACK_BLOCK_MS;
  try {
    const sample = await getPublicClient().getBlock({ blockNumber: headBlock - behind });
    const elapsed = headTimestampMs - Number(sample.timestamp) * 1000;
    if (elapsed <= 0) return FALLBACK_BLOCK_MS;
    return Math.max(1, Math.round(elapsed / Number(behind)));
  } catch {
    return FALLBACK_BLOCK_MS;
  }
}

async function readChunk(
  client: ReturnType<typeof getPublicClient>,
  wallet: Address,
  fromBlock: bigint,
  toBlock: bigint,
) {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const [outgoing, incoming] = await Promise.all([
        client.getLogs({
          address: PENMT_TOKEN_ADDRESS,
          event: transferEvent,
          args: { from: wallet },
          fromBlock,
          toBlock,
        }),
        client.getLogs({
          address: PENMT_TOKEN_ADDRESS,
          event: transferEvent,
          args: { to: wallet },
          fromBlock,
          toBlock,
        }),
      ]);
      return [...outgoing, ...incoming];
    } catch (err) {
      last = err;
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    }
  }
  throw last;
}

export async function scanPenmtTransfers(options: {
  wallet: Address;
  highBlock: bigint;
  lowBlock: bigint;
  head: ChainHead;
}): Promise<{ transfers: PenmtTransfer[]; reachedBlock: bigint }> {
  const wallet = options.wallet;
  let cursor = options.highBlock;
  const floor = options.lowBlock < 0n ? 0n : options.lowBlock;
  if (cursor < floor) {
    return { transfers: [], reachedBlock: cursor };
  }

  const client = getPublicClient();
  const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
  while (cursor >= floor && ranges.length < MAX_CHUNKS_PER_SCAN) {
    const from = cursor - CHUNK_BLOCKS + 1n;
    const fromBlock = from > floor ? from : floor;
    ranges.push({ fromBlock, toBlock: cursor });
    if (fromBlock <= floor) break;
    cursor = fromBlock - 1n;
  }

  const raw: RawTransfer[] = [];
  for (let index = 0; index < ranges.length; index += LOG_CONCURRENCY) {
    const slice = ranges.slice(index, index + LOG_CONCURRENCY);
    const batches = await Promise.all(
      slice.map(({ fromBlock, toBlock }) =>
        readChunk(client, wallet, fromBlock, toBlock),
      ),
    );
    for (const log of batches.flat()) {
      const decoded = log.args;
      const hash = log.transactionHash;
      const blockNumber = log.blockNumber;
      if (
        !hash ||
        blockNumber == null ||
        decoded.from == null ||
        decoded.to == null ||
        decoded.value == null
      ) {
        continue;
      }
      raw.push({
        hash,
        logIndex: log.logIndex ?? 0,
        from: decoded.from,
        to: decoded.to,
        value: decoded.value,
        blockNumber,
      });
    }
  }
  const reached = ranges.length > 0 ? ranges[ranges.length - 1].fromBlock : cursor;

  const times = await blockTimestamps(raw.map((log) => log.blockNumber), options.head);
  const transfers = raw.map((log) => ({
    hash: log.hash,
    logIndex: log.logIndex,
    from: log.from,
    to: log.to,
    value: log.value,
    at: times.get(log.blockNumber.toString()) ?? approximateTimestamp(options.head, log.blockNumber),
  }));
  return { transfers, reachedBlock: reached };
}

async function blockTimestamps(
  blocks: bigint[],
  head: ChainHead,
): Promise<Map<string, number>> {
  const unique = [...new Set(blocks.map((block) => block.toString()))];
  const times = new Map<string, number>();
  const client = getPublicClient();
  const size = 8;
  for (let index = 0; index < unique.length; index += size) {
    const slice = unique.slice(index, index + size);
    const settled = await Promise.all(
      slice.map(async (key) => {
        try {
          const block = await client.getBlock({ blockNumber: BigInt(key) });
          return [key, Number(block.timestamp) * 1000] as const;
        } catch {
          return [key, approximateTimestamp(head, BigInt(key))] as const;
        }
      }),
    );
    for (const [key, at] of settled) times.set(key, at);
  }
  return times;
}
