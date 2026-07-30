type HomeScreenProps = {
  balanceLabel?: string;
};

export function HomeScreen({ balanceLabel = "$0.00" }: HomeScreenProps) {
  return (
    <section className="flex flex-1 flex-col justify-between gap-10 py-6">
      <div className="rounded-3xl border border-line bg-surface-raised/80 px-6 py-10 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <p className="text-sm font-medium tracking-wide text-ink-muted uppercase">
          Your balance
        </p>
        <p className="mt-3 text-5xl font-semibold tracking-tight text-ink tabular-nums">
          {balanceLabel}
        </p>
        <p className="mt-3 text-sm text-ink-muted">On Base</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ActionButton label="Receive" hint="Get paid" />
        <ActionButton label="Send" hint="Pay someone" primary />
      </div>
    </section>
  );
}

function ActionButton({
  label,
  hint,
  primary = false,
}: {
  label: string;
  hint: string;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      className={
        primary
          ? "flex min-h-28 flex-col items-start justify-between rounded-2xl bg-accent px-5 py-4 text-left text-ink shadow-[0_10px_30px_rgba(61,143,95,0.25)] transition active:scale-[0.98]"
          : "flex min-h-28 flex-col items-start justify-between rounded-2xl border border-line bg-surface-raised px-5 py-4 text-left text-ink transition active:scale-[0.98]"
      }
    >
      <span className="text-2xl font-semibold">{label}</span>
      <span className={primary ? "text-sm text-ink/80" : "text-sm text-ink-muted"}>
        {hint}
      </span>
    </button>
  );
}
