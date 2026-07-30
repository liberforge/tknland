import { useEffect, useState } from "react";
import { HomeScreen } from "./screens/HomeScreen";
import { MenuSheet } from "./components/MenuSheet";
import { SetupScreen } from "./screens/SetupScreen";
import { UnsupportedScreen } from "./screens/UnsupportedScreen";
import { isPrfSupported, getWebAuthnHostHint } from "./lib/webauthn/prf";
import { getActiveDeviceVault } from "./lib/vault/db";
import { createInitialDeviceVault, verifyVaultUnlock } from "./lib/vault/ceremony";
import type { DeviceVaultRecord } from "./lib/vault/types";

type BootState =
  | { status: "loading" }
  | { status: "unsupported"; reason?: string }
  | { status: "setup" }
  | { status: "ready"; vault: DeviceVaultRecord };

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [boot, setBoot] = useState<BootState>({ status: "loading" });
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [unlockHint, setUnlockHint] = useState<string | null>(null);

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
          reason: "Platform authenticator / PRF unavailable.",
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
        reason: err instanceof Error ? err.message : "Startup failed",
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
        err instanceof Error ? err.message : "Could not create wallet";
      if (/PRF|does not support/i.test(message)) {
        setBoot({ status: "unsupported", reason: message });
      } else {
        setSetupError(message);
      }
    } finally {
      setSetupBusy(false);
    }
  }

  async function handleTestUnlock() {
    if (boot.status !== "ready") return;
    setUnlockHint("Waiting for biometrics…");
    try {
      const { wordCount } = await verifyVaultUnlock(boot.vault);
      setUnlockHint(`OK — decrypted ${wordCount}-word seed, then wiped`);
    } catch (err) {
      setUnlockHint(err instanceof Error ? err.message : "Unlock failed");
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between py-3">
        <p className="text-2xl font-semibold tracking-tight text-ink">
          {import.meta.env.DEV ? "DEV tkn.land" : "tkn.land"}
        </p>
        {boot.status === "ready" ? (
          <button
            type="button"
            aria-label="Open menu"
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
          <p className="py-16 text-center text-ink-muted">Loading…</p>
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
        {boot.status === "ready" ? <HomeScreen /> : null}
      </main>

      {boot.status === "ready" ? (
        <MenuSheet
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          onTestUnlock={handleTestUnlock}
          unlockHint={unlockHint}
        />
      ) : null}
    </div>
  );
}
