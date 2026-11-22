import type { MettalTransactionPage, PublicMettalTransaction } from "@/lib/activity/types";
import {
  METTAL_API_URL,
  type MettalCredentials,
} from "@/lib/mettal/credentials";
import { RequestError } from "@/lib/client-error";

export const METTAL_DEFAULT_SYMBOL = "PENMT";
export const METTAL_DEFAULT_COUNTRY = "PE";
/** Mettal balances/amounts use minor units (centavos): 1.00 → 100. */
export const METTAL_MINOR_UNIT_SCALE = 100;
/** Minimum acquire amount (major units / S/). */
export const METTAL_MIN_ACQUIRE_MAJOR = 5;
export const METTAL_MIN_ACQUIRE_MINOR =
  METTAL_MIN_ACQUIRE_MAJOR * METTAL_MINOR_UNIT_SCALE;
/** If Mettal redeem balance is at least this (major), withdraw from Mettal first. */
export const METTAL_REDEEM_FIRST_MAJOR = 5;
export const METTAL_REDEEM_FIRST_MINOR =
  METTAL_REDEEM_FIRST_MAJOR * METTAL_MINOR_UNIT_SCALE;

export type MettalAcquireAccount = {
  bankAccount: string;
  country: string;
  currency: string;
  symbol: string;
  name?: string;
};

export type MettalAccountBalances = {
  acquireBalance: number;
  redeemBalance: number;
};

type IssueTokenResponse = {
  accessToken: string;
  tokenType: string;
  /** Lifetime in seconds. */
  expiresIn: number;
};

type CachedMettalToken = {
  accessToken: string;
  expiresAtMs: number;
};

const mettalTokenCache = new Map<string, CachedMettalToken>();
/** Don't reuse a token that is about to expire. */
const METTAL_TOKEN_SKEW_MS = 60_000;
/** A mistaken expiresIn must not pin a token for days. */
const METTAL_TOKEN_MAX_MS = 24 * 60 * 60 * 1000;

export function isFetchFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /failed to fetch|networkerror|load failed|network request failed/i.test(
    err.message,
  );
}

type GetBalancesResponse = {
  success: boolean;
  data: MettalAccountBalances;
};

type EnsureAcquireAccountResponse = {
  success: boolean;
  data: MettalAcquireAccount;
};

export type MettalAcquireChallenge = {
  message: string;
  expiresAt: string;
};

type AcquireChallengeResponse = {
  success: boolean;
  data: MettalAcquireChallenge;
};

export type MettalAcquireResult = {
  workflowId: string;
  symbol: string;
  amount: number;
};

type AcquireTokensResponse = {
  success: boolean;
  data: MettalAcquireResult;
};

export const METTAL_ACQUIRE_NETWORK = "base";

type MettalApiErrorBody = {
  code?: string;
  message?: string;
  statusCode?: number;
};

async function readMettalError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as MettalApiErrorBody;
    if (typeof body.message === "string" && body.message.trim()) {
      return body.message.trim();
    }
    if (typeof body.code === "string" && body.code.trim()) {
      return body.code.trim();
    }
  } catch {
    // ignore non-JSON error bodies
  }
  return `Error de Mettal (${response.status})`;
}

async function mettalFetch(
  method: "GET" | "POST" | "DELETE",
  path: string,
  init?: { headers?: HeadersInit; body?: string; query?: string },
): Promise<Response> {
  try {
    const response = await fetch(`${METTAL_API_URL}${path}${init?.query ?? ""}`, {
      method,
      headers: init?.headers,
      body: init?.body,
    });
    if (!response.ok) {
      throw new RequestError(method, path, await readMettalError(response));
    }
    return response;
  } catch (err) {
    if (err instanceof RequestError) throw err;
    const message =
      err instanceof Error && err.message ? err.message : "Failed to fetch";
    throw new RequestError(method, path, message);
  }
}

function mettalFailure(
  method: "GET" | "POST" | "DELETE",
  path: string,
  message: string,
): RequestError {
  return new RequestError(method, path, message);
}

export function forgetMettalAccessToken(credentials: MettalCredentials): void {
  mettalTokenCache.delete(credentials.key);
}

