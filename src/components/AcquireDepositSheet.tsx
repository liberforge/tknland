import { useEffect, useState } from "react";
import {
  ensureAcquireAccount,
  formatMettalMajor,
  getAccountBalances,
  issueMettalAccessToken,
  METTAL_MIN_ACQUIRE_MINOR,
  parseMettalMajorToMinor,
  type MettalAcquireAccount,
} from "@/lib/mettal/client";
import { withMettalCredentials } from "@/lib/mettal/credentials";
import type { DeviceVaultRecord } from "@/lib/vault/types";

type AcquireDepositSheetProps = {
  open: boolean;
  vault: DeviceVaultRecord | null;
  onClose: () => void;
};

type SheetStep =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "amount"; acquireBalance: number }
  | { kind: "deposit"; account: MettalAcquireAccount }
  | { kind: "error"; message: string };

export function AcquireDepositSheet({
  open,
  vault,
  onClose,
}: AcquireDepositSheetProps) {
  const [step, setStep] = useState<SheetStep>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const [amountInput, setAmountInput] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [amountReadyMinor, setAmountReadyMinor] = useState<number | null>(null);

  useEffect(() => {
    if (!open) {
      setStep({ kind: "idle" });
      setCopied(false);
      setAmountInput("");
      setAmountError(null);
      setAmountReadyMinor(null);
      return;
    }

    if (!vault) {
      setStep({
        kind: "error",
        message:
          "Abre http://localhost:5173 para cargar la cuenta con biometría.",
      });
      return;
    }

    let cancelled = false;
    setStep({
      kind: "loading",
      message: "Confirma tu biometría y consulta tu saldo…",
    });
    setCopied(false);
    setAmountInput("");
    setAmountError(null);
    setAmountReadyMinor(null);

    void (async () => {
      try {
        const next = await withMettalCredentials(vault, async (credentials) => {
          const accessToken = await issueMettalAccessToken(credentials);
          const balances = await getAccountBalances({ accessToken });

          if (balances.acquireBalance >= METTAL_MIN_ACQUIRE_MINOR) {
            return {
              kind: "amount" as const,
              acquireBalance: balances.acquireBalance,
            };
          }

          const account = await ensureAcquireAccount({ accessToken });
          return { kind: "deposit" as const, account };
        });
        if (cancelled) return;
        setStep(next);
      } catch (err) {
        if (cancelled) return;
        setStep({
          kind: "error",
          message:
            err instanceof Error
              ? err.message
              : "No se pudo consultar el saldo de adquisición.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, vault]);

  if (!open) return null;

  async function copyAccount(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setStep({
        kind: "error",
        message: "No se pudo copiar el número de cuenta.",
      });
    }
  }

  function handleAmountContinue() {
    if (step.kind !== "amount") return;
    const minor = parseMettalMajorToMinor(amountInput);
    if (minor === null || minor <= 0) {
      setAmountError("Ingresa un monto válido (hasta 2 decimales).");
      setAmountReadyMinor(null);
      return;
    }
    if (minor > step.acquireBalance) {
      setAmountError(
        `El máximo disponible es S/ ${formatMettalMajor(step.acquireBalance)}.`,
      );
      setAmountReadyMinor(null);
      return;
    }
    if (minor < METTAL_MIN_ACQUIRE_MINOR) {
      setAmountError(
        `El monto mínimo es S/ ${formatMettalMajor(METTAL_MIN_ACQUIRE_MINOR)}.`,
      );
      setAmountReadyMinor(null);
      return;
    }
    setAmountError(null);
    setAmountReadyMinor(minor);
    // Next step: mint/acquire into the app wallet (wired separately).
  }

  const title =
    step.kind === "amount" ? "Agregar a tu saldo" : "Agregar PENMT";

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/75 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="acquire-deposit-title"
    >
      <section className="flex w-full max-w-md flex-col overflow-y-auto rounded-3xl border border-line bg-surface px-5 py-5 shadow-2xl">
        <div className="flex items-center justify-between gap-4">
          <h1
            id="acquire-deposit-title"
            className="text-2xl font-semibold text-ink"
          >
            {title}
          </h1>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="grid h-11 w-11 place-items-center rounded-xl border border-line bg-surface-raised text-2xl text-ink"
          >
            ×
          </button>
        </div>

        {step.kind === "loading" ? (
          <p className="mt-6 rounded-2xl border border-line bg-surface-raised p-4 text-sm text-ink">
            {step.message}
          </p>
        ) : null}

        {step.kind === "error" ? (
          <p
            className="mt-6 rounded-2xl border border-danger/50 bg-danger/10 p-4 text-sm text-ink"
            role="alert"
          >
            {step.message}
          </p>
        ) : null}

        {step.kind === "amount" ? (
          <>
            <p className="mt-4 text-sm leading-6 text-ink-muted">
              Tienes saldo disponible en Mettal. ¿Cuánto quieres agregar a la
              app?
            </p>
            <p className="mt-4 text-sm text-ink">
              Disponible:{" "}
              <span className="font-semibold tabular-nums">
                S/ {formatMettalMajor(step.acquireBalance)}
              </span>
            </p>
            <label className="mt-6 block">
              <span className="text-xs font-medium tracking-wide text-ink-muted uppercase">
                Monto (S/)
              </span>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={amountInput}
                onChange={(e) => {
                  setAmountInput(e.target.value);
                  setAmountError(null);
                  setAmountReadyMinor(null);
                }}
                className="mt-2 min-h-14 w-full rounded-2xl border border-line bg-surface-raised px-4 text-xl font-semibold tabular-nums text-ink outline-none focus:border-accent"
              />
            </label>
            {amountError ? (
              <p className="mt-3 text-sm text-danger" role="alert">
                {amountError}
              </p>
            ) : null}
            {amountReadyMinor !== null && !amountError ? (
              <p className="mt-3 text-sm text-ink-muted">
                Monto seleccionado: S/ {formatMettalMajor(amountReadyMinor)}. El
                envío a la billetera se conectará a continuación.
              </p>
            ) : null}
            <button
              type="button"
              onClick={handleAmountContinue}
              className="mt-8 min-h-14 rounded-2xl bg-accent px-5 py-3 font-semibold text-white transition active:scale-[0.99]"
            >
              Continuar
            </button>
            <button
              type="button"
              onClick={onClose}
              className="mt-3 min-h-14 rounded-2xl border border-line bg-surface-raised px-5 py-3 font-semibold text-ink transition active:scale-[0.99]"
            >
              Cancelar
            </button>
          </>
        ) : null}

        {step.kind === "deposit" ? (
          <>
            <p className="mt-4 text-sm leading-6 text-ink-muted">
              Transfiere soles (S/) a esta cuenta bancaria para aumentar tu
              saldo PENMT.
            </p>
            <div className="mt-6 rounded-2xl border border-line bg-surface-raised px-4 py-5">
              <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">
                Cuenta bancaria {step.account.currency}
              </p>
              <p className="mt-3 break-all font-mono text-xl font-semibold tracking-wide text-ink">
                {step.account.bankAccount}
              </p>
              <button
                type="button"
                onClick={() => void copyAccount(step.account.bankAccount)}
                className="mt-4 min-h-12 w-full rounded-2xl bg-accent px-5 py-3 font-semibold text-white transition active:scale-[0.99]"
              >
                {copied ? "Copiado" : "Copiar cuenta bancaria"}
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-8 min-h-14 rounded-2xl border border-line bg-surface-raised px-5 py-3 font-semibold text-ink transition active:scale-[0.99]"
            >
              Listo
            </button>
          </>
        ) : null}

        {step.kind === "error" ? (
          <button
            type="button"
            onClick={onClose}
            className="mt-8 min-h-14 rounded-2xl border border-line bg-surface-raised px-5 py-3 font-semibold text-ink transition active:scale-[0.99]"
          >
            Cerrar
          </button>
        ) : null}
      </section>
    </div>
  );
}
