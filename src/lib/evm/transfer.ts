import {
  erc20Abi,
  formatUnits,
  maxUint256,
  type Account,
  type Address,
  type Hash,
  type WalletClient,
} from "viem";
import { withDeviceVaultSeed } from "@/lib/vault/ceremony";
import { ensurePrimaryEvmAccount } from "@/lib/vault/evm";
import type { DeviceVaultRecord } from "@/lib/vault/types";
import { minProtocolAmountError } from "@/lib/protocol/links";
import {
  EVM_CHAIN,
  GAS_PACK_CONTRACT_ADDRESS,
  PENMT_TOKEN_ADDRESS,
} from "@/lib/evm/config";
import {
  getPublicClient,
  getWalletClient,
  getWritePublicClient,
} from "@/lib/evm/client";
import { gasPackAbi, getPackPrice } from "@/lib/evm/gas-pack";
import { HOP_SEED_TARGET, planSendGas } from "@/lib/evm/gas-virality";
import { parsePenmtMajorToRaw } from "@/lib/evm/penmt";

export type PenmtTransferResult = {
  transferTxHash: Hash;
  approveTxHash: Hash | null;
  /** Gas-pack purchase tx, if one ran in this send. */
  feeTxHash: Hash | null;
  /** ETH gift to receiver, if any. */
  giftTxHash: Hash | null;
  /** Pack price paid in PENMT (0 if no pack bought). */
  feeAmountRaw: bigint;
  feeAmountFormatted: string;
  principalRaw: bigint;
  sender: Address;
  receiver: Address;
  vault: DeviceVaultRecord;
};

export class GasPackRequiredError extends Error {
  readonly code = "GAS_PACK_REQUIRED" as const;
  constructor(
    message: string,
    readonly canSelfServe: boolean,
  ) {
    super(message);
    this.name = "GasPackRequiredError";
  }
}

/**
 * Soft floors near Base Sepolia realities (~0.001–0.01 gwei).
 * Too-high maxFeePerGas makes viem reserve gasLimit*maxFee up front and
 * falsely report "insufficient funds" on ~1.5e-5 ETH wallets.
 */
const MIN_PRIORITY_FEE = 1_000_000n; // 0.001 gwei
const MIN_MAX_FEE = 20_000_000n; // 0.02 gwei
const RECEIPT_TIMEOUT_MS = 20_000;

async function getNonces(sender: Address): Promise<{
  latest: number;
  pending: number;
}> {
  const client = getWritePublicClient();
  const [latest, pending] = await Promise.all([
    client.getTransactionCount({ address: sender, blockTag: "latest" }),
    client.getTransactionCount({ address: sender, blockTag: "pending" }),
  ]);
  return { latest, pending };
}

async function waitForReceipt(hash: Hash): Promise<void> {
  const client = getWritePublicClient();
  try {
    const receipt = await client.waitForTransactionReceipt({
      hash,
      confirmations: 1,
      timeout: RECEIPT_TIMEOUT_MS,
    });
    if (receipt.status !== "success") {
      throw new Error("La transacción falló en la cadena.");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/timed out|timeout/i.test(msg)) throw err;

    // Final check — often mined just after the waiter gives up.
    const receipt = await client
      .getTransactionReceipt({ hash })
      .catch(() => null);
    if (receipt?.status === "success") return;
    if (receipt?.status === "reverted") {
      throw new Error("La transacción falló en la cadena.");
    }
    throw new Error(
      "La red tardó demasiado en confirmar. Revisa el envío en unos segundos; puede haberse completado.",
    );
  }
}

async function estimateSendFees(bumpBps = 0n): Promise<{
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
}> {
  const client = getWritePublicClient();
  const fees = await client.estimateFeesPerGas();
  let tip = fees.maxPriorityFeePerGas ?? MIN_PRIORITY_FEE;
  let max = fees.maxFeePerGas ?? MIN_MAX_FEE;

  if (bumpBps > 0n) {
    tip += (tip * bumpBps) / 10_000n;
    max += (max * bumpBps) / 10_000n;
  }

  if (tip < MIN_PRIORITY_FEE) tip = MIN_PRIORITY_FEE;
  if (max < MIN_MAX_FEE) max = MIN_MAX_FEE;
  if (max < tip) max = tip;

  return { maxPriorityFeePerGas: tip, maxFeePerGas: max };
}

