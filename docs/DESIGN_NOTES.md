# Design notes

## Primary + Cancelar action row

When a screen or sheet ends with a primary continue/confirm action and a
cancel/close action, prefer a **single horizontal row** instead of stacking
full-width buttons:

| Slot | Width | Role |
|------|-------|------|
| Primary | **~2/3** (`flex-[2]`) | Continuar, Enviar Pedido, Confirmar, etc. |
| Secondary | **~1/3** (`flex-1`) | Cancelar |

### Markup pattern

```tsx
<div className="mt-8 flex gap-3">
  <button
    type="button"
    className="min-h-14 min-w-0 flex-[2] rounded-2xl bg-accent px-4 py-3 font-semibold text-surface transition active:scale-[0.99]"
  >
    Continuar
  </button>
  <button
    type="button"
    className="min-h-14 min-w-0 flex-1 rounded-2xl border border-line bg-surface-raised px-3 py-3 font-semibold text-ink transition active:scale-[0.99]"
  >
    Cancelar
  </button>
</div>
```

### Why

- Keeps both actions visible above the soft keyboard on phones.
- Makes the primary path obvious without burying Cancelar.
- Matches Enviar / Pedir / Agregar and handshake amount entry.

### Exceptions

- A lone primary (e.g. “Listo” after success) can stay full width.
- Destructive or rare secondaries that need equal weight can break this rule
  with an explicit reason in the PR.
