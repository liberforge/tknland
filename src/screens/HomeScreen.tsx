type HomeScreenProps = {
  balanceAmount?: string;
  onAdd: () => void;
};

export function HomeScreen({
  balanceAmount = "0.00",
  onAdd,
}: HomeScreenProps) {
  return (
    <section className="flex flex-1 flex-col justify-between gap-10 py-6">
      <div className="rounded-3xl border border-line bg-surface-raised/80 px-6 py-10 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <p className="text-sm font-medium tracking-wide text-ink-muted uppercase">
          Tu saldo
        </p>
        <p className="mt-3 grid grid-cols-[1fr_auto_1fr] items-baseline tracking-tight tabular-nums">
          <span className="col-start-2 text-5xl font-semibold text-ink">
            {balanceAmount}
          </span>
          <span className="col-start-3 ml-2 text-xs font-medium text-ink/45">
            PENMT
          </span>
        </p>
        <p className="mt-3 text-sm text-ink-muted tabular-nums">
          ≈ S/ {balanceAmount}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <ActionButton
          label="Agregar"
          hint="Agrega PENMT a tu saldo"
          onClick={onAdd}
        />
        <ActionButton label="Enviar" hint="Envía PENMT a otra persona" />
        <ActionButton
          label="Retirar"
          hint="Recibe soles en tu cuenta bancaria"
        />
      </div>
    </section>
  );
}

function ActionButton({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-32 flex-col items-start justify-between rounded-2xl border border-line bg-surface-raised px-4 py-4 text-left text-ink transition active:scale-[0.98]"
    >
      <span className="text-xl font-semibold">{label}</span>
      <span className="text-sm text-ink-muted">{hint}</span>
    </button>
  );
}
