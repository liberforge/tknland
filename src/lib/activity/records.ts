import { GAS_PACK_CONTRACT_ADDRESS } from "@/lib/evm/config";
import { peruBankName } from "@/lib/mettal/peru-banks";
import type { PenmtTransfer } from "@/lib/activity/chain";
import type { ActivityRecord, PublicMettalTransaction } from "@/lib/activity/types";

const PAIR_MS = 10 * 60 * 1000;
const COVER_MS = 7 * 24 * 60 * 60 * 1000;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

type Indexed = {
  tx: PublicMettalTransaction;
  index: number;
  at: number;
};

export function buildActivity(input: {
  transactions: PublicMettalTransaction[];
  transfers: PenmtTransfer[];
  redeemAddresses: string[];
  wallet: string;
  decimals: number;
}): ActivityRecord[] {
  const records: ActivityRecord[] = [];
  const used = new Set<number>();
  const dropHashes = new Set<string>();

  for (const tx of input.transactions) {
    const hash = chainHash(tx);
    if (hash) dropHashes.add(hash);
  }

  const incomes = indexed(input.transactions, "income");
  const acquires = indexed(input.transactions, "acquire");
  for (const income of incomes) {
    const amount = minor(income.tx.amount?.value);
    const match =
      amount == null
        ? undefined
        : closest(acquires, income.at, (acquire) => {
            if (used.has(acquire.index)) return false;
            if (minor(acquire.tx.amount?.value) !== amount) return false;
            return Math.abs(acquire.at - income.at) <= PAIR_MS;
          });
    if (match) {
      used.add(income.index);
      used.add(match.index);
      records.push(depositRecord(income, match));
    }
  }
  for (const income of incomes) {
    if (used.has(income.index)) continue;
    used.add(income.index);
    records.push(depositRecord(income));
  }
  for (const acquire of acquires) {
    if (used.has(acquire.index)) continue;
    used.add(acquire.index);
    records.push(receiveTokensRecord(acquire));
  }

  const burns = indexed(input.transactions, "income.redeem.tokens");
  const redeems = indexed(input.transactions, "redeem");
  const burnUsed = new Set<number>();
  for (const redeem of redeems) {
    const gross = grossMinor(redeem.tx);
    const match =
      gross == null
        ? undefined
        : closest(burns, redeem.at, (burn) => {
            if (burnUsed.has(burn.index)) return false;
            if (burn.at > redeem.at) return false;
            if (redeem.at - burn.at > COVER_MS) return false;
            return minor(burn.tx.amount?.value) === gross;
          });
    if (match) burnUsed.add(match.index);
    used.add(redeem.index);
    records.push(withdrawRecord(redeem.tx, redeem.at));
  }
  for (const burn of burns) {
    if (burnUsed.has(burn.index)) {
      used.add(burn.index);
      continue;
    }
    used.add(burn.index);
    records.push(
      pendingWithdrawRecord(
        burn.at,
        minor(burn.tx.amount?.value),
        burn.tx.id ?? `burn-${burn.index}`,
        statusLabel(burn.tx.status),
      ),
    );
  }

  input.transactions.forEach((tx, index) => {
    if (used.has(index)) return;
    const at = timeOf(tx);
    const amount = minor(tx.amount?.value);
    records.push({
      id: `mettal:${tx.id ?? index}`,
      at,
      title: tx.concept?.trim() || tx.type || "Movimiento",
      amountLabel: amount == null ? "" : moneyLabel(amount, tx.amount?.currency, tx.amount?.symbol),
      statusLabel: statusLabel(tx.status),
    });
  });

  const wallet = input.wallet.toLowerCase();
  const redeemAddresses = new Set(input.redeemAddresses.map((address) => address.toLowerCase()));
  const gasPack = GAS_PACK_CONTRACT_ADDRESS.toLowerCase();
  const seen = new Set<string>();
  const coveredRedeems = new Set<string>();

  for (const transfer of input.transfers) {
    const key = `${transfer.hash}:${transfer.logIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (dropHashes.has(transfer.hash.toLowerCase())) continue;
    if (transfer.value === 0n) continue;

    const from = transfer.from.toLowerCase();
    const to = transfer.to.toLowerCase();
    if (from === wallet && to === wallet) continue;

    if (to === gasPack) {
      records.push({
        id: `chain:${key}`,
        at: transfer.at,
        title: "Recarga de red",
        amountLabel: penmtRaw(transfer.value, input.decimals),
        statusLabel: "Completado",
      });
      continue;
    }

    const chainMinor = rawToMinor(transfer.value, input.decimals);
    if (to === ZERO_ADDRESS || redeemAddresses.has(to)) {
      const cover = redeems.find((redeem) => {
        const id = redeem.tx.id ?? String(redeem.index);
        if (coveredRedeems.has(id)) return false;
        if (transfer.at > redeem.at) return false;
        if (redeem.at - transfer.at > COVER_MS) return false;
        return chainMinor != null && grossMinor(redeem.tx) === chainMinor;
      });
      if (cover) {
        coveredRedeems.add(cover.tx.id ?? String(cover.index));
        continue;
      }
      if (redeemAddresses.has(to)) {
        records.push({
          id: `chain:${key}`,
          at: transfer.at,
          title: "Retiraste",
          amountLabel: penmtRaw(transfer.value, input.decimals),
          statusLabel: "Completado",
        });
        continue;
      }
      records.push(
        pendingWithdrawRecord(transfer.at, chainMinor, `chain:${key}`, "Pendiente"),
      );
      continue;
    }

    if (from === wallet) {
      records.push({
        id: `chain:${key}`,
        at: transfer.at,
        title: "Enviaste",
        amountLabel: penmtRaw(transfer.value, input.decimals),
        counterparty: transfer.to,
        counterpartyPrefix: "a",
        statusLabel: "Completado",
      });
      continue;
    }

    if (to === wallet) {
      const minted = from === ZERO_ADDRESS;
      records.push({
        id: `chain:${key}`,
        at: transfer.at,
        title: minted ? "Depositaste" : "Recibiste",
        amountLabel: penmtRaw(transfer.value, input.decimals),
        counterparty: minted ? undefined : transfer.from,
        counterpartyPrefix: minted ? undefined : "de",
        statusLabel: "Completado",
      });
    }
  }

  records.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  return records;
}

function indexed(rows: PublicMettalTransaction[], type: string): Indexed[] {
  return rows
    .map((tx, index) => ({ tx, index, at: timeOf(tx) }))
    .filter((row) => row.tx.type === type)
    .sort((a, b) => a.at - b.at);
}

function closest(
  rows: Indexed[],
  at: number,
  accept: (row: Indexed) => boolean,
): Indexed | undefined {
  let best: Indexed | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (!accept(row)) continue;
    const distance = Math.abs(row.at - at);
    if (distance < bestDistance) {
      best = row;
      bestDistance = distance;
    }
  }
  return best;
}

function depositRecord(income: Indexed, acquire?: Indexed): ActivityRecord {
  const amount = minor(income.tx.amount?.value);
  const at = acquire ? Math.max(income.at, acquire.at) : income.at;
  const statuses = [income.tx.status, acquire?.tx.status].filter(
    (status): status is string => Boolean(status),
  );
  return {
    id: `deposit:${income.tx.id ?? income.index}:${acquire?.tx.id ?? ""}`,
    at,
    title: "Depositaste",
    amountLabel: amount == null ? "" : soles(amount),
    detail: acquire && minor(acquire.tx.amount?.value) != null
      ? `Recibiste ${penmtMinor(minor(acquire.tx.amount?.value))}`
      : undefined,
    statusLabel: combinedStatus(statuses),
  };
}

function receiveTokensRecord(acquire: Indexed): ActivityRecord {
  return {
    id: `acquire:${acquire.tx.id ?? acquire.index}`,
    at: acquire.at,
    title: "Recibiste",
    amountLabel: penmtMinor(minor(acquire.tx.amount?.value)),
    statusLabel: statusLabel(acquire.tx.status),
  };
}

function withdrawRecord(tx: PublicMettalTransaction, at: number): ActivityRecord {
  const net = minor(tx.amount?.value);
  const fee = minor(tx.fee?.total) ?? 0;
  const gross = net == null ? null : net + fee;
  const account = tx.bank?.account;
  const bank = bankLabel(account, tx.bank?.bankName);
  const tail = last4(account);
  const parts: string[] = [];
  if (gross != null && fee > 0) parts.push(soles(gross));
  if (fee > 0) parts.push(`comisión ${soles(fee)}`);
  if (tail) parts.push(`···${tail}`);
  return {
    id: `redeem:${tx.id ?? at}`,
    at,
    title: bank ? `Retiraste a ${bank}` : "Retiraste",
    amountLabel: net == null ? "" : soles(net),
    detail: parts.length > 0 ? parts.join(" · ") : undefined,
    statusLabel: statusLabel(tx.status),
  };
}

function pendingWithdrawRecord(
  at: number,
  amountMinor: number | null,
  id: string,
  status: string | undefined,
): ActivityRecord {
  return {
    id: id.startsWith("chain:") ? id : `burn:${id}`,
    at,
    title: "Retiro en curso",
    amountLabel: penmtMinor(amountMinor),
    statusLabel: status ?? "Pendiente",
  };
}

function bankLabel(account?: string, bankName?: string): string | null {
  const fromCci = account ? peruBankName(account) : null;
  if (fromCci) return fromCci;
  const name = bankName?.trim();
  if (!name || /\d{6,}/.test(name)) return null;
  return name;
}

function last4(account?: string): string | null {
  const digits = (account ?? "").replace(/\D/g, "");
  if (digits.length < 4) return null;
  return digits.slice(-4);
}

function chainHash(tx: PublicMettalTransaction): string | null {
  const hash = tx.blockchain?.transactionHash?.trim().toLowerCase();
  return hash ? hash : null;
}

function timeOf(tx: PublicMettalTransaction): number {
  const raw = tx.date?.createdAt ?? tx.date?.updatedAt;
  const parsed = raw ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function minor(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function grossMinor(tx: PublicMettalTransaction): number | null {
  const value = minor(tx.amount?.value);
  if (value == null) return null;
  return value + (minor(tx.fee?.total) ?? 0);
}

function rawToMinor(value: bigint, decimals: number): number | null {
  const scale = decimals - 2;
  if (scale < 0) return null;
  const divisor = 10n ** BigInt(scale);
  if (divisor === 0n || value % divisor !== 0n) return null;
  const minorValue = value / divisor;
  if (minorValue > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(minorValue);
}

function soles(value: number): string {
  return `S/ ${(value / 100).toFixed(2)}`;
}

function penmtMinor(value: number | null): string {
  if (value == null) return "";
  return `${(value / 100).toFixed(2)} PENMT`;
}

function penmtRaw(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(Math.max(decimals, 0));
  const whole = abs / base;
  const fraction = abs % base;
  const fractionText = fraction.toString().padStart(Math.max(decimals, 0), "0").slice(0, 2).padEnd(2, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fractionText} PENMT`;
}

function moneyLabel(value: number, currency?: string, symbol?: string): string {
  const code = (currency ?? symbol ?? "").toUpperCase();
  if (code === "PEN" || code === "PENMT" || code === "") return soles(value);
  return `${(value / 100).toFixed(2)} ${code}`;
}

function statusLabel(status?: string): string | undefined {
  switch (status) {
    case "completed":
      return "Completado";
    case "pending":
    case "in_progress":
      return "Pendiente";
    case "failed":
    case "rejected":
      return "Fallido";
    case "canceling":
    case "canceled":
      return "Cancelado";
    default:
      return undefined;
  }
}

function combinedStatus(statuses: string[]): string | undefined {
  if (statuses.some((status) => status === "failed" || status === "rejected")) {
    return "Fallido";
  }
  if (statuses.some((status) => status === "canceling" || status === "canceled")) {
    return "Cancelado";
  }
  if (statuses.some((status) => status !== "completed")) return "Pendiente";
  return statuses.length > 0 ? "Completado" : undefined;
}
