import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import {
  authorizeRedeem,
  deleteDestination,
  formatMettalMajor,
  formatMettalMajorGrouped,
  getAccountBalances,
  getRedeemAddresses,
  getRedeemStatus,
  issueMettalAccessToken,
  listDestinations,
  METTAL_ACQUIRE_NETWORK,
  METTAL_DEFAULT_COUNTRY,
  METTAL_MINOR_UNIT_SCALE,
  METTAL_REDEEM_FIRST_MINOR,
  parseMettalMajorToMinor,
  registerDestination,
  requestRedeemQuote,
  type MettalDestination,
  type MettalRedeemQuote,
} from "@/lib/mettal/client";
import {
  withMettalCredentialsAndSeed,
  type MettalCredentials,
} from "@/lib/mettal/credentials";
import { getPenmtBalance } from "@/lib/evm/penmt";
import {
  getPenmtFeePreview,
  sendPenmtWithFee,
  type SendProgress,
} from "@/lib/evm/transfer";
import { ensurePrimaryEvmAccount } from "@/lib/vault/evm";
import type { DeviceVaultRecord, VaultAccount } from "@/lib/vault/types";

const REDEEM_BALANCE_POLL_MS = 7_000;
const REDEEM_STATUS_POLL_MS = 5_000;

type WithdrawSession = {
  credentials: MettalCredentials;
  accessToken: string;
  account: VaultAccount;
  signer: PrivateKeyAccount;
  redeemBalanceMinor: number;
  selectedBankId?: string;
  selectedBankAccount?: string;
};

type WithdrawSheetProps = {
  open: boolean;
  vault: DeviceVaultRecord | null;
  onClose: () => void;
  onVaultUpdated?: (vault: DeviceVaultRecord) => void;
  onBalanceConfirmed?: (balanceFormatted: string) => void;
};

type SheetStep =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | {
      kind: "bank";
      banks: MettalDestination[];
      selectedId: string | null;
      onChainFormatted: string;
    }
  | {
      kind: "confirm-delete";
      banks: MettalDestination[];
      selectedId: string;
      onChainFormatted: string;
    }
  | {
      kind: "register-bank";
      banks: MettalDestination[];
      onChainFormatted: string;
    }
  | {
      kind: "amount";
      banks: MettalDestination[];
      selectedId: string;
      onChainFormatted: string;
      feeFormatted: string | null;
    }
  | {
      kind: "amount-mettal";
      banks: MettalDestination[];
      selectedId: string;
      redeemFormatted: string;
      redeemBalanceMinor: number;
    }
  | {
      kind: "confirm-quote";
      quote: MettalRedeemQuote;
      amountMinor: number;
      bankAccount: string;
    }
  | { kind: "working"; message: string }
  | { kind: "waiting-redeem-balance"; amountMinor: number; previousRedeem: number }
  | { kind: "waiting-payout"; transactionId: string; amountMinor: number }
  | { kind: "success"; amountMinor: number }
  | { kind: "error"; message: string };

function progressMessage(step: SendProgress): string {
  switch (step) {
    case "unlock":
      return "Confirma tu biometría…";
    case "clearing":
      return "Preparando la red…";
    case "approve":
      return "Autorizando comisión…";
    case "fee":
      return "Cargando ETH de gas…";
    case "transfer":
      return "Enviando PENMT…";
    case "done":
      return "Transferencia enviada…";
  }
}

