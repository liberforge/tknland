import { useEffect, useState } from "react";
import { isAddress, type Address } from "viem";

const STORAGE_KEY = "tkn.land.devSimulatedAddress";

type Listener = () => void;
const listeners = new Set<Listener>();

function readStored(): Address | null {
  if (!import.meta.env.DEV) return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)?.trim() ?? "";
    if (!isAddress(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

/** DEV-only address used for balance and send previews. Never signs. */
export function getSimulatedAddress(): Address | null {
  return readStored();
}

export function setSimulatedAddress(next: string | null): void {
  if (!import.meta.env.DEV) return;
  const trimmed = next?.trim() ?? "";
  if (!trimmed) {
    sessionStorage.removeItem(STORAGE_KEY);
  } else if (!isAddress(trimmed)) {
    throw new Error("Dirección inválida.");
  } else {
    sessionStorage.setItem(STORAGE_KEY, trimmed);
  }
  for (const listener of listeners) listener();
}

export function subscribeSimulatedAddress(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSimulatedAddress(): Address | null {
  const [address, setAddress] = useState<Address | null>(() => readStored());
  useEffect(() => subscribeSimulatedAddress(() => setAddress(readStored())), []);
  return address;
}
