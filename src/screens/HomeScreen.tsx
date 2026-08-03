type HomeScreenProps = {
  balanceAmount?: string | null;
  onAdd: () => void;
  onSend: () => void;
  onRequest: () => void;
  onWithdraw: () => void;
};

export function HomeScreen({
  balanceAmount = null,
  onAdd,
  onSend,
  onRequest,
  onWithdraw,
}: HomeScreenProps) {
  const balanceReady = balanceAmount != null;

  return (
    <section className="relative flex flex-1 flex-col justify-between gap-10 py-4">
      <div
        className="ambient-orb pointer-events-none absolute left-1/2 top-8 h-56 w-56 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(212,165,116,0.28)_0%,transparent_70%)]"
        aria-hidden
      />

      <div className="animate-rise relative px-2 pt-10 text-center">
        <p className="text-[0.7rem] font-medium tracking-[0.22em] text-accent uppercase">
          Tu saldo
        </p>
        <p className="mt-4 grid grid-cols-[1fr_auto_1fr] items-baseline tracking-tight tabular-nums">
          <span
            className="col-start-2 min-h-[3.75rem] text-6xl font-semibold leading-none tracking-tight text-ink"
            aria-busy={!balanceReady}
          >
            {balanceReady ? balanceAmount : "\u00A0"}
          </span>
          <span className="col-start-3 ml-2.5 self-end pb-1.5 text-xs font-medium tracking-wide text-accent-soft">
            PENMT
          </span>
        </p>
        <p className="mt-4 min-h-5 text-sm text-ink-muted tabular-nums">
          {balanceReady ? `≈ S/ ${balanceAmount}` : "\u00A0"}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onAdd}
          className="animate-rise-delay-1 group relative flex min-h-[5.5rem] items-center justify-between overflow-hidden rounded-2xl bg-accent px-5 py-4 text-left text-surface transition active:scale-[0.98]"
        >
          <span
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,transparent_40%,rgba(255,255,255,0.18)_50%,transparent_60%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            aria-hidden
          />
          <span className="relative">
            <span className="block text-xl font-semibold tracking-tight">
              Agregar
            </span>
            <span className="mt-1 block text-sm text-surface/70">
              Agrega a tu saldo
            </span>
          </span>
          <ActionGlyph kind="add" className="relative text-surface/80" />
        </button>

        <div className="grid grid-cols-2 gap-3">
          <ActionButton
            className="animate-rise-delay-2"
            label="Enviar"
            hint="A otra persona"
            glyph="send"
            onClick={onSend}
          />
          <ActionButton
            className="animate-rise-delay-3"
            label="Pedir"
            hint="Que te envíen"
            glyph="request"
            onClick={onRequest}
          />
        </div>

        <ActionButton
          className="animate-rise-delay-3 min-h-[5.5rem]"
          label="Retirar"
          hint="A tu cuenta bancaria"
          glyph="withdraw"
          onClick={onWithdraw}
        />
      </div>
    </section>
  );
}

function ActionButton({
  label,
  hint,
  glyph,
  className = "",
  onClick,
}: {
  label: string;
  hint: string;
  glyph: "send" | "request" | "withdraw";
  className?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[7.5rem] flex-col items-start justify-between rounded-2xl border border-line/80 bg-surface-raised/70 px-4 py-4 text-left text-ink backdrop-blur-sm transition active:scale-[0.98] ${className}`}
    >
      <ActionGlyph kind={glyph} className="text-accent-soft" />
      <span>
        <span className="block text-lg font-semibold tracking-tight">
          {label}
        </span>
        <span className="mt-1 block text-sm leading-snug text-ink-muted">
          {hint}
        </span>
      </span>
    </button>
  );
}

function ActionGlyph({
  kind,
  className = "",
}: {
  kind: "add" | "send" | "request" | "withdraw";
  className?: string;
}) {
  const common = `h-8 w-8 ${className}`;

  if (kind === "add") {
    return (
      <svg className={common} viewBox="0 0 32 32" fill="none" aria-hidden>
        <path
          d="M16 8v16M8 16h16"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (kind === "send") {
    return (
      <svg className={common} viewBox="0 0 32 32" fill="none" aria-hidden>
        <path
          d="M10 22 22 10M12 10h10v10"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (kind === "request") {
    return (
      <svg className={common} viewBox="0 0 32 32" fill="none" aria-hidden>
        <path
          d="M22 10 10 22M20 22H10V12"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg className={common} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path
        d="M16 7v14M10 15l6 6 6-6"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 25h16"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
      />
    </svg>
  );
}