export function WithdrawSheet({
  open,
  vault,
  onClose,
  onVaultUpdated,
  onBalanceConfirmed,
}: WithdrawSheetProps) {
  const [step, setStep] = useState<SheetStep>({ kind: "idle" });
  const [amountInput, setAmountInput] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [bankInput, setBankInput] = useState("");
  const [bankError, setBankError] = useState<string | null>(null);
  const sessionRef = useRef<WithdrawSession | null>(null);
  const onVaultUpdatedRef = useRef(onVaultUpdated);
  onVaultUpdatedRef.current = onVaultUpdated;
  const onBalanceConfirmedRef = useRef(onBalanceConfirmed);
  onBalanceConfirmedRef.current = onBalanceConfirmed;

  function clearSession() {
    sessionRef.current = null;
  }

  async function refreshAccessToken(session: WithdrawSession): Promise<string> {
    const accessToken = await issueMettalAccessToken(session.credentials);
    session.accessToken = accessToken;
    return accessToken;
  }

  useEffect(() => {
    if (open) return;
    clearSession();
    setStep({ kind: "idle" });
    setAmountInput("");
    setAmountError(null);
    setBankInput("");
    setBankError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!vault) {
      setStep({
        kind: "error",
        message: "Abre la app para cargar la cuenta con biometría.",
      });
      return;
    }
    if (sessionRef.current) return;

    let cancelled = false;
    setStep({
      kind: "loading",
      message: "Confirmando acceso…",
    });

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
            return {
              credentials,
              accessToken,
              account,
              signer,
              nextVault,
            };
          },
        );
        if (cancelled) return;

        sessionRef.current = {
          credentials: unlocked.credentials,
          accessToken: unlocked.accessToken,
          account: unlocked.account,
          signer: unlocked.signer,
          redeemBalanceMinor: 0,
        };
        onVaultUpdatedRef.current?.(unlocked.nextVault);

        setStep({
          kind: "loading",
          message: "Consultando tu cuenta en Mettal…",
        });

        const [banks, onChain, balances] = await Promise.all([
          listDestinations({
            accessToken: unlocked.accessToken,
            country: METTAL_DEFAULT_COUNTRY,
          }),
          getPenmtBalance(unlocked.account.address),
          getAccountBalances({ accessToken: unlocked.accessToken }),
        ]);
        if (cancelled) return;

        if (sessionRef.current) {
          sessionRef.current.redeemBalanceMinor = balances.redeemBalance;
        }

        if (banks.length === 0) {
          setStep({
            kind: "register-bank",
            banks: [],
            onChainFormatted: onChain.formatted,
          });
          return;
        }

        setStep({
          kind: "bank",
          banks,
          selectedId: banks[0]?.id ?? null,
          onChainFormatted: onChain.formatted,
        });
      } catch (err) {
        if (cancelled) return;
        clearSession();
        setStep({
          kind: "error",
          message:
            err instanceof Error
              ? err.message
              : "No se pudo iniciar el retiro.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, vault]);

  useEffect(() => {
    if (step.kind !== "waiting-redeem-balance") return;
    const target = step.amountMinor;
    const previous = step.previousRedeem;
    let cancelled = false;
    let inFlight = false;

    async function poll() {
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
          balances = await getAccountBalances({ accessToken });
        }
        if (cancelled) return;
        if (balances.redeemBalance >= previous + target) {
          setStep({ kind: "working", message: "Obteniendo cotización…" });
          void requestFiatRedeemQuote(target);
        }
      } catch {
        // keep polling
      } finally {
        inFlight = false;
      }
    }

    void poll();
    const timer = window.setInterval(() => void poll(), REDEEM_BALANCE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.kind]);

  useEffect(() => {
    if (step.kind !== "waiting-payout") return;
    const transactionId = step.transactionId;
    const amountMinor = step.amountMinor;
    let cancelled = false;
    let inFlight = false;

    async function poll() {
      const session = sessionRef.current;
      if (!session || cancelled || inFlight) return;
      inFlight = true;
      try {
        let status;
        try {
          status = await getRedeemStatus({
            accessToken: session.accessToken,
            transactionId,
          });
        } catch {
          const accessToken = await refreshAccessToken(session);
          status = await getRedeemStatus({ accessToken, transactionId });
        }
        if (cancelled) return;
        if (status.status === "success") {
          try {
            const balance = await getPenmtBalance(session.account.address);
            onBalanceConfirmedRef.current?.(balance.formatted);
          } catch {
            // ignore
          }
          setStep({ kind: "success", amountMinor });
          return;
        }
        if (status.status === "failed") {
          setStep({
            kind: "error",
            message: "El retiro bancario falló. Inténtalo de nuevo más tarde.",
          });
        }
      } catch {
        // keep polling
      } finally {
        inFlight = false;
      }
    }

    void poll();
    const timer = window.setInterval(() => void poll(), REDEEM_STATUS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [step]);

  if (!open) return null;

  async function requestFiatRedeemQuote(amountMinor: number) {
    const session = sessionRef.current;
    if (!session) {
      setStep({ kind: "error", message: "La sesión expiró." });
      return;
    }

    const bankId = session.selectedBankId;
    if (!bankId) {
      setStep({
        kind: "error",
        message: "Selecciona una cuenta bancaria e inténtalo de nuevo.",
      });
      return;
    }

    try {
      let accessToken = session.accessToken;
      let quote;
      try {
        quote = await requestRedeemQuote({
          accessToken,
          amount: amountMinor,
          destinationId: bankId,
        });
      } catch {
        accessToken = await refreshAccessToken(session);
        quote = await requestRedeemQuote({
          accessToken,
          amount: amountMinor,
          destinationId: bankId,
        });
      }

      setStep({
        kind: "confirm-quote",
        quote,
        amountMinor,
        bankAccount: session.selectedBankAccount ?? "",
      });
    } catch (err) {
      setStep({
        kind: "error",
        message:
          err instanceof Error
            ? err.message
            : "No se pudo obtener la cotización del retiro.",
      });
    }
  }

  async function handleConfirmQuote() {
    if (step.kind !== "confirm-quote") return;
    const session = sessionRef.current;
    if (!session) {
      setStep({ kind: "error", message: "La sesión expiró." });
      return;
    }

    const bankId = session.selectedBankId;
    if (!bankId) {
      setStep({
        kind: "error",
        message: "Selecciona una cuenta bancaria e inténtalo de nuevo.",
      });
      return;
    }

    const amountMinor = step.amountMinor;
    const quoteId = step.quote.quoteId;
    const idempotencyKey = crypto.randomUUID();
    setStep({ kind: "working", message: "Confirmando retiro…" });

    try {
      let accessToken = session.accessToken;
      let result;
      try {
        result = await authorizeRedeem({
          accessToken,
          quoteId,
          destinationId: bankId,
          idempotencyKey,
        });
      } catch {
        accessToken = await refreshAccessToken(session);
        result = await authorizeRedeem({
          accessToken,
          quoteId,
          destinationId: bankId,
          idempotencyKey,
        });
      }

      if (result.status === "success") {
        try {
          const balance = await getPenmtBalance(session.account.address);
          onBalanceConfirmedRef.current?.(balance.formatted);
        } catch {
          // ignore
        }
        setStep({ kind: "success", amountMinor });
        return;
      }

      setStep({
        kind: "waiting-payout",
        transactionId: result.transactionId,
        amountMinor,
      });
    } catch (err) {
      setStep({
        kind: "error",
        message:
          err instanceof Error
            ? err.message
            : "No se pudo completar el retiro bancario.",
      });
    }
  }

  function goToAmountStep(input: {
    banks: MettalDestination[];
    selectedId: string;
    onChainFormatted: string;
  }) {
    const session = sessionRef.current;
    if (!session) return;

    if (session.redeemBalanceMinor >= METTAL_REDEEM_FIRST_MINOR) {
      setStep({
        kind: "amount-mettal",
        banks: input.banks,
        selectedId: input.selectedId,
        redeemBalanceMinor: session.redeemBalanceMinor,
        redeemFormatted: formatMettalMajorGrouped(session.redeemBalanceMinor),
      });
      return;
    }

    setStep({ kind: "working", message: "Calculando comisión…" });
    void (async () => {
      try {
        const fee = await getPenmtFeePreview({
          sender: session.account.address as Address,
          amount: input.onChainFormatted,
        });
        setStep({
          kind: "amount",
          banks: input.banks,
          selectedId: input.selectedId,
          onChainFormatted: input.onChainFormatted,
          feeFormatted: fee.skipped ? null : fee.feeAmountFormatted,
        });
      } catch {
        setStep({
          kind: "amount",
          banks: input.banks,
          selectedId: input.selectedId,
          onChainFormatted: input.onChainFormatted,
          feeFormatted: null,
        });
      }
    })();
  }

  async function handleRegisterBank() {
    const session = sessionRef.current;
    if (!session || step.kind !== "register-bank") return;
    const digits = bankInput.trim().replace(/\s/g, "");
    if (!/^\d{20}$/.test(digits)) {
      setBankError("Ingresa un CCI válido de 20 dígitos.");
      return;
    }
    setBankError(null);
    setStep({ kind: "working", message: "Registrando cuenta bancaria…" });
    try {
      let accessToken = session.accessToken;
      let bank;
      try {
        bank = await registerDestination({
          accessToken,
          bankAccount: digits,
          country: METTAL_DEFAULT_COUNTRY,
        });
      } catch {
        accessToken = await refreshAccessToken(session);
        bank = await registerDestination({
          accessToken,
          bankAccount: digits,
          country: METTAL_DEFAULT_COUNTRY,
        });
      }
      const banks = await listDestinations({
        accessToken,
        country: METTAL_DEFAULT_COUNTRY,
      });
      setStep({
        kind: "bank",
        banks: banks.length ? banks : [bank],
        selectedId: bank.id,
        onChainFormatted: step.onChainFormatted,
      });
    } catch (err) {
      setStep({
        kind: "register-bank",
        banks: step.banks,
        onChainFormatted: step.onChainFormatted,
      });
      setBankError(
        err instanceof Error
          ? err.message
          : "No se pudo registrar la cuenta bancaria.",
      );
    }
  }

  async function handleContinueFromBank() {
    if (step.kind !== "bank" || !step.selectedId) return;
    const session = sessionRef.current;
    if (!session) return;

    setStep({ kind: "working", message: "Consultando saldo Mettal…" });
    try {
      let accessToken = session.accessToken;
      let balances;
      try {
        balances = await getAccountBalances({ accessToken });
      } catch {
        accessToken = await refreshAccessToken(session);
        balances = await getAccountBalances({ accessToken });
      }
      session.redeemBalanceMinor = balances.redeemBalance;
      goToAmountStep({
        banks: step.banks,
        selectedId: step.selectedId,
        onChainFormatted: step.onChainFormatted,
      });
    } catch (err) {
      setStep({
        kind: "error",
        message:
          err instanceof Error
            ? err.message
            : "No se pudo consultar el saldo de retiro.",
      });
    }
  }

  async function handleMettalWithdraw() {
    if (step.kind !== "amount-mettal") return;
    const session = sessionRef.current;
    if (!session) {
      setStep({ kind: "error", message: "La sesión expiró." });
      return;
    }

    const minor = parseMettalMajorToMinor(amountInput);
    if (minor === null || minor <= 0) {
      setAmountError("Ingresa un monto válido (hasta 2 decimales).");
      return;
    }
    if (minor < 100) {
      setAmountError("El monto mínimo es S/ 1.00.");
      return;
    }
    if (minor > step.redeemBalanceMinor) {
      setAmountError(
        `El máximo disponible es S/ ${step.redeemFormatted}.`,
      );
      return;
    }

    setAmountError(null);
    session.selectedBankId = step.selectedId;
    session.selectedBankAccount =
      step.banks.find((bank) => bank.id === step.selectedId)?.bankAccount ??
      "";
    setStep({ kind: "working", message: "Obteniendo cotización…" });
    void requestFiatRedeemQuote(minor);
  }

  async function handleWithdraw() {
    if (step.kind !== "amount") return;
    const session = sessionRef.current;
    if (!session) {
      setStep({ kind: "error", message: "La sesión expiró." });
      return;
    }

    const minor = parseMettalMajorToMinor(amountInput);
    if (minor === null || minor <= 0) {
      setAmountError("Ingresa un monto válido (hasta 2 decimales).");
      return;
    }
    if (minor < 100) {
      setAmountError("El monto mínimo es S/ 1.00.");
      return;
    }

    const onChainMinor = Math.round(
      Number(step.onChainFormatted.replace(/,/g, "")) * METTAL_MINOR_UNIT_SCALE,
    );
    if (!Number.isFinite(onChainMinor) || minor > onChainMinor) {
      setAmountError(
        `El máximo disponible es S/ ${step.onChainFormatted}.`,
      );
      return;
    }

    setAmountError(null);
    session.selectedBankId = step.selectedId;
    session.selectedBankAccount =
      step.banks.find((bank) => bank.id === step.selectedId)?.bankAccount ??
      "";

    setStep({ kind: "working", message: "Buscando dirección de retiro…" });

    try {
      let accessToken = session.accessToken;
      let addresses;
      try {
        addresses = await getRedeemAddresses({ accessToken });
      } catch {
        accessToken = await refreshAccessToken(session);
        addresses = await getRedeemAddresses({ accessToken });
      }

      const baseAddress = addresses.find(
        (item) =>
          item.chain.toLowerCase() === METTAL_ACQUIRE_NETWORK &&
          item.address?.startsWith("0x"),
      );
      if (!baseAddress) {
        throw new Error(
          "No hay dirección de retiro en Base para esta cuenta Mettal.",
        );
      }

      const balancesBefore = await getAccountBalances({ accessToken });
      const amountMajor = formatMettalMajor(minor);

      const result = await sendPenmtWithFee({
        vault: vault!,
        receiver: baseAddress.address as Address,
        amount: amountMajor,
        onProgress: (progress) => {
          setStep({ kind: "working", message: progressMessage(progress) });
        },
      });
      onVaultUpdatedRef.current?.(result.vault);

      setStep({
        kind: "waiting-redeem-balance",
        amountMinor: minor,
        previousRedeem: balancesBefore.redeemBalance,
      });
    } catch (err) {
      setStep({
        kind: "error",
        message:
          err instanceof Error ? err.message : "No se pudo enviar el retiro.",
      });
    }
  }

  async function handleDeleteBank() {
    const session = sessionRef.current;
    if (!session || step.kind !== "confirm-delete") return;
    const id = step.selectedId;
    const onChainFormatted = step.onChainFormatted;
    setStep({ kind: "working", message: "Eliminando cuenta…" });
    try {
      let accessToken = session.accessToken;
      try {
        await deleteDestination({ accessToken, id });
      } catch {
        accessToken = await refreshAccessToken(session);
        await deleteDestination({ accessToken, id });
      }
      const banks = await listDestinations({
        accessToken,
        country: METTAL_DEFAULT_COUNTRY,
      });
      if (banks.length === 0) {
        setStep({
          kind: "register-bank",
          banks: [],
          onChainFormatted,
        });
        return;
      }
      setStep({
        kind: "bank",
        banks,
        selectedId: banks[0]?.id ?? null,
        onChainFormatted,
      });
    } catch (err) {
      setStep({
        kind: "error",
        message:
          err instanceof Error
            ? err.message
            : "No se pudo eliminar la cuenta bancaria.",
      });
    }
  }

  const title =
    step.kind === "success"
      ? "Listo"
      : step.kind === "register-bank"
        ? "Cuenta bancaria"
        : step.kind === "confirm-delete"
          ? "Eliminar cuenta"
          : step.kind === "confirm-quote"
            ? "Confirmar retiro"
            : step.kind === "amount" || step.kind === "amount-mettal"
              ? "Retirar"
              : "Retirar a tu banco";

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/75 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="withdraw-title"
    >
      <section className="flex w-full max-w-md flex-col overflow-y-auto rounded-3xl border border-line bg-surface px-5 py-5 shadow-2xl">
        <h1 id="withdraw-title" className="text-2xl font-semibold text-ink">
          {title}
        </h1>

        {step.kind === "loading" || step.kind === "working" ? (
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
              Cancelar
            </button>
          </>
        ) : null}

        {step.kind === "waiting-redeem-balance" ||
        step.kind === "waiting-payout" ? (
          <>
            <div className="mt-8 flex flex-col items-center gap-5 px-2 py-6 text-center">
              <div
                className="h-10 w-10 animate-spin rounded-full border-2 border-line border-t-accent"
                aria-hidden="true"
              />
              <p className="text-base leading-6 text-ink">
                {step.kind === "waiting-payout"
                  ? "Procesando retiro a tu banco…"
                  : "Esperando confirmación del depósito…"}
              </p>
              <p className="text-sm leading-6 text-ink-muted">
                S/ {formatMettalMajorGrouped(step.amountMinor)}
              </p>
            </div>
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

        {step.kind === "register-bank" ? (
          <>
            <p className="mt-4 text-sm leading-6 text-ink-muted">
              Registra el CCI de tu cuenta bancaria para retirar soles. Tú debes
              ser el titular de la cuenta según los datos de tu registro en
              Mettal.io. Recuerda hacer un retiro de prueba con una cantidad
              baja para verificar que todo esté bien.
            </p>
            <label className="mt-6 block text-sm font-medium text-ink">
              CCI (20 dígitos)
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={bankInput}
                onChange={(e) => {
                  setBankInput(e.target.value);
                  setBankError(null);
                }}
                className="mt-2 min-h-14 w-full rounded-2xl border border-line bg-surface-raised px-4 font-mono text-lg text-ink outline-none focus:border-accent"
              />
            </label>
            {bankError ? (
              <p className="mt-3 text-sm text-danger" role="alert">
                {bankError}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => void handleRegisterBank()}
              className="mt-8 min-h-14 rounded-2xl bg-accent px-5 py-3 font-semibold text-surface transition active:scale-[0.99]"
            >
              Guardar cuenta
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

        {step.kind === "bank" ? (
          <>
            <p className="mt-4 text-sm leading-6 text-ink-muted">
              {step.banks.length === 1
                ? "Retiraremos a esta cuenta bancaria."
                : "Elige la cuenta bancaria de destino."}
            </p>
            <div className="mt-5 flex flex-col gap-2">
              {step.banks.map((bank) => {
                const selected = step.selectedId === bank.id;
                return (
                  <button
                    key={bank.id}
                    type="button"
                    onClick={() =>
                      setStep({ ...step, selectedId: bank.id })
                    }
                    className={`rounded-2xl border px-4 py-4 text-left transition active:scale-[0.99] ${
                      selected
                        ? "border-accent bg-accent/10"
                        : "border-line bg-surface-raised"
                    }`}
                  >
                    <span className="block font-mono text-base font-semibold text-ink">
                      {bank.bankAccount}
                    </span>
                    <span className="mt-1 block text-xs text-ink-muted">
                      {bank.currency} · {bank.country}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() =>
                setStep({
                  kind: "register-bank",
                  banks: step.banks,
                  onChainFormatted: step.onChainFormatted,
                })
              }
              className="mt-4 text-sm font-semibold text-accent"
            >
              Agregar otra cuenta
            </button>
            {step.selectedId &&
            (step.banks.length > 1 || import.meta.env.DEV) ? (
              <button
                type="button"
                onClick={() =>
                  setStep({
                    kind: "confirm-delete",
                    banks: step.banks,
                    selectedId: step.selectedId!,
                    onChainFormatted: step.onChainFormatted,
                  })
                }
                className="mt-2 text-sm font-semibold text-ink-muted"
              >
                Eliminar cuenta seleccionada
              </button>
            ) : null}
            <button
              type="button"
              disabled={!step.selectedId}
              onClick={() => void handleContinueFromBank()}
              className="mt-8 min-h-14 rounded-2xl bg-accent px-5 py-3 font-semibold text-surface transition active:scale-[0.99] disabled:opacity-50"
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

        {step.kind === "confirm-delete" ? (
          <>
            <p className="mt-4 text-sm leading-6 text-ink-muted">
              Vas a eliminar esta cuenta bancaria. No podrás retirar a ella
              hasta volver a registrarla.
            </p>
            {step.banks
              .filter((bank) => bank.id === step.selectedId)
              .map((bank) => (
                <div
                  key={bank.id}
                  className="mt-5 rounded-2xl border border-line bg-surface-raised px-4 py-4"
                >
                  <span className="block font-mono text-base font-semibold text-ink">
                    {bank.bankAccount}
                  </span>
                  <span className="mt-1 block text-xs text-ink-muted">
                    {bank.currency} · {bank.country}
                  </span>
                </div>
              ))}
            <button
              type="button"
              onClick={() => void handleDeleteBank()}
              className="mt-8 min-h-14 rounded-2xl border border-danger/50 bg-danger/10 px-5 py-3 font-semibold text-danger transition active:scale-[0.99]"
            >
              Sí, eliminar cuenta
            </button>
            <button
              type="button"
              onClick={() =>
                setStep({
                  kind: "bank",
                  banks: step.banks,
                  selectedId: step.selectedId,
                  onChainFormatted: step.onChainFormatted,
                })
              }
              className="mt-3 min-h-14 rounded-2xl border border-line bg-surface-raised px-5 py-3 font-semibold text-ink transition active:scale-[0.99]"
            >
              Volver
            </button>
          </>
        ) : null}

        {step.kind === "confirm-quote" ? (
          <>
            <p className="mt-4 text-sm leading-6 text-ink-muted">
              Revisa el detalle antes de confirmar el retiro a tu banco.
            </p>
            <div className="mt-5 rounded-2xl border border-line bg-surface-raised px-4 py-4 text-sm text-ink">
              {step.bankAccount ? (
                <div className="flex items-start justify-between gap-3">
                  <span className="text-ink-muted">Cuenta</span>
                  <span className="max-w-[70%] break-all text-right font-mono font-semibold">
                    {step.bankAccount}
                  </span>
                </div>
              ) : null}
              <div
                className={`flex items-center justify-between gap-3 ${
                  step.bankAccount ? "mt-3" : ""
                }`}
              >
                <span className="text-ink-muted">Solicitado</span>
                <span className="font-semibold tabular-nums">
                  S/{" "}
                  {formatMettalMajorGrouped(
                    step.quote.initialAmount ?? step.amountMinor,
                  )}
                </span>
              </div>
              {typeof step.quote.totalFee === "number" ? (
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-ink-muted">Comisión</span>
                  <span className="font-semibold tabular-nums">
                    S/ {formatMettalMajorGrouped(step.quote.totalFee)}
                  </span>
                </div>
              ) : null}
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
                <span className="font-medium text-ink">Recibirás</span>
                <span className="text-lg font-semibold tabular-nums text-accent">
                  S/{" "}
                  {formatMettalMajorGrouped(
                    step.quote.finalAmount ??
                      step.quote.initialAmount ??
                      step.amountMinor,
                  )}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleConfirmQuote()}
              className="mt-8 min-h-14 rounded-2xl bg-accent px-5 py-3 font-semibold text-surface transition active:scale-[0.99]"
            >
              Confirmar retiro
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

        {step.kind === "amount-mettal" ? (
          <>
            <p className="mt-4 text-sm leading-6 text-ink-muted">
              Ya tienes saldo en tu balance de retiro de Mettal.io. Retira desde
              ahí primero.
            </p>
            <p className="mt-4 text-sm leading-6 text-ink-muted">
              Disponible{" "}
              <span className="ml-1 text-2xl font-semibold tabular-nums tracking-tight text-accent">
                {step.redeemFormatted}
              </span>{" "}
              PENMT
            </p>
            <div className="mt-6">
              <span className="text-sm font-medium text-ink">Monto a retirar</span>
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
                className="mt-2 min-h-14 w-full rounded-2xl border border-line bg-surface-raised px-4 text-xl font-semibold tabular-nums text-ink outline-none focus:border-accent"
              />
            </div>
            {amountError ? (
              <p className="mt-3 text-sm text-danger" role="alert">
                {amountError}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => void handleMettalWithdraw()}
              className="mt-8 min-h-14 rounded-2xl bg-accent px-5 py-3 font-semibold text-surface transition active:scale-[0.99]"
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

        {step.kind === "amount" ? (
          <>
            <p className="mt-4 text-sm leading-6 text-ink-muted">
              Disponible{" "}
              <span className="ml-1 text-2xl font-semibold tabular-nums tracking-tight text-accent">
                {step.onChainFormatted}
              </span>{" "}
              PENMT
            </p>
            {step.feeFormatted ? (
              <p className="mt-2 text-sm text-ink-muted">
                Comisión de red ≈ {step.feeFormatted} PENMT
              </p>
            ) : null}
            <div className="mt-6">
              <span className="text-sm font-medium text-ink">Monto a retirar</span>
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
                className="mt-2 min-h-14 w-full rounded-2xl border border-line bg-surface-raised px-4 text-xl font-semibold tabular-nums text-ink outline-none focus:border-accent"
              />
            </div>
            {amountError ? (
              <p className="mt-3 text-sm text-danger" role="alert">
                {amountError}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => void handleWithdraw()}
              className="mt-8 min-h-14 rounded-2xl bg-accent px-5 py-3 font-semibold text-surface transition active:scale-[0.99]"
            >
              Retirar
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

        {step.kind === "success" ? (
          <>
            <p className="mt-4 text-sm leading-6 text-ink-muted">
              Solicitamos el retiro de{" "}
              <span className="font-semibold text-ink">
                S/ {formatMettalMajorGrouped(step.amountMinor)}
              </span>{" "}
              a tu cuenta bancaria. Revisa tu correo electrónico para la
              confirmación final por parte de Mettal.io.
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
      </section>
    </div>
  );
}
