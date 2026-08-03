import {
  METTAL_API_URL,
  type MettalCredentials,
} from "@/lib/mettal/credentials";

export const METTAL_DEFAULT_SYMBOL = "PENMT";
export const METTAL_DEFAULT_COUNTRY = "PE";
/** Mettal balances/amounts use minor units (centavos): 1.00 → 100. */
export const METTAL_MINOR_UNIT_SCALE = 100;
/** Minimum acquire balance (major units) before offering an on-app top-up. */
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
  expiresIn: number;
};

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

export async function issueMettalAccessToken(
  credentials: MettalCredentials,
): Promise<string> {
  const response = await fetch(`${METTAL_API_URL}/v1/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key: credentials.key,
      secret: credentials.secret,
    }),
  });

  if (!response.ok) {
    throw new Error(await readMettalError(response));
  }

  const body = (await response.json()) as IssueTokenResponse;
  if (!body.accessToken?.trim()) {
    throw new Error("Mettal no devolvió un access token.");
  }
  return body.accessToken;
}

/** Acquire + redeem balances for a token symbol (amounts in minor units). */
export async function getAccountBalances(options: {
  accessToken: string;
  symbol?: string;
}): Promise<MettalAccountBalances> {
  const symbol = (options.symbol ?? METTAL_DEFAULT_SYMBOL).trim().toUpperCase();
  const response = await fetch(
    `${METTAL_API_URL}/v1/account/balances/${encodeURIComponent(symbol)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(await readMettalError(response));
  }

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
    throw new Error("Mettal no devolvió los saldos de la cuenta.");
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
  const response = await fetch(`${METTAL_API_URL}/v1/account/acquire-account`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ symbol, country }),
  });

  if (!response.ok) {
    throw new Error(await readMettalError(response));
  }

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
    throw new Error("Mettal no devolvió una cuenta de adquisición.");
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
  const response = await fetch(`${METTAL_API_URL}/v1/tokens/acquire-challenge`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      address: options.address.trim(),
      network,
    }),
  });

  if (!response.ok) {
    throw new Error(await readMettalError(response));
  }

  const body = (await response.json()) as AcquireChallengeResponse;
  if (
    !body.success ||
    !body.data?.message?.trim() ||
    !body.data?.expiresAt?.trim()
  ) {
    throw new Error("Mettal no devolvió un challenge de propiedad.");
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
  const response = await fetch(`${METTAL_API_URL}/v1/tokens/acquire`, {
    method: "POST",
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

  if (!response.ok) {
    throw new Error(await readMettalError(response));
  }

  const body = (await response.json()) as AcquireTokensResponse;
  if (
    !body.success ||
    !body.data?.workflowId?.trim() ||
    typeof body.data.amount !== "number"
  ) {
    throw new Error("Mettal no aceptó la solicitud de adquisición.");
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
}): Promise<MettalDestination[]> {
  const qs = options.country
    ? `?country=${encodeURIComponent(options.country)}`
    : "";
  const response = await fetch(
    `${METTAL_API_URL}/v1/account/destinations${qs}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${options.accessToken}` },
    },
  );
  if (!response.ok) throw new Error(await readMettalError(response));
  const body = (await response.json()) as {
    success: boolean;
    data: MettalDestination[];
  };
  if (!body.success || !Array.isArray(body.data)) {
    throw new Error("Mettal no devolvió las cuentas bancarias.");
  }
  return body.data;
}

export async function registerDestination(options: {
  accessToken: string;
  bankAccount: string;
  country?: string;
}): Promise<MettalDestination> {
  const response = await fetch(`${METTAL_API_URL}/v1/account/destinations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "bank_account",
      bankAccount: options.bankAccount,
      country: options.country ?? METTAL_DEFAULT_COUNTRY,
    }),
  });
  if (!response.ok) throw new Error(await readMettalError(response));
  const body = (await response.json()) as {
    success: boolean;
    data: MettalDestination;
  };
  if (!body.success || !body.data?.id) {
    throw new Error("Mettal no registró la cuenta bancaria.");
  }
  return body.data;
}

export async function deleteDestination(options: {
  accessToken: string;
  id: string;
}): Promise<void> {
  const response = await fetch(
    `${METTAL_API_URL}/v1/account/destinations/${encodeURIComponent(options.id)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${options.accessToken}` },
    },
  );
  if (!response.ok) throw new Error(await readMettalError(response));
}

export async function getRedeemAddresses(options: {
  accessToken: string;
}): Promise<MettalRedeemAddress[]> {
  const response = await fetch(`${METTAL_API_URL}/v1/account/redeem-address`, {
    method: "GET",
    headers: { Authorization: `Bearer ${options.accessToken}` },
  });
  if (!response.ok) throw new Error(await readMettalError(response));
  const body = (await response.json()) as {
    success: boolean;
    data: MettalRedeemAddress[];
  };
  if (!body.success || !Array.isArray(body.data)) {
    throw new Error("Mettal no devolvió las direcciones de retiro.");
  }
  return body.data;
}

export async function requestRedeemQuote(options: {
  accessToken: string;
  amount: number;
  destinationId: string;
  currency?: string;
}): Promise<MettalRedeemQuote> {
  const response = await fetch(`${METTAL_API_URL}/v1/redeem/quote`, {
    method: "POST",
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
  if (!response.ok) throw new Error(await readMettalError(response));
  const body = (await response.json()) as {
    success: boolean;
    data: MettalRedeemQuote;
  };
  if (!body.success || !body.data?.quoteId) {
    throw new Error("Mettal no emitió una cotización de retiro.");
  }
  return body.data;
}

export async function authorizeRedeem(options: {
  accessToken: string;
  quoteId: string;
  destinationId: string;
  idempotencyKey: string;
}): Promise<MettalRedeemAuthorizeResult> {
  const response = await fetch(`${METTAL_API_URL}/v1/redeem`, {
    method: "POST",
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
  if (!response.ok) throw new Error(await readMettalError(response));
  const body = (await response.json()) as {
    success: boolean;
    data: MettalRedeemAuthorizeResult;
  };
  if (!body.success || !body.data?.transactionId) {
    throw new Error("Mettal no aceptó el retiro.");
  }
  return body.data;
}

export async function getRedeemStatus(options: {
  accessToken: string;
  transactionId: string;
}): Promise<MettalRedeemStatus> {
  const response = await fetch(
    `${METTAL_API_URL}/v1/redeem/status/${encodeURIComponent(options.transactionId)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${options.accessToken}` },
    },
  );
  if (!response.ok) throw new Error(await readMettalError(response));
  const body = (await response.json()) as {
    success: boolean;
    data: MettalRedeemStatus;
  };
  if (!body.success || !body.data?.transactionId) {
    throw new Error("Mettal no devolvió el estado del retiro.");
  }
  return body.data;
}

export function maskBankAccount(value: string): string {
  const digits = value.replace(/\s/g, "");
  if (digits.length <= 6) return digits;
  return `${digits.slice(0, 4)}••••${digits.slice(-4)}`;
}
