import { useState } from "react";

type QuizQuestion = {
  id: string;
  prompt: string;
  options: { id: string; label: string; correct: boolean }[];
};

const QUESTIONS: QuizQuestion[] = [
  {
    id: "stranger",
    prompt: "¿Qué haces si alguien te pide tu clave privada?",
    options: [
      {
        id: "give-ok",
        label: "Se la doy, no hay problema",
        correct: false,
      },
      {
        id: "give-delete",
        label: "Se la doy, pero le pido que la borre",
        correct: false,
      },
      {
        id: "never",
        label: "Nunca hay que darle la clave privada a nadie",
        correct: true,
      },
    ],
  },
  {
    id: "support",
    prompt:
      "¿Qué pasa si te contactamos desde el soporte oficial y te pedimos la clave privada para proteger tus tokens?",
    options: [
      {
        id: "official-ok",
        label:
          "Si es soporte oficial, entonces sí puedo darles la clave privada",
        correct: false,
      },
      {
        id: "already-have",
        label: "Ellos ya tienen la clave",
        correct: false,
      },
      {
        id: "never",
        label: "Nunca hay que darle la clave privada a nadie",
        correct: true,
      },
    ],
  },
  {
    id: "ceo",
    prompt:
      "¿Qué pasa si el CEO de Blockchain te llama y te dice que necesitas darle la clave privada para salvar tus fondos?",
    options: [
      {
        id: "ceo-has-keys",
        label: "El CEO de Blockchain tiene todas las claves",
        correct: false,
      },
      {
        id: "ceo-secure",
        label:
          "Si es para asegurar mis tokens, entonces sí puedo darle la clave privada",
        correct: false,
      },
      {
        id: "never",
        label: "Nunca hay que darle la clave privada a nadie",
        correct: true,
      },
    ],
  },
];

type BackupStep =
  | { kind: "quiz"; index: number }
  | { kind: "privacy" }
  | { kind: "reveal"; words: string[] };

type BackupFlowProps = {
  mockBiometrics?: boolean;
  onRevealSeed: () => Promise<string>;
  onBackupCompleted?: () => Promise<void>;
  onBack: () => void;
};

export function BackupFlow({
  mockBiometrics = false,
  onRevealSeed,
  onBackupCompleted,
  onBack,
}: BackupFlowProps) {
  const [step, setStep] = useState<BackupStep>({ kind: "quiz", index: 0 });
  const [wrongHint, setWrongHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleAnswer(correct: boolean) {
    if (step.kind !== "quiz") return;
    if (!correct) {
      setWrongHint(
        "Respuesta incorrecta. La clave privada nunca se comparte con nadie.",
      );
      return;
    }

    setWrongHint(null);
    const next = step.index + 1;
    if (next < QUESTIONS.length) {
      setStep({ kind: "quiz", index: next });
      return;
    }
    setStep({ kind: "privacy" });
  }

  async function handleReveal() {
    setBusy(true);
    setError(null);
    try {
      const mnemonic = await onRevealSeed();
      const words = mnemonic.trim().split(/\s+/);
      setStep({ kind: "reveal", words });
      if (onBackupCompleted) {
        await onBackupCompleted();
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo revelar la clave privada.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (step.kind === "quiz") {
    const question = QUESTIONS[step.index]!;
    return (
      <>
        <p className="text-xl font-semibold text-ink">Copia de seguridad</p>
        <p className="mt-2 text-sm text-ink-muted">
          Pregunta {step.index + 1} de {QUESTIONS.length}
        </p>
        <p className="mt-6 text-base font-medium leading-6 text-ink">
          {question.prompt}
        </p>
        <div className="mt-5 space-y-3">
          {question.options.map((option, index) => (
            <button
              key={option.id}
              type="button"
              onClick={() => handleAnswer(option.correct)}
              className="flex w-full gap-3 rounded-2xl border border-line bg-surface px-4 py-4 text-left text-sm leading-5 text-ink transition active:bg-line"
            >
              <span className="shrink-0 font-semibold tabular-nums text-ink-muted">
                {index + 1}.
              </span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
        {wrongHint ? (
          <p
            className="mt-5 rounded-2xl border border-danger/50 bg-danger/10 p-4 text-sm leading-6 text-ink"
            role="alert"
          >
            {wrongHint}
          </p>
        ) : null}
        <button
          type="button"
          onClick={onBack}
          className="mt-auto w-full rounded-xl border border-line bg-surface py-3 text-ink transition active:bg-line"
        >
          Volver
        </button>
      </>
    );
  }

  if (step.kind === "privacy") {
    return (
      <>
        <p className="text-xl font-semibold text-ink">Copia de seguridad</p>
        <div className="mt-6 space-y-4 text-sm leading-6 text-ink-muted">
          <p className="text-base font-medium text-ink">
            Asegúrate de que nadie esté mirando tu pantalla.
          </p>
          <p>
            En el siguiente paso vas a ver tu clave privada. Cualquiera que la
            vea puede vaciar esta billetera.
          </p>
        </div>
        {error ? (
          <p
            className="mt-5 rounded-2xl border border-danger/50 bg-danger/10 p-4 text-sm leading-6 text-ink"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => void handleReveal()}
          disabled={busy}
          className="mt-8 min-h-14 w-full rounded-2xl bg-accent px-5 py-3 font-semibold text-surface transition active:scale-[0.99] disabled:opacity-50"
        >
          {busy
            ? mockBiometrics
              ? "Revelando (mock)…"
              : "Confirma la biometría…"
            : "Nadie está mirando, continuar"}
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="mt-3 w-full rounded-xl border border-line bg-surface py-3 text-ink transition active:bg-line disabled:opacity-50"
        >
          Volver
        </button>
      </>
    );
  }

  return (
    <>
      <p className="text-xl font-semibold text-ink">Tu clave privada</p>
      <div className="mt-4 space-y-4 pb-6 text-sm leading-6 text-ink-muted">
        <p>
          La clave privada son doce palabras que proveen total e{" "}
          <span className="font-semibold text-ink">irrestricto</span> acceso a
          todos los tokens de esta billetera. Guárdala con cuidado,
          preferentemente en papel. Intenta no guardarla en un documento
          electrónico y menos en internet. Cualquiera con acceso a esta clave
          tiene control total de esta billetera.
        </p>
      </div>
      <ol className="grid grid-cols-2 gap-2 pb-10">
        {step.words.map((word, index) => (
          <li
            key={`${index}-${word}`}
            className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-3 text-sm text-ink"
          >
            <span className="w-5 shrink-0 text-ink-muted tabular-nums">
              {index + 1}.
            </span>
            <span className="font-medium">{word}</span>
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={onBack}
        className="mt-auto w-full rounded-xl border border-line bg-surface py-3 text-ink transition active:bg-line"
      >
        Listo
      </button>
    </>
  );
}
