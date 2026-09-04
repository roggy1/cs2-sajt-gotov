import { createFileRoute } from "@tanstack/react-router";
import { normalizeMarketHashName } from "@/lib/steamName";
// The wire shape lives with the client hook, so the two can never disagree
// about what this route returns.
import type { SalesHistory, SalesWindow } from "@/lib/salesHistory";

/**
 * Skinport SALES HISTORY proxy.
 *
 * A second free, key-less Skinport endpoint alongside the catalogue feed
 * already used for prices. This one answers a different question: not
 * "what is it listed at" but "what did copies actually SELL for, and how
 * many" — min/max/avg/median plus volume over 24h, 7d, 30d and 90d.
 * Everything comes back in EUR, the app's internal currency.
 *
 * https://docs.skinport.com/sales/history — no authorization required,
 * cached 5 minutes upstream, hard-limited to 8 requests per 5 minutes, and
 * Brotli (`Accept-Encoding: br`) is mandatory.
 *
 * That budget is the whole reason this route exists in the shape it does.
 * Unlike the catalogue feed, history is PER ITEM, so it can never be used
 * to price a portfolio — 8 requests would cover eight holdings. It is an
 * Inspect-page feature only: one item, on demand, and everything else is
 * served from the cache below.
 */
const HISTORY_URL = "https://api.skinport.com/v1/sales/history";

/** Upstream caches for 5 minutes; holding ours longer costs nothing. */
const CACHE_TTL_MS = 30 * 60 * 1000;

/** Their published ceiling. */
const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 5 * 60 * 1000;

interface RawWindow {
  min?: number | null;
  max?: number | null;
  avg?: number | null;
  median?: number | null;
  volume?: number | null;
}

interface RawHistory {
  market_hash_name?: string;
  currency?: string;
  last_24_hours?: RawWindow | null;
  last_7_days?: RawWindow | null;
  last_30_days?: RawWindow | null;
  last_90_days?: RawWindow | null;
}

interface CacheEntry {
  history: SalesHistory | null;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
/** One shared promise per name, so a burst asks upstream once. */
const inFlight = new Map<string, Promise<SalesHistory | null>>();
/** Timestamps of upstream calls inside the current window. */
let recentCalls: number[] = [];

function budgetAvailable(): boolean {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  recentCalls = recentCalls.filter((t) => t > cutoff);
  return recentCalls.length < RATE_LIMIT;
}

/** Positive finite numbers only — a 0 median means "no sales", not "free". */
function toPrice(raw: number | null | undefined): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
}

function toWindow(raw: RawWindow | null | undefined): SalesWindow {
  const volume = typeof raw?.volume === "number" && raw.volume > 0 ? Math.round(raw.volume) : 0;
  return {
    min: toPrice(raw?.min),
    max: toPrice(raw?.max),
    avg: toPrice(raw?.avg),
    median: toPrice(raw?.median),
    volume,
  };
}

async function download(marketHashName: string): Promise<SalesHistory | null> {
  const params = new URLSearchParams({
    market_hash_name: marketHashName,
    app_id: "730",
    currency: "EUR",
  });

  recentCalls.push(Date.now());
  const res = await fetch(`${HISTORY_URL}?${params.toString()}`, {
    // Required by Skinport on this endpoint — without it the request is rejected.
    headers: { "Accept-Encoding": "br", Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Skinport history responded ${res.status}`);

  const body = (await res.json()) as RawHistory[] | RawHistory;
  const rows = Array.isArray(body) ? body : [body];
  // Matched on the normalized name so a curly apostrophe or a stray
  // non-breaking space still lines up with what we asked for.
  const wanted = normalizeMarketHashName(marketHashName);
  const row =
    rows.find(
      (r) => r?.market_hash_name && normalizeMarketHashName(r.market_hash_name) === wanted,
    ) ?? rows[0];
  if (!row) return null;

  return {
    marketHashName: row.market_hash_name ?? marketHashName,
    last24h: toWindow(row.last_24_hours),
    last7d: toWindow(row.last_7_days),
    last30d: toWindow(row.last_30_days),
    last90d: toWindow(row.last_90_days),
  };
}

export const Route = createFileRoute("/api/skinport-history")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const name = normalizeMarketHashName(url.searchParams.get("name") ?? "");
        if (!name) return Response.json({ error: "Missing name" }, { status: 400 });

        const cached = cache.get(name);
        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
          return Response.json({ history: cached.history, cached: true });
        }

        // Someone else is already asking upstream for this exact name —
        // ride along on their answer rather than spending a second slot.
        // Wrapped because a rejection here belongs to that other request:
        // it must not surface as a 500 on this one.
        const pending = inFlight.get(name);
        if (pending) {
          try {
            return Response.json({ history: await pending, cached: true });
          } catch {
            return Response.json({ history: null, status: "error" });
          }
        }

        // Out of budget: say so instead of spending someone else's quota.
        // A stale cached answer is better than an error, so serve one if we
        // have it — history that is half an hour old is still history.
        if (!budgetAvailable()) {
          return cached
            ? Response.json({ history: cached.history, cached: true, stale: true })
            : Response.json({ history: null, status: "rate_limited" });
        }

        const task = download(name)
          .then((history) => {
            cache.set(name, { history, fetchedAt: Date.now() });
            return history;
          })
          .finally(() => {
            inFlight.delete(name);
          });
        inFlight.set(name, task);

        try {
          return Response.json({ history: await task });
        } catch (err) {
          console.warn(`[skinport-history] lookup failed for "${name}":`, err);
          // Never a 500 for the client: an unavailable history is a missing
          // panel, not a broken page.
          return Response.json({ history: null, status: "error" });
        }
      },
    },
  },
});
