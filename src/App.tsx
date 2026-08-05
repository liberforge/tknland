import { useCallback, useEffect, useState } from "react";
import { HomeScreen } from "./screens/HomeScreen";
import { MenuSheet } from "./components/MenuSheet";
import { MettalConnectSheet } from "./components/MettalConnectSheet";
import { AcquireDepositSheet } from "./components/AcquireDepositSheet";
import {
  SendScreen,
  type SendScreenMode,
} from "./screens/SendScreen";
import { HandshakeSheet } from "./components/HandshakeSheet";
import { WithdrawSheet } from "./components/WithdrawSheet";
import { SetupScreen } from "./screens/SetupScreen";
import { UnsupportedScreen } from "./screens/UnsupportedScreen";
import {
  getWebAuthnHostHint,
  isMockBiometrics,
  isPrfSupported,
} from "./lib/webauthn/prf";
import { getActiveDeviceVault } from "./lib/vault/db";
import { createInitialDeviceVault, markBackupCompleted, verifyVaultUnlock, withDeviceVaultSeed } from "./lib/vault/ceremony";
import type { DeviceVaultRecord } from "./lib/vault/types";
import { getPrimaryAddress } from "./lib/vault/evm";
import {
  disconnectMettal,
  storeMettalCredentials,
  type MettalCredentials,
} from "./lib/mettal/credentials";
import {
  clearLocationHash,
  parseHandshakeLink,
  type HandshakeLink,
} from "./lib/protocol/links";
import { getPenmtBalance } from "./lib/evm/penmt";

type BootState =
  | { status: "loading" }
  | { status: "unsupported"; reason?: string }
  | { status: "setup" }
  | { status: "ready"; vault: DeviceVaultRecord };

