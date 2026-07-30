import { useEffect, useState } from "react";

type MenuSheetProps = {
  open: boolean;
  onClose: () => void;
  onTestUnlock?: () => void;
  onDisconnectMettal?: () => void;
  unlockHint?: string | null;
};

export function MenuSheet({
  open,
  onClose,
  onTestUnlock,
  onDisconnectMettal,
  unlockHint,
}: MenuSheetProps) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let frame = 0;
    let secondFrame = 0;
    let timer = 0;

    if (open) {
      setMounted(true);
      // Wait until the hidden panel has been painted before transitioning it in.
      frame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      timer = window.setTimeout(() => setMounted(false), 250);
    }

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(secondFrame);
      clearTimeout(timer);
    };
  }, [open]);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-center">
      <button
        type="button"
        aria-label="Cerrar menú"
        className={`absolute inset-0 bg-black/55 transition-opacity duration-[250ms] motion-reduce:transition-none ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menú"
        className={`relative z-10 flex min-h-dvh w-full max-w-md flex-col overflow-y-auto border border-line bg-surface-raised px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] transition-transform duration-[250ms] ease-out motion-reduce:transform-none motion-reduce:transition-none ${
          visible ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
        <p className="text-xl font-semibold text-ink">Menú</p>
        <ul className="mt-4 divide-y divide-line">
          <MenuItem label="Copia de seguridad" hint="Próximamente" />
          {onTestUnlock ? (
            <MenuItem
              label="Probar desbloqueo"
              hint={unlockHint ?? "Biometría → descifrar → borrar"}
              onClick={onTestUnlock}
            />
          ) : null}
          {onDisconnectMettal ? (
            <MenuItem
              label="DEV: Disconnect mettal"
              hint="Borra la conexión para probarla otra vez"
              onClick={onDisconnectMettal}
            />
          ) : null}
          <MenuItem label="Avanzado" hint="Próximamente" />
          <MenuItem label="Acerca de" hint="Billetera tkn.land" />
        </ul>
        <button
          type="button"
          onClick={onClose}
          className="mt-auto w-full rounded-xl border border-line bg-surface py-3 text-ink transition active:bg-line"
        >
          Cerrar
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
