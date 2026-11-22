import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { HighlightedAddress } from "@/components/DestinationAccount";
import {
  ACTIVITY_WINDOW_MS,
  approximateTimestamp,
  blockForTimestamp,
  chainHead,
  scanPenmtTransfers,
  type ChainHead,
  type PenmtTransfer,
} from "@/lib/activity/chain";
import { buildActivity } from "@/lib/activity/records";
import type { ActivityRecord, PublicMettalTransaction } from "@/lib/activity/types";
import { clientError, reportClientError } from "@/lib/client-error";
import { getSimulatedAddress } from "@/lib/evm/dev-address";
import { getPenmtDecimals } from "@/lib/evm/penmt";
import {
  getRedeemAddresses,
  issueMettalAccessToken,
  listAccountTransactions,
} from "@/lib/mettal/client";
import {
  withMettalCredentials,
  withMettalCredentialsAndSeed,
} from "@/lib/mettal/credentials";
import { withDeviceVaultSeed } from "@/lib/vault/ceremony";
import { ensurePrimaryEvmAccount, getPrimaryAddress } from "@/lib/vault/evm";
import type { DeviceVaultRecord } from "@/lib/vault/types";
import { WebAuthnCancelled } from "@/lib/webauthn/prf";

const PAGE_SIZE = 20;

type ActivityPanelProps = {
  vault: DeviceVaultRecord;
  mockBiometrics: boolean;
  onVaultUpdated?: (vault: DeviceVaultRecord) => void;
};

