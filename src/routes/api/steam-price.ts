import { createFileRoute } from "@tanstack/react-router";
import {
  getSteamQuote,
  limiterSnapshot,
  parseSteamPrice,
  type SteamQuote,
} from "@/lib/server/steamMarket.server";
import { normalizeMarketHashName } from "@/lib/steamName";

// Re-exported so existing importers (and tests) keep working — the parser
// itself now lives with the rest of the Steam logic.
export { parseSteamPrice };

/** Cap on a single batch request, so one client can't queue the world. */
const MAX_BATCH = 50;

/* -------------------------------------------------------------------------
 * Bulk price feed (the Vercel fix)
 *
 * Steam's price endpoints are rate-limited PER IP. On a laptop that budget
 * belongs to one person; on Vercel the egress IP is shared with every other
 * tenant on that edge, so the budget is gone before this app asks for
 * anything and every lookup comes back 429. No amount of client-side
 * caching fixes that, because the very first call already fails.
 *
 * The way out is to stop asking Steam per item and read a pre-built dump
 * instead: one HTTP request for the whole catalogue, cached in memory,
 * answering every lookup instantly with no per-item budget to exhaust.
 *
 * WHERE THAT DUMP COMES FROM IS A DEPLOYMENT DECISION, so the URL is an
 * environment variable rather than a hardcoded host:
 *
 *   STEAM_PRICE_FEED_URL   full URL of a JSON price dump (see shapes below)
 *   STEAM_PRICE_FEED_RATE  multiplier turning a feed value into EUR
 *                          (default 1 — set ~0.92 for a USD feed)
 *
 * NOT a valid feed, despite the name:
 * `ByMykel/CSGO-API .../api/en/skins.json`. That file is the item CATALOGUE
 * — id, name, image, rarity, float range, collections — and this app
 * already loads it for exactly that purpose (see src/lib/catalog). It
 * carries no price field of any kind, so pointing this at it would return
 * "no price" for every holding and quietly zero out the Steam column.
 *
 * Accepted shapes (all keyed by market_hash_name, values may be a plain
 * number or an object; the first recognised field wins):
 *
 *   { "AK-47 | Redline (Field-Tested)": 12.34 }
 *   { "AK-47 | Redline (Field-Tested)": { "price": 12.34, "volume": 128 } }
 *   { "AK-47 | Redline (Field-Tested)": { "steam_price": "12.34" } }
 *   { "AK-47 | Redline (Field-Tested)": { "steam": { "last_24h": 12.34 } } }
 *   [ { "market_hash_name": "...", "price": 12.34 } ]
 *
 * With no feed configured the route behaves exactly as before: straight to
 * Steam, limiter and cache included. Nothing here changes the response
 * shape, so the client is untouched.
 * ---------------------------------------------------------------------- */

const FEED_URL = process.env["STEAM_PRICE_FEED_URL"] ?? "";
const FEED_RATE = (() => {
  const raw = Number(process.env["STEAM_PRICE_FEED_RATE"] ?? "1");
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
})();

/** Dumps are rebuilt hourly at best; re-reading more often buys nothing. */
const FEED_TTL_MS = 6 * 60 * 60 * 1000;
/** A manual refresh may pull a newer dump, but not on every click. */
const FEED_FORCE_MIN_AGE_MS = 10 * 60 * 1000;
/** A feed is a few MB of JSON; a stuck download must not hold the request. */
const FEED_TIMEOUT_MS = 20_000;
/** After a failure, stop hammering a feed that is down. */
const FEED_RETRY_AFTER_MS = 5 * 60 * 1000;

interface FeedRow {
  priceEur: number;
  volume24h?: number | undefined;
}

let feed: Map<string, FeedRow> | null = null;
let feedFetchedAt = 0;
/** Shared in-flight download, so a burst of lookups triggers one fetch. */
let feedInFlight: Promise<Map<string, FeedRow>> | null = null;
let feedFailedAt = 0;

function toPrice(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n * FEED_RATE : null;
}

