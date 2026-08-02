import {
  erc20Abi,
  formatUnits,
  maxUint256,
  type Account,
  type Address,
  type Hash,
  type WalletClient,
} from "viem";
import { baseSepolia } from "viem/chains";
import { withDeviceVaultSeed } from "@/lib/vault/ceremony";
import { ensurePrimaryEvmAccount } from "@/lib/vault/evm";
import type { DeviceVaultRecord } from "@/lib/vault/types";
import {
  FEE_CONTRACT_ADDRESS,
  PENMT_TOKEN_ADDRESS,
} from "@/lib/evm/config";
import {
  getPublicClient,
  getWalletClient,
  getWritePublicClient,
} from "@/lib/evm/client";
import { feeContractAbi, getMinFeeAmount } from "@/lib/evm/fee";
import { parsePenmtMajorToRaw } from "@/lib/evm/penmt";

export type PenmtTransferResult = {
  transferTxHash: Hash;
  approveTxHash: Hash | null;
  feeTxHash: Hash | null;
  feeAmountRaw: bigint;
  feeAmountFormatted: string;
  principalRaw: bigint;
  sender: Address;
  receiver: Address;
  vault: DeviceVaultRecord;
};

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
      "Falta autorización del token para la comisión. Inténtalo de nuevo.",
    );
  }
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
    chain: baseSepolia,
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
      chain: baseSepolia,
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

export type SendProgress =
  | "unlock"
  | "clearing"
  | "approve"
  | "transfer"
  | "fee"
  | "done";

/**
 * Biometric-gated PENMT transfer. When the sender can cover principal + min fee:
 * approve (if needed) → processFee (tops up ETH) → transfer.
 * Otherwise transfer only (fee 0, no top-up). Near-zero ETH still needs an
 * operator bootstrap (fee-contract CLI) outside this path.
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

  const configuredFee = await getMinFeeAmount(PENMT_TOKEN_ADDRESS);
  const decimals = await publicClient.readContract({
    address: PENMT_TOKEN_ADDRESS,
    abi: erc20Abi,
    functionName: "decimals",
  });

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

      const balance = await publicClient.readContract({
        address: PENMT_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [sender],
      });

      if (balance < principalRaw) {
        throw new Error(
          `Saldo insuficiente. Necesitas ${formatUnits(principalRaw, decimals)} PENMT.`,
        );
      }

      const chargeFee =
        configuredFee > 0n && balance >= principalRaw + configuredFee;
      const feeAmountRaw = chargeFee ? configuredFee : 0n;

      const wallet = getWalletClient(signer);
      let nonce = await ensureClearNonce({
        wallet,
        account: signer,
        sender,
        onClearing: () => report("clearing"),
      });

      let approveTxHash: Hash | null = null;
      let feeTxHash: Hash | null = null;

      // Fee + ETH top-up first so transfer has gas.
      if (feeAmountRaw > 0n) {
        const writePublic = getWritePublicClient();
        const readAllowance = () =>
          writePublic.readContract({
            address: PENMT_TOKEN_ADDRESS,
            abi: erc20Abi,
            functionName: "allowance",
            args: [sender, FEE_CONTRACT_ADDRESS],
          });

        const ensureFeeApproval = async () => {
          const allowance = await readAllowance();
          // transfer() does not use allowance — only processFee pulls `feeAmountRaw`.
          if (allowance >= feeAmountRaw) return;

          report("approve");
          // Some ERC-20s require clearing a non-zero allowance before raising it.
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
                args: [FEE_CONTRACT_ADDRESS, 0n],
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
              args: [FEE_CONTRACT_ADDRESS, maxUint256],
            },
          });
          approveTxHash = approved.hash;
          nonce = approved.nextNonce;
        };

        await ensureFeeApproval();

        report("fee");
        try {
          const feePaid = await writeContractSequential({
            wallet,
            account: signer,
            sender,
            nonce,
            request: {
              address: FEE_CONTRACT_ADDRESS,
              abi: feeContractAbi,
              functionName: "processFee",
              args: [
                PENMT_TOKEN_ADDRESS,
                feeAmountRaw,
                sender,
                sender,
                receiver,
              ],
            },
          });
          feeTxHash = feePaid.hash;
          nonce = feePaid.nextNonce;
        } catch (err) {
          // Stale allowance read — force approve max and retry processFee once.
          if (!/ERC20InsufficientAllowance|0xfb8f41b2|autorización del token/i.test(
            err instanceof Error ? err.message : String(err),
          )) {
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
                args: [FEE_CONTRACT_ADDRESS, 0n],
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
                args: [FEE_CONTRACT_ADDRESS, maxUint256],
              },
            });
            approveTxHash = approved.hash;
            nonce = approved.nextNonce;
          }
          const feePaid = await writeContractSequential({
            wallet,
            account: signer,
            sender,
            nonce,
            request: {
              address: FEE_CONTRACT_ADDRESS,
              abi: feeContractAbi,
              functionName: "processFee",
              args: [
                PENMT_TOKEN_ADDRESS,
                feeAmountRaw,
                sender,
                sender,
                receiver,
              ],
            },
          });
          feeTxHash = feePaid.hash;
          nonce = feePaid.nextNonce;
        }
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
        feeAmountRaw,
        feeAmountFormatted: formatFeeMajor(feeAmountRaw, decimals),
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

/** Preview the fee that would actually be charged for this send. */
export async function getPenmtFeePreview(input: {
  sender: Address;
  /** Major-unit amount string, e.g. "10.00". */
  amount: string;
}): Promise<{
  feeAmountRaw: bigint;
  feeAmountFormatted: string;
  skipped: boolean;
}> {
  const publicClient = getPublicClient();
  const principalRaw = await parsePenmtMajorToRaw(input.amount);
  const [configuredFee, decimals, balance] = await Promise.all([
    getMinFeeAmount(PENMT_TOKEN_ADDRESS),
    publicClient.readContract({
      address: PENMT_TOKEN_ADDRESS,
      abi: erc20Abi,
      functionName: "decimals",
    }),
    publicClient.readContract({
      address: PENMT_TOKEN_ADDRESS,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [input.sender],
    }),
  ]);

  const chargeFee =
    configuredFee > 0n && balance >= principalRaw + configuredFee;
  const feeAmountRaw = chargeFee ? configuredFee : 0n;

  return {
    feeAmountRaw,
    feeAmountFormatted: formatFeeMajor(feeAmountRaw, decimals),
    skipped: !chargeFee && configuredFee > 0n,
  };
}

/** Show enough decimals for tiny on-chain fees (avoid "0.00" for 0.00001). */
function formatFeeMajor(raw: bigint, decimals: number): string {
  if (raw === 0n) return "0";
  const major = formatUnits(raw, decimals);
  const asNumber = Number(major);
  if (!Number.isFinite(asNumber)) return major;
  const places = Math.min(decimals, 6);
  const fixed = asNumber.toFixed(places);
  if (asNumber >= 0.01) {
    return asNumber.toFixed(2);
  }
  return fixed.replace(/\.?0+$/, "") || "0";
}
