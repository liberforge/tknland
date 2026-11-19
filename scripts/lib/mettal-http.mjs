/**
 * Mettal staging HTTP helpers — same request shapes as src/lib/mettal/client.ts
 */

export async function mettalRequest(baseUrl, method, path, options = {}) {
  const url = `${baseUrl.replace(/\/$/, "")}${path}${options.query ?? ""}`;
  const response = await fetch(url, {
    method,
    headers: options.headers,
    body: options.body,
  });
  const text = await response.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const msg =
      (json && (json.message || json.error?.message || json.error)) ||
      text ||
      response.statusText;
    const err = new Error(`${method} ${path} → HTTP ${response.status}: ${msg}`);
    err.status = response.status;
    err.body = json ?? text;
    throw err;
  }
  return json;
}

export async function issueAccessToken(baseUrl, key, secret) {
  const body = await mettalRequest(baseUrl, "POST", "/v1/auth/token", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, secret }),
  });
  if (!body?.accessToken) throw new Error("Mettal auth/token missing accessToken");
  return body.accessToken;
}

export async function getBalances(baseUrl, accessToken, symbol = "PENMT") {
  const body = await mettalRequest(
    baseUrl,
    "GET",
    `/v1/account/balances/${encodeURIComponent(symbol)}`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!body?.success || !body.data) throw new Error("balances response invalid");
  return body.data;
}

export async function ensureAcquireAccount(baseUrl, accessToken) {
  const body = await mettalRequest(baseUrl, "POST", "/v1/account/acquire-account", {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ symbol: "PENMT", country: "PE" }),
  });
  if (!body?.success || !body.data?.bankAccount) {
    throw new Error("acquire-account response invalid");
  }
  return body.data;
}

export async function listDestinations(
  baseUrl,
  accessToken,
  country = "PE",
  symbol = "PENMT",
) {
  const qs = new URLSearchParams({ country, symbol });
  const body = await mettalRequest(baseUrl, "GET", "/v1/account/destinations", {
    headers: { authorization: `Bearer ${accessToken}` },
    query: `?${qs}`,
  });
  if (!body?.success || !Array.isArray(body.data)) {
    throw new Error("destinations response invalid");
  }
  return body.data;
}

export async function registerDestination(
  baseUrl,
  accessToken,
  bankAccount,
  { country = "PE", symbol = "PENMT" } = {},
) {
  const body = await mettalRequest(baseUrl, "POST", "/v1/account/destinations", {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      type: "bank_account",
      bankAccount,
      country,
      symbol,
    }),
  });
  if (!body?.success || !body.data?.id) {
    throw new Error("register destination failed");
  }
  return body.data;
}

export async function ensureRedeemAddress(baseUrl, accessToken) {
  const body = await mettalRequest(baseUrl, "POST", "/v1/account/redeem-address", {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ chain: "base", symbol: "PENMT" }),
  });
  if (!body?.success || !body.data?.address) {
    throw new Error("redeem-address response invalid");
  }
  return body.data;
}

export async function acquireChallenge(baseUrl, accessToken, address) {
  const body = await mettalRequest(baseUrl, "POST", "/v1/tokens/acquire-challenge", {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ address, network: "base" }),
  });
  if (!body?.success || !body.data?.message) {
    throw new Error("acquire-challenge response invalid");
  }
  return body.data;
}

export async function acquireTokens(baseUrl, accessToken, input) {
  const body = await mettalRequest(baseUrl, "POST", "/v1/tokens/acquire", {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      symbol: "PENMT",
      network: "base",
      address: input.address,
      amount: input.amountMinor,
      message: input.message,
      signature: input.signature,
    }),
  });
  if (!body?.success || !body.data?.workflowId) {
    throw new Error("acquire response invalid");
  }
  return body.data;
}

export async function redeemQuote(baseUrl, accessToken, input) {
  const body = await mettalRequest(baseUrl, "POST", "/v1/redeem/quote", {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      amount: input.amountMinor,
      currency: "PEN",
      destinationId: input.destinationId,
    }),
  });
  if (!body?.success || !body.data?.quoteId) {
    throw new Error("redeem/quote response invalid");
  }
  return body.data;
}

export async function authorizeRedeem(baseUrl, accessToken, input) {
  const body = await mettalRequest(baseUrl, "POST", "/v1/redeem", {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify({
      quoteId: input.quoteId,
      destinationId: input.destinationId,
    }),
  });
  if (!body?.success || !body.data?.transactionId) {
    throw new Error("redeem authorize response invalid");
  }
  return body.data;
}

export async function redeemStatus(baseUrl, accessToken, transactionId) {
  const body = await mettalRequest(
    baseUrl,
    "GET",
    `/v1/redeem/status/${encodeURIComponent(transactionId)}`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!body?.success || !body.data?.transactionId) {
    throw new Error("redeem status response invalid");
  }
  return body.data;
}

/**
 * Browser-faithful CORS preflight. Would have caught missing Idempotency-Key.
 */
export async function assertCorsAllowsIdempotencyKey(baseUrl, origin) {
  const path = "/v1/redeem";
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers":
        "authorization,content-type,idempotency-key",
    },
  });
  const allowOrigin = response.headers.get("access-control-allow-origin") ?? "";
  const allowHeaders = (
    response.headers.get("access-control-allow-headers") ?? ""
  ).toLowerCase();
  if (!response.ok && response.status !== 204) {
    throw new Error(`CORS OPTIONS ${path} → HTTP ${response.status}`);
  }
  if (allowOrigin !== origin && allowOrigin !== "*") {
    throw new Error(
      `CORS Allow-Origin expected ${origin}, got ${allowOrigin || "(empty)"}`,
    );
  }
  if (!allowHeaders.split(",").map((s) => s.trim()).includes("idempotency-key")) {
    throw new Error(
      `CORS Allow-Headers missing idempotency-key: ${allowHeaders || "(empty)"}`,
    );
  }
}