const mockBiometrics = isMockBiometrics();

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mettalOpen, setMettalOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [sendMode, setSendMode] = useState<SendScreenMode | null>(null);
  const [handshakeLink, setHandshakeLink] = useState<HandshakeLink | null>(
    null,
  );
  const [boot, setBoot] = useState<BootState>({ status: "loading" });
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [unlockHint, setUnlockHint] = useState<string | null>(null);
  const [homeBalance, setHomeBalance] = useState<string | null>(null);

  const mettalConnected =
    boot.status === "ready" && Boolean(boot.vault.mettalCredentials);

  const refreshBalance = useCallback(
    async (
      vault: DeviceVaultRecord,
      options?: { invalidate?: boolean; retries?: number },
    ) => {
      const address = getPrimaryAddress(vault);
      if (!address) {
        setHomeBalance("0.00");
        return;
      }
      if (options?.invalidate) setHomeBalance(null);

      const attempts = Math.max(1, options?.retries ?? 1);
      for (let i = 0; i < attempts; i++) {
        try {
          const { formatted } = await getPenmtBalance(address);
          setHomeBalance(formatted);
          return;
        } catch {
          if (i < attempts - 1) {
            await new Promise((resolve) => setTimeout(resolve, 600));
          }
          // Keep last known balance on RPC blips; if invalidated, leave blank.
        }
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const hostHint = getWebAuthnHostHint();
      if (hostHint) {
        if (!cancelled) {
          setBoot({ status: "unsupported", reason: hostHint });
        }
        return;
      }

      const supported = await isPrfSupported();
      if (cancelled) return;
      if (!supported) {
        setBoot({
          status: "unsupported",
          reason: "El autenticador de la plataforma o PRF no está disponible.",
        });
        return;
      }

      const vault = await getActiveDeviceVault();
      if (cancelled) return;
      if (vault) {
        setBoot({ status: "ready", vault });
        void refreshBalance(vault);
      } else {
        setBoot({ status: "setup" });
      }
    })().catch((err: unknown) => {
      if (cancelled) return;
      setBoot({
        status: "unsupported",
        reason: err instanceof Error ? err.message : "Error al iniciar",
      });
    });

    return () => {
      cancelled = true;
    };
  }, [refreshBalance]);

  useEffect(() => {
    if (boot.status !== "ready") return;

    const vault = boot.vault;
    const id = window.setInterval(() => {
      void refreshBalance(vault);
    }, 30_000);

    return () => window.clearInterval(id);
  }, [boot, refreshBalance]);

  useEffect(() => {
    function consumeHash() {
      const parsed = parseHandshakeLink(window.location.hash);
      if (!parsed) return;
      clearLocationHash();
      setSendMode(null);
      setDepositOpen(false);
      setWithdrawOpen(false);
      setMettalOpen(false);
      setMenuOpen(false);
      setHandshakeLink(parsed);
    }

    consumeHash();
    window.addEventListener("hashchange", consumeHash);
    return () => window.removeEventListener("hashchange", consumeHash);
  }, []);

  async function handleSetup() {
    setSetupBusy(true);
    setSetupError(null);
    try {
      const vault = await createInitialDeviceVault();
      setBoot({ status: "ready", vault });
      void refreshBalance(vault);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "No se pudo crear la billetera";
      if (/PRF|does not support|no admite/i.test(message)) {
        setBoot({ status: "unsupported", reason: message });
      } else {
        setSetupError(message);
      }
    } finally {
      setSetupBusy(false);
    }
  }

  const handleEnsureVault = useCallback(async () => {
    if (boot.status === "ready") return boot.vault;
    const vault = await createInitialDeviceVault();
    setBoot({ status: "ready", vault });
    void refreshBalance(vault);
    return vault;
  }, [boot, refreshBalance]);

  async function handleTestUnlock() {
    if (boot.status !== "ready") return;
    setUnlockHint(
      mockBiometrics
        ? "Desbloqueo mock…"
        : "Esperando la biometría…",
    );
    try {
      const { wordCount } = await verifyVaultUnlock(boot.vault);
      setUnlockHint(
        mockBiometrics
          ? `Mock OK: frase de ${wordCount} palabras`
          : `Listo: frase de ${wordCount} palabras descifrada y luego borrada`,
      );
    } catch (err) {
      setUnlockHint(err instanceof Error ? err.message : "Error al desbloquear");
    }
  }

  async function handleRevealSeed(): Promise<string> {
    if (boot.status !== "ready") {
      throw new Error("La billetera aún no está lista.");
    }
    return withDeviceVaultSeed(boot.vault, (mnemonic) => mnemonic);
  }

  async function handleBackupCompleted(): Promise<void> {
    if (boot.status !== "ready") return;
    const vault = await markBackupCompleted(boot.vault);
    setBoot({ status: "ready", vault });
  }

  const handleMettalCredentials = useCallback(
    async (credentials: MettalCredentials) => {
      if (boot.status !== "ready") {
        throw new Error("La billetera aún no está lista.");
      }

      const vault = await storeMettalCredentials(boot.vault, credentials);
      setBoot({ status: "ready", vault });
    },
    [boot],
  );

  function handleDisconnectMettal() {
    if (!import.meta.env.DEV || boot.status !== "ready") return;

    void (async () => {
      try {
        const vault = await disconnectMettal(boot.vault);
        setBoot({ status: "ready", vault });
        setMenuOpen(false);
      } catch (err) {
        setUnlockHint(
          err instanceof Error
            ? err.message
            : "No se pudo desconectar Mettal.",
        );
      }
    })();
  }

  const [mettalContinueTarget, setMettalContinueTarget] = useState<
    "deposit" | "withdraw"
  >("deposit");

  function handleAdd() {
    if (mettalConnected) {
      setDepositOpen(true);
      return;
    }
    setMettalContinueTarget("deposit");
    setMettalOpen(true);
  }

  function handleWithdraw() {
    if (mettalConnected) {
      setWithdrawOpen(true);
      return;
    }
    setMettalContinueTarget("withdraw");
    setMettalOpen(true);
  }

  function handleMettalContinue() {
    setMettalOpen(false);
    if (mettalContinueTarget === "withdraw") {
      setWithdrawOpen(true);
      return;
    }
    setDepositOpen(true);
  }

  const handshakeOpen = handshakeLink !== null;
  const readyVault = boot.status === "ready" ? boot.vault : null;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-[max(2.75rem,env(safe-area-inset-bottom))] pt-[max(0.5rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between pb-3 pt-0">
        <p className="text-[1.65rem] font-semibold tracking-tight text-ink">
          {import.meta.env.DEV ? (
            <>
              <span className="mr-2 align-middle text-[0.65rem] font-semibold tracking-[0.14em] text-accent uppercase">
                {mockBiometrics ? "Mock" : "Dev"}
              </span>
              tkn.land
            </>
          ) : (
            "tkn.land"
          )}
        </p>
        {boot.status === "ready" ? (
          <button
            type="button"
            aria-label="Abrir menú"
            onClick={() => setMenuOpen(true)}
            className="grid h-11 w-11 place-items-center rounded-xl border border-line/80 bg-surface-raised/80 text-ink backdrop-blur-sm transition active:scale-[0.96]"
          >
            <span className="flex w-5 flex-col gap-1.5" aria-hidden>
              <span className="h-0.5 w-full rounded bg-ink" />
              <span className="h-0.5 w-full rounded bg-ink" />
              <span className="h-0.5 w-full rounded bg-ink" />
            </span>
          </button>
        ) : (
          <span className="h-11 w-11" aria-hidden />
        )}
      </header>

      <main className="flex flex-1 flex-col">
        {boot.status === "loading" ? (
          <p className="py-16 text-center text-ink-muted">Cargando…</p>
        ) : null}
        {boot.status === "unsupported" ? (
          <UnsupportedScreen reason={boot.reason} />
        ) : null}
        {boot.status === "setup" && !handshakeOpen ? (
          <SetupScreen
            busy={setupBusy}
            error={setupError}
            onSetup={handleSetup}
            mockBiometrics={mockBiometrics}
          />
        ) : null}
        {boot.status === "setup" && handshakeOpen ? (
          <p className="py-16 text-center text-ink-muted">
            Abre el enlace para continuar…
          </p>
        ) : null}
        {boot.status === "ready" && sendMode == null ? (
          <HomeScreen
            balanceAmount={homeBalance}
            onAdd={handleAdd}
            onSend={() => setSendMode("send")}
            onRequest={() => setSendMode("request")}
            onWithdraw={handleWithdraw}
          />
        ) : null}
        {boot.status === "ready" && sendMode != null ? (
          <SendScreen
            mode={sendMode}
            vault={boot.vault}
            onBack={() => setSendMode(null)}
            onVaultUpdated={(vault) => {
              setBoot({ status: "ready", vault });
            }}
          />
        ) : null}
      </main>

      {boot.status === "ready" ? (
        <MenuSheet
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          onTestUnlock={
            import.meta.env.DEV ? handleTestUnlock : undefined
          }
          onDisconnectMettal={
            import.meta.env.DEV && mettalConnected
              ? handleDisconnectMettal
              : undefined
          }
          unlockHint={unlockHint}
          backupCompleted={boot.vault.backupCompleted}
          mockBiometrics={mockBiometrics}
          vault={boot.vault}
          onVaultUpdated={(updated) => {
            setBoot({ status: "ready", vault: updated });
            void refreshBalance(updated);
          }}
          onRevealSeed={handleRevealSeed}
          onBackupCompleted={handleBackupCompleted}
        />
      ) : null}

      {boot.status === "ready" ? (
        <>
          <MettalConnectSheet
            open={mettalOpen}
            connected={mettalConnected}
            secureStorageAvailable
            mockBiometrics={mockBiometrics}
            onClose={() => setMettalOpen(false)}
            onContinue={handleMettalContinue}
            onCredentials={handleMettalCredentials}
          />
          <AcquireDepositSheet
            open={depositOpen}
            vault={boot.vault}
            onClose={() => setDepositOpen(false)}
            onVaultUpdated={(vault) => {
              setBoot({ status: "ready", vault });
            }}
            onBalanceConfirmed={(balanceFormatted) => {
              setHomeBalance(balanceFormatted);
            }}
          />
          <WithdrawSheet
            open={withdrawOpen}
            vault={boot.vault}
            onClose={() => setWithdrawOpen(false)}
            onVaultUpdated={(vault) => {
              setBoot({ status: "ready", vault });
            }}
            onBalanceConfirmed={(balanceFormatted) => {
              setHomeBalance(balanceFormatted);
            }}
          />
        </>
      ) : null}

      <HandshakeSheet
        open={handshakeOpen}
        link={handshakeLink}
        vault={readyVault}
        mockBiometrics={mockBiometrics}
        onClose={() => {
          setHandshakeLink(null);
          if (boot.status === "ready") void refreshBalance(boot.vault);
        }}
        onEnsureVault={handleEnsureVault}
        onVaultUpdated={(vault) => {
          setBoot({ status: "ready", vault });
        }}
        onBalanceRefresh={() => {
          const vault =
            boot.status === "ready" ? boot.vault : null;
          if (vault) {
            void refreshBalance(vault, { invalidate: true, retries: 3 });
            return;
          }
          void getActiveDeviceVault().then((active) => {
            if (active) {
              void refreshBalance(active, { invalidate: true, retries: 3 });
            }
          });
        }}
      />
    </div>
  );
}
