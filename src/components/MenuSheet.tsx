import { useEffect, useState, type ReactNode } from "react";
import type { Address } from "viem";
import { BackupFlow } from "./BackupFlow";
import { HighlightedAddress } from "./DestinationAccount";
import { getPublicClient } from "@/lib/evm/client";
import { estimateNetworkCredit } from "@/lib/evm/gas-virality";
import { withDeviceVaultSeed } from "@/lib/vault/ceremony";
import {
  ensurePrimaryEvmAccount,
  getPrimaryAddress,
} from "@/lib/vault/evm";
import type { DeviceVaultRecord } from "@/lib/vault/types";

type MenuSheetProps = {
  open: boolean;
  onClose: () => void;
  onTestUnlock?: () => void;
  onDisconnectMettal?: () => void;
  unlockHint?: string | null;
  backupCompleted?: boolean;
  mockBiometrics?: boolean;
  vault: DeviceVaultRecord;
  onVaultUpdated?: (vault: DeviceVaultRecord) => void;
  onRevealSeed: () => Promise<string>;
  onBackupCompleted?: () => Promise<void>;
};

type MenuView = "menu" | "about" | "backup" | "network";

type NetworkStatus =
  | { kind: "idle" }
  | { kind: "unlocking" }
  | { kind: "loading" }
  | {
      kind: "ready";
      penmtFormatted: string;
      approxSends: number;
      needsPackSoon: boolean;
    }
  | { kind: "error"; message: string };

