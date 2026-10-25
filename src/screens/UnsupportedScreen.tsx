type UnsupportedScreenProps = {
  reason?: string;
};

export function UnsupportedScreen({ reason }: UnsupportedScreenProps) {
  return (
    <section className="flex flex-1 flex-col justify-center gap-6 py-8">
      <div className="rounded-3xl border border-line bg-surface-raised px-6 py-8">
        <p className="text-sm font-medium tracking-wide text-ink-muted uppercase">
          Dispositivo no compatible
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">
          Se requiere biometría
        </h1>
        <p className="mt-4 text-base leading-relaxed text-ink-muted">
          tkn.land necesita una clave de acceso compatible con biometría para
          proteger tu billetera. Este teléfono o navegador aún no la admite.
        </p>
        {reason ? (
          <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap break-all text-left font-mono text-xs leading-5 text-ink-muted/80 select-text">
            {reason}
          </pre>
        ) : null}
      </div>
    </section>
  );
}
