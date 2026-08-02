import { useEffect, useRef, useState } from "react";
import type { PrivateKeyAccount } from "viem/accounts";
import {
  acquireTokens,
  ensureAcquireAccount,
  formatMettalMajor,
  formatMettalMajorGrouped,
  getAccountBalances,
  issueAcquireChallenge,
  issueMettalAccessToken,
  METTAL_ACQUIRE_NETWORK,
  METTAL_DEFAULT_SYMBOL,
  METTAL_MIN_ACQUIRE_MINOR,
  parseMettalMajorToMinor,
  type MettalAcquireAccount,
  type MettalAcquireResult,
} from "@/lib/mettal/client";
import {
  withMettalCredentialsAndSeed,
  type MettalCredentials,
} from "@/lib/mettal/credentials";
import { getPenmtBalance } from "@/lib/evm/penmt";
import { ensurePrimaryEvmAccount } from "@/lib/vault/evm";
import type { DeviceVaultRecord, VaultAccount } from "@/lib/vault/types";

const ACQUIRE_BALANCE_POLL_MS = 7_000;
const RECEIPT_BALANCE_POLL_MS = 7_000;

type AcquireSession = {
  credentials: MettalCredentials;
  accessToken: string;
  account: VaultAccount;
  signer: PrivateKeyAccount;
};

type AcquireDepositSheetProps = {
  open: boolean;
  vault: DeviceVaultRecord | null;
  onClose: () => void;
  onVaultUpdated?: (vault: DeviceVaultRecord) => void;
  onBalanceConfirmed?: (balanceFormatted: string) => void;
};

type SheetStep =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "amount"; acquireBalance: number }
  | { kind: "acquiring"; message: string }
  | {
      kind: "waiting-receipt";
      result: MettalAcquireResult;
      previousBalanceRaw: bigint;
    }
  | { kind: "success"; result: MettalAcquireResult; balanceFormatted: string }
  | { kind: "deposit"; account: MettalAcquireAccount }
  | { kind: "waiting-deposit" }
  | { kind: "error"; message: string };

