import { useState } from "react";
import { HomeScreen } from "./screens/HomeScreen";
import { MenuSheet } from "./components/MenuSheet";

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between py-3">
        <p className="font-display text-2xl tracking-tight text-ink">tkn.land</p>
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setMenuOpen(true)}
          className="grid h-11 w-11 place-items-center rounded-xl border border-line bg-surface-raised text-ink"
        >
          <span className="flex w-5 flex-col gap-1.5" aria-hidden>
            <span className="h-0.5 w-full rounded bg-ink" />
            <span className="h-0.5 w-full rounded bg-ink" />
            <span className="h-0.5 w-full rounded bg-ink" />
          </span>
        </button>
      </header>

      <main className="flex flex-1 flex-col">
        <HomeScreen />
      </main>

      <MenuSheet open={menuOpen} onClose={() => setMenuOpen(false)} />
    </div>
  );
}
