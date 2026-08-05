import { isAddress } from "viem";
import { bytesToBase64Url, randomBytes } from "@/lib/bytes";
import { PENMT_TOKEN_ADDRESS } from "@/lib/evm/config";

export const PROTOCOL_VERSION = "1";
export const PROTOCOL_TOKEN_PENMT = "PENMT";

/** 96-bit random id → ~16 base64url chars (match / replay without UUID length). */
export function newHandshakeId(): string {
  return bytesToBase64Url(randomBytes(12));
}

export type ProtocolToken = typeof PROTOCOL_TOKEN_PENMT;

export type InviteLink = {
  type: "invite";
  v: string;
  id: string;
  token: ProtocolToken;
  amount: string;
};

export type PayLink = {
  type: "pay";
  v: string;
  id: string;
  addr: `0x${string}`;
  token: ProtocolToken;
  /** Major units when set; omit for in-person “enter amount yourself” requests. */
  amount: string | null;
};

export type ReceiptLink = {
  type: "receipt";
  v: string;
  id: string;
  tx: `0x${string}`;
};

export type HandshakeLink = InviteLink | PayLink | ReceiptLink;

/** Minimum PENMT amount for sends / requests in the protocol UX. */
export const MIN_PROTOCOL_AMOUNT_MAJOR = 5;

/** Normalize a major-unit amount for protocol params (e.g. "12.5" → "12.50"). */
export function normalizeProtocolAmount(raw: string): string | null {
  const normalized = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!normalized || !/^\d+(\.\d{1,18})?$/.test(normalized)) return null;
  const major = Number(normalized);
  if (!Number.isFinite(major) || major <= 0) return null;
  // Keep up to 2 display decimals for PENMT UX; strip trailing zeros beyond that.
  const fixed = major.toFixed(2);
  return fixed;
}

/** Error message if `amount` (normalized major string) is below the minimum. */
export function minProtocolAmountError(amount: string): string | null {
  if (Number(amount) < MIN_PROTOCOL_AMOUNT_MAJOR) {
    return `El monto mínimo es ${MIN_PROTOCOL_AMOUNT_MAJOR} PENMT.`;
  }
  return null;
}

export function tokenSymbolToAddress(token: ProtocolToken): `0x${string}` {
  if (token === PROTOCOL_TOKEN_PENMT) return PENMT_TOKEN_ADDRESS;
  throw new Error(`Token no soportado: ${token}`);
}

export function parseTokenParam(raw: string | null): ProtocolToken | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if (upper === PROTOCOL_TOKEN_PENMT) return PROTOCOL_TOKEN_PENMT;
  return null;
}

function buildFragment(
  type: HandshakeLink["type"],
  params: Record<string, string>,
): string {
  const search = new URLSearchParams(params);
  return `#${type}?${search.toString()}`;
}

export function buildInviteLink(input: {
  id: string;
  amount: string;
  token?: ProtocolToken;
  origin?: string;
}): string {
  const amount = normalizeProtocolAmount(input.amount);
  if (!amount) throw new Error("Monto inválido.");
  const origin = input.origin ?? window.location.origin;
  const fragment = buildFragment("invite", {
    v: PROTOCOL_VERSION,
    id: input.id,
    token: input.token ?? PROTOCOL_TOKEN_PENMT,
    amount,
  });
  return `${origin}/${fragment}`;
}

export function buildPayLink(input: {
  id: string;
  addr: string;
  /** Omit or pass null for an open request (payer chooses the amount). */
  amount?: string | null;
  token?: ProtocolToken;
  origin?: string;
}): string {
  if (!isAddress(input.addr)) throw new Error("Cuenta TKN inválida.");
  const origin = input.origin ?? window.location.origin;
  const params: Record<string, string> = {
    v: PROTOCOL_VERSION,
    id: input.id,
    addr: input.addr,
    token: input.token ?? PROTOCOL_TOKEN_PENMT,
  };
  if (input.amount != null && input.amount !== "") {
    const amount = normalizeProtocolAmount(input.amount);
    if (!amount) throw new Error("Monto inválido.");
    params.amount = amount;
  }
  const fragment = buildFragment("pay", params);
  return `${origin}/${fragment}`;
}

export function buildReceiptLink(input: {
  id: string;
  tx: string;
  origin?: string;
}): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.tx)) {
    throw new Error("Hash de transacción inválido.");
  }
  const origin = input.origin ?? window.location.origin;
  const fragment = buildFragment("receipt", {
    v: PROTOCOL_VERSION,
    id: input.id,
    tx: input.tx,
  });
  return `${origin}/${fragment}`;
}

/** Parse hash fragment like `#invite?v=1&id=…` or a full URL containing that fragment. */
export function parseHandshakeLink(raw: string): HandshakeLink | null {
  const hash = extractHash(raw);
  if (!hash) return null;

  const withoutHash = hash.startsWith("#") ? hash.slice(1) : hash;
  const qIndex = withoutHash.indexOf("?");
  if (qIndex < 0) return null;

  const type = withoutHash.slice(0, qIndex);
  const params = new URLSearchParams(withoutHash.slice(qIndex + 1));
  const v = params.get("v")?.trim() ?? "";
  if (v !== PROTOCOL_VERSION) return null;

  if (type === "invite") {
    const id = params.get("id")?.trim() ?? "";
    const token = parseTokenParam(params.get("token"));
    const amount = normalizeProtocolAmount(params.get("amount") ?? "");
    if (!id || !token || !amount) return null;
    return { type: "invite", v, id, token, amount };
  }

  if (type === "pay") {
    const id = params.get("id")?.trim() ?? "";
    const addrRaw = params.get("addr")?.trim() ?? "";
    const token = parseTokenParam(params.get("token"));
    const amountRaw = params.get("amount");
    const amount =
      amountRaw == null || amountRaw.trim() === ""
        ? null
        : normalizeProtocolAmount(amountRaw);
    if (!id || !token || !isAddress(addrRaw)) return null;
    if (amountRaw != null && amountRaw.trim() !== "" && !amount) return null;
    return {
      type: "pay",
      v,
      id,
      addr: addrRaw,
      token,
      amount,
    };
  }

  if (type === "receipt") {
    const id = params.get("id")?.trim() ?? "";
    const tx = params.get("tx")?.trim() ?? "";
    if (!id || !/^0x[0-9a-fA-F]{64}$/.test(tx)) return null;
    return { type: "receipt", v, id, tx: tx as `0x${string}` };
  }

  return null;
}

function extractHash(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#")) return trimmed;
  try {
    const url = new URL(trimmed, window.location.origin);
    return url.hash || null;
  } catch {
    return null;
  }
}

export function clearLocationHash(): void {
  const { pathname, search } = window.location;
  window.history.replaceState(null, "", `${pathname}${search}`);
}
