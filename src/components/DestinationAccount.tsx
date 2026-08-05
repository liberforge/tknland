type DestinationAccountProps = {
  address: string;
  className?: string;
};

/** Label + address box; first/last 4 hex chars after 0x are bold for easy checks. */
export function DestinationAccount({
  address,
  className = "",
}: DestinationAccountProps) {
  return (
    <div className={className}>
      <p className="text-sm font-medium text-ink">Cuenta destino</p>
      <p className="mt-2 break-all rounded-2xl border border-line bg-surface-raised p-3 font-mono text-xs text-ink-muted">
        <HighlightedAddress address={address} />
      </p>
    </div>
  );
}

/** First/last 4 hex chars after 0x bold for easy visual checks. */
export function HighlightedAddress({ address }: { address: string }) {
  const trimmed = address.trim();
  const has0x = /^0x/i.test(trimmed);
  const body = has0x ? trimmed.slice(2) : trimmed;
  const prefix = has0x ? trimmed.slice(0, 2) : "";

  if (body.length <= 8) {
    return (
      <>
        {prefix}
        <span className="font-semibold text-ink">{body}</span>
      </>
    );
  }

  const head = body.slice(0, 4);
  const mid = body.slice(4, -4);
  const tail = body.slice(-4);

  return (
    <>
      {prefix}
      <span className="font-semibold text-ink">{head}</span>
      {mid}
      <span className="font-semibold text-ink">{tail}</span>
    </>
  );
}
