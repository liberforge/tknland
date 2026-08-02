import type { ProtocolToken } from "@/lib/protocol/links";

export type PaymentIntentStatus = "pending" | "completed" | "expired";

export type PaymentIntent = {
  id: string;
  token: ProtocolToken;
  /** Major-unit amount string, e.g. "10.00". */
  amount: string;
  label?: string;
  createdAt: number;
  status: PaymentIntentStatus;
  txHash?: `0x${string}`;
};
