import { useEffect, useRef, useState } from "react";
import type { Hash } from "viem";
import {
  buildPayLink,
  buildReceiptLink,
  normalizeProtocolAmount,
  minProtocolAmountError,
  type HandshakeLink,
  type PayLink,
} from "@/lib/protocol/links";
import {
  completePaymentIntent,
  matchPayReply,
  recordCompletedPay,
} from "@/lib/protocol/intents";
import { shareText } from "@/lib/share";
import {
  getPenmtFeePreview,
  sendPenmtWithFee,
  type SendProgress,
} from "@/lib/evm/transfer";
import { withDeviceVaultSeed } from "@/lib/vault/ceremony";
import {
  ensurePrimaryEvmAccount,
  getPrimaryAddress,
} from "@/lib/vault/evm";
import type { DeviceVaultRecord } from "@/lib/vault/types";
import { DestinationAccount } from "@/components/DestinationAccount";

type HandshakeSheetProps = {
  open: boolean;
  link: HandshakeLink | null;
  vault: DeviceVaultRecord | null;
  mockBiometrics?: boolean;
  onClose: () => void;
  /** Create vault when accepting an invite without one. */
  onEnsureVault: () => Promise<DeviceVaultRecord>;
  onVaultUpdated?: (vault: DeviceVaultRecord) => void;
  onBalanceRefresh?: () => void;
};

type ResolvedPayLink = Omit<PayLink, "amount"> & { amount: string };

type Step =
  | { kind: "idle" }
  | { kind: "invite"; amount: string; id: string }
  | { kind: "working"; message: string }
  | {
      kind: "pay-ready";
      url: string;
      amount: string;
      message: string;
      shareMethod: "share" | "clipboard";
    }
  | {
      kind: "enter-amount";
      pay: PayLink;
      amountInput: string;
      amountError: string | null;
    }
  | {
      kind: "confirm";
      pay: ResolvedPayLink;
      feeFormatted: string | null;
      gasNote: string | null;
      packCostFormatted: string | null;
      totalCostFormatted: string | null;
      needsPack: boolean;
      canAfford: boolean;
      matchedIntent: boolean;
    }
  | { kind: "already-paid"; amount: string; txHash?: Hash }
  | { kind: "expired"; amount: string }
  | {
      kind: "sent";
      amount: string;
      txHash: Hash;
      id: string;
      receiptUrl: string;
    }
  | { kind: "receipt"; amountHint?: string; tx: Hash }
  | { kind: "error"; message: string };

