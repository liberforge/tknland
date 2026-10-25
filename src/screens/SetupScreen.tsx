type SetupScreenProps = {
  busy: boolean;
  error: string | null;
  /** Safari cannot tell whether a passkey exists, so the user chooses. */
  chooseAccount?: boolean;
  onContinue: () => void;
  onRestore: () => void;
  onCreate: () => void;
  mockBiometrics?: boolean;
};

export function SetupScreen({
  busy,
  error,
  chooseAccount = false,
  onContinue,
  onRestore,
  onCreate,
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
            ? "Modo mock activo: se preparará una billetera local sin biometría."
            : chooseAccount
              ? "Crea una billetera nueva. Si ya tienes una en este dispositivo, ábrela."
              : "Toca el botón. Si este dispositivo ya tiene una billetera, la abrimos con la biometría. Si no, creamos una."}
        </p>
      </div>

      <div className="animate-rise-delay-2 flex flex-col gap-3">
        {error ? (
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-left font-mono text-xs leading-5 text-ink select-text">
            {error}
          </pre>
        ) : null}
        {chooseAccount ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={onCreate}
              className="min-h-14 rounded-2xl bg-accent px-5 text-lg font-semibold text-surface transition active:scale-[0.98] disabled:opacity-60"
            >
              {busy ? "Un momento…" : "Crear nueva cuenta"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onRestore}
              className="min-h-14 rounded-2xl border border-line bg-surface-raised px-5 text-lg font-semibold text-ink transition active:scale-[0.98] disabled:opacity-60"
            >
              Ya tengo cuenta
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={onContinue}
            className="min-h-14 rounded-2xl bg-accent px-5 text-lg font-semibold text-surface transition active:scale-[0.98] disabled:opacity-60"
          >
            {busy ? "Un momento…" : "Continuar"}
          </button>
        )}
      </div>
    </section>
  );
}
