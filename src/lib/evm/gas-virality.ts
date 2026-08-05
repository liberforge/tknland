import { formatUnits, parseEther } from "viem";

/** See docs/GAS_VIRALITY_PROTOCOL.md */

/** Below this, sender must buy a gas pack before sending. */
export const PACK_FLOOR = parseEther("0.000008"); // 0.8e-5

/** Sender band: may top receiver up to terminal seed. */
export const TERMINAL_SENDER_MIN = parseEther("0.000022"); // 2.2e-5

/** Sender band: may top receiver up to hop seed (1 extra hop). */
export const HOP_SENDER_MIN = parseEther("0.000035"); // 3.5e-5

/** Receiver top-up target enabling 1 extra hop. */
export const HOP_SEED_TARGET = parseEther("0.00002"); // 2e-5

/** Receiver top-up target for 1 send only. */
export const TERMINAL_SEED_TARGET = parseEther("0.00001"); // 1e-5

/**
 * Indicative ETH→PENMT rate for UX (~S/7,000 per ETH; PENMT ≈ S/1).
 * Not a live oracle — display only.
 */
export const INDICATIVE_ETH_PENMT_RATE = 7000n;

/** ~1 send budget on Base (approve + a few ERC-20 transfers). */
export const APPROX_SEND_ETH_COST = TERMINAL_SEED_TARGET;

export type ReceiverGiftPlan =
  | { kind: "none" }
  | { kind: "top_up"; target: bigint; gift: bigint }
  | { kind: "buy_pack_first" };

export type SendGasPlan = {
  /** Sender must purchase a gas pack before this send can proceed. */
  needsPack: boolean;
  /** Sender ETH is at/above pack floor (can try self-serve buyGasPack). */
  canSelfServePack: boolean;
  receiverGift: ReceiverGiftPlan;
};

/**
 * Plan gas actions for a PENMT send (virality protocol).
 * `gift = max(0, target - receiverEth)` when topping up.
 */
export function planSendGas(input: {
  senderEth: bigint;
  receiverEth: bigint;
}): SendGasPlan {
  const { senderEth, receiverEth } = input;
  const receiverCold = receiverEth < PACK_FLOOR;

  if (senderEth < PACK_FLOOR) {
    return {
      needsPack: true,
      canSelfServePack: false,
      receiverGift: { kind: "none" },
    };
  }

  if (senderEth >= HOP_SENDER_MIN) {
    const target = HOP_SEED_TARGET;
    if (receiverEth < target) {
      return {
        needsPack: false,
        canSelfServePack: true,
        receiverGift: {
          kind: "top_up",
          target,
          gift: target - receiverEth,
        },
      };
    }
    return {
      needsPack: false,
      canSelfServePack: true,
      receiverGift: { kind: "none" },
    };
  }

  if (senderEth >= TERMINAL_SENDER_MIN) {
    const target = TERMINAL_SEED_TARGET;
    if (receiverEth < target) {
      return {
        needsPack: false,
        canSelfServePack: true,
        receiverGift: {
          kind: "top_up",
          target,
          gift: target - receiverEth,
        },
      };
    }
    return {
      needsPack: false,
      canSelfServePack: true,
      receiverGift: { kind: "none" },
    };
  }

  // Mid-low:  packFloor … < terminalSenderMin
  if (receiverCold) {
    return {
      needsPack: true,
      canSelfServePack: true,
      receiverGift: { kind: "buy_pack_first" },
    };
  }

  return {
    needsPack: false,
    canSelfServePack: true,
    receiverGift: { kind: "none" },
  };
}

export type NetworkCreditEstimate = {
  /** ETH balance valued in PENMT at the indicative rate. */
  penmtFormatted: string;
  /** Floor of ethBalance / APPROX_SEND_ETH_COST; 0 below pack floor. */
  approxSends: number;
  /** True when the next send will likely auto-buy a pack. */
  needsPackSoon: boolean;
};

/** UX estimate of network credit from on-chain ETH wei. */
export function estimateNetworkCredit(ethWei: bigint): NetworkCreditEstimate {
  const penmtRaw = ethWei * INDICATIVE_ETH_PENMT_RATE;
  const penmtMajor = Number(formatUnits(penmtRaw, 18));
  const penmtFormatted =
    penmtMajor >= 1
      ? penmtMajor.toFixed(2)
      : penmtMajor >= 0.01
        ? penmtMajor.toFixed(2)
        : penmtMajor.toFixed(4);

  const needsPackSoon = ethWei < PACK_FLOOR;
  const approxSends = needsPackSoon
    ? 0
    : Number(ethWei / APPROX_SEND_ETH_COST);

  return { penmtFormatted, approxSends, needsPackSoon };
}