export function MenuSheet({
  open,
  onClose,
  onTestUnlock,
  onDisconnectMettal,
  unlockHint,
  backupCompleted = false,
  mockBiometrics = false,
  vault,
  onVaultUpdated,
  onRevealSeed,
  onBackupCompleted,
}: MenuSheetProps) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const [view, setView] = useState<MenuView>("menu");
  const [network, setNetwork] = useState<NetworkStatus>({ kind: "idle" });
  const [resolvedAddress, setResolvedAddress] = useState<Address | null>(
    () => getPrimaryAddress(vault),
  );

  const [copiedAccount, setCopiedAccount] = useState(false);

  useEffect(() => {
    let frame = 0;
    let secondFrame = 0;
    let timer = 0;

    if (open) {
      setMounted(true);
      setView("menu");
      setNetwork({ kind: "idle" });
      setResolvedAddress(getPrimaryAddress(vault));
      setCopiedAccount(false);
      // Wait until the hidden panel has been painted before transitioning it in.
      frame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      timer = window.setTimeout(() => setMounted(false), 250);
    }

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(secondFrame);
      clearTimeout(timer);
    };
    // Only re-run on open/close — vault updates must not reset the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- vault read only when opening
  }, [open]);

  useEffect(() => {
    if (!open || view !== "network") return;

    let cancelled = false;
    setNetwork({ kind: "loading" });

    void (async () => {
      try {
        let address = resolvedAddress ?? getPrimaryAddress(vault);

        if (!address) {
          setNetwork({ kind: "unlocking" });
          const resolved = await withDeviceVaultSeed(vault, async (mnemonic) => {
            const { vault: updated, account } = await ensurePrimaryEvmAccount(
              vault,
              mnemonic,
            );
            onVaultUpdated?.(updated);
            return account.address as Address;
          });
          if (cancelled) return;
          address = resolved;
          setResolvedAddress(address);
        }

        setNetwork({ kind: "loading" });
        const ethWei = await getPublicClient().getBalance({ address });
        if (cancelled) return;
        setNetwork({ kind: "ready", ...estimateNetworkCredit(ethWei) });
      } catch (err) {
        if (cancelled) return;
        setNetwork({
          kind: "error",
          message:
            err instanceof Error
              ? err.message
              : "No se pudo consultar el saldo de red.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
    // onVaultUpdated is intentionally omitted (inline from parent).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view, vault, resolvedAddress]);

  if (!mounted) return null;

  const displayAddress =
    resolvedAddress ?? getPrimaryAddress(vault);

  async function handleRevealAccount() {
    let address = displayAddress;
    if (!address) {
      try {
        address = await withDeviceVaultSeed(vault, async (mnemonic) => {
          const { vault: updated, account } = await ensurePrimaryEvmAccount(
            vault,
            mnemonic,
          );
          onVaultUpdated?.(updated);
          return account.address as Address;
        });
        setResolvedAddress(address);
      } catch {
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAccount(true);
      window.setTimeout(() => setCopiedAccount(false), 1500);
    } catch {
      // Clipboard may be unavailable; address is still visible in the menu.
    }
  }

  const title =
    view === "about"
      ? "Acerca de"
      : view === "backup"
        ? "Copia de seguridad"
        : view === "network"
          ? "Recarga de Red"
          : "Menú";

  const networkStatusMessage =
    network.kind === "unlocking"
      ? mockBiometrics
        ? "Desbloqueando billetera…"
        : "Confirma tu biometría para ver el saldo…"
      : network.kind === "loading" || network.kind === "idle"
        ? "Consultando saldo…"
        : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-center">
      <button
        type="button"
        aria-label="Cerrar menú"
        className={`absolute inset-0 bg-black/55 transition-opacity duration-[250ms] motion-reduce:transition-none ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative z-10 flex min-h-dvh w-full max-w-md flex-col overflow-y-auto border border-line bg-surface-raised px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] transition-transform duration-[250ms] ease-out motion-reduce:transform-none motion-reduce:transition-none ${
          visible ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
        {view === "menu" ? (
          <>
            <p className="text-xl font-semibold text-ink">Menú</p>
            <ul className="mt-4 divide-y divide-line">
              <MenuItem
                label="Tu cuenta TKN"
                hint={
                  displayAddress ? (
                    <span className="break-all font-mono text-xs">
                      <HighlightedAddress address={displayAddress} />
                      {copiedAccount ? (
                        <span className="mt-1 block text-accent">
                          Copiado al portapapeles
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    "Toca para revelar y copiar"
                  )
                }
                onClick={() => void handleRevealAccount()}
              />
              <MenuItem
                label="Copia de seguridad"
                hint={
                  backupCompleted
                    ? "Ver frase secreta"
                    : "Respalda tu frase secreta"
                }
                onClick={() => setView("backup")}
              />
              <MenuItem
                label="Recarga de Red"
                hint="Saldo de red y envíos"
                onClick={() => setView("network")}
              />
              <MenuItem
                label="Acerca de"
                hint="Billetera tkn.land"
                onClick={() => setView("about")}
              />
              {onTestUnlock ? (
                <MenuItem
                  label="DEV: Probar desbloqueo"
                  hint={unlockHint ?? "Biometría → descifrar → borrar"}
                  onClick={onTestUnlock}
                />
              ) : null}
              {onDisconnectMettal ? (
                <MenuItem
                  label="DEV: Disconnect mettal"
                  hint="Borra la conexión para probarla otra vez"
                  onClick={onDisconnectMettal}
                />
              ) : null}
            </ul>
            <button
              type="button"
              onClick={onClose}
              className="mt-auto w-full rounded-xl border border-line bg-surface py-3 text-ink transition active:bg-line"
            >
              Cerrar
            </button>
          </>
        ) : null}
        {view === "network" ? (
          <>
            <p className="text-xl font-semibold text-ink">Recarga de Red</p>
            <div className="mt-6 space-y-6 pb-10">
              {networkStatusMessage ? (
                <p className="text-sm text-ink-muted">{networkStatusMessage}</p>
              ) : network.kind === "error" ? (
                <p className="text-sm text-ink-muted">{network.message}</p>
              ) : network.kind === "ready" ? (
                <>
                  <div className="text-center">
                    <p className="text-[0.7rem] font-medium tracking-[0.22em] text-accent uppercase">
                      Saldo de red
                    </p>
                    <p className="mt-3 flex items-baseline justify-center gap-2 tabular-nums">
                      <span className="text-5xl font-semibold tracking-tight text-ink">
                        {network.penmtFormatted}
                      </span>
                      <span className="text-sm font-medium text-accent-soft">
                        PENMT
                      </span>
                    </p>
                    <p className="mt-3 text-sm text-ink-muted">
                      {network.needsPackSoon
                        ? "Sin envíos disponibles · la próxima recarga es automática"
                        : `Quedan ≈ ${network.approxSends} envío${network.approxSends === 1 ? "" : "s"}`}
                    </p>
                  </div>
                  <div className="space-y-3 text-sm leading-6 text-ink-muted">
                    <p>
                      Cuando se acaba el saldo de
                      red, la recarga es automática y cuesta{" "}
                      <span className="font-semibold text-ink">1 PENMT</span>.
                    </p>
                  </div>
                </>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setView("menu")}
              className="mt-auto w-full rounded-xl border border-line bg-surface py-3 text-ink transition active:bg-line"
            >
              Volver
            </button>
          </>
        ) : null}
        {view === "about" ? (
          <>
            <p className="text-xl font-semibold text-ink">Acerca de</p>
            <div className="mt-4 space-y-4 text-sm leading-6 text-ink-muted">
              <p>
                tkn.land es una billetera de{" "}
                <span className="font-semibold text-ink">autocustodia</span>
                {" "}(self-custody).
              </p>
              <p>
                Al usar este software, aceptas su uso{" "}
                <span className="font-semibold text-ink">tal cual</span>
                {" "}(as-is) y eximes a los desarrolladores de cualquier
                reclamo por daños, pérdidas o perjuicios derivados de su uso.
              </p>
              <p>
                Tu clave privada se guarda en tu teléfono, protegida por la
                seguridad biométrica del dispositivo. Esto es autocustodia
                total: tkn.land no almacena ni registro de actividad, ni
                contraseñas, ni claves. Todas las operaciones se ejecutan bajo
                tu control.
              </p>
              <p>
                Si pierdes, reinicias o borras el teléfono, o si se invalidan
                las claves biométricas,{" "}
                <span className="font-semibold text-ink">
                  cualquier token guardado en la app es irrecuperable
                </span>
                . Es tu responsabilidad respaldar tus claves en un lugar
                seguro.
              </p>
              <p>
                Ten cuidado: cualquiera que tenga tu clave privada puede
                acceder a los tokens.
              </p>
              <p className="pt-[40px] text-right font-mono text-[0.65rem] text-ink-muted/80">
                Build {__APP_COMMIT__}
                <span className="mx-1.5 text-line">·</span>
                {formatBuiltAt(__APP_BUILT_AT__)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setView("menu")}
              className="mt-auto w-full rounded-xl border border-line bg-surface py-3 text-ink transition active:bg-line"
            >
              Volver
            </button>
          </>
        ) : null}
        {view === "backup" ? (
          <BackupFlow
            mockBiometrics={mockBiometrics}
            onRevealSeed={onRevealSeed}
            onBackupCompleted={onBackupCompleted}
            onBack={() => setView("menu")}
          />
        ) : null}
      </div>
    </div>
  );
}

function formatBuiltAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function MenuItem({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint: ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <>
      <p className="text-ink">{label}</p>
      <div className="text-sm text-ink-muted">{hint}</div>
    </>
  );

  return (
    <li>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="flex w-full flex-col items-start py-4 text-left"
        >
          {content}
        </button>
      ) : (
        <div className="py-4">{content}</div>
      )}
    </li>
  );
}
