#!/usr/bin/env node
/**
 * tkn.land staging user-journey battery
 *
 * Run order: CORS → Mettal auth → simulate deposit → mint → P2P send →
 * ETH drain + gas pack send → fund redeem rail → bank redeem.
 *
 * Secrets: scripts/.env.staging-test (see .env.example.staging-test).
 *
 *   pnpm test:journeys
 *   ./scripts/run-test.sh
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { formatEther, formatUnits, isAddress } from "viem";
import { simulateFiatDeposit } from "./lib/simulate-fiat-deposit.mjs";
import {
  assertCorsAllowsIdempotencyKey,
  authorizeRedeem,
  acquireChallenge,
  acquireTokens,
  ensureAcquireAccount,
  ensureRedeemAddress,
  getBalances,
  issueAccessToken,
  listDestinations,
  redeemQuote,
  redeemStatus,
  registerDestination,
} from "./lib/mettal-http.mjs";
import {
  createClients,
  drainEthTo,
  getPenmtBalance,
  getPenmtDecimals,
  sendPenmt,
  buyPackThenTransfer,
  PACK_FLOOR,
} from "./lib/onchain.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const DEFAULT_RECEIVER = "0x8aF993d76a2f723238d38188990f801b1Fbb80D3";
const DEFAULT_CCI = "03500000155325374494";
const DEFAULT_API = "https://api.v1.stg.mettal.io";
const DEFAULT_ALFIN = "https://intgr.stg.mettal.io/alfin/webhook";
const DEFAULT_RPC = "https://sepolia.base.org";

const results = [];

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env) || process.env[key] === "") {
      process.env[key] = val;
    }
  }
}

function env(name, fallback = "") {
  return (process.env[name] ?? fallback).trim();
}

function flag(name) {
  return ["1", "true", "yes", "on"].includes(env(name).toLowerCase());
}

function record(step, status, detail = "") {
  results.push({ step, status, detail });
  const tag = status.padEnd(4);
  console.log(`[${tag}] ${step}${detail ? ` — ${detail}` : ""}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function poll(label, fn, { timeoutMs = 90_000, intervalMs = 5_000 } = {}) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      lastErr = err;
    }
    await sleep(intervalMs);
  }
  throw new Error(
    `${label} timed out after ${timeoutMs}ms${lastErr ? `: ${lastErr.message}` : ""}`,
  );
}

function bootstrapEnv() {
  const candidates = [
    env("METTAL_STG_ENV_FILE"),
    resolve(__dirname, ".env.staging-test"),
  ].filter(Boolean);
  let loaded = false;
  for (const path of candidates) {
    if (existsSync(path)) {
      loadEnvFile(path);
      console.log(`loaded env ${path}`);
      loaded = true;
      break;
    }
  }
  if (!loaded) {
    throw new Error(
      "No secrets file. Create scripts/.env.staging-test (see scripts/.env.example.staging-test).",
    );
  }
}

async function main() {
  bootstrapEnv();

  const apiUrl = env("METTAL_STG_API_URL", DEFAULT_API);
  const origin = env("METTAL_STG_ORIGIN", "https://www.tkn.land");
  const alfinUrl = env("METTAL_STG_ALFIN_WEBHOOK_URL", DEFAULT_ALFIN);
  const key = env("METTAL_STG_KEY");
  const secret = env("METTAL_STG_SECRET");
  const priv = env("METTAL_STG_EVM_PRIVATE_KEY") || env("TKN_SENDER_PRIVATE_KEY");
  const rpcUrl = env("TKN_RPC_URL", DEFAULT_RPC);
  const receiver = env("TKN_RECEIVER_ADDRESS", DEFAULT_RECEIVER);
  const cci = env("METTAL_STG_BANK_CCI", DEFAULT_CCI);
  const depositMajor = Number(env("METTAL_STG_DEPOSIT_AMOUNT_MAJOR", "5"));
  const sendMajor = env("TKN_SEND_AMOUNT", "1");
  const redeemMinor = Number(env("METTAL_STG_REDEEM_AMOUNT_MINOR", "100"));

  const allowDeposit = flag("METTAL_STG_ALLOW_SIMULATE_DEPOSIT");
  const allowAcquire = flag("METTAL_STG_ALLOW_ACQUIRE");
  const allowRedeem = flag("METTAL_STG_ALLOW_REDEEM");
  const allowSend = flag("TKN_ALLOW_SEND");
  const allowGasPack = flag("TKN_ALLOW_GAS_PACK");
  const allowRegisterDest = flag("METTAL_STG_ALLOW_REGISTER_DESTINATION");

  if (!isAddress(receiver)) throw new Error(`invalid receiver ${receiver}`);

  console.log("\n=== tkn.land staging journey battery ===");
  console.log({ apiUrl, origin, receiver, depositMajor, redeemMinor, allowDeposit, allowAcquire, allowSend, allowGasPack, allowRedeem });

  // —— A0 CORS ——
  try {
    await assertCorsAllowsIdempotencyKey(apiUrl, origin);
    record("A0 CORS Idempotency-Key", "PASS");
  } catch (err) {
    record("A0 CORS Idempotency-Key", "FAIL", err.message);
    throw err;
  }

  if (!key || !secret) {
    record("A1 auth", "FAIL", "METTAL_STG_KEY/SECRET missing");
    throw new Error("Set METTAL_STG_KEY and METTAL_STG_SECRET in scripts/.env.staging-test");
  }
  if (!priv) {
    record("wallets", "FAIL", "METTAL_STG_EVM_PRIVATE_KEY missing");
    throw new Error("Set METTAL_STG_EVM_PRIVATE_KEY");
  }

  const accessToken = await issueAccessToken(apiUrl, key, secret);
  record("A1 auth/token", "PASS");

  const { account, publicClient, walletClient } = createClients(rpcUrl, priv);
  record("wallet", "PASS", account.address);

  const acquireAccount = await ensureAcquireAccount(apiUrl, accessToken);
  record("A1 acquire-account", "PASS", acquireAccount.bankAccount);

  await ensureRedeemAddress(apiUrl, accessToken);
  record("A1 redeem-address ensure", "PASS");

  // —— A2 simulate + mint ——
  let balances = await getBalances(apiUrl, accessToken);
  if (allowDeposit) {
    const before = balances.acquireBalance;
    await simulateFiatDeposit({
      amountMajor: depositMajor,
      bankAccount: acquireAccount.bankAccount,
      webhookUrl: alfinUrl,
      label: "tknland-journey-battery",
    });
    record("A2 simulate Alfin deposit", "PASS", `S/ ${depositMajor} → ${acquireAccount.bankAccount}`);
    balances = await poll(
      "acquire balance credit",
      async () => {
        const b = await getBalances(apiUrl, accessToken);
        return b.acquireBalance > before ? b : null;
      },
      { timeoutMs: 120_000 },
    );
    record("A2 acquire balance credited", "PASS", `acquire=${balances.acquireBalance}`);
  } else {
    record("A2 simulate Alfin deposit", "SKIP", "METTAL_STG_ALLOW_SIMULATE_DEPOSIT!=1");
  }

  if (allowAcquire) {
    balances = await getBalances(apiUrl, accessToken);
    const mintMinor = Math.min(balances.acquireBalance, Math.round(depositMajor * 100));
    if (mintMinor < 500) {
      throw new Error(`acquire balance ${balances.acquireBalance} < 500 minor (need mint funds)`);
    }
    const beforePenmt = await getPenmtBalance(publicClient, account.address);
    const challenge = await acquireChallenge(apiUrl, accessToken, account.address);
    const signature = await walletClient.signMessage({
      account,
      message: challenge.message,
    });
    const minted = await acquireTokens(apiUrl, accessToken, {
      address: account.address,
      amountMinor: mintMinor,
      message: challenge.message,
      signature,
    });
    record("A2 acquire mint requested", "PASS", `workflow=${minted.workflowId} amount=${mintMinor}`);
    try {
      await poll(
        "on-chain PENMT after mint",
        async () => {
          const bal = await getPenmtBalance(publicClient, account.address);
          return bal > beforePenmt ? bal : null;
        },
        { timeoutMs: 180_000, intervalMs: 8_000 },
      );
      const after = await getPenmtBalance(publicClient, account.address);
      const decimals = await getPenmtDecimals(publicClient);
      record(
        "A2 on-chain PENMT credited",
        "PASS",
        formatUnits(after, decimals),
      );
    } catch (err) {
      record("A2 on-chain PENMT credited", "FAIL", err.message);
      throw err;
    }
  } else {
    record("A2 acquire mint", "SKIP", "METTAL_STG_ALLOW_ACQUIRE!=1");
  }

  // —— B P2P send ——
  if (allowSend) {
    const before = await getPenmtBalance(publicClient, receiver);
    const result = await sendPenmt({
      publicClient,
      walletClient,
      account,
      receiver,
      amountMajor: sendMajor,
    });
    const after = await poll(
      "receiver PENMT",
      async () => {
        const bal = await getPenmtBalance(publicClient, receiver);
        return bal > before ? bal : null;
      },
      { timeoutMs: 60_000 },
    );
    record(
      "B P2P send",
      "PASS",
      `tx=${result.transferTxHash} receiver=${formatUnits(after, await getPenmtDecimals(publicClient))}`,
    );
  } else {
    record("B P2P send", "SKIP", "TKN_ALLOW_SEND!=1");
  }

  // —— C drain ETH + pack + send ——
  if (allowGasPack) {
    const drained = await drainEthTo({
      publicClient,
      walletClient,
      account,
      to: receiver,
      leaveWei: PACK_FLOOR / 2n, // below pack floor so reload is required
    });
    record(
      "C drain ETH to receiver",
      "PASS",
      drained.skipped
        ? drained.note
        : `sent ${formatEther(drained.sent)} tx=${drained.hash} left=${formatEther(drained.balanceAfter)}`,
    );
    const before = await getPenmtBalance(publicClient, receiver);
    const result = await buyPackThenTransfer({
      publicClient,
      walletClient,
      account,
      receiver,
      amountMajor: sendMajor,
    });
    if (!result.feeTxHash) throw new Error("expected gas pack tx");
    await poll(
      "receiver PENMT after pack send",
      async () => {
        const bal = await getPenmtBalance(publicClient, receiver);
        return bal > before ? bal : null;
      },
      { timeoutMs: 60_000 },
    );
    record(
      "C gas pack + transfer",
      "PASS",
      `pack=${result.feeTxHash} transfer=${result.transferTxHash}`,
    );
  } else {
    record("C gas pack + transfer", "SKIP", "TKN_ALLOW_GAS_PACK!=1");
  }

  // —— A3 redeem (fund rail like WithdrawSheet) ——
  if (allowRedeem) {
    let destId = env("METTAL_STG_DESTINATION_ID");
    if (!destId) {
      const banks = await listDestinations(apiUrl, accessToken, "PE", "PENMT");
      const match = banks.find((b) => b.bankAccount?.replace(/\s/g, "") === cci);
      if (match) {
        destId = match.id;
        record("A3 use preferred destination", "PASS", match.bankAccount);
      } else if (banks[0]) {
        destId = banks[0].id;
        record(
          "A3 use existing destination",
          "PASS",
          `${banks[0].bankAccount} (preferred CCI not registered)`,
        );
      } else if (allowRegisterDest) {
        const created = await registerDestination(apiUrl, accessToken, cci);
        destId = created.id;
        record("A3 register destination", "PASS", cci);
      } else {
        throw new Error(
          "No destinations; set METTAL_STG_ALLOW_REGISTER_DESTINATION=1 or METTAL_STG_DESTINATION_ID",
        );
      }
    }

    balances = await getBalances(apiUrl, accessToken);
    if (balances.redeemBalance < redeemMinor) {
      const redeemAddr = await ensureRedeemAddress(apiUrl, accessToken);
      const beforeRedeem = balances.redeemBalance;
      const decimals = await getPenmtDecimals(publicClient);
      const amountMajor = (redeemMinor / 100).toFixed(2);
      // need a bit of ETH for transfer — pack if drained
      const result = await sendPenmt({
        publicClient,
        walletClient,
        account,
        receiver: redeemAddr.address,
        amountMajor,
      });
      record(
        "A3 fund Mettal redeem address",
        "PASS",
        `to=${redeemAddr.address} tx=${result.transferTxHash}`,
      );
      balances = await poll(
        "redeem balance credit",
        async () => {
          const b = await getBalances(apiUrl, accessToken);
          return b.redeemBalance >= beforeRedeem + redeemMinor ? b : null;
        },
        { timeoutMs: 180_000, intervalMs: 8_000 },
      );
      record("A3 redeem balance credited", "PASS", `redeem=${balances.redeemBalance}`);
    } else {
      record("A3 fund redeem rail", "SKIP", `already redeem=${balances.redeemBalance}`);
    }

    const quote = await redeemQuote(apiUrl, accessToken, {
      amountMinor: redeemMinor,
      destinationId: destId,
    });
    record("A3 redeem quote", "PASS", quote.quoteId);
    const authorized = await authorizeRedeem(apiUrl, accessToken, {
      quoteId: quote.quoteId,
      destinationId: destId,
      idempotencyKey: randomUUID(),
    });
    record(
      "A3 redeem authorize",
      "PASS",
      `tx=${authorized.transactionId} status=${authorized.status}`,
    );
    const status = await poll(
      "redeem status",
      async () => {
        const s = await redeemStatus(apiUrl, accessToken, authorized.transactionId);
        if (["success", "completed", "failed", "cancelled"].includes(
          String(s.status).toLowerCase(),
        )) {
          return s;
        }
        return null;
      },
      { timeoutMs: 120_000, intervalMs: 8_000 },
    ).catch(async () => redeemStatus(apiUrl, accessToken, authorized.transactionId));
    record("A3 redeem status", "PASS", status.status);
  } else {
    record("A3 bank redeem", "SKIP", "METTAL_STG_ALLOW_REDEEM!=1");
  }

  console.log("\n=== summary ===");
  for (const r of results) {
    console.log(`${r.status.padEnd(4)} ${r.step}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  if (results.some((r) => r.status === "FAIL")) process.exit(1);
}

main().catch((err) => {
  console.error("\nBATTERY FAILED:", err instanceof Error ? err.message : err);
  if (results.length) {
    console.log("\n=== summary ===");
    for (const r of results) {
      console.log(`${r.status.padEnd(4)} ${r.step}${r.detail ? ` — ${r.detail}` : ""}`);
    }
  }
  process.exit(1);
});
