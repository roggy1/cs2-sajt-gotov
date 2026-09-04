import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { get, set } from "idb-keyval";
import { normalizeMarketHashName } from "@/lib/steamName";
import {
  parseDump,
  parseEurRate,
  isDumpMarket,
  type DumpQuote,
  type DumpRow,
} from "@/lib/priceDumpParse";
import type { MarketplaceId } from "@/lib/markets/types";

/* =========================================================================
 * The price dump, in the browser
 *
 * WHY IT MOVED OFF THE SERVER
 *
 * Two walls, one after the other. Steam and CSFloat rate-limit per IP, and
 * a Vercel egress address is shared with every tenant on the edge — so
 * per-item lookups came back 429 or hung on `(pending)`. Moving to a bulk
 * dump fixed the rate limit but hit the second wall: a serverless function
 * is killed at 10 seconds, and a ~15MB download does not reliably finish
 * inside that. The function died mid-download, every time, and took the
 * request with it.
 *
 * The browser has neither limit. It has no execution ceiling, its own IP,
 * and — crucially — it only has to do this ONCE for the whole session
 * rather than once per serverless invocation. So the dump is downloaded
 * here, held in memory, and persisted so a reload does not pay for it
 * again.
 *
 * WHAT THIS MEANS FOR THE TABLE
 *
 * Every price the inventory shows is a Map read from this store. No row
 * makes a network request, ever — not on render, not on a market switch,
 * not when a skin is added. Switching price source is a re-read of an
 * object already in memory.
 *
 * STORAGE: IndexedDB, not localStorage. localStorage caps at ~5MB and is
 * synchronous; a 15MB dump would throw QuotaExceededError on write and
 * block the main thread if it didn't. `idb-keyval` is already how the item
 * catalogue is cached, so this follows the same path.
 * ====================================================================== */

const DUMP_URL = "https://prices.csgotrader.app/latest/prices.json";
const RATES_URL = "https://prices.csgotrader.app/latest/exchange_rates.json";

/**
 * Read-only CORS proxies, tried in order when the direct fetch is refused.
 *
 * The dump host may or may not send `Access-Control-Allow-Origin`, and that
 * can change without notice — so a refusal is treated as a routing problem
 * rather than an outage. These proxies only ever GET a public JSON file: no
 * credentials pass through them, and nothing about the user is in the URL.
 */
const PROXIES = [
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
];

/** How long a downloaded dump is used before refreshing. */
const TTL_MS = 30 * 60 * 1000;
/** Past this, a persisted dump is too old to show at all. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Used when the FX file cannot be read. Approximate by nature. */
const FALLBACK_USD_TO_EUR = 0.92;

const IDB_KEY = "cs2-price-dump-v1";

export type DumpStatus = "loading" | "ready" | "error";

interface PersistedDump {
  /** Stored as a plain object: structured clone handles Maps, but a plain
   *  object survives a schema change in either direction. */
  rows: Record<string, DumpRow>;
  fetchedAt: number;
  rate: number;
}

interface PriceDumpValue {
  status: DumpStatus;
  /** When the dump in memory was downloaded. */
  fetchedAt: number | null;
  /** How many items it covers — the honest measure of whether it loaded. */
  size: number;
  /** One market's price for one item. `null` means "not in the dump". */
  quote: (marketHashName: string, market: MarketplaceId) => DumpQuote | null;
  /** Every market we have for one item. */
  row: (marketHashName: string) => DumpRow | null;
  /** Re-download, ignoring the TTL. */
  refresh: () => Promise<void>;
}

const PriceDumpContext = createContext<PriceDumpValue | null>(null);

