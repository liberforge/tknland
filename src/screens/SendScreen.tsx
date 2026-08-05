import { useEffect, useState } from "react";
import {
  buildInviteLink,
  buildPayLink,
  newHandshakeId,
  normalizeProtocolAmount,
  minProtocolAmountError,
  PROTOCOL_TOKEN_PENMT,
} from "@/lib/protocol/links";
import { createPaymentIntent } from "@/lib/protocol/intents";
import { shareText } from "@/lib/share";
import { getPenmtBalance } from "@/lib/evm/penmt";
import { withDeviceVaultSeed } from "@/lib/vault/ceremony";
import {
  ensurePrimaryEvmAccount,
  getPrimaryAddress,
} from "@/lib/vault/evm";
import type { DeviceVaultRecord } from "@/lib/vault/types";
import { QrCode } from "@/components/QrCode";

export type SendScreenMode = "send" | "request";

type SendScreenProps = {
  mode: SendScreenMode;
  vault: DeviceVaultRecord | null;
  onBack: () => void;
  onVaultUpdated?: (vault: DeviceVaultRecord) => void;
};

type Step =
  | { kind: "amount" }
  | { kind: "working"; message: string }
  | {
      kind: "shared";
      amount: string;
      url: string;
      message: string;
      shareMethod: "share" | "clipboard";
    }
  | { kind: "error"; message: string };