export async function issueMettalAccessToken(
  credentials: MettalCredentials,
  options?: { force?: boolean },
): Promise<string> {
  const cacheKey = credentials.key;
  if (options?.force) mettalTokenCache.delete(cacheKey);
  const cached = mettalTokenCache.get(cacheKey);
  if (cached && cached.expiresAtMs - METTAL_TOKEN_SKEW_MS > Date.now()) {
    return cached.accessToken;
  }

  const response = await mettalFetch("POST", "/v1/auth/token", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key: credentials.key,
      secret: credentials.secret,
    }),
  });

  const body = (await response.json()) as IssueTokenResponse;
  if (!body.accessToken?.trim()) {
    throw mettalFailure("POST", "/v1/auth/token", "Mettal no devolvió un access token.");
  }

  const ttlMs = Math.min(
    Math.max(0, body.expiresIn) * 1000,
    METTAL_TOKEN_MAX_MS,
  );
  if (ttlMs > METTAL_TOKEN_SKEW_MS) {
    mettalTokenCache.set(cacheKey, {
      accessToken: body.accessToken,
      expiresAtMs: Date.now() + ttlMs,
    });
  } else {
    mettalTokenCache.delete(cacheKey);
  }
  return body.accessToken;
}

/** Acquire + redeem balances for a token symbol (amounts in minor units). */
export async function getAccountBalances(options: {
  accessToken: string;
  symbol?: string;
}): Promise<MettalAccountBalances> {
  const symbol = (options.symbol ?? METTAL_DEFAULT_SYMBOL).trim().toUpperCase();
  const response = await mettalFetch(
    "GET",
    `/v1/account/balances/${encodeURIComponent(symbol)}`,
    {
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
      },
    },
  );

  const body = (await response.json()) as GetBalancesResponse;
  const data = body.data;
  if (
    !body.success ||
    !data ||
    typeof data.acquireBalance !== "number" ||
    !Number.isFinite(data.acquireBalance) ||
    typeof data.redeemBalance !== "number" ||
    !Number.isFinite(data.redeemBalance)
  ) {
    throw mettalFailure(
      "GET",
      `/v1/account/balances/${encodeURIComponent(symbol)}`,
      "Mettal no devolvió los saldos de la cuenta.",
    );
  }

  return {
    acquireBalance: data.acquireBalance,
    redeemBalance: data.redeemBalance,
  };
}

/** Ensures the permanent acquire bank account exists (creates if missing). */
export async function ensureAcquireAccount(options: {
  accessToken: string;
  symbol?: string;
  country?: string;
}): Promise<MettalAcquireAccount> {
  const symbol = (options.symbol ?? METTAL_DEFAULT_SYMBOL).trim().toUpperCase();
  const country = (options.country ?? METTAL_DEFAULT_COUNTRY)
    .trim()
    .toUpperCase();
  const response = await mettalFetch("POST", "/v1/account/acquire-account", {
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ symbol, country }),
  });

  const body = (await response.json()) as EnsureAcquireAccountResponse;
  const account = body.data;
  if (
    !body.success ||
    !account ||
    typeof account.bankAccount !== "string" ||
    !account.bankAccount.trim() ||
    typeof account.currency !== "string" ||
    !account.currency.trim()
  ) {
    throw mettalFailure(
      "POST",
      "/v1/account/acquire-account",
      "Mettal no devolvió una cuenta de adquisición.",
    );
  }

  return account;
}

/** One-time EIP-191 challenge for minting to an unregistered Base address. */
export async function issueAcquireChallenge(options: {
  accessToken: string;
  address: string;
  network?: string;
}): Promise<MettalAcquireChallenge> {
  const network = (options.network ?? METTAL_ACQUIRE_NETWORK).trim().toLowerCase();
  const response = await mettalFetch("POST", "/v1/tokens/acquire-challenge", {
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      address: options.address.trim(),
      network,
    }),
  });

  const body = (await response.json()) as AcquireChallengeResponse;
  if (
    !body.success ||
    !body.data?.message?.trim() ||
    !body.data?.expiresAt?.trim()
  ) {
    throw mettalFailure(
      "POST",
      "/v1/tokens/acquire-challenge",
      "Mettal no devolvió un challenge de propiedad.",
    );
  }
  return body.data;
}

/** Request token mint to a Base address (with ownership proof when required). */
export async function acquireTokens(options: {
  accessToken: string;
  amount: number;
  address: string;
  message: string;
  signature: string;
  symbol?: string;
  network?: string;
}): Promise<MettalAcquireResult> {
  const symbol = (options.symbol ?? METTAL_DEFAULT_SYMBOL).trim().toUpperCase();
  const network = (options.network ?? METTAL_ACQUIRE_NETWORK).trim().toLowerCase();
  const response = await mettalFetch("POST", "/v1/tokens/acquire", {
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      symbol,
      network,
      address: options.address.trim(),
      amount: options.amount,
      message: options.message,
      signature: options.signature,
    }),
  });

  const body = (await response.json()) as AcquireTokensResponse;
  if (
    !body.success ||
    !body.data?.workflowId?.trim() ||
    typeof body.data.amount !== "number"
  ) {
    throw mettalFailure(
      "POST",
      "/v1/tokens/acquire",
      "Mettal no aceptó la solicitud de adquisición.",
    );
  }
  return body.data;
}