function mapSendError(err: unknown, walletAddress?: Address): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (/timed out|timeout|tardó demasiado/i.test(msg)) {
    return new Error(
      "La red tardó demasiado en confirmar. Revisa el envío en unos segundos; puede haberse completado.",
    );
  }
  if (/insufficient funds/i.test(msg)) {
    const addr = walletAddress ? ` Cuenta TKN: ${walletAddress}` : "";
    return new Error(
      `No tienes suficiente ETH en Base para pagar el gas de la red.${addr}`,
    );
  }
  if (/ERC20InsufficientAllowance|0xfb8f41b2/i.test(msg)) {
    return new Error(
      "Falta autorización del token para la recarga de red. Inténtalo de nuevo.",
    );
  }
  if (err instanceof GasPackRequiredError) return err;
  return err instanceof Error ? err : new Error(msg);
}

function isNonceConflict(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /replacement transaction underpriced|nonce too low|already known|replacement fee too low/i.test(
    msg,
  );
}

/** Replace a stuck mempool tx at `nonce` with a no-op self-transfer. */
async function cancelNonce(input: {
  wallet: WalletClient;
  account: Account;
  sender: Address;
  nonce: number;
}): Promise<void> {
  // Modest bump so cancel replaces without locking more ETH than the wallet has.
  const fees = await estimateSendFees(10_000n); // +100%
  const hash = await input.wallet.sendTransaction({
    account: input.account,
    chain: EVM_CHAIN,
    to: input.sender,
    value: 0n,
    nonce: input.nonce,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    maxFeePerGas: fees.maxFeePerGas,
  });
  await waitForReceipt(hash);
}

/**
 * If pending > latest, wait briefly for natural clearance, then cancel the
 * stuck nonce so the send can proceed.
 */
async function ensureClearNonce(input: {
  wallet: WalletClient;
  account: Account;
  sender: Address;
  onClearing?: () => void;
}): Promise<number> {
  let { latest, pending } = await getNonces(input.sender);
  if (pending <= latest) return pending;

  input.onClearing?.();

  // Give a prior broadcast a short chance to mine before canceling it.
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2_000));
    ({ latest, pending } = await getNonces(input.sender));
    if (pending <= latest) return pending;
  }

  // Still stuck — cancel nonce `latest` (the gap).
  await cancelNonce({
    wallet: input.wallet,
    account: input.account,
    sender: input.sender,
    nonce: latest,
  });

  ({ pending } = await getNonces(input.sender));
  return pending;
}

async function writeContractSequential(input: {
  wallet: WalletClient;
  account: Account;
  sender: Address;
  nonce: number;
  request: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  };
}): Promise<{ hash: Hash; nextNonce: number }> {
  const sendOnce = async (nonce: number, bumpBps: bigint) => {
    const fees = await estimateSendFees(bumpBps);
    const hash = await input.wallet.writeContract({
      address: input.request.address,
      abi: input.request.abi,
      functionName: input.request.functionName,
      args: input.request.args,
      account: input.account,
      chain: EVM_CHAIN,
      nonce,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      maxFeePerGas: fees.maxFeePerGas,
    } as never);
    await waitForReceipt(hash);
    return hash;
  };

  try {
    const hash = await sendOnce(input.nonce, 0n);
    return { hash, nextNonce: input.nonce + 1 };
  } catch (err) {
    if (!isNonceConflict(err)) throw mapSendError(err, input.sender);

    // Clear any stuck mempool tx, then retry once with a fresh nonce + higher fees.
    const nonce = await ensureClearNonce({
      wallet: input.wallet,
      account: input.account,
      sender: input.sender,
    });
    try {
      const hash = await sendOnce(nonce, 10_000n); // +100%
      return { hash, nextNonce: nonce + 1 };
    } catch (err2) {
      throw mapSendError(err2, input.sender);
    }
  }
}