export function SendScreen({
  mode,
  vault,
  onBack,
  onVaultUpdated,
}: SendScreenProps) {
  const [step, setStep] = useState<Step>({ kind: "amount" });
  const [amountInput, setAmountInput] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [balanceFormatted, setBalanceFormatted] = useState<string | null>(null);
  const [accountPayUrl, setAccountPayUrl] = useState<string | null>(null);

  useEffect(() => {
    setStep({ kind: "amount" });
    setAmountInput("");
    setAmountError(null);
    setBalanceFormatted(null);
    setAccountPayUrl(null);
  }, [mode]);

  useEffect(() => {
    if (!vault) return;
    const address = getPrimaryAddress(vault);
    if (!address) {
      setBalanceFormatted("0.00");
      return;
    }

    let cancelled = false;
    void getPenmtBalance(address)
      .then(({ formatted }) => {
        if (!cancelled) setBalanceFormatted(formatted);
      })
      .catch(() => {
        if (!cancelled) setBalanceFormatted(null);
      });

    return () => {
      cancelled = true;
    };
  }, [vault]);

  useEffect(() => {
    if (mode !== "request" || !vault) {
      setAccountPayUrl(null);
      return;
    }
    const address = getPrimaryAddress(vault);
    if (!address) {
      setAccountPayUrl(null);
      return;
    }
    setAccountPayUrl(
      buildPayLink({
        id: newHandshakeId(),
        addr: address,
        amount: null,
      }),
    );
  }, [mode, vault]);

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

  async function handleCreateInvite() {
    const amount = normalizeProtocolAmount(amountInput);
    if (!amount) {
      setAmountError("Ingresa un monto válido (ej. 10.00).");
      return;
    }
    const minError = minProtocolAmountError(amount);
    if (minError) {
      setAmountError(minError);
      return;
    }
    setAmountError(null);
    setStep({ kind: "working", message: "Preparando envío…" });

    try {
      const intent = await createPaymentIntent({
        token: PROTOCOL_TOKEN_PENMT,
        amount,
      });
      const url = buildInviteLink({ id: intent.id, amount: intent.amount });
      const message = `Te quiero enviar ${amount} PENMT. Abre el enlace para aceptar:`;
      const result = await shareText({
        title: "tkn.land",
        text: message,
        url,
      });
      if (result.method === "cancelled") {
        setStep({ kind: "amount" });
        return;
      }
      setStep({
        kind: "shared",
        amount,
        url,
        message,
        shareMethod: result.method,
      });
    } catch (err) {
      setStep({
        kind: "error",
        message:
          err instanceof Error ? err.message : "No se pudo preparar el envío.",
      });
    }
  }

  async function handleCreateRequest() {
    if (!vault) {
      setStep({
        kind: "error",
        message: "Crea tu billetera antes de pedir dinero.",
      });
      return;
    }

    const amount = normalizeProtocolAmount(amountInput);
    if (!amount) {
      setAmountError("Ingresa un monto válido (ej. 10.00).");
      return;
    }
    const minError = minProtocolAmountError(amount);
    if (minError) {
      setAmountError(minError);
      return;
    }
    setAmountError(null);
    setStep({
      kind: "working",
      message: "Confirmando con biometría…",
    });

    try {
      const { address } = await resolveReceiveAddress(vault);
      const id = newHandshakeId();
      const url = buildPayLink({ id, addr: address, amount });
      const message = `Te pido ${amount} PENMT. Abre el enlace para enviar:`;
      const result = await shareText({
        title: "tkn.land",
        text: message,
        url,
      });
      if (result.method === "cancelled") {
        setStep({ kind: "amount" });
        return;
      }
      setStep({
        kind: "shared",
        amount,
        url,
        message,
        shareMethod: result.method,
      });
    } catch (err) {
      setStep({
        kind: "error",
        message:
          err instanceof Error ? err.message : "No se pudo preparar el pedido.",
      });
    }
  }

  const title =
    step.kind === "shared"
      ? mode === "send"
        ? "Comparte el enlace"
        : "Comparte el pedido"
      : mode === "request"
        ? "Pedir"
        : "Enviar";

  const requestHint =
    "Indica cuánto pides. Quien abra el enlace podrá enviártelo.";

  return (
    <section className="flex flex-1 flex-col py-1">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Volver al inicio"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line/80 bg-surface-raised/80 text-ink transition active:scale-[0.96]"
        >
          <svg
            className="h-5 w-5"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden
          >
            <path
              d="M12.5 4.5 7 10l5.5 5.5"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
          <h1
            id="send-screen-title"
            className="text-2xl font-semibold leading-none text-ink"
          >
            {title}
          </h1>
          {mode === "request" && step.kind === "amount" ? (
            <p className="min-w-0 flex-1 pl-6 text-sm leading-5 text-ink-muted">
              {requestHint}
            </p>
          ) : null}
        </div>
      </div>

      <div className={`${mode === "request" ? "mt-8" : "mt-5"} flex flex-1 flex-col`}>
        {step.kind === "amount" ? (
          <>
            {mode === "send" ? (
              <p className="text-sm leading-6 text-ink-muted">
                Indica cuánto quieres enviar. Para aceptar la otra persona debe
                responderte con su numero de cuenta TKN para que puedas
                enviarle.
              </p>
            ) : null}
            {mode === "send" && balanceFormatted != null ? (
              <p className="mt-4 text-base text-ink-muted">
                Tu saldo{" "}
                <span className="ml-1 text-2xl font-semibold tabular-nums tracking-tight text-accent">
                  {balanceFormatted}
                </span>{" "}
                <span className="text-sm font-medium text-accent-soft">
                  PENMT
                </span>
              </p>
            ) : null}
            <div className={mode === "send" ? "mt-5" : undefined}>
              {mode === "send" ? (
                <span className="text-sm font-medium text-ink">
                  Monto a enviar
                </span>
              ) : null}
              <div
                className={`${mode === "send" ? "mt-2" : ""} flex max-w-[13.5rem] items-center gap-2`}
              >
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={amountInput}
                  onChange={(e) => {
                    setAmountInput(e.target.value);
                    setAmountError(null);
                  }}
                  className="min-h-12 min-w-0 flex-1 rounded-2xl border border-line bg-surface-raised px-4 text-center text-xl font-semibold tabular-nums text-ink outline-none focus:border-accent"
                />
                <span className="shrink-0 text-sm font-medium text-accent-soft">
                  PENMT
                </span>
              </div>
            </div>
            {amountError ? (
              <p className="mt-2 text-sm text-danger" role="alert">
                {amountError}
              </p>
            ) : null}
            <div className="mt-8 flex gap-3">
              <button
                type="button"
                onClick={() =>
                  mode === "send"
                    ? void handleCreateInvite()
                    : void handleCreateRequest()
                }
                className="min-h-12 min-w-0 flex-[2] rounded-2xl bg-accent px-4 py-3 font-semibold text-surface transition active:scale-[0.99]"
              >
                {mode === "send" ? "Continuar" : "Enviar Pedido"}
              </button>
              <button
                type="button"
                onClick={onBack}
                className="min-h-12 min-w-0 flex-1 rounded-2xl border border-line bg-surface-raised px-3 py-3 font-semibold text-ink transition active:scale-[0.99]"
              >
                Cancelar
              </button>
            </div>
            {mode === "request" ? (
              <div className="mt-6 pb-4">
                <div className="h-px bg-line" role="separator" />
                <h2 className="mt-5 text-lg font-semibold text-ink">
                  Tu cuenta TKN
                </h2>
                <p className="mt-2 text-sm leading-6 text-ink-muted">
                  Quien ya tenga saldo en tkn.land, puede escanear este QR con
                  su celular y enviarte en el momento.
                </p>
                {accountPayUrl ? (
                  <div className="mt-4 flex justify-center">
                    <div className="rounded-2xl border border-line bg-ink p-3">
                      <QrCode
                        value={accountPayUrl}
                        size={200}
                        aria-label="Código QR de tu cuenta TKN"
                      />
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-ink-muted">
                    Crea tu billetera para mostrar el código QR.
                  </p>
                )}
                <button
                  type="button"
                  onClick={onBack}
                  className="mt-6 min-h-12 w-full rounded-2xl border border-line bg-surface-raised px-5 py-3 font-semibold text-ink transition active:scale-[0.99]"
                >
                  Cerrar
                </button>
              </div>
            ) : null}
          </>
        ) : null}

        {step.kind === "working" ? (
          <p className="rounded-2xl border border-line bg-surface-raised p-4 text-sm text-ink">
            {step.message}
          </p>
        ) : null}

        {step.kind === "shared" ? (
          <>
            <p className="text-sm leading-6 text-ink-muted">
              {step.shareMethod === "clipboard"
                ? "Enlace copiado. Pégalo en WhatsApp u otro chat."
                : mode === "send"
                  ? "Cuando respondan con su enlace, ábrelo aquí para confirmar el envío."
                  : "Cuando abran tu pedido podrán enviarte el monto."}
            </p>
            <p className="mt-6 text-3xl font-semibold tabular-nums tracking-tight text-ink">
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
              className="mt-8 min-h-14 rounded-2xl bg-accent px-5 py-3 font-semibold text-surface transition active:scale-[0.99]"
            >
              Compartir de nuevo
            </button>
            <button
              type="button"
              onClick={onBack}
              className="mt-3 min-h-14 rounded-2xl border border-line bg-surface-raised px-5 py-3 font-semibold text-ink transition active:scale-[0.99]"
            >
              Listo
            </button>
          </>
        ) : null}

        {step.kind === "error" ? (
          <>
            <p
              className="rounded-2xl border border-danger/50 bg-danger/10 p-4 text-sm text-ink"
              role="alert"
            >
              {step.message}
            </p>
            <button
              type="button"
              onClick={() => setStep({ kind: "amount" })}
              className="mt-8 min-h-14 rounded-2xl bg-accent px-5 py-3 font-semibold text-surface transition active:scale-[0.99]"
            >
              Reintentar
            </button>
          </>
        ) : null}
      </div>
    </section>
  );
}