export function formatMettalMajor(minor: number): string {
  return (minor / METTAL_MINOR_UNIT_SCALE).toFixed(2);
}

/** Display amount with thousands separators (e.g. "5,999,061.90"). */
export function formatMettalMajorGrouped(minor: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / METTAL_MINOR_UNIT_SCALE);
}

/** Parses a major-unit amount string (e.g. "12.50" or "12,50") into minor units. */
export function parseMettalMajorToMinor(raw: string): number | null {
  const normalized = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!normalized || !/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const major = Number(normalized);
  if (!Number.isFinite(major)) return null;
  return Math.round(major * METTAL_MINOR_UNIT_SCALE);
}

export type MettalDestination = {
  id: string;
  type: "bank_account";
  bankAccount: string;
  country: string;
  currency: string;
  symbol: string;
  name?: string;
};

export type MettalRedeemQuote = {
  quoteId: string;
  expiresIn: number;
  initialAmount: number;
  finalAmount?: number;
  totalFee?: number;
  currency: string;
  country?: string;
};

export type MettalRedeemAuthorizeResult = {
  transactionId: string;
  quoteId: string;
  amount: number;
  symbol: string;
  status: string;
};

export type MettalRedeemStatus = {
  transactionId: string;
  type: string;
  amount: number;
  currency: string;
  status: string;
};

export type MettalRedeemAddress = {
  chain: string;
  token: string;
  address: string;
};

export async function listDestinations(options: {
  accessToken: string;
  country?: string;
  symbol?: string;
}): Promise<MettalDestination[]> {
  const params = new URLSearchParams();
  if (options.country) params.set("country", options.country);
  // PE has multiple rails; Mettal requires symbol when country is set.
  if (options.country || options.symbol) {
    params.set(
      "symbol",
      (options.symbol ?? METTAL_DEFAULT_SYMBOL).trim().toUpperCase(),
    );
  }
  const qs = params.toString() ? `?${params}` : "";
  const response = await mettalFetch("GET", "/v1/account/destinations", {
    headers: { Authorization: `Bearer ${options.accessToken}` },
    query: qs,
  });
  const body = (await response.json()) as {
    success: boolean;
    data: MettalDestination[];
  };
  if (!body.success || !Array.isArray(body.data)) {
    throw mettalFailure(
      "GET",
      "/v1/account/destinations",
      "Mettal no devolvió las cuentas bancarias.",
    );
  }
  return body.data;
}

export async function registerDestination(options: {
  accessToken: string;
  bankAccount: string;
  country?: string;
  symbol?: string;
}): Promise<MettalDestination> {
  const response = await mettalFetch("POST", "/v1/account/destinations", {
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "bank_account",
      bankAccount: options.bankAccount,
      country: options.country ?? METTAL_DEFAULT_COUNTRY,
      symbol: (options.symbol ?? METTAL_DEFAULT_SYMBOL).trim().toUpperCase(),
    }),
  });
  const body = (await response.json()) as {
    success: boolean;
    data: MettalDestination;
  };
  if (!body.success || !body.data?.id) {
    throw mettalFailure(
      "POST",
      "/v1/account/destinations",
      "Mettal no registró la cuenta bancaria.",
    );
  }
  return body.data;
}

export async function deleteDestination(options: {
  accessToken: string;
  id: string;
}): Promise<void> {
  const path = `/v1/account/destinations/${encodeURIComponent(options.id)}`;
  await mettalFetch("DELETE", path, {
    headers: { Authorization: `Bearer ${options.accessToken}` },
  });
}

export async function getRedeemAddresses(options: {
  accessToken: string;
}): Promise<MettalRedeemAddress[]> {
  const response = await mettalFetch("GET", "/v1/account/redeem-address", {
    headers: { Authorization: `Bearer ${options.accessToken}` },
  });
  const body = (await response.json()) as {
    success: boolean;
    data: MettalRedeemAddress[];
  };
  if (!body.success || !Array.isArray(body.data)) {
    throw mettalFailure(
      "GET",
      "/v1/account/redeem-address",
      "Mettal no devolvió las direcciones de retiro.",
    );
  }
  return body.data;
}

/** Ensures the redeem deposit address exists for a chain (creates if missing). */
export async function ensureRedeemAddress(options: {
  accessToken: string;
  chain?: string;
  symbol?: string;
}): Promise<MettalRedeemAddress> {
  const chain = (options.chain ?? METTAL_ACQUIRE_NETWORK).trim().toLowerCase();
  const symbol = (options.symbol ?? METTAL_DEFAULT_SYMBOL).trim().toUpperCase();
  const response = await mettalFetch("POST", "/v1/account/redeem-address", {
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ chain, symbol }),
  });
  const body = (await response.json()) as {
    success: boolean;
    data: MettalRedeemAddress;
  };
  const address = body.data;
  if (
    !body.success ||
    !address ||
    typeof address.chain !== "string" ||
    !address.chain.trim() ||
    typeof address.address !== "string" ||
    !address.address.trim()
  ) {
    throw mettalFailure(
      "POST",
      "/v1/account/redeem-address",
      "Mettal no devolvió una dirección de retiro.",
    );
  }
  return address;
}

