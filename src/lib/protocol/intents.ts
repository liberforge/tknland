import {
  getIntent,
  listIntents,
  putIntent,
} from "@/lib/vault/db";
import type { ProtocolToken } from "@/lib/protocol/links";
import {
  newHandshakeId,
  normalizeProtocolAmount,
} from "@/lib/protocol/links";
import type { PaymentIntent } from "@/lib/protocol/types";

export const INTENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type PayMatchResult =
  | { kind: "no_intent" }
  | { kind: "completed"; intent: PaymentIntent }
  | { kind: "expired"; intent: PaymentIntent }
  | { kind: "mismatch"; intent: PaymentIntent; reason: string }
  | { kind: "match"; intent: PaymentIntent };

function isExpired(intent: PaymentIntent, now = Date.now()): boolean {
  return (
    intent.status === "pending" && now - intent.createdAt > INTENT_TTL_MS
  );
}

async function expireIfNeeded(intent: PaymentIntent): Promise<PaymentIntent> {
  if (!isExpired(intent)) return intent;
  if (intent.status === "expired") return intent;
  const expired: PaymentIntent = { ...intent, status: "expired" };
  await putIntent(expired);
  return expired;
}

export async function createPaymentIntent(input: {
  token: ProtocolToken;
  amount: string;
  label?: string;
}): Promise<PaymentIntent> {
  const amount = normalizeProtocolAmount(input.amount);
  if (!amount) throw new Error("Monto inválido.");

  const intent: PaymentIntent = {
    id: newHandshakeId(),
    token: input.token,
    amount,
    label: input.label,
    createdAt: Date.now(),
    status: "pending",
  };
  await putIntent(intent);
  return intent;
}

export async function getPaymentIntent(
  id: string,
): Promise<PaymentIntent | undefined> {
  const intent = await getIntent(id);
  if (!intent) return undefined;
  return expireIfNeeded(intent);
}

export async function matchPayReply(input: {
  id: string;
  token: ProtocolToken;
  amount: string;
}): Promise<PayMatchResult> {
  const amount = normalizeProtocolAmount(input.amount);
  if (!amount) {
    return {
      kind: "mismatch",
      intent: {
        id: input.id,
        token: input.token,
        amount: input.amount,
        createdAt: 0,
        status: "pending",
      },
      reason: "Monto inválido en el enlace.",
    };
  }

  const intent = await getPaymentIntent(input.id);
  if (!intent) return { kind: "no_intent" };

  if (intent.status === "completed") {
    return { kind: "completed", intent };
  }
  if (intent.status === "expired") {
    return { kind: "expired", intent };
  }

  if (intent.token !== input.token || intent.amount !== amount) {
    return {
      kind: "mismatch",
      intent,
      reason:
        "El monto o el token no coinciden con tu envío pendiente. El enlace puede haber sido alterado.",
    };
  }

  return { kind: "match", intent };
}

export async function completePaymentIntent(
  id: string,
  txHash: `0x${string}`,
): Promise<PaymentIntent> {
  const intent = await getPaymentIntent(id);
  if (!intent) {
    throw new Error("No se encontró el envío pendiente.");
  }
  if (intent.status === "completed") {
    return intent;
  }
  const completed: PaymentIntent = {
    ...intent,
    status: "completed",
    txHash,
  };
  await putIntent(completed);
  return completed;
}

/** Mark a solicit (no prior invite) as a completed local record for replay protection. */
export async function recordCompletedPay(input: {
  id: string;
  token: ProtocolToken;
  amount: string;
  txHash: `0x${string}`;
  label?: string;
}): Promise<PaymentIntent> {
  const amount = normalizeProtocolAmount(input.amount);
  if (!amount) throw new Error("Monto inválido.");

  const existing = await getPaymentIntent(input.id);
  if (existing?.status === "completed") return existing;

  const intent: PaymentIntent = {
    id: input.id,
    token: input.token,
    amount,
    label: input.label,
    createdAt: existing?.createdAt ?? Date.now(),
    status: "completed",
    txHash: input.txHash,
  };
  await putIntent(intent);
  return intent;
}

export async function listPaymentIntents(): Promise<PaymentIntent[]> {
  const all = await listIntents();
  const updated = await Promise.all(all.map((intent) => expireIfNeeded(intent)));
  return updated;
}