export function AcquireDepositSheet({
  open,
  vault,
  onClose,
  onVaultUpdated,
  onBalanceConfirmed,
}: AcquireDepositSheetProps) {
  const [step, setStep] = useState<SheetStep>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const [amountInput, setAmountInput] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const sessionRef = useRef<AcquireSession | null>(null);
  const onVaultUpdatedRef = useRef(onVaultUpdated);
  onVaultUpdatedRef.current = onVaultUpdated;
  const onBalanceConfirmedRef = useRef(onBalanceConfirmed);
  onBalanceConfirmedRef.current = onBalanceConfirmed;

  function clearSession() {
    sessionRef.current = null;
  }

  async function refreshAccessToken(session: AcquireSession): Promise<string> {
    const accessToken = await issueMettalAccessToken(session.credentials);
    session.accessToken = accessToken;
    return accessToken;
  }

  useEffect(() => {
    if (open) return;
    clearSession();
    setStep({ kind: "idle" });
    setCopied(false);
    setAmountInput("");
    setAmountError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    if (!vault) {
      setStep({
        kind: "error",
        message:
          "Abre http://localhost:5173 para cargar la cuenta con biometría.",
      });
      return;
    }

    // One biometric unlock per sheet open; vault updates must not re-prompt.
    if (sessionRef.current) return;

    let cancelled = false;
    setStep({
      kind: "loading",
      message: "Confirma tu biometría y consulta tu saldo…",
    });
    setCopied(false);
    setAmountInput("");
    setAmountError(null);

    void (async () => {
      try {
        const unlocked = await withMettalCredentialsAndSeed(
          vault,
          async ({ credentials, mnemonic }) => {
            const accessToken = await issueMettalAccessToken(credentials);
            const {
              vault: nextVault,
              account,
              signer,
            } = await ensurePrimaryEvmAccount(vault, mnemonic);
            const balances = await getAccountBalances({ accessToken });
            return {
              credentials,
              accessToken,
              account,
              signer,
              nextVault,
              balances,
            };
          },
        );
        if (cancelled) return;

        sessionRef.current = {
          credentials: unlocked.credentials,
          accessToken: unlocked.accessToken,
          account: unlocked.account,
          signer: unlocked.signer,
        };
        onVaultUpdatedRef.current?.(unlocked.nextVault);

        if (unlocked.balances.acquireBalance >= METTAL_MIN_ACQUIRE_MINOR) {
          setStep({
            kind: "amount",
            acquireBalance: unlocked.balances.acquireBalance,
          });
          return;
        }

        const bankAccount = await ensureAcquireAccount({
          accessToken: unlocked.accessToken,
        });
        if (cancelled) return;
        setStep({ kind: "deposit", account: bankAccount });
      } catch (err) {
        if (cancelled) return;
        clearSession();
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

  useEffect(() => {
    if (step.kind !== "waiting-deposit") return;

    let cancelled = false;
    let inFlight = false;

    async function pollAcquireBalance() {
      const session = sessionRef.current;
      if (!session || cancelled || inFlight) return;
      inFlight = true;
      try {
        let balances;
        try {
          balances = await getAccountBalances({
            accessToken: session.accessToken,
          });
        } catch {
          const accessToken = await refreshAccessToken(session);
          if (cancelled) return;
          balances = await getAccountBalances({ accessToken });
        }
        if (cancelled) return;
        if (balances.acquireBalance > 0) {
          setStep({
            kind: "amount",
            acquireBalance: balances.acquireBalance,
          });
        }
      } catch {
        // Keep waiting; bank credits can take a while and transient errors are OK.
      } finally {
        inFlight = false;
      }
    }

    void pollAcquireBalance();
    const timer = window.setInterval(() => {
      void pollAcquireBalance();
    }, ACQUIRE_BALANCE_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [step.kind]);

  useEffect(() => {
    if (step.kind !== "waiting-receipt") return;

    const previousBalanceRaw = step.previousBalanceRaw;
    const result = step.result;
    let cancelled = false;
    let inFlight = false;

    async function pollOnChainBalance() {
      const session = sessionRef.current;
      if (!session || cancelled || inFlight) return;
      inFlight = true;
      try {
        const balance = await getPenmtBalance(session.account.address);
        if (cancelled) return;
        if (balance.raw > previousBalanceRaw) {
          onBalanceConfirmedRef.current?.(balance.formatted);
          setStep({
            kind: "success",
            result,
            balanceFormatted: balance.formatted,
          });
        }
      } catch {
        // Keep waiting; RPC/mint delays are expected.
      } finally {
        inFlight = false;
      }
    }

    void pollOnChainBalance();
    const timer = window.setInterval(() => {
      void pollOnChainBalance();
    }, RECEIPT_BALANCE_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [step]);

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

  function handleTransferDone() {
    if (step.kind !== "deposit" || !sessionRef.current) return;
    setStep({ kind: "waiting-deposit" });
  }

  async function handleAmountContinue() {
    if (step.kind !== "amount") return;
    const session = sessionRef.current;
    if (!session) {
      setStep({
        kind: "error",
        message: "La sesión expiró. Cierra e inténtalo de nuevo.",
      });
      return;
    }

    const minor = parseMettalMajorToMinor(amountInput);
    if (minor === null || minor <= 0) {
      setAmountError("Ingresa un monto válido (hasta 2 decimales).");
      return;
    }
    if (minor > step.acquireBalance) {
      setAmountError(
        `El máximo disponible es S/ ${formatMettalMajorGrouped(step.acquireBalance)}.`,
      );
      return;
    }
    if (minor < METTAL_MIN_ACQUIRE_MINOR) {
      setAmountError(
        `El monto mínimo es S/ ${formatMettalMajor(METTAL_MIN_ACQUIRE_MINOR)}.`,
      );
      return;
    }

    setAmountError(null);
    setStep({
      kind: "acquiring",
      message: "Firmando y agregando PENMT…",
    });

    try {
      let accessToken = session.accessToken;
      let challenge;
      try {
        challenge = await issueAcquireChallenge({
          accessToken,
          address: session.account.address,
          network: METTAL_ACQUIRE_NETWORK,
        });
      } catch {
        accessToken = await refreshAccessToken(session);
        challenge = await issueAcquireChallenge({
          accessToken,
          address: session.account.address,
          network: METTAL_ACQUIRE_NETWORK,
        });
      }

      const signature = await session.signer.signMessage({
        message: challenge.message,
      });

      let previousBalanceRaw = 0n;
      try {
        const before = await getPenmtBalance(session.account.address);
        previousBalanceRaw = before.raw;
      } catch {
        // If the RPC is briefly down, still wait and treat any later increase as arrival.
      }

      const result = await acquireTokens({
        accessToken,
        amount: minor,
        address: session.account.address,
        message: challenge.message,
        signature,
        symbol: METTAL_DEFAULT_SYMBOL,
        network: METTAL_ACQUIRE_NETWORK,
      });

      setStep({
        kind: "waiting-receipt",
        result,
        previousBalanceRaw,
      });
    } catch (err) {
      setStep({
        kind: "error",
        message:
          err instanceof Error
            ? err.message
            : "No se pudo agregar PENMT a tu billetera.",
      });
    }
  }

  const title =
    step.kind === "amount" || step.kind === "acquiring"
      ? "Agregar a tu saldo"
      : step.kind === "waiting-deposit"
        ? "Esperando depósito"
        : step.kind === "waiting-receipt"
          ? "Esperando recepción"
          : step.kind === "success"
            ? "Listo"
            : "Agregar PENMT";

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/75 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="acquire-deposit-title"
    >
      <section className="flex w-full max-w-md flex-col overflow-y-auto rounded-3xl border border-line bg-surface px-5 py-5 shadow-2xl">
        <h1
          id="acquire-deposit-title"
          className="text-2xl font-semibold text-ink"
        >
          {title}
        </h1>

        {step.kind === "loading" || step.kind === "acquiring" ? (
          <>
            <p className="mt-6 rounded-2xl border border-line bg-surface-raised p-4 text-sm text-ink">
              {step.message}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-8 min-h-14 rounded-2xl border border-line bg-surface-raised px-5 py-3 font-semibold text-ink transition active:scale-[0.99]"
            >
              Cancelar
            </button>
          </>
        ) : null}

        {step.kind === "waiting-deposit" || step.kind === "waiting-receipt" ? (
          <>
            <div className="mt-8 flex flex-col items-center gap-5 px-2 py-6 text-center">
              <div
                className="h-10 w-10 animate-spin rounded-full border-2 border-line border-t-accent"
                aria-hidden="true"
              />
              <p className="text-base leading-6 text-ink">
                {step.kind === "waiting-receipt"
                  ? "Esperando recepción…"
                  : "Esperando que llegue el depósito…"}
              </p>
              <p className="text-sm leading-6 text-ink-muted">
                {step.kind === "waiting-receipt"
                  ? `Solicitamos S/ ${formatMettalMajorGrouped(step.result.amount)}. Esperando la recepción.`
                  : "Esperando que llegue el depósito. Puedes dejar esta pantalla abierta."}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 min-h-14 rounded-2xl border border-line bg-surface-raised px-5 py-3 font-semibold text-ink transition active:scale-[0.99]"
            >
              Cancelar
            </button>
          </>
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
            <p className="mt-5 text-base text-ink-muted">
              Disponible{" "}
              <span className="ml-1 text-2xl font-semibold tabular-nums tracking-tight text-accent">
                S/ {formatMettalMajorGrouped(step.acquireBalance)}
              </span>
            </p>
            <div className="mt-6">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-ink">
                  Monto a agregar
                </span>
                <div className="flex gap-1.5">
                  {([25, 50, 100] as const).map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => {
                        const minor =
                          pct === 100
                            ? step.acquireBalance
                            : Math.floor((step.acquireBalance * pct) / 100);
                        setAmountInput(formatMettalMajor(minor));
                        setAmountError(null);
                      }}
                      className="rounded-lg border border-line bg-surface-raised px-2.5 py-1 text-xs font-semibold tabular-nums text-ink-muted transition active:scale-[0.97] hover:border-accent/50 hover:text-ink"
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
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
                className="mt-2 min-h-14 w-full rounded-2xl border border-line bg-surface-raised px-4 text-center text-xl font-semibold tabular-nums text-ink outline-none focus:border-accent"
              />
            </div>
            {amountError ? (
              <p className="mt-3 text-sm text-danger" role="alert">
                {amountError}
              </p>
            ) : null}
            <div className="mt-8 flex gap-3">
              <button
                type="button"
                onClick={() => void handleAmountContinue()}
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

        {step.kind === "success" ? (
          <>
            <p className="mt-4 text-sm leading-6 text-ink-muted">
              Llegaron{" "}
              <span className="font-semibold text-ink">
                S/ {formatMettalMajorGrouped(step.result.amount)}
              </span>{" "}
              {step.result.symbol} a tu billetera.
            </p>
            <p className="mt-4 text-center text-3xl font-semibold tabular-nums tracking-tight text-accent">
              {step.balanceFormatted}{" "}
              <span className="text-sm font-medium text-accent-soft">PENMT</span>
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-8 min-h-14 rounded-2xl bg-accent px-5 py-3 font-semibold text-surface transition active:scale-[0.99]"
            >
              Listo
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
                className="mt-4 min-h-12 w-full rounded-2xl border border-line bg-surface px-5 py-3 font-semibold text-ink transition active:scale-[0.99]"
              >
                {copied ? "Copiado" : "Copiar cuenta bancaria"}
              </button>
            </div>
            <button
              type="button"
              onClick={handleTransferDone}
              className="mt-8 min-h-14 rounded-2xl bg-accent px-5 py-3 font-semibold text-surface transition active:scale-[0.99]"
            >
              Ya hice la transferencia
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
