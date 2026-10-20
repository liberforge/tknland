import { useEffect, useRef, useState } from "react";

type QuizQuestion = {
  id: string;
  prompt: string;
  options: { id: string; label: string; correct: boolean }[];
};

const QUESTIONS: QuizQuestion[] = [
  {
    id: "stranger",
    prompt: "¿Qué haces si alguien te pide tu frase secreta?",
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
        label: "Nunca hay que darle la frase secreta a nadie",
        correct: true,
      },
    ],
  },
  {
    id: "support",
    prompt:
      "¿Qué pasa si te contactamos desde el soporte oficial y te pedimos la frase secreta para proteger tus tokens?",
    options: [
      {
        id: "official-ok",
        label:
          "Si es soporte oficial, entonces sí puedo darles la frase secreta",
        correct: false,
      },
      {
        id: "already-have",
        label: "Ellos ya tienen todas las clave",
        correct: false,
      },
      {
        id: "never",
        label: "Nunca hay que darle la frase secreta a nadie",
        correct: true,
      },
    ],
  },
  {
    id: "ceo",
    prompt:
      "¿Qué pasa si el CEO de Blockchain te llama y te dice que necesitas darle la frase secreta para salvar tus fondos?",
    options: [
      {
        id: "ceo-has-keys",
        label: "El CEO de Blockchain tiene todas las claves",
        correct: false,
      },
      {
        id: "ceo-secure",
        label:
          "Si me dicen que es para asegurar mis tokens, entonces sí les doy la frase secreta",
        correct: false,
      },
      {
        id: "never",
        label: "Nunca hay que darle la frase secreta a nadie",
        correct: true,
      },
    ],
  },
];

function shuffleOptions<T>(options: T[]): T[] {
  const copy = [...options];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const current = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = current;
  }
  return copy;
}

