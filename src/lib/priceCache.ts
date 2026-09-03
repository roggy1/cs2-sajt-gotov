import { get, set } from "idb-keyval";
import type { MarketplaceId } from "@/lib/markets/types";

export interface CachedQuote {
  priceEur: number | null;
  listingCount?: number;
  listingCountIsPartial?: boolean;
  volume24h?: number;
  exactFloatMatch?: boolean;
  fetchedAt: number;
}

/**
 * Client-side price cache.
 *
 * The server routes already cache, but every lookup still costs a network
 * round trip — and the item page asks for up to 5 wears x 3 markets. This
 * layer makes repeat questions free: switching variant and back, revisiting
 * an item, or re-opening the tab all hit memory instead of the wire.
 *
 * Two tiers on purpose:
 *  - a Map for instant synchronous reads during render
 *  - IndexedDB so the cache survives a reload (localStorage is synchronous
 *    and would block the main thread at this volume)
 */
const TTL_MS = 15 * 60 * 1000;
const IDB_KEY = "cs2-price-cache-v1";

const memory = new Map<string, CachedQuote>();
let hydrated = false;
let hydrating: Promise<void> | null = null;

function cacheKey(marketHashName: string, market: MarketplaceId, extra?: string): string {
  return `${market}::${marketHashName}::${extra ?? ""}`;
}

/** Loads the persisted cache into memory once per session. */
async function hydrate(): Promise<void> {
  if (hydrated) return;
  if (hydrating) return hydrating;

  hydrating = (async () => {
    try {
      const stored = await get<Record<string, CachedQuote>>(IDB_KEY);
      if (stored) {
        const now = Date.now();
        for (const [key, value] of Object.entries(stored) as [string, CachedQuote][]) {
          if (now - value.fetchedAt < TTL_MS) memory.set(key, value);
        }
      }
    } catch {
      /* IndexedDB unavailable — memory-only cache still works */
    } finally {
      hydrated = true;
      hydrating = null;
    }
  })();

  return hydrating;
}

/** Debounced write-back so a burst of lookups doesn't hammer IndexedDB. */
let flushTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void (async () => {
      try {
        const now = Date.now();
        const snapshot: Record<string, CachedQuote> = {};
        for (const [key, value] of memory) {
          if (now - value.fetchedAt < TTL_MS) snapshot[key] = value;
        }
        await set(IDB_KEY, snapshot);
      } catch {
        /* ignore */
      }
    })();
  }, 2000);
}

export async function readQuoteCache(
  marketHashName: string,
  market: MarketplaceId,
  extra?: string,
): Promise<CachedQuote | null> {
  await hydrate();
  const entry = memory.get(cacheKey(marketHashName, market, extra));
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > TTL_MS) return null;
  return entry;
}

export function writeQuoteCache(
  marketHashName: string,
  market: MarketplaceId,
  quote: Omit<CachedQuote, "fetchedAt">,
  extra?: string,
): void {
  memory.set(cacheKey(marketHashName, market, extra), { ...quote, fetchedAt: Date.now() });
  scheduleFlush();
}

/** Used by manual refresh, which must bypass the cache. */
export function invalidateQuote(
  marketHashName: string,
  market: MarketplaceId,
  extra?: string,
): void {
  memory.delete(cacheKey(marketHashName, market, extra));
}