export async function requestRedeemQuote(options: {
  accessToken: string;
  amount: number;
  destinationId: string;
  currency?: string;
}): Promise<MettalRedeemQuote> {
  const response = await mettalFetch("POST", "/v1/redeem/quote", {
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: options.amount,
      currency: options.currency ?? "PEN",
      destinationId: options.destinationId,
    }),
  });
  const body = (await response.json()) as {
    success: boolean;
    data: MettalRedeemQuote;
  };
  if (!body.success || !body.data?.quoteId) {
    throw mettalFailure("POST", "/v1/redeem/quote", "Mettal no emitió una cotización de retiro.");
  }
  return body.data;
}

export async function authorizeRedeem(options: {
  accessToken: string;
  quoteId: string;
  destinationId: string;
  idempotencyKey: string;
}): Promise<MettalRedeemAuthorizeResult> {
  const response = await mettalFetch("POST", "/v1/redeem", {
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": options.idempotencyKey,
    },
    body: JSON.stringify({
      quoteId: options.quoteId,
      destinationId: options.destinationId,
    }),
  });
  const body = (await response.json()) as {
    success: boolean;
    data: MettalRedeemAuthorizeResult;
  };
  if (!body.success || !body.data?.transactionId) {
    throw mettalFailure("POST", "/v1/redeem", "Mettal no aceptó el retiro.");
  }
  return body.data;
}

export async function getRedeemStatus(options: {
  accessToken: string;
  transactionId: string;
}): Promise<MettalRedeemStatus> {
  const path = `/v1/redeem/status/${encodeURIComponent(options.transactionId)}`;
  const response = await mettalFetch("GET", path, {
    headers: { Authorization: `Bearer ${options.accessToken}` },
  });
  const body = (await response.json()) as {
    success: boolean;
    data: MettalRedeemStatus;
  };
  if (!body.success || !body.data?.transactionId) {
    throw mettalFailure("GET", path, "Mettal no devolvió el estado del retiro.");
  }
  return body.data;
}

export async function listAccountTransactions(options: {
  accessToken: string;
  page?: number;
  limit?: number;
}): Promise<MettalTransactionPage> {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));
  const path = "/v1/account/transactions";
  const response = await mettalFetch("GET", path, {
    headers: { Authorization: `Bearer ${options.accessToken}` },
    query: `?page=${page}&limit=${limit}`,
  });
  const body = (await response.json()) as {
    success?: boolean;
    data?: PublicMettalTransaction[];
    page?: number;
    pages?: number;
    total?: number;
  };
  if (!body.success || !Array.isArray(body.data)) {
    throw mettalFailure("GET", path, "Mettal no devolvió el historial.");
  }
  return {
    rows: body.data.map(publicTransaction),
    page: finiteInt(body.page, page),
    pages: finiteInt(body.pages, 0),
    total: finiteInt(body.total, body.data.length),
  };
}

function publicTransaction(row: PublicMettalTransaction): PublicMettalTransaction {
  return {
    id: text(row.id),
    type: text(row.type),
    status: text(row.status),
    concept: text(row.concept),
    amount: row.amount
      ? {
          value: finiteNumber(row.amount.value),
          currency: text(row.amount.currency),
          symbol: text(row.amount.symbol),
        }
      : undefined,
    date: row.date
      ? { createdAt: text(row.date.createdAt), updatedAt: text(row.date.updatedAt) }
      : undefined,
    fee: row.fee
      ? {
          total: finiteNumber(row.fee.total),
          currency: text(row.fee.currency),
          symbol: text(row.fee.symbol),
        }
      : undefined,
    bank: row.bank
      ? { account: text(row.bank.account), bankName: text(row.bank.bankName) }
      : undefined,
    blockchain: row.blockchain
      ? {
          network: text(row.blockchain.network),
          address: text(row.blockchain.address),
          transactionHash: text(row.blockchain.transactionHash),
        }
      : undefined,
  };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function finiteInt(value: unknown, fallback: number): number {
  const parsed = finiteNumber(value);
  if (parsed == null) return fallback;
  return Math.floor(parsed);
}

export function maskBankAccount(value: string): string {
  const digits = value.replace(/\s/g, "");
  if (digits.length <= 6) return digits;
  return `${digits.slice(0, 4)}••••${digits.slice(-4)}`;
}
