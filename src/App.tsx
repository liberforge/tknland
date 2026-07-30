import { useCallback, useEffect, useState } from "react";
import { HomeScreen } from "./screens/HomeScreen";
import { MenuSheet } from "./components/MenuSheet";
import { MettalConnectSheet } from "./components/MettalConnectSheet";
import { SetupScreen } from "./screens/SetupScreen";
import { UnsupportedScreen } from "./screens/UnsupportedScreen";
import { isPrfSupported, getWebAuthnHostHint } from "./lib/webauthn/prf";
import { getActiveDeviceVault } from "./lib/vault/db";
import { createInitialDeviceVault, verifyVaultUnlock } from "./lib/vault/ceremony";
import type { DeviceVaultRecord } from "./lib/vault/types";
import {
  disconnectMettal,
  storeMettalCredentials,
  type MettalCredentials,
} from "./lib/mettal/credentials";

type BootState =
  | { status: "loading" }
  | { status: "unsupported"; reason?: string }
  | { status: "setup" }
  | { status: "design-preview" }
  | { status: "ready"; vault: DeviceVaultRecord };

const isLocalDesignPreview =
  import.meta.env.DEV &&
  window.location.origin === "http://127.0.0.1:5173";

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mettalOpen, setMettalOpen] = useState(false);
  const [boot, setBoot] = useState<BootState>({ status: "loading" });
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [unlockHint, setUnlockHint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (isLocalDesignPreview) {
        setBoot({ status: "design-preview" });
        return;
      }

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
  }, []);

  async function handleSetup() {
    setSetupBusy(true);
    setSetupError(null);
    try {
      const vault = await createInitialDeviceVault();
      setBoot({ status: "ready", vault });
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

  async function handleTestUnlock() {
    if (boot.status === "design-preview") {
      setUnlockHint("Biometría desactivada en la vista previa local");
      return;
    }
    if (boot.status !== "ready") return;
    setUnlockHint("Esperando la biometría…");
    try {
      const { wordCount } = await verifyVaultUnlock(boot.vault);
      setUnlockHint(
        `Listo: frase de ${wordCount} palabras descifrada y luego borrada`,
      );
    } catch (err) {
      setUnlockHint(err instanceof Error ? err.message : "Error al desbloquear");
    }
  }

  const handleMettalCredentials = useCallback(
    async (credentials: MettalCredentials) => {
      if (boot.status !== "ready") {
        throw new Error(
          "Abre http://localhost:5173 para guardar las credenciales con biometría.",
        );
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

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between py-3">
        <p className="text-2xl font-semibold tracking-tight text-ink">
          {import.meta.env.DEV ? "DEV tkn.land" : "tkn.land"}
        </p>
        {boot.status === "ready" || boot.status === "design-preview" ? (
          <button
            type="button"
            aria-label="Abrir menú"
            onClick={() => setMenuOpen(true)}
            className="grid h-11 w-11 place-items-center rounded-xl border border-line bg-surface-raised text-ink"
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
        {boot.status === "setup" ? (
          <SetupScreen
            busy={setupBusy}
            error={setupError}
            onSetup={handleSetup}
          />
        ) : null}
        {boot.status === "ready" || boot.status === "design-preview" ? (
          <HomeScreen onAdd={() => setMettalOpen(true)} />
        ) : null}
      </main>

      {boot.status === "ready" || boot.status === "design-preview" ? (
        <MenuSheet
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          onTestUnlock={handleTestUnlock}
          onDisconnectMettal={
            import.meta.env.DEV &&
            boot.status === "ready" &&
            Boolean(boot.vault.mettalCredentials)
              ? handleDisconnectMettal
              : undefined
          }
          unlockHint={unlockHint}
        />
      ) : null}

      {boot.status === "ready" || boot.status === "design-preview" ? (
        <MettalConnectSheet
          open={mettalOpen}
          connected={
            boot.status === "ready" && Boolean(boot.vault.mettalCredentials)
          }
          secureStorageAvailable={boot.status === "ready"}
          onClose={() => setMettalOpen(false)}
          onCredentials={handleMettalCredentials}
        />
      ) : null}
    </div>
  );
}