function OptionMark({
  correct,
  delayMs,
}: {
  correct: boolean;
  delayMs: number;
}) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden
      className={`mt-0.5 size-[1.125rem] shrink-0 ${
        correct ? "quiz-check text-[#3dbe7a]" : "quiz-mark text-danger"
      }`}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      {correct ? (
        <path
          fill="currentColor"
          d="M10 1.25a8.75 8.75 0 1 0 0 17.5 8.75 8.75 0 0 0 0-17.5Zm4.03 6.22-4.4 5.28a.9.9 0 0 1-1.34.06L5.9 10.3a.9.9 0 1 1 1.28-1.26l1.72 1.74 3.76-4.5a.9.9 0 0 1 1.37 1.18Z"
        />
      ) : (
        <path
          fill="currentColor"
          d="M10 1.25a8.75 8.75 0 1 0 0 17.5 8.75 8.75 0 0 0 0-17.5Zm3.18 10.68a.9.9 0 0 1-1.27 1.27L10 11.27l-1.91 1.93a.9.9 0 0 1-1.27-1.27L8.73 10 6.82 8.07a.9.9 0 0 1 1.27-1.27L10 8.73l1.91-1.93a.9.9 0 1 1 1.27 1.27L11.27 10l1.91 1.93Z"
        />
      )}
    </svg>
  );
}

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
  const [optionOrders] = useState(() =>
    QUESTIONS.map((question) => shuffleOptions(question.options)),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [wrongHint, setWrongHint] = useState<string | null>(null);
  const [passing, setPassing] = useState(false);
  const [passLayout, setPassLayout] = useState<{
    height: number;
    tops: number[];
    correctHeight: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const passingFrom = useRef<number | null>(null);

  function resetQuizAnswer() {
    setSelectedId(null);
    setRevealed(false);
    setWrongHint(null);
  }

  function goToNextQuestion() {
    const from = passingFrom.current;
    if (from == null) return;
    passingFrom.current = null;
    setPassing(false);
    setPassLayout(null);
    setSelectedId(null);
    setRevealed(false);
    setWrongHint(null);
    const next = from + 1;
    if (next < QUESTIONS.length) {
      setStep({ kind: "quiz", index: next });
      return;
    }
    setStep({ kind: "privacy" });
  }

  function handleContinue() {
    if (step.kind !== "quiz" || !selectedId || revealed || passing) return;
    const question = QUESTIONS[step.index];
    const selected = question?.options.find((option) => option.id === selectedId);
    if (!selected) return;
    if (!selected.correct) {
      setRevealed(true);
      setWrongHint(
        "Respuesta incorrecta. La frase secreta nunca se comparte con nadie.",
      );
      return;
    }

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const root = optionsRef.current;
    const rootBox = root?.getBoundingClientRect();
    if (reduceMotion || !root || !rootBox) {
      passingFrom.current = step.index;
      goToNextQuestion();
      return;
    }

    const labels = Array.from(root.querySelectorAll<HTMLElement>(":scope > label"));
    setPassLayout({
      height: rootBox.height,
      tops: labels.map(
        (label) => label.getBoundingClientRect().top - rootBox.top,
      ),
      correctHeight:
        labels
          .find((label) => label.dataset.correct === "true")
          ?.getBoundingClientRect().height ?? 0,
    });
    passingFrom.current = step.index;
    setPassing(true);
  }

  useEffect(() => {
    if (!passing || step.kind !== "quiz") return;
    const timer = window.setTimeout(goToNextQuestion, 2050);
    return () => window.clearTimeout(timer);
    // goToNextQuestion closes over the current question index.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passing, step]);

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
          : "No se pudo revelar la frase secreta.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (step.kind === "quiz") {
    const question = QUESTIONS[step.index]!;
    const options = optionOrders[step.index] ?? question.options;
    return (
      <>
        <p className="text-xl font-semibold text-ink">Copia de seguridad</p>
        <div
          className="mt-4 flex gap-1.5"
          aria-hidden
        >
          {QUESTIONS.map((item, index) => (
            <span
              key={item.id}
              className={`h-1 flex-1 rounded-full ${
                index <= step.index ? "bg-accent" : "bg-line"
              }`}
            />
          ))}
        </div>
        <p className="mt-3 text-sm text-ink-muted">
          Pregunta {step.index + 1} de {QUESTIONS.length}
        </p>
        <fieldset className="mt-5 border-0 p-0">
          <legend className="mb-5 text-lg font-medium leading-7 text-ink">
            {question.prompt}
          </legend>
          <div
            ref={optionsRef}
            className="relative space-y-3"
            style={
              passing && passLayout ? { height: passLayout.height } : undefined
            }
          >
            {options.map((option, index) => {
              const selected = selectedId === option.id;
              const markDelay = index * 90 + (option.correct ? 160 : 0);
              const frameTop = passLayout?.tops[index] ?? 0;
              const centerTop = passLayout
                ? (passLayout.height - passLayout.correctHeight) / 2
                : 0;
              if (passing) {
                return (
                  <label
                    key={option.id}
                    className={`absolute right-0 left-0 flex items-start gap-3 rounded-2xl border px-4 py-4 text-left text-sm leading-5 text-ink ${
                      option.correct
                        ? "quiz-option-center border-[#3dbe7a] bg-[#3dbe7a]/10"
                        : "quiz-option-out pointer-events-none border-line bg-surface"
                    }`}
                    style={
                      option.correct
                        ? {
                            top: frameTop,
                            ["--quiz-shift" as string]: `${centerTop - frameTop}px`,
                          }
                        : { top: frameTop, animationDelay: `${index * 50}ms` }
                    }
                  >
                    {option.correct ? (
                      <OptionMark correct delayMs={160} />
                    ) : (
                      <span className="mt-0.5 size-[1.125rem] shrink-0 rounded-full border border-line" />
                    )}
                    <span>{option.label}</span>
                  </label>
                );
              }
              return (
                <label
                  key={option.id}
                  data-correct={option.correct ? "true" : undefined}
                  onClick={() => {
                    if (revealed) return;
                    setSelectedId(option.id);
                  }}
                  className={`flex items-start gap-3 rounded-2xl border px-4 py-4 text-left text-sm leading-5 transition-colors ${
                    revealed ? "cursor-default" : "cursor-pointer"
                  } ${
                    revealed && option.correct
                      ? "quiz-correct border-[#3dbe7a] bg-[#3dbe7a]/10 text-ink"
                      : revealed
                        ? `border-danger/70 bg-danger/10 text-ink ${
                            selected ? "quiz-wrong" : ""
                          }`
                        : selected
                          ? "border-accent bg-accent/10 text-ink"
                          : "border-line bg-surface text-ink"
                  }`}
                  style={
                    revealed
                      ? { animationDelay: `${index * 90}ms` }
                      : undefined
                  }
                >
                  {revealed ? (
                    <OptionMark correct={option.correct} delayMs={markDelay} />
                  ) : (
                    <input
                      type="radio"
                      name={`backup-quiz-${question.id}`}
                      value={option.id}
                      checked={selected}
                      onChange={() => setSelectedId(option.id)}
                      className="mt-0.5 size-[1.125rem] shrink-0 accent-accent"
                    />
                  )}
                  <span>{option.label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        {wrongHint ? (
          <p
            className="animate-rise mt-4 rounded-2xl border border-danger/50 bg-danger/10 p-4 text-sm leading-6 text-ink"
            style={{ animationDelay: "0.38s" }}
            role="alert"
          >
            {wrongHint}
          </p>
        ) : null}
        {revealed ? (
          <button
            type="button"
            onClick={resetQuizAnswer}
            className="animate-rise mt-5 min-h-14 w-full rounded-2xl bg-accent px-5 py-3 font-semibold text-surface transition active:scale-[0.99]"
            style={{ animationDelay: "0.48s" }}
          >
            Prueba de nuevo
          </button>
        ) : (
          <button
            type="button"
            onClick={handleContinue}
            disabled={selectedId == null}
            className={`mt-5 min-h-14 w-full rounded-2xl bg-accent px-5 py-3 font-semibold text-surface transition active:scale-[0.99] disabled:opacity-40 ${
              passing ? "pointer-events-none opacity-0" : ""
            }`}
          >
            Continuar
          </button>
        )}
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
            En el siguiente paso vas a ver tu frase secreta. Cualquiera que la
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
      <p className="text-xl font-semibold text-ink">Tu frase secreta</p>
      <div className="mt-4 space-y-4 pb-6 text-sm leading-6 text-ink-muted">
        <p>
          La frase secreta son doce palabras que proveen acceso{" "}
          <span className="font-semibold text-ink">total e irrestricto</span>{" "}
          a todos los tokens de esta billetera. Guárdala con cuidado,
          preferentemente haz dos copias en papel y guárdalas en lugares diferentes.
          Intenta no guardarla en un documento
          electrónico y menos en internet. Cualquiera con acceso a esta frase secreta
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