function toVolume(raw: unknown): number | undefined {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : Number.NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

/**
 * Pulls a usable price out of one feed entry.
 *
 * Deliberately forgiving about the shape and strict about the value: a
 * missing, zero or non-numeric price returns null rather than 0, because a
 * 0 written into a portfolio reads as "this skin is worthless" and drags
 * every total down with it.
 */
function readRow(value: unknown): FeedRow | null {
  const direct = toPrice(value);
  if (direct !== null) return { priceEur: direct };
  if (!value || typeof value !== "object") return null;

  const obj = value as Record<string, unknown>;
  const steam = obj["steam"];
  const nested =
    steam && typeof steam === "object" ? (steam as Record<string, unknown>) : undefined;

  const price =
    toPrice(obj["price"]) ??
    toPrice(obj["steam_price"]) ??
    toPrice(obj["safe_price"]) ??
    toPrice(obj["median_price"]) ??
    toPrice(obj["lowest_price"]) ??
    (nested
      ? (toPrice(nested["last_24h"]) ??
        toPrice(nested["last_7d"]) ??
        toPrice(nested["last_30d"]) ??
        toPrice(nested["price"]) ??
        toPrice(nested["median"]))
      : null);
  if (price === null) return null;

  const volume = toVolume(obj["volume"] ?? obj["volume24h"] ?? nested?.["volume"]);
  return volume === undefined ? { priceEur: price } : { priceEur: price, volume24h: volume };
}

async function downloadFeed(): Promise<Map<string, FeedRow>> {
  const res = await fetch(FEED_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`price feed responded ${res.status}`);

  const body = (await res.json()) as unknown;
  const map = new Map<string, FeedRow>();

  const add = (name: unknown, value: unknown) => {
    if (typeof name !== "string") return;
    // Normalised on the way IN, so a lookup for a name carrying a curly
    // apostrophe or a stray non-breaking space still finds its row.
    const key = normalizeMarketHashName(name);
    const row = readRow(value);
    if (key && row) map.set(key, row);
  };

  if (Array.isArray(body)) {
    for (const entry of body) {
      if (!entry || typeof entry !== "object") continue;
      const obj = entry as Record<string, unknown>;
      add(obj["market_hash_name"] ?? obj["name"], obj);
    }
  } else if (body && typeof body === "object") {
    for (const [name, value] of Object.entries(body as Record<string, unknown>)) {
      add(name, value);
    }
  }

  if (map.size === 0) {
    // Almost always the catalogue-instead-of-prices mistake described at
    // the top of this file. Say so once, loudly, instead of returning
    // "no listings" for every holding in the portfolio.
    throw new Error(
      "price feed parsed to 0 usable rows — is STEAM_PRICE_FEED_URL pointing at a price dump " +
        "rather than an item catalogue (e.g. CSGO-API skins.json, which has no prices)?",
    );
  }
  return map;
}

/** The feed, downloading it if needed. Never throws. */
async function getFeed(force: boolean): Promise<Map<string, FeedRow> | null> {
  if (!FEED_URL) return null;

  const age = Date.now() - feedFetchedAt;
  const fresh = feed && age < FEED_TTL_MS;
  const forcedRefresh = force && age > FEED_FORCE_MIN_AGE_MS;
  if (fresh && !forcedRefresh) return feed;

  // Down recently: keep serving whatever we have rather than retrying on
  // every single lookup of a portfolio refresh.
  if (!feed && Date.now() - feedFailedAt < FEED_RETRY_AFTER_MS) return null;
  if (feedInFlight) return feedInFlight.catch(() => feed);

  feedInFlight = downloadFeed()
    .then((map) => {
      feed = map;
      feedFetchedAt = Date.now();
      feedFailedAt = 0;
      console.info(`[steam-price] loaded ${map.size} prices from the bulk feed`);
      return map;
    })
    .finally(() => {
      feedInFlight = null;
    });

  try {
    return await feedInFlight;
  } catch (err) {
    feedFailedAt = Date.now();
    console.warn("[steam-price] bulk feed unavailable:", err);
    // A stale feed still beats a 429 from Steam.
    return feed;
  }
}

/** A feed hit, shaped exactly like a Steam quote. */
function quoteFromFeed(row: FeedRow, withVolume: boolean): SteamQuote {
  return {
    priceEur: row.priceEur,
    status: "ok",
    // True in the sense the client cares about: served without a live
    // marketplace call.
    cached: true,
    ...(withVolume && row.volume24h !== undefined ? { volume24h: row.volume24h } : {}),
  };
}

/**
 * One quote, feed first.
 *
 * Order matters and is deliberate:
 *
 * 1. The feed answers instantly and cannot be rate-limited, so it goes
 *    first — that is the whole point of having it.
 * 2. Steam is asked only for what the feed cannot answer: items missing
 *    from the dump, and requests that need a live listing COUNT (dumps
 *    carry prices, not order-book depth).
 * 3. If Steam then refuses (429 on a shared cloud IP is the normal case),
 *    a feed price is used rather than reporting failure.
 *
 * With no feed configured this collapses to "ask Steam", i.e. the previous
 * behaviour, unchanged.
 */
async function quoteFor(
  name: string,
  opts: { force: boolean; withCount: boolean; withVolume: boolean },
): Promise<SteamQuote> {
  const rows = await getFeed(opts.force);
  const row = rows?.get(normalizeMarketHashName(name));

  // A count can only come from Steam. Everything else the feed can answer.
  if (row && !opts.withCount) return quoteFromFeed(row, opts.withVolume);

  const quote = await getSteamQuote(name, opts);
  if (!row) return quote;

  // Steam had nothing useful to say — fall back to the dump's price, and
  // keep whatever extras Steam did manage to return.
  if (quote.priceEur === null && quote.status !== "no_listings") {
    return {
      ...quoteFromFeed(row, opts.withVolume),
      ...(quote.listingCount !== undefined ? { listingCount: quote.listingCount } : {}),
    };
  }
  return quote;
}

/**
 * Steam price + listing count.
 *
 * All the awkward parts — which endpoint reports an exact listing count,
 * what to do when it 429s, and how fast we may ask — live in
 * `steamMarket.server`. This handler only parses the request, consults the
 * optional bulk feed above, and shapes the response.
 *
 * Two shapes:
 *   GET ?name=<market_hash_name>          → one quote
 *   GET ?names=<a>|<b>|<c>                → { results: { [name]: quote } }
 *
 * The batch form exists because a portfolio refresh used to make one HTTP
 * round trip per holding, each one queued behind a fixed 2.5s gap on the
 * server. Batching lets the limiter interleave them itself.
 */
export const Route = createFileRoute("/api/steam-price")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const single = url.searchParams.get("name");
          const many = url.searchParams.get("names");

          // Manual refresh bypasses every cache tier, but never the limiter.
          const force = url.searchParams.get("force") === "1";
          // The item page wants a real listing count; bulk refreshes don't
          // need one, and skipping it saves the fallback call.
          const withCount = url.searchParams.get("withCount") === "1";
          const withVolume = url.searchParams.get("withVolume") === "1";
          const opts = { force, withCount, withVolume };

          const diagnostics = {
            "X-Steam-Limiter": JSON.stringify(limiterSnapshot()),
            "X-Steam-Feed": FEED_URL ? `${feed?.size ?? 0} rows` : "off",
          };

          if (many) {
            // The separator is a BARE pipe, and a market_hash_name contains
            // a SPACED one: "AK-47 | Redline (Field-Tested)". Splitting on
            // "|" alone shredded every name into fragments — the client
            // sends `a|b`, the server read "AK-47", "Redline (Field-Tested)",
            // "AWP"... so the whole batch prefetch missed, warmed nothing,
            // and spent Steam's per-IP budget on names that do not exist.
            // Splitting only on a pipe with no space on either side keeps
            // the names whole and needs no change on the client.
            const names = [
              ...new Set(
                many
                  .split(/(?<! )\|(?! )/)
                  .map((n) => n.trim())
                  .filter(Boolean),
              ),
            ];
            if (names.length === 0) {
              return Response.json({ error: "Empty 'names' parameter" }, { status: 400 });
            }
            if (names.length > MAX_BATCH) {
              return Response.json({ error: `Too many names (max ${MAX_BATCH})` }, { status: 400 });
            }

            // Fired together on purpose: the limiter owns pacing, so the
            // handler must not re-serialise what it already schedules.
            const settled = await Promise.all(
              names.map(async (name) => [name, await quoteFor(name, opts)] as const),
            );

            return Response.json(
              { results: Object.fromEntries(settled) as Record<string, SteamQuote> },
              { headers: diagnostics },
            );
          }

          if (!single) {
            return Response.json(
              { error: "Missing 'name' or 'names' query parameter" },
              { status: 400 },
            );
          }

          const quote = await quoteFor(single, opts);
          return Response.json(quote, { headers: diagnostics });
        } catch (err) {
          // Nothing below this line may throw out of the handler: on Vercel
          // an uncaught error is a 502, which the client cannot tell apart
          // from the whole deployment being broken. A price-less quote is
          // one empty cell; a 502 is a wall of red.
          console.error("[steam-price] handler failed:", err);
          return Response.json({ priceEur: null, status: "error", cached: false });
        }
      },
    },
  },
});