/** Fetch a JSON URL directly, falling back to a CORS proxy if refused. */
async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const attempts = [url, ...PROXIES.map((wrap) => wrap(url))];
  let lastError: unknown;

  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt, { signal, headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`${attempt} responded ${res.status}`);
      return await res.json();
    } catch (err) {
      // An abort is the caller leaving, not a failed route — stop rather
      // than working through the proxy list for a page that is gone.
      if (signal.aborted) throw err;
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function download(signal: AbortSignal): Promise<PersistedDump> {
  // The rate first and separately: it is a tiny file, and a dump parsed
  // with the wrong multiplier is worse than no dump at all.
  let rate = FALLBACK_USD_TO_EUR;
  try {
    const parsed = parseEurRate(await fetchJson(RATES_URL, signal));
    if (parsed !== null) rate = parsed;
    else throw new Error("no EUR rate in the response");
  } catch (err) {
    if (signal.aborted) throw err;
    console.warn(
      `[price-dump] could not read an EUR rate (${String(err)}); using ${FALLBACK_USD_TO_EUR}.`,
    );
  }

  const rows = parseDump(await fetchJson(DUMP_URL, signal), rate);
  return { rows: Object.fromEntries(rows), fetchedAt: Date.now(), rate };
}

/**
 * Downloads the dump once per session (per TTL) and hands it to the tree.
 *
 * Order of events on a cold load is deliberate: the persisted copy is read
 * from IndexedDB FIRST, so a returning user has prices on screen before any
 * network call is made, and the refresh then happens behind those prices.
 */
export function PriceDumpProvider({ children }: { children: ReactNode }) {
  const [dump, setDump] = useState<PersistedDump | null>(null);
  const [status, setStatus] = useState<DumpStatus>("loading");
  /** Guards against two downloads racing (StrictMode mounts twice in dev). */
  const inFlight = useRef<Promise<void> | null>(null);

  const load = useCallback(async (force: boolean, signal: AbortSignal) => {
    if (inFlight.current) return inFlight.current;

    const run = (async () => {
      try {
        const next = await download(signal);
        if (signal.aborted) return;
        setDump(next);
        setStatus("ready");
        try {
          await set(IDB_KEY, next);
        } catch {
          // A dump that cannot be persisted still works for this session.
          // Not worth failing over — the next reload just re-downloads.
        }
        console.info(`[price-dump] ${Object.keys(next.rows).length} items (rate ${next.rate})`);
      } catch (err) {
        if (signal.aborted) return;
        console.warn("[price-dump] download failed:", err);
        // Only an error if there is nothing to show. A failed REFRESH over
        // a dump we already have is invisible to the user, as it should be.
        setStatus((prev) => (prev === "ready" && !force ? prev : "error"));
      } finally {
        inFlight.current = null;
      }
    })();

    inFlight.current = run;
    return run;
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      let cached: PersistedDump | undefined;
      try {
        cached = await get<PersistedDump>(IDB_KEY);
      } catch {
        /* IndexedDB unavailable — memory-only, download every session */
      }
      if (controller.signal.aborted) return;

      const age = cached ? Date.now() - cached.fetchedAt : Number.POSITIVE_INFINITY;
      if (cached && age < MAX_AGE_MS) {
        setDump(cached);
        setStatus("ready");
      }
      if (age > TTL_MS) void load(false, controller.signal);
    })();

    return () => controller.abort();
  }, [load]);

  const refresh = useCallback(async () => {
    const controller = new AbortController();
    await load(true, controller.signal);
  }, [load]);

  const value = useMemo<PriceDumpValue>(() => {
    const rows = dump?.rows;

    const row = (marketHashName: string): DumpRow | null => {
      if (!rows) return null;
      return rows[normalizeMarketHashName(marketHashName)] ?? null;
    };

    return {
      status,
      fetchedAt: dump?.fetchedAt ?? null,
      size: rows ? Object.keys(rows).length : 0,
      row,
      quote: (marketHashName, market) => {
        if (!isDumpMarket(market)) return null;
        const quote = row(marketHashName)?.[market];
        // The last gate on the "0.00" bug: a price is a positive number or
        // it is not a price, whatever a dump decides to publish.
        return quote && Number.isFinite(quote.priceEur) && quote.priceEur > 0 ? quote : null;
      },
      refresh,
    };
  }, [dump, status, refresh]);

  return <PriceDumpContext.Provider value={value}>{children}</PriceDumpContext.Provider>;
}

/**
 * The dump.
 *
 * Safe to call outside the provider (during SSR, or in a test that renders
 * one component): it degrades to an empty, permanently-"loading" store
 * rather than throwing, so a missing provider is a screen with no prices
 * instead of a blank page.
 */
export function usePriceDump(): PriceDumpValue {
  const ctx = useContext(PriceDumpContext);
  return (
    ctx ?? {
      status: "loading",
      fetchedAt: null,
      size: 0,
      quote: () => null,
      row: () => null,
      refresh: async () => undefined,
    }
  );
}
