type MenuSheetProps = {
  open: boolean;
  onClose: () => void;
  onTestUnlock?: () => void;
  unlockHint?: string | null;
};

export function MenuSheet({
  open,
  onClose,
  onTestUnlock,
  unlockHint,
}: MenuSheetProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label="Close menu"
        className="absolute inset-0 bg-black/55"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className="relative z-10 w-full max-w-md rounded-t-3xl border border-line bg-surface-raised px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
        <p className="text-xl font-semibold text-ink">Menu</p>
        <ul className="mt-4 divide-y divide-line">
          <MenuItem label="Backup" hint="Coming soon" />
          {onTestUnlock ? (
            <MenuItem
              label="Test unlock"
              hint={unlockHint ?? "Biometric → decrypt → wipe"}
              onClick={onTestUnlock}
            />
          ) : null}
          <MenuItem label="Advanced" hint="Coming soon" />
          <MenuItem label="About" hint="tkn.land wallet" />
        </ul>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-xl border border-line py-3 text-ink"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function MenuItem({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <p className="text-ink">{label}</p>
      <p className="text-sm text-ink-muted">{hint}</p>
    </>
  );

  return (
    <li>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="flex w-full flex-col items-start py-4 text-left"
        >
          {content}
        </button>
      ) : (
        <div className="py-4">{content}</div>
      )}
    </li>
  );
}
