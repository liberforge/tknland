type SetupScreenProps = {
  busy: boolean;
  error: string | null;
  onSetup: () => void;
};

export function SetupScreen({ busy, error, onSetup }: SetupScreenProps) {
  return (
    <section className="flex flex-1 flex-col justify-between gap-10 py-6">
      <div className="rounded-3xl border border-line bg-surface-raised/80 px-6 py-10">
        <p className="text-sm font-medium tracking-wide text-ink-muted uppercase">
          Welcome
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">
          Your wallet, unlocked with biometrics
        </h1>
        <p className="mt-4 text-base leading-relaxed text-ink-muted">
          Tap below to create your wallet. We&apos;ll ask for Face ID or your
          fingerprint — nothing else to set up.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {error ? (
          <p className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-ink">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={onSetup}
          className="min-h-14 rounded-2xl bg-accent px-5 text-lg font-semibold text-ink shadow-[0_10px_30px_rgba(61,143,95,0.25)] transition active:scale-[0.98] disabled:opacity-60"
        >
          {busy ? "Setting up…" : "Continue with biometrics"}
        </button>
      </div>
    </section>
  );
}
