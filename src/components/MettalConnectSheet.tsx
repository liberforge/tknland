import { useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";
import {
  METTAL_PORTAL_URL,
  parseMettalQrPayload,
  type MettalCredentials,
} from "@/lib/mettal/credentials";

type MettalConnectSheetProps = {
  open: boolean;
  connected: boolean;
  secureStorageAvailable: boolean;
  mockBiometrics?: boolean;
  onClose: () => void;
  onContinue: () => void;
  onCredentials: (credentials: MettalCredentials) => Promise<void>;
};

export function MettalConnectSheet({
  open,
  connected,
  secureStorageAvailable,
  mockBiometrics = false,
  onClose,
  onContinue,
  onCredentials,
}: MettalConnectSheetProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const processingRef = useRef(false);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setScanning(false);
      setSaving(false);
      setError(null);
      processingRef.current = false;
    }
  }, [open]);

  useEffect(() => {
    const video = videoRef.current;
    if (!open || !scanning || !video) return;

    let cancelled = false;
    const scanner = new QrScanner(
      video,
      (result) => {
        if (cancelled || processingRef.current) return;
        processingRef.current = true;
        setScanning(false);
        setSaving(true);
        setError(null);

        void (async () => {
          try {
            const credentials = parseMettalQrPayload(result.data);
            await onCredentials(credentials);
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : "No se pudieron guardar las credenciales.",
            );
          } finally {
            setSaving(false);
            processingRef.current = false;
          }
        })();
      },
      {
        preferredCamera: "environment",
        maxScansPerSecond: 10,
        highlightScanRegion: true,
        highlightCodeOutline: true,
        returnDetailedScanResult: true,
      },
    );

    void scanner.start().catch((err: unknown) => {
      if (cancelled) return;
      setScanning(false);
      setError(
        err instanceof Error
          ? `No se pudo abrir la cámara: ${err.message}`
          : "No se pudo abrir la cámara.",
      );
    });

    return () => {
      cancelled = true;
      scanner.destroy();
    };
  }, [onCredentials, open, scanning]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/75 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mettal-connect-title"
    >
      <section className="flex w-full max-w-md flex-col overflow-y-auto rounded-3xl border border-line bg-surface px-5 py-5 shadow-2xl">
        <h1
          id="mettal-connect-title"
          className="text-2xl font-semibold text-ink"
        >
          Conectar Mettal
        </h1>

        {connected ? (
          <div className="mt-6 flex flex-1 flex-col text-center">
            <img
              src="/images/mettal-connected-success.webp"
              alt=""
              className="mx-auto aspect-square w-full max-w-64 rounded-3xl object-cover"
            />
            <p className="mt-6 text-2xl font-semibold text-ink">
              ¡Paso completado!
            </p>
            <p className="mt-2 text-ink-muted">
              Ya estás conectado con tu cuenta Mettal.
            </p>
            <button
              type="button"
              onClick={onContinue}
              className="mt-8 min-h-14 rounded-2xl bg-accent px-5 py-3 font-semibold text-surface transition active:scale-[0.99]"
            >
              Continuar
            </button>
          </div>
        ) : (
          <>
            <div className="mt-6 space-y-4 text-sm leading-6 text-ink-muted">
              <p>
                En una computadora, abre{" "}
                <span className="font-medium text-ink">{METTAL_PORTAL_URL}</span>{" "}
                y solicita una API key. Mettal mostrará un código QR.
              </p>
              <p>
                Cuando estés listo presiona el botón para escanear el código QR.
              </p>
            </div>

            {!secureStorageAvailable ? (
              <p className="mt-6 rounded-2xl border border-danger/50 bg-danger/10 p-4 text-sm leading-6 text-ink">
                Esta vista de diseño no tiene una bóveda. Abre{" "}
                <span className="font-medium">http://localhost:5173</span> para
                crearla y guardar las credenciales con biometría.
              </p>
            ) : null}

            {scanning ? (
              <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-black">
                <video
                  ref={videoRef}
                  className="aspect-square w-full object-cover"
                  muted
                  playsInline
                  aria-label="Vista de la cámara para escanear el QR"
                />
              </div>
            ) : null}

            {saving ? (
              <p className="mt-6 rounded-2xl border border-line bg-surface-raised p-4 text-sm text-ink">
                {mockBiometrics
                  ? "Cifrando y guardando las credenciales (mock)…"
                  : "Confirma tu biometría para cifrar y guardar las credenciales…"}
              </p>
            ) : null}

            {error ? (
              <p
                className="mt-6 rounded-2xl border border-danger/50 bg-danger/10 p-4 text-sm text-ink"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            {secureStorageAvailable && !scanning && !saving ? (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setScanning(true);
                }}
                className="mt-6 min-h-14 rounded-2xl bg-accent px-5 py-3 font-semibold text-surface transition active:scale-[0.99]"
              >
                Escanear código QR
              </button>
            ) : null}

            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="mt-3 min-h-14 rounded-2xl border border-line bg-surface-raised px-5 py-3 font-semibold text-ink transition active:scale-[0.99] disabled:opacity-50"
            >
              Cancelar
            </button>
          </>
        )}
      </section>
    </div>
  );
}