export function HandshakeSheet({
  open,
  link,
  vault,
  mockBiometrics = false,
  onClose,
  onEnsureVault,
  onVaultUpdated,
  onBalanceRefresh,
}: HandshakeSheetProps) {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const onBalanceRefreshRef = useRef(onBalanceRefresh);
  onBalanceRefreshRef.current = onBalanceRefresh;
  const senderAddress = vault ? getPrimaryAddress(vault) : null;

  useEffect(() => {
    if (!open || !link) {
      setStep({ kind: "idle" });
      return;
    }

    let cancelled = false;

    void (async () => {
      if (link.type === "invite") {
        if (!cancelled) {
          setStep({
            kind: "invite",
            amount: link.amount,
            id: link.id,
          });
        }
        return;
      }

      if (link.type === "receipt") {
        if (!cancelled) {
          setStep({ kind: "receipt", tx: link.tx });
          onBalanceRefreshRef.current?.();
        }
        return;
      }

      // pay
      if (link.amount == null) {
        if (!cancelled) {
          setStep({
            kind: "enter-amount",
            pay: link,
            amountInput: "",
            amountError: null,
          });
        }
        return;
      }

      void prepareConfirm(link, link.amount, cancelled, (next) => {
        if (!cancelled) setStep(next);
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [link, open, senderAddress]);

  async function prepareConfirm(
    pay: PayLink,
    amount: string,
    cancelled: boolean,
    apply: (step: Step) => void,
  ): Promise<void> {
    const minError = minProtocolAmountError(amount);
    if (minError) {
      apply({ kind: "error", message: minError });
      return;
    }

    apply({ kind: "working", message: "Verificando enlace…" });
    try {
      const match = await matchPayReply({
        id: pay.id,
        token: pay.token,
        amount,
      });

      if (cancelled) return;

      if (match.kind === "completed") {
        apply({
          kind: "already-paid",
          amount: match.intent.amount,
          txHash: match.intent.txHash,
        });
        return;
      }
      if (match.kind === "expired") {
        apply({ kind: "expired", amount: match.intent.amount });
        return;
      }

      if (match.kind === "mismatch") {
        apply({
          kind: "error",
          message: match.reason,
        });
        return;
      }

      let feeFormatted: string | null = null;
      let gasNote: string | null = null;
      let packCostFormatted: string | null = null;
      let totalCostFormatted: string | null = null;
      let needsPack = false;
      let canAfford = true;
      if (senderAddress) {
        try {
          const fee = await getPenmtFeePreview({
            sender: senderAddress,
            receiver: pay.addr,
            amount,
          });
          feeFormatted = fee.needsPack ? fee.feeAmountFormatted : "0";
          gasNote = fee.gasNote;
          packCostFormatted = fee.packCostFormatted;
          totalCostFormatted = fee.totalCostFormatted;
          needsPack = fee.needsPack;
          canAfford = fee.canAfford;
        } catch {
          feeFormatted = null;
          gasNote = null;
          packCostFormatted = null;
          totalCostFormatted = null;
          needsPack = false;
          canAfford = true;
        }
      }

      if (cancelled) return;

      apply({
        kind: "confirm",
        pay: { ...pay, amount },
        feeFormatted,
        gasNote,
        packCostFormatted,
        totalCostFormatted,
        needsPack,
        canAfford,
        matchedIntent: match.kind === "match",
      });
    } catch (err) {
      if (!cancelled) {
        apply({
          kind: "error",
          message:
            err instanceof Error
              ? err.message
              : "No se pudo abrir el enlace.",
        });
      }
    }
  }

  if (!open || !link) return null;

  async function resolveReceiveAddress(
    current: DeviceVaultRecord,
  ): Promise<{ address: `0x${string}`; vault: DeviceVaultRecord }> {
    const existing = getPrimaryAddress(current);
    if (existing) return { address: existing, vault: current };

    return withDeviceVaultSeed(current, async (mnemonic) => {
      const { vault: updated, account } = await ensurePrimaryEvmAccount(
        current,
        mnemonic,
      );
      onVaultUpdated?.(updated);
      return {
        address: account.address as `0x${string}`,
        vault: updated,
      };
    });
  }

  async function handleAcceptInvite() {
    if (link?.type !== "invite") return;
    setStep({
      kind: "working",
      message: vault
        ? mockBiometrics
          ? "Preparando respuesta…"
          : "Confirmando con biometría…"
        : mockBiometrics
          ? "Creando billetera…"
          : "Creando billetera con biometría…",
    });

    try {
      const readyVault = vault ?? (await onEnsureVault());
      onVaultUpdated?.(readyVault);
      const { address } = await resolveReceiveAddress(readyVault);
      const url = buildPayLink({
        id: link.id,
        addr: address,
        amount: link.amount,
        token: link.token,
      });
      const message = `Envíame ${link.amount} PENMT a esta cuenta TKN:`;
      const result = await shareText({
        title: "tkn.land",
        text: message,
        url,
      });
      if (result.method === "cancelled") {
        setStep({
          kind: "invite",
          amount: link.amount,
          id: link.id,
        });
        return;
      }
      setStep({
        kind: "pay-ready",
        url,
        amount: link.amount,
        message,
        shareMethod: result.method,
      });
    } catch (err) {
      setStep({
        kind: "error",
        message:
          err instanceof Error
            ? err.message
            : "No se pudo aceptar el envío.",
      });
    }
  }

  async function handleEnterAmountContinue() {
    if (step.kind !== "enter-amount") return;
    const amount = normalizeProtocolAmount(step.amountInput);
    if (!amount) {
      setStep({
        ...step,
        amountError: "Ingresa un monto válido (ej. 10.00).",
      });
      return;
    }
    const minError = minProtocolAmountError(amount);
    if (minError) {
      setStep({
        ...step,
        amountError: minError,
      });
      return;
    }
    await prepareConfirm(step.pay, amount, false, setStep);
  }

  async function handleConfirmPay() {
    if (step.kind !== "confirm" || !vault) {
      setStep({
        kind: "error",
        message: "Necesitas una billetera para enviar.",
      });
      return;
    }

    const pay = step.pay;
    const progressMessage = (progress: SendProgress): string => {
      switch (progress) {
        case "unlock":
          return mockBiometrics
            ? "Desbloqueando billetera…"
            : "Confirmando con biometría…";
        case "clearing":
          return "Liberando una transacción trabada en la red…";
        case "approve":
          return "Autorizando recarga de red…";
        case "pack":
          return "Comprando recarga de red…";
        case "gift":
          return "Enviando saldo de red al destinatario…";
        case "transfer":
          return "Enviando PENMT… esperando confirmación";
        case "done":
          return "Listo";
      }
    };

    setStep({
      kind: "working",
      message: progressMessage("unlock"),
    });

    try {
      const result = await sendPenmtWithFee({
        vault,
        receiver: pay.addr,
        amount: pay.amount,
        onProgress: (progress) => {
          setStep({ kind: "working", message: progressMessage(progress) });
        },
      });
      onVaultUpdated?.(result.vault);

      if (step.matchedIntent) {
        await completePaymentIntent(pay.id, result.transferTxHash);
      } else {
        await recordCompletedPay({
          id: pay.id,
          token: pay.token,
          amount: pay.amount,
          txHash: result.transferTxHash,
        });
      }

      const receiptUrl = buildReceiptLink({
        id: pay.id,
        tx: result.transferTxHash,
      });
      onBalanceRefresh?.();
      setStep({
        kind: "sent",
        amount: pay.amount,
        txHash: result.transferTxHash,
        id: pay.id,
        receiptUrl,
      });
    } catch (err) {
      setStep({
        kind: "error",
        message:
          err instanceof Error ? err.message : "No se pudo completar el envío.",
      });
    }
  }

  const title =
    step.kind === "invite"
      ? "Recibir"
      : step.kind === "enter-amount"
        ? "Enviar"
        : step.kind === "confirm"
          ? "Confirmar envío"
          : step.kind === "sent"
            ? "Enviado"
            : step.kind === "already-paid"
              ? "Ya pagado"
              : step.kind === "receipt"
                ? "Recibido"
                : step.kind === "pay-ready"
                  ? "Responde en el chat"
                  : "tkn.land";

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/75 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="handshake-sheet-title"
    >
      <section className="flex w-full max-w-md flex-col overflow-y-auto rounded-3xl border border-line bg-surface px-5 py-5 shadow-2xl">
        <h1
          id="handshake-sheet-title"
          className="text-2xl font-semibold text-ink"
        >
          {title}
        </h1>

        {step.kind === "working" ? (
          <>
            <div className="mt-8 flex flex-col items-center gap-5 px-2 py-6 text-center">
              <div
                className="h-10 w-10 animate-spin rounded-full border-2 border-line border-t-accent"
                aria-hidden="true"
              />
              <p className="text-base leading-6 text-ink">{step.message}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 min-h-14 rounded-2xl border border-line bg-surface-raised px-5 py-3 font-semibold text-ink transition active:scale-[0.99]"
            >
              Cerrar
            </button>
          </>
        ) : null}

        {step.kind === "invite" ? (
          <>
            <p className="mt-4 text-sm leading-6 text-ink-muted">
              Te quieren enviar PENMT. Para aceptar debes responder a tu contacto con tu número de cuenta TKN.
            </p>
            <p className="mt-6 text-4xl font-semibold tabular-nums tracking-tight text-ink">
              {step.amount}{" "}
              <span className="text-base font-medium text-accent-soft">
                PENMT
              </span>
            </p>
            {!vault ? (
              <p className="mt-4 text-sm leading-6 text-ink-muted">
                Primero crearemos tu billetera con biometría.
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => void handleAcceptInvite()}
              className="mt-8 min-h-14 rounded-2xl bg-accent px-5 py-3 font-semibold text-surface transition active:scale-[0.99]"
            >
              Responder con mi cuenta TKN
            </button>
            <button
              type="button"
              onClick={onClose}
              className="mt-3 min-h-14 rounded-2xl border border-line bg-surface-raised px-5 py-3 font-semibold text-ink transition active:scale-[0.99]"
            >
              Ahora no
            </button>
          </>
        ) : null}

        {step.kind === "pay-ready" ? (
          <>
            <p className="mt-4 text-sm leading-6 text-ink-muted">
              {step.shareMethod === "clipboard"
                ? "Enlace copiado. Pégalo en el mismo chat para que te envíen el dinero."
                : "Comparte este enlace en el mismo chat. Cuando lo abran, podrán enviarte el monto."}
            </p>
            <p className="mt-6 text-3xl font-semibold tabular-nums text-ink">
              {step.amount}{" "}
              <span className="text-base font-medium text-accent-soft">
                PENMT
              </span>
            </p>
            <p className="mt-4 whitespace-pre-wrap break-all rounded-2xl border border-line bg-surface-raised p-3 text-xs leading-5 text-ink-muted">
              {`${step.message}\n${step.url}`}
            </p>
            <button
              type="button"
              onClick={() =>
                void shareText({
                  title: "tkn.land",
                  text: step.message,
                  url: step.url,
                })
              }
              className="mt-8 min-h-14 rounded-2xl border border-line bg-surface-raised px-5 py-3 font-semibold text-ink transition active:scale-[0.99]"
            >
              Compartir de nuevo
            </button>
            <button
              type="button"
              onClick={onClose}
              className="mt-3 min-h-14 rounded-2xl bg-accent px-5 py-3 font-semibold text-surface transition active:scale-[0.99]"
            >
              Listo
            </button>
          </>
        ) : null}

        {step.kind === "enter-amount" ? (
          <>
            <p className="mt-4 text-sm leading-6 text-ink-muted">
              Escaneaste una cuenta TKN. Indica cuánto quieres enviar.
            </p>
            <DestinationAccount className="mt-4" address={step.pay.addr} />
            <div className="mt-6">
              <span className="text-sm font-medium text-ink">Monto a enviar</span>
              <div className="mt-2 flex max-w-[13.5rem] items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={step.amountInput}
                  onChange={(e) =>
                    setStep({
                      ...step,
                      amountInput: e.target.value,
                      amountError: null,
                    })
                  }
                  className="min-h-14 min-w-0 flex-1 rounded-2xl border border-line bg-surface-raised px-4 text-center text-xl font-semibold tabular-nums text-ink outline-none focus:border-accent"
                />
                <span className="shrink-0 text-sm font-medium text-accent-soft">
                  PENMT
                </span>
              </div>
            </div>
            {step.amountError ? (
              <p className="mt-3 text-sm text-danger" role="alert">
                {step.amountError}
              </p>
            ) : null}
            <div className="mt-8 flex gap-3">
              <button
                type="button"
                onClick={() => void handleEnterAmountContinue()}
                className="min-h-14 min-w-0 flex-[2] rounded-2xl bg-accent px-4 py-3 font-semibold text-surface transition active:scale-[0.99]"
              >
                Continuar
              </button>
              <button
                type="button"
                onClick={onClose}
                className="min-h-14 min-w-0 flex-1 rounded-2xl border border-line bg-surface-raised px-3 py-3 font-semibold text-ink transition active:scale-[0.99]"
              >
                Cancelar
              </button>
            </div>
          </>
        ) : null}

        {step.kind === "confirm" ? (
          <>
            <p className="mt-4 text-sm leading-6 text-ink-muted">
              {step.matchedIntent
                ? "Confirma el envío a la cuenta TKN."
                : "Te piden este monto. Confirma para enviarlo."}
            </p>
            <DestinationAccount className="mt-4" address={step.pay.addr} />
            <p className="mt-6 text-4xl font-semibold tabular-nums tracking-tight text-ink">
              {step.pay.amount}{" "}
              <span className="text-base font-medium text-accent-soft">
                PENMT
              </span>
            </p>
            {step.packCostFormatted != null &&
            step.totalCostFormatted != null ? (
              <p className="mt-2 text-sm text-ink-muted">
                Para poder hacer este envío se hará primero una recarga de red de
                costo {step.packCostFormatted} PENMT. Costo total del envío{" "}
                <span className="font-semibold text-ink tabular-nums">
                  {step.totalCostFormatted} PENMT
                </span>
                .
              </p>
            ) : step.needsPack && step.gasNote != null ? (
              <p className="mt-2 text-sm text-ink-muted">{step.gasNote}</p>
            ) : null}
            {!step.canAfford ? (
              <p className="mt-2 text-sm font-semibold text-ink">
                No tienes saldo suficiente.
              </p>
            ) : null}
            {!vault ? (
              <p className="mt-4 text-sm text-ink-muted">
                Necesitas una billetera para enviar. Cierra y crea una primero.
              </p>
            ) : null}
            <div className="mt-8 flex gap-3">
              <button
                type="button"
                disabled={!vault || !step.canAfford}
                onClick={() => void handleConfirmPay()}
                className="min-h-14 min-w-0 flex-[2] rounded-2xl bg-accent px-4 py-3 font-semibold text-surface transition active:scale-[0.99] disabled:opacity-50"
              >
                {mockBiometrics ? "Enviar" : "Confirmar con biometría"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="min-h-14 min-w-0 flex-1 rounded-2xl border border-line bg-surface-raised px-3 py-3 font-semibold text-ink transition active:scale-[0.99]"
              >
                Cancelar
              </button>
            </div>
          </>
        ) : null}

        {step.kind === "already-paid" ? (
          <>
            <p className="mt-4 text-sm leading-6 text-ink-muted">
              Este envío ya se completó.
            </p>
            <p className="mt-6 text-3xl font-semibold tabular-nums text-ink">
              {step.amount}{" "}
              <span className="text-base font-medium text-accent-soft">
                PENMT
              </span>
            </p>
            {step.txHash ? (
              <p className="mt-4 break-all rounded-2xl border border-line bg-surface-raised p-3 font-mono text-xs text-ink-muted">
                {step.txHash}
              </p>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="mt-8 min-h-14 rounded-2xl bg-accent px-5 py-3 font-semibold text-surface transition active:scale-[0.99]"
            >
              Cerrar
            </button>
          </>
        ) : null}

        {step.kind === "expired" ? (
          <>
            <p className="mt-4 text-sm leading-6 text-ink-muted">
              Este envío pendiente expiró. Crea uno nuevo si aún quieres
              enviar {step.amount} PENMT.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-8 min-h-14 rounded-2xl bg-accent px-5 py-3 font-semibold text-surface transition active:scale-[0.99]"
            >
              Cerrar
            </button>
          </>
        ) : null}

        {step.kind === "sent" ? (
          <>
            <p className="mt-4 text-3xl font-semibold tabular-nums text-ink">
              {step.amount}{" "}
              <span className="text-base font-medium text-accent-soft">
                PENMT
              </span>
            </p>
            <p className="mt-4 text-sm leading-6 text-ink-muted">
              Envío confirmado. Puedes avisar con un comprobante (opcional).
            </p>
            <div className="mt-6 rounded-2xl border border-line bg-surface-raised px-4 py-5">
              <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">
                Comprobante
              </p>
              <p className="mt-3 break-all font-mono text-xs leading-5 text-ink-muted">
                {step.txHash}
              </p>
              <button
                type="button"
                onClick={() =>
                  void shareText({
                    title: "tkn.land",
                    text: "Te envié PENMT. Abre para ver el comprobante:",
                    url: step.receiptUrl,
                  })
                }
                className="mt-4 min-h-12 w-full rounded-2xl border border-line bg-surface px-5 py-3 font-semibold text-ink transition active:scale-[0.99]"
              >
                Compartir comprobante
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-8 min-h-14 rounded-2xl bg-accent px-5 py-3 font-semibold text-surface transition active:scale-[0.99]"
            >
              Listo
            </button>
          </>
        ) : null}

        {step.kind === "receipt" ? (
          <>
            <p className="mt-4 text-sm leading-6 text-ink-muted">
              Comprobante de envío. Tu saldo se actualiza al abrir la app.
            </p>
            <p className="mt-6 break-all rounded-2xl border border-line bg-surface-raised p-3 font-mono text-xs text-ink-muted">
              {step.tx}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-8 min-h-14 rounded-2xl bg-accent px-5 py-3 font-semibold text-surface transition active:scale-[0.99]"
            >
              Ver saldo
            </button>
          </>
        ) : null}

        {step.kind === "error" ? (
          <>
            <p
              className="mt-6 rounded-2xl border border-danger/50 bg-danger/10 p-4 text-sm text-ink"
              role="alert"
            >
              {step.message}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-8 min-h-14 rounded-2xl border border-line bg-surface-raised px-5 py-3 font-semibold text-ink transition active:scale-[0.99]"
            >
              Cerrar
            </button>
          </>
        ) : null}
      </section>
    </div>
  );
}
