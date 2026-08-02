type SetupScreenProps = {
  busy: boolean;
  error: string | null;
  onSetup: () => void;
  mockBiometrics?: boolean;
};

export function SetupScreen({
  busy,
  error,
  onSetup,
  mockBiometrics = false,
}: SetupScreenProps) {
  return (
    <section className="flex flex-1 flex-col justify-between gap-10 py-6">
      <div className="animate-rise px-1 pt-6">
        <p className="text-[0.7rem] font-medium tracking-[0.22em] text-accent uppercase">
          Bienvenido
        </p>
        <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight text-ink">
          Tu billetera, solo tuya
        </h1>
        <p className="mt-5 max-w-[20rem] text-base leading-relaxed text-ink-muted">
          {mockBiometrics
            ? "Modo mock activo: se creará una bóveda local sin Face ID ni huella."
            : "Toca el botón para crearla. Te pediremos Face ID o tu huella, sin ninguna configuración adicional."}
        </p>
      </div>

      <div className="animate-rise-delay-2 flex flex-col gap-3">
        {error ? (
          <p className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-ink">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={onSetup}
          className="min-h-14 rounded-2xl bg-accent px-5 text-lg font-semibold text-surface transition active:scale-[0.98] disabled:opacity-60"
        >
          {busy
            ? "Configurando…"
            : mockBiometrics
              ? "Crear billetera (mock)"
              : "Crear mi billetera"}
        </button>
      </div>
    </section>
  );
}
