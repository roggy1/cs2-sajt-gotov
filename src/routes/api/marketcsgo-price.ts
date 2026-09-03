import { createFileRoute } from "@tanstack/react-router";
import { normalizeMarketHashName } from "@/lib/steamName";

/**
 * Market.CSGO price proxy.
 *
 * Their `prices/EUR.json` endpoint publishes the WHOLE catalogue in one
 * response, keyed by `market_hash_name`, already in EUR — the app's
 * internal base currency, so nothing is converted here. That makes this
 * the same shape as the Skinport integration: download occasionally, then
 * answer every per-item lookup from memory, so a 200-item portfolio still
 * costs one upstream request.
 *
 * Verified live before this was written: the endpoint answers without any
 * API key, and each row carries `market_hash_name`, `price` and `volume`.
 */
const PRICES_URL = "https://market.csgo.com/api/v2/prices/EUR.json";

/** Their list is regenerated on their side periodically; hourly is ample. */
const CACHE_TTL_MS = 60 * 60 * 1000;

interface RawRow {
  market_hash_name?: string;
  /** Lowest asking price, as a decimal string in EUR. */
  price?: string;
  /** Units SOLD in 24h — a liquidity signal, NOT a count of live offers. */
  volume?: string;
}

interface Row {
  priceEur: number | null;
  volume24h: number | undefined;
}

type Catalogue = Map<string, Row>;

let catalogue: Catalogue | null = null;
let fetchedAt = 0;
/** Shared in-flight promise so a burst of lookups triggers ONE download. */
let inFlight: Promise<Catalogue> | null = null;

function toNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function downloadCatalogue(): Promise<Catalogue> {
  const res = await fetch(PRICES_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Market.CSGO responded ${res.status}`);

  const body = (await res.json()) as { success?: boolean; items?: RawRow[] };
  if (body.success === false || !Array.isArray(body.items)) {
    throw new Error("Market.CSGO returned no items");
  }

  const map: Catalogue = new Map();
  for (const item of body.items) {
    if (!item?.market_hash_name) continue;
    // Normalized on the way IN, so a lookup for a name carrying a curly
    // apostrophe or a stray non-breaking space still finds its row.
    const key = normalizeMarketHashName(item.market_hash_name);
    if (!key) continue;

    const priceEur = toNumber(item.price);
    const volume = Number(item.volume ?? "");
    const row: Row = {
      priceEur,
      volume24h: Number.isFinite(volume) && volume > 0 ? volume : undefined,
    };

    // The feed can carry the same name more than once; keep the cheaper
    // asking price, which is what a buyer would actually pay.
    const existing = map.get(key);
    if (!existing || (priceEur !== null && (existing.priceEur ?? Infinity) > priceEur)) {
      map.set(key, row);
    }
  }
  return map;
}

async function getCatalogue(force: boolean): Promise<Catalogue> {
  const fresh = catalogue && Date.now() - fetchedAt < CACHE_TTL_MS;
  if (fresh && !force) return catalogue!;
  if (inFlight) return inFlight;

  inFlight = downloadCatalogue()
    .then((map) => {
      catalogue = map;
      fetchedAt = Date.now();
      return map;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

export const Route = createFileRoute("/api/marketcsgo-price")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const rawName = url.searchParams.get("name");
        const force = url.searchParams.get("force") === "1";

        if (!rawName) {
          return Response.json({ error: "Missing 'name' query parameter" }, { status: 400 });
        }
        const marketHashName = normalizeMarketHashName(rawName);

        const hadCatalogue = catalogue !== null;

        try {
          const map = await getCatalogue(force);
          const row = map.get(marketHashName);
          if (!row) {
            return Response.json({ priceEur: null, status: "no_listings", cached: false });
          }

          return Response.json({
            priceEur: row.priceEur,
            // Deliberately NOT reported as `listingCount`. This feed gives
            // 24h sales volume, and rendering that in a "listings" column
            // would state a number the market never claimed.
            volume24h: row.volume24h,
            status: row.priceEur === null ? "no_listings" : "ok",
            cached: Date.now() - fetchedAt > 1000,
          });
        } catch {
          // Serve the last catalogue we managed to download rather than
          // wiping prices; only report a hard error if we never had one.
          if (hadCatalogue && catalogue) {
            const row = catalogue.get(marketHashName);
            return Response.json({
              priceEur: row?.priceEur ?? null,
              volume24h: row?.volume24h,
              status: "ok",
              cached: true,
              stale: true,
            });
          }
          return Response.json({ priceEur: null, status: "error", cached: false });
        }
      },
    },
  },
});
