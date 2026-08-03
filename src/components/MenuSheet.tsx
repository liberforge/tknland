import { useEffect, useState } from "react";
import { BackupFlow } from "./BackupFlow";

type MenuSheetProps = {
  open: boolean;
  onClose: () => void;
  onTestUnlock?: () => void;
  onDisconnectMettal?: () => void;
  unlockHint?: string | null;
  backupCompleted?: boolean;
  mockBiometrics?: boolean;
  onRevealSeed: () => Promise<string>;
  onBackupCompleted?: () => Promise<void>;
};

type MenuView = "menu" | "about" | "backup";

export function MenuSheet({
  open,
  onClose,
  onTestUnlock,
  onDisconnectMettal,
  unlockHint,
  backupCompleted = false,
  mockBiometrics = false,
  onRevealSeed,
  onBackupCompleted,
}: MenuSheetProps) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const [view, setView] = useState<MenuView>("menu");

  useEffect(() => {
    let frame = 0;
    let secondFrame = 0;
    let timer = 0;

    if (open) {
      setMounted(true);
      setView("menu");
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

  const title =
    view === "about"
      ? "Acerca de"
      : view === "backup"
        ? "Copia de seguridad"
        : "Menú";

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
        aria-label={title}
        className={`relative z-10 flex min-h-dvh w-full max-w-md flex-col overflow-y-auto border border-line bg-surface-raised px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] transition-transform duration-[250ms] ease-out motion-reduce:transform-none motion-reduce:transition-none ${
          visible ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
        {view === "menu" ? (
          <>
            <p className="text-xl font-semibold text-ink">Menú</p>
            <ul className="mt-4 divide-y divide-line">
              <MenuItem
                label="Copia de seguridad"
                hint={
                  backupCompleted
                    ? "Ver frase secreta"
                    : "Respalda tu frase secreta"
                }
                onClick={() => setView("backup")}
              />
              {onTestUnlock ? (
                <MenuItem
                  label="DEV: Probar desbloqueo"
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
              <MenuItem
                label="Acerca de"
                hint="Billetera tkn.land"
                onClick={() => setView("about")}
              />
            </ul>
            <button
              type="button"
              onClick={onClose}
              className="mt-auto w-full rounded-xl border border-line bg-surface py-3 text-ink transition active:bg-line"
            >
              Cerrar
            </button>
          </>
        ) : null}
        {view === "about" ? (
          <>
            <p className="text-xl font-semibold text-ink">Acerca de</p>
            <div className="mt-4 space-y-4 pb-10 text-sm leading-6 text-ink-muted">
              <p>
                tkn.land es una billetera de{" "}
                <span className="font-semibold text-ink">autocustodia</span>
                {" "}(self-custody).
              </p>
              <p>
                Al usar este software, aceptas su uso{" "}
                <span className="font-semibold text-ink">tal cual</span>
                {" "}(as-is) y eximes a los desarrolladores de cualquier
                reclamo por daños, pérdidas o perjuicios derivados de su uso.
              </p>
              <p>
                Tu clave privada se guarda en tu teléfono, protegida por la
                seguridad biométrica del dispositivo. Esto es autocustodia
                total: tkn.land no almacena ni registro de actividad, ni
                contraseñas, ni claves. Todas las operaciones se ejecutan bajo
                tu control.
              </p>
              <p>
                Si pierdes, reinicias o borras el teléfono, o si se invalidan
                las claves biométricas,{" "}
                <span className="font-semibold text-ink">
                  cualquier token guardado en la app es irrecuperable
                </span>
                . Es tu responsabilidad respaldar tus claves en un lugar
                seguro.
              </p>
              <p>
                Ten cuidado: cualquiera que tenga tu clave privada puede
                acceder a los tokens.
              </p>
              <p className="pt-2 font-mono text-xs text-ink-muted/80">
                Build {__APP_COMMIT__}
                <span className="mx-1.5 text-line">·</span>
                {formatBuiltAt(__APP_BUILT_AT__)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setView("menu")}
              className="mt-auto w-full rounded-xl border border-line bg-surface py-3 text-ink transition active:bg-line"
            >
              Volver
            </button>
          </>
        ) : null}
        {view === "backup" ? (
          <BackupFlow
            mockBiometrics={mockBiometrics}
            onRevealSeed={onRevealSeed}
            onBackupCompleted={onBackupCompleted}
            onBack={() => setView("menu")}
          />
        ) : null}
      </div>
    </div>
  );
}

function formatBuiltAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
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