async function sendEthSequential(input: {
  wallet: WalletClient;
  account: Account;
  sender: Address;
  nonce: number;
  to: Address;
  value: bigint;
}): Promise<{ hash: Hash; nextNonce: number }> {
  const sendOnce = async (nonce: number, bumpBps: bigint) => {
    const fees = await estimateSendFees(bumpBps);
    const hash = await input.wallet.sendTransaction({
      account: input.account,
      chain: EVM_CHAIN,
      to: input.to,
      value: input.value,
      nonce,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      maxFeePerGas: fees.maxFeePerGas,
    });
    await waitForReceipt(hash);
    return hash;
  };

  try {
    const hash = await sendOnce(input.nonce, 0n);
    return { hash, nextNonce: input.nonce + 1 };
  } catch (err) {
    if (!isNonceConflict(err)) throw mapSendError(err, input.sender);
    const nonce = await ensureClearNonce({
      wallet: input.wallet,
      account: input.account,
      sender: input.sender,
    });
    try {
      const hash = await sendOnce(nonce, 10_000n);
      return { hash, nextNonce: nonce + 1 };
    } catch (err2) {
      throw mapSendError(err2, input.sender);
    }
  }
}

export type SendProgress =
  | "unlock"
  | "clearing"
  | "approve"
  | "pack"
  | "gift"
  | "transfer"
  | "done";

/**
 * Biometric-gated PENMT transfer (gas virality protocol).
 * Optional gas pack → optional ETH gift to receiver → PENMT transfer.
 * No per-transfer FeeContract commission.
 */