export function ActivityPanel({
  vault,
  mockBiometrics,
  onVaultUpdated,
}: ActivityPanelProps) {
  const [lines, setLines] = useState<ActivityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [mettalError, setMettalError] = useState<string | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [range, setRange] = useState(() => {
    const to = Date.now();
    return { from: to - ACTIVITY_WINDOW_MS, to };
  });
  const loadRef = useRef<(nextPage: number) => Promise<void>>(async () => {});

  useEffect(() => {
    let cancelled = false;
    const mettalConnected =
      vault.mettalConnected === true || Boolean(vault.mettalCredentials);
    const tokenRef = { current: null as string | null };
    const rowsRef = { current: [] as PublicMettalTransaction[] };
    const pageRef = { current: 0 };
    const pagesRef = { current: 0 };
    const redeemRef = { current: [] as string[] };
    const decimalsRef = { current: 6 };
    const headRef = { current: null as ChainHead | null };
    const windowsRef = { current: [] as ActivityWindow[] };
    const indexRef = { current: 0 };
    const walletRef = { current: null as Address | null };
    let busy = false;

    function publish() {
      if (cancelled || !walletRef.current) return;
      const window = windowsRef.current[indexRef.current];
      const records = buildActivity({
        transactions: rowsRef.current,
        transfers: mergeTransfers(
          [],
          windowsRef.current.flatMap((item) => item.transfers),
        ),
        redeemAddresses: redeemRef.current,
        wallet: walletRef.current,
        decimals: decimalsRef.current,
      });
      if (!window) {
        setLines(records);
        return;
      }
      const newest = indexRef.current === 0;
      setLines(
        records.filter((line) => {
          if (line.at < window.from) return false;
          return newest ? line.at <= window.to : line.at < window.to;
        }),
      );
    }

    async function load(nextPage: number) {
      if (busy || nextPage < 0) return;
      const cached = windowsRef.current[nextPage];
      if (cached) {
        indexRef.current = nextPage;
        setPage(nextPage);
        setRange({ from: cached.from, to: cached.to });
        publish();
        return;
      }
      if (nextPage !== windowsRef.current.length) return;
      busy = true;
      const extend = nextPage > 0;
      if (extend) setLoadingMore(true);
      else setLoading(true);
      try {
        let address =
          (getSimulatedAddress() as Address | null) ??
          walletRef.current ??
          getPrimaryAddress(vault);
        if (!walletRef.current || (!extend && mettalConnected && !tokenRef.current)) {
          try {
            if (mettalConnected && !tokenRef.current) {
              if (!address) {
                const unlocked = await withMettalCredentialsAndSeed(
                  vault,
                  async ({ credentials, mnemonic }) => {
                    const { vault: updated, account } = await ensurePrimaryEvmAccount(
                      vault,
                      mnemonic,
                    );
                    onVaultUpdated?.(updated);
                    return {
                      address: account.address as Address,
                      accessToken: await issueMettalAccessToken(credentials),
                    };
                  },
                );
                address = unlocked.address;
                tokenRef.current = unlocked.accessToken;
              } else {
                tokenRef.current = await withMettalCredentials(
                  vault,
                  (credentials) => issueMettalAccessToken(credentials),
                );
              }
            } else if (!address) {
              address = await withDeviceVaultSeed(vault, async (mnemonic) => {
                const { vault: updated, account } = await ensurePrimaryEvmAccount(
                  vault,
                  mnemonic,
                );
                onVaultUpdated?.(updated);
                return account.address as Address;
              });
            }
            if (!cancelled) setHint(null);
          } catch (err) {
            if (err instanceof WebAuthnCancelled && !address) {
              if (!cancelled) {
                setHint(
                  mockBiometrics
                    ? "Desbloqueando billetera…"
                    : "Confirma tu biometría para ver el historial.",
                );
                setLoading(false);
                setLoadingMore(false);
              }
              return;
            }
            if (!address) {
              if (!cancelled) {
                setChainError(
                  clientError(
                    "activity.chain",
                    err instanceof Error ? err : "No se pudo leer el historial.",
                  ),
                );
                setLoading(false);
                setLoadingMore(false);
              }
              return;
            }
            if (!(err instanceof WebAuthnCancelled) && !cancelled) {
              setMettalError(
                clientError(
                  "activity.mettal",
                  err instanceof Error ? err : "No se pudo leer Mettal.",
                ),
              );
            }
          }
        }

        if (!address) {
          if (!cancelled) {
            setLoading(false);
            setLoadingMore(false);
          }
          return;
        }
        walletRef.current = address;

        if (!extend) {
          try {
            decimalsRef.current = await getPenmtDecimals();
          } catch (err) {
            decimalsRef.current = 6;
            reportClientError("activity.chain", err);
          }
        }

        if (tokenRef.current) {
          const mettalPage = pageRef.current === 0 ? 1 : pageRef.current + 1;
          const hasMore =
            !extend ||
            pageRef.current === 0 ||
            pageRef.current < pagesRef.current;
          if (hasMore) {
            try {
              const page = await listAccountTransactions({
                accessToken: tokenRef.current,
                page: mettalPage,
                limit: PAGE_SIZE,
              });
              rowsRef.current = extend
                ? [...rowsRef.current, ...page.rows]
                : page.rows;
              pageRef.current = page.page;
              pagesRef.current = page.pages;
              if (!cancelled) setMettalError(null);
            } catch (err) {
              if (!cancelled) {
                setMettalError(
                  clientError(
                    "activity.mettal",
                    err instanceof Error ? err : "No se pudo leer Mettal.",
                  ),
                );
              }
            }
          }
          if (!extend) {
            try {
              const addresses = await getRedeemAddresses({
                accessToken: tokenRef.current,
              });
              redeemRef.current = addresses.map((item) => item.address);
            } catch (err) {
              reportClientError("activity.mettal", err);
            }
          }
        }

        publish();

        try {
          const head = headRef.current ?? (await chainHead());
          headRef.current = head;
          const previous = extend ? windowsRef.current[nextPage - 1] : null;
          const anchor = previous ? previous.from : head.timestampMs;
          const intended = { from: anchor - ACTIVITY_WINDOW_MS, to: anchor };
          if (!cancelled) setRange(intended);
          const lowBlock = blockForTimestamp(head, intended.from);
          const highBlock = previous ? previous.reachedBlock - 1n : head.block;
          let transfers: PenmtTransfer[] = [];
          let reachedBlock = highBlock;
          let from = intended.from;
          if (highBlock >= lowBlock) {
            const scanned = await scanPenmtTransfers({
              wallet: address,
              highBlock,
              lowBlock,
              head,
            });
            transfers = scanned.transfers;
            reachedBlock = scanned.reachedBlock;
            if (scanned.reachedBlock > lowBlock) {
              from = approximateTimestamp(head, scanned.reachedBlock);
            }
          }
          const window = { from, to: intended.to, transfers, reachedBlock };
          windowsRef.current[nextPage] = window;
          indexRef.current = nextPage;
          if (!cancelled) {
            setChainError(null);
            setPage(nextPage);
            setRange({ from: window.from, to: window.to });
          }
        } catch (err) {
          if (!cancelled) {
            setChainError(
              clientError(
                "activity.chain",
                err instanceof Error ? err : "No se pudo leer la cadena.",
              ),
            );
            const current = windowsRef.current[indexRef.current];
            if (current) setRange({ from: current.from, to: current.to });
          }
        }

        publish();
      } finally {
        busy = false;
        if (!cancelled) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    }

    loadRef.current = load;
    void load(0);
    return () => {
      cancelled = true;
    };
    // The panel mounts when Historial opens and unmounts when it closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mt-4 flex flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
        <p className="text-sm text-ink-muted">{formatSpan(range.from, range.to)}</p>
        <div className="flex shrink-0 gap-2">
          {page > 0 ? (
            <button
              type="button"
              onClick={() => void loadRef.current(page - 1)}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink transition active:bg-line"
            >
              Anterior
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void loadRef.current(page + 1)}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink transition active:bg-line"
          >
            Siguiente
          </button>
        </div>
      </div>
      {loading || loadingMore ? (
        <div
          className="flex flex-1 flex-col items-center justify-center py-16"
          role="status"
          aria-label="Consultando historial"
        >
          <div
            className="h-10 w-10 animate-spin rounded-full border-2 border-line border-t-accent"
            aria-hidden
          />
        </div>
      ) : null}
      {!loading && !loadingMore && hint ? (
        <p className="mt-3 text-sm text-ink-muted">{hint}</p>
      ) : null}
      {!loading && !loadingMore && lines.length === 0 && !hint ? (
        <p className="mt-3 text-sm text-ink-muted">Todavía no hay movimientos.</p>
      ) : null}
      {!loading && !loadingMore && lines.length > 0 ? (
        <ul className="mt-2 divide-y divide-line">
          {lines.map((line) => (
            <li key={line.id} className="py-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-ink">{line.title}</p>
                {line.amountLabel ? (
                  <p className="shrink-0 tabular-nums text-ink">{line.amountLabel}</p>
                ) : null}
              </div>
              {line.counterparty && !isZeroAddress(line.counterparty) ? (
                <p className="mt-1 break-all font-mono text-xs text-ink-muted">
                  {line.counterpartyPrefix === "de" ? "de " : "a "}
                  <HighlightedAddress address={line.counterparty} />
                </p>
              ) : null}
              {line.detail ? (
                <p className="mt-1 text-sm text-ink-muted">{line.detail}</p>
              ) : null}
              <p className="mt-1 text-xs text-ink-muted">
                {formatWhen(line.at)}
                {line.statusLabel ? ` · ${line.statusLabel}` : ""}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      {mettalError ? (
        <p className="mt-4 text-sm text-ink" role="alert">
          {mettalError}
        </p>
      ) : null}
      {chainError ? (
        <p className="mt-4 text-sm text-ink" role="alert">
          {chainError}
        </p>
      ) : null}
    </div>
  );
}

type ActivityWindow = {
  from: number;
  to: number;
  transfers: PenmtTransfer[];
  reachedBlock: bigint;
};

function isZeroAddress(address: string): boolean {
  return /^0x0+$/i.test(address);
}

function mergeTransfers(current: PenmtTransfer[], next: PenmtTransfer[]): PenmtTransfer[] {
  const seen = new Set(current.map((transfer) => `${transfer.hash}:${transfer.logIndex}`));
  const merged = [...current];
  for (const transfer of next) {
    const key = `${transfer.hash}:${transfer.logIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(transfer);
  }
  return merged;
}

function formatSpan(from: number, to: number): string {
  const start = new Date(from);
  const end = new Date(to);
  const sameYear = start.getFullYear() === end.getFullYear();
  const options: Intl.DateTimeFormatOptions = sameYear
    ? { day: "numeric", month: "short" }
    : { day: "numeric", month: "short", year: "numeric" };
  const formatted = new Intl.DateTimeFormat("es", options);
  return `Del ${formatted.format(start)} al ${formatted.format(end)}`;
}

function formatWhen(at: number): string {
  if (!at) return "";
  return new Date(at).toLocaleString("es", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