export async function sendPenmtWithFee(input: {
  vault: DeviceVaultRecord;
  receiver: Address;
  /** Major-unit amount string, e.g. "10.00". */
  amount: string;
  onProgress?: (step: SendProgress) => void;
}): Promise<PenmtTransferResult> {
  const publicClient = getPublicClient();
  const principalRaw = await parsePenmtMajorToRaw(input.amount);
  if (principalRaw <= 0n) throw new Error("El monto debe ser mayor que cero.");
  const minError = minProtocolAmountError(input.amount);
  if (minError) throw new Error(minError);

  const [decimals, packPrice] = await Promise.all([
    publicClient.readContract({
      address: PENMT_TOKEN_ADDRESS,
      abi: erc20Abi,
      functionName: "decimals",
    }),
    getPackPrice(PENMT_TOKEN_ADDRESS),
  ]);

  const report = (step: SendProgress) => {
    input.onProgress?.(step);
  };

  let senderForError: Address | undefined;
  try {
    report("unlock");
    return await withDeviceVaultSeed(input.vault, async (mnemonic) => {
      const { vault, signer } = await ensurePrimaryEvmAccount(
        input.vault,
        mnemonic,
      );
      const sender = signer.address;
      senderForError = sender;
      const receiver = input.receiver;

      const [penmtBalance, senderEth, receiverEth] = await Promise.all([
        publicClient.readContract({
          address: PENMT_TOKEN_ADDRESS,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [sender],
        }),
        publicClient.getBalance({ address: sender }),
        publicClient.getBalance({ address: receiver }),
      ]);

      if (penmtBalance < principalRaw) {
        throw new Error(
          `Saldo insuficiente. Necesitas ${formatUnits(principalRaw, decimals)} PENMT.`,
        );
      }

      let plan = planSendGas({ senderEth, receiverEth });
      let packAmountRaw = 0n;

      if (plan.needsPack) {
        if (!plan.canSelfServePack) {
          throw new GasPackRequiredError(
            "Necesitas una recarga de red para continuar.",
            false,
          );
        }
        if (penmtBalance < principalRaw + packPrice) {
          throw new GasPackRequiredError(
            `Para enviarle saldo de red a esta persona, primero haz una recarga de red. Necesitas ${formatUnits(packPrice, decimals)} PENMT extra.`,
            true,
          );
        }
        packAmountRaw = packPrice;
      }

      const wallet = getWalletClient(signer);
      let nonce = await ensureClearNonce({
        wallet,
        account: signer,
        sender,
        onClearing: () => report("clearing"),
      });

      let approveTxHash: Hash | null = null;
      let feeTxHash: Hash | null = null;
      let giftTxHash: Hash | null = null;

      if (packAmountRaw > 0n) {
        const writePublic = getWritePublicClient();
        const readAllowance = () =>
          writePublic.readContract({
            address: PENMT_TOKEN_ADDRESS,
            abi: erc20Abi,
            functionName: "allowance",
            args: [sender, GAS_PACK_CONTRACT_ADDRESS],
          });

        const ensurePackApproval = async () => {
          const allowance = await readAllowance();
          if (allowance >= packAmountRaw) return;

          report("approve");
          if (allowance > 0n) {
            const cleared = await writeContractSequential({
              wallet,
              account: signer,
              sender,
              nonce,
              request: {
                address: PENMT_TOKEN_ADDRESS,
                abi: erc20Abi,
                functionName: "approve",
                args: [GAS_PACK_CONTRACT_ADDRESS, 0n],
              },
            });
            approveTxHash = cleared.hash;
            nonce = cleared.nextNonce;
          }
          const approved = await writeContractSequential({
            wallet,
            account: signer,
            sender,
            nonce,
            request: {
              address: PENMT_TOKEN_ADDRESS,
              abi: erc20Abi,
              functionName: "approve",
              args: [GAS_PACK_CONTRACT_ADDRESS, maxUint256],
            },
          });
          approveTxHash = approved.hash;
          nonce = approved.nextNonce;
        };

        await ensurePackApproval();

        report("pack");
        try {
          const bought = await writeContractSequential({
            wallet,
            account: signer,
            sender,
            nonce,
            request: {
              address: GAS_PACK_CONTRACT_ADDRESS,
              abi: gasPackAbi,
              functionName: "buyGasPack",
              args: [PENMT_TOKEN_ADDRESS, packAmountRaw],
            },
          });
          feeTxHash = bought.hash;
          nonce = bought.nextNonce;
        } catch (err) {
          if (
            !/ERC20InsufficientAllowance|0xfb8f41b2|autorización del token/i.test(
              err instanceof Error ? err.message : String(err),
            )
          ) {
            throw err;
          }
          report("approve");
          const allowance = await readAllowance();
          if (allowance > 0n && allowance < maxUint256) {
            const cleared = await writeContractSequential({
              wallet,
              account: signer,
              sender,
              nonce,
              request: {
                address: PENMT_TOKEN_ADDRESS,
                abi: erc20Abi,
                functionName: "approve",
                args: [GAS_PACK_CONTRACT_ADDRESS, 0n],
              },
            });
            nonce = cleared.nextNonce;
          }
          if (allowance < maxUint256) {
            const approved = await writeContractSequential({
              wallet,
              account: signer,
              sender,
              nonce,
              request: {
                address: PENMT_TOKEN_ADDRESS,
                abi: erc20Abi,
                functionName: "approve",
                args: [GAS_PACK_CONTRACT_ADDRESS, maxUint256],
              },
            });
            approveTxHash = approved.hash;
            nonce = approved.nextNonce;
          }
          const bought = await writeContractSequential({
            wallet,
            account: signer,
            sender,
            nonce,
            request: {
              address: GAS_PACK_CONTRACT_ADDRESS,
              abi: gasPackAbi,
              functionName: "buyGasPack",
              args: [PENMT_TOKEN_ADDRESS, packAmountRaw],
            },
          });
          feeTxHash = bought.hash;
          nonce = bought.nextNonce;
        }

        // Re-plan after pack (sender should be near packTopUpTarget).
        const [senderEthAfter, receiverEthAfter] = await Promise.all([
          publicClient.getBalance({ address: sender }),
          publicClient.getBalance({ address: receiver }),
        ]);
        plan = planSendGas({
          senderEth: senderEthAfter,
          receiverEth: receiverEthAfter,
        });
      }

      if (plan.receiverGift.kind === "top_up" && plan.receiverGift.gift > 0n) {
        report("gift");
        const gifted = await sendEthSequential({
          wallet,
          account: signer,
          sender,
          nonce,
          to: receiver,
          value: plan.receiverGift.gift,
        });
        giftTxHash = gifted.hash;
        nonce = gifted.nextNonce;
      }

      report("transfer");
      const transferred = await writeContractSequential({
        wallet,
        account: signer,
        sender,
        nonce,
        request: {
          address: PENMT_TOKEN_ADDRESS,
          abi: erc20Abi,
          functionName: "transfer",
          args: [receiver, principalRaw],
        },
      });

      report("done");
      return {
        transferTxHash: transferred.hash,
        approveTxHash,
        feeTxHash,
        giftTxHash,
        feeAmountRaw: packAmountRaw,
        feeAmountFormatted: formatFeeMajor(packAmountRaw, decimals),
        principalRaw,
        sender,
        receiver,
        vault,
      };
    });
  } catch (err) {
    throw mapSendError(err, senderForError);
  }
}

/** Preview gas/pack requirements for a send (no per-transfer commission). */
export async function getPenmtFeePreview(input: {
  sender: Address;
  receiver?: Address;
  /** Major-unit amount string, e.g. "10.00". */
  amount: string;
}): Promise<{
  feeAmountRaw: bigint;
  feeAmountFormatted: string;
  skipped: boolean;
  needsPack: boolean;
  canSelfServePack: boolean;
  canAfford: boolean;
  gasNote: string;
  packCostFormatted: string | null;
  totalCostFormatted: string | null;
}> {
  const publicClient = getPublicClient();
  const principalRaw = await parsePenmtMajorToRaw(input.amount);
  const [decimals, packPrice, penmtBalance, senderEth, receiverEth] =
    await Promise.all([
      publicClient.readContract({
        address: PENMT_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: "decimals",
      }),
      getPackPrice(PENMT_TOKEN_ADDRESS),
      publicClient.readContract({
        address: PENMT_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [input.sender],
      }),
      publicClient.getBalance({ address: input.sender }),
      input.receiver
        ? publicClient.getBalance({ address: input.receiver })
        : Promise.resolve(HOP_SEED_TARGET),
    ]);

  const plan = planSendGas({ senderEth, receiverEth });
  const needsPack = plan.needsPack;
  const requiredRaw = needsPack ? principalRaw + packPrice : principalRaw;
  const canAfford = penmtBalance >= requiredRaw;
  const packAmountRaw = needsPack && canAfford ? packPrice : 0n;

  let gasNote = "Envío sin comisión de red.";
  let packCostFormatted: string | null = null;
  let totalCostFormatted: string | null = null;
  if (needsPack && !plan.canSelfServePack) {
    gasNote = "Necesitas una recarga de red para continuar.";
  } else if (needsPack) {
    packCostFormatted = formatFeeMajor(packPrice, decimals);
    totalCostFormatted = formatFeeMajor(principalRaw + packPrice, decimals);
    gasNote = `Para poder hacer este envío se hará primero una recarga de red de costo ${packCostFormatted} PENMT. Costo total del envío ${totalCostFormatted} PENMT.`;
  } else if (plan.receiverGift.kind === "top_up") {
    gasNote = "Sin comisión. Se enviará un poco de saldo de red al destinatario.";
  }

  return {
    feeAmountRaw: packAmountRaw,
    feeAmountFormatted: formatFeeMajor(packAmountRaw, decimals),
    skipped: needsPack && packAmountRaw === 0n,
    needsPack,
    canSelfServePack: plan.canSelfServePack,
    canAfford,
    gasNote,
    packCostFormatted,
    totalCostFormatted,
  };
}

/** Show enough decimals for tiny on-chain amounts (avoid "0.00" for 0.00001). */
function formatFeeMajor(raw: bigint, decimals: number): string {
  if (raw === 0n) return "0";
  const major = formatUnits(raw, decimals);
  const asNumber = Number(major);
  if (!Number.isFinite(asNumber)) return major;
  const places = Math.min(decimals, 6);
  const fixed = asNumber.toFixed(places);
  if (asNumber >= 0.01) {
    return asNumber.toFixed(2).replace(/\.00$/, "");
  }
  return fixed.replace(/\.?0+$/, "") || "0";
}
