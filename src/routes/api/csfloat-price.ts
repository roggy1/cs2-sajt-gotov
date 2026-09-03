import { createFileRoute } from "@tanstack/react-router";

// Server-side proxy for CSFloat (docs.csfloat.com). Runs only on the server:
// the API key never reaches the browser, and server-to-server calls have no
// CORS restrictions.
const CSFLOAT_LISTINGS_URL = "https://csfloat.com/api/v1/listings";

// How close (in float units) a listing's float must be to the requested
// float to count as "the same condition" for price matching.
const FLOAT_TOLERANCE = 0.001;

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// How many listings we pull per lookup. Doubles as the ceiling for the
// reported listing count, so the two must never drift apart.
const LISTING_QUERY_LIMIT = 50;

// Counting means walking pages. Cap the walk so one popular item can't
// fire dozens of requests; past the cap we report nothing rather than a
// number we know is short.
const MAX_COUNT_PAGES = 8; // up to 400 listings
type CacheEntry = {
  priceCents: number | null;
  exactFloatMatch: boolean;
  /** Undefined when this entry was written by a request that didn't ask
   * for a count — such an entry must NOT satisfy one that does. */
  listingCount?: number;
  fetchedAt: number;
};
const cache = new Map<string, CacheEntry>();

interface CsfloatListing {
  id?: string;
  price: number; // in cents (USD)
  item?: {
    paint_index?: number | string;
    float_value?: number;
    phase?: string;
  };
  // Some response shapes surface these at the top level instead.
  paint_index?: number | string;
  phase?: string;
  type?: "buy_now" | "auction";
}

/** Pulls paint_index out of a listing regardless of which shape the API
 * returns it in — nested under `item` or flat at the top level. */
function listingPaintIndex(l: CsfloatListing): string | undefined {
  const raw = l.item?.paint_index ?? l.paint_index;
  return raw === undefined || raw === null ? undefined : String(raw);
}

/** Pulls a phase label out of a listing, if the API provides one. */
function listingPhase(l: CsfloatListing): string | undefined {
  return l.item?.phase ?? l.phase;
}

function cacheKey(
  marketHashName: string,
  paintIndex?: string,
  phase?: string,
  floatValue?: number,
): string {
  return `${marketHashName}::${paintIndex ?? ""}::${phase ?? ""}::${floatValue ?? ""}`;
}

/**
 * One GET call to CSFloat's listings endpoint, Buy Now only. We DO pass
 * paint_index as a query param when we have one (in case CSFloat's API
 * supports it — their Go client library exposes a matching field), but we
 * never TRUST it blindly: every candidate is verified against its own
 * `item.paint_index` in the response before its price is accepted (see
 * `verifiedListings` in the handler below). That way, even if the query
 * param turns out to be silently ignored, we can never return the wrong
 * phase's price — worst case we return null more often than ideal.
 */
/**
 * Auth headers for a CSFloat read.
 *
 * Reading listings is a PUBLIC endpoint — CSFloat documents `GET
 * /api/v1/listings` as needing no key, and only listing an item for sale
 * requires one. The proxy used to refuse to run at all without
 * `CSFLOAT_API_KEY`, which meant a deployment with no key simply had no
 * CSFloat prices. Now the key is sent when it exists (a key raises the
 * rate ceiling and is what an authenticated deployment should use) and
 * omitted when it doesn't, so the market works out of the box.
 */
function authHeaders(apiKey: string | undefined): HeadersInit {
  return apiKey ? { Authorization: apiKey } : {};
}

async function queryListings(
  apiKey: string | undefined,
  marketHashName: string,
  paintIndex?: string,
  minFloat?: number,
  maxFloat?: number,
  limit = LISTING_QUERY_LIMIT,
): Promise<CsfloatListing[]> {
  const params = new URLSearchParams({
    market_hash_name: marketHashName,
    // Only fixed-price listings — auctions' current bid is not a real price
    // (e.g. an €81 "price" that's actually just the opening bid).
    type: "buy_now",
    sort_by: "lowest_price",
    limit: String(limit),
  });
  if (paintIndex) params.set("paint_index", paintIndex);
  if (minFloat !== undefined) params.set("min_float", minFloat.toFixed(6));
  if (maxFloat !== undefined) params.set("max_float", maxFloat.toFixed(6));

  const res = await fetch(`${CSFLOAT_LISTINGS_URL}?${params.toString()}`, {
    headers: authHeaders(apiKey),
  });
  if (!res.ok) throw new Error(`CSFloat responded ${res.status}`);

  const body = (await res.json()) as CsfloatListing[] | { data?: CsfloatListing[] };
  return Array.isArray(body) ? body : (body.data ?? []);
}

/**
 * Walks pages until one comes back short, meaning every listing has been
 * seen. Returns undefined if the cap is hit first — an approximate count
 * presented as exact is worse than no count at all.
 */
async function countListings(
  apiKey: string | undefined,
  marketHashName: string,
  paintIndex?: string,
  phase?: string,
): Promise<number | undefined> {
  // De-duplicated by listing id: if the API ignores `page` and keeps
  // returning the same rows, the set simply stops growing and we bail out
  // with an accurate figure instead of multiplying one page by the page
  // count. A failed page returns what we already counted rather than
  // nothing, so a hiccup on page 3 doesn't wipe out pages 1 and 2.
  const seen = new Set<string>();

  for (let page = 0; page < MAX_COUNT_PAGES; page++) {
    const params = new URLSearchParams({
      market_hash_name: marketHashName,
      type: "buy_now",
      sort_by: "lowest_price",
      limit: String(LISTING_QUERY_LIMIT),
    });
    if (page > 0) params.set("page", String(page));
    if (paintIndex) params.set("paint_index", paintIndex);

    let listings: CsfloatListing[];
    try {
      const res = await fetch(`${CSFLOAT_LISTINGS_URL}?${params.toString()}`, {
        headers: authHeaders(apiKey),
      });
      if (!res.ok) {
        console.warn(`[csfloat] count page ${page} returned ${res.status}`);
        return seen.size > 0 ? seen.size : undefined;
      }
      const body = (await res.json()) as CsfloatListing[] | { data?: CsfloatListing[] };
      listings = Array.isArray(body) ? body : (body.data ?? []);
    } catch (err) {
      console.warn(`[csfloat] count page ${page} threw:`, err);
      return seen.size > 0 ? seen.size : undefined;
    }

    const before = seen.size;
    for (const listing of verifiedListings(listings, paintIndex, phase)) {
      if (listing.id) seen.add(listing.id);
    }

    // Nothing new, or a short page — either way we've seen everything.
    if (seen.size === before || listings.length < LISTING_QUERY_LIMIT) break;
  }

  return seen.size;
}

/**
 * Keeps only listings that genuinely match the phase we're pricing.
 *
 * A listing matches if EITHER its paint_index equals ours, OR its phase
 * label equals ours — whichever the API actually exposes. If we're pricing
 * a phase-sensitive item but a listing exposes neither field, it's
 * rejected: returning "no price" is correct here, whereas returning a
 * random phase's price is the exact bug we're fixing.
 */
function verifiedListings(
  listings: CsfloatListing[],
  paintIndex?: string,
  phase?: string,
): CsfloatListing[] {
  if (!paintIndex && !phase) return listings; // not phase-sensitive — nothing to verify

  return listings.filter((l) => {
    const lPaint = listingPaintIndex(l);
    if (paintIndex && lPaint !== undefined) return lPaint === paintIndex;

    const lPhase = listingPhase(l);
    if (phase && lPhase !== undefined) {
      return lPhase.trim().toLowerCase() === phase.trim().toLowerCase();
    }
    return false;
  });
}

export const Route = createFileRoute("/api/csfloat-price")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const marketHashName = url.searchParams.get("name");
        const floatParam = url.searchParams.get("float");
        const paintIndex = url.searchParams.get("paintIndex") ?? undefined;
        const phase = url.searchParams.get("phase") ?? undefined;

        if (!marketHashName) {
          return Response.json({ error: "Missing 'name' query parameter" }, { status: 400 });
        }

        const floatValue = floatParam !== null ? Number(floatParam) : undefined;
        const hasFloat = floatValue !== undefined && Number.isFinite(floatValue);

        const key = cacheKey(marketHashName, paintIndex, phase, hasFloat ? floatValue : undefined);
        const cached = cache.get(key);
        const wantsCount = url.searchParams.get("withCount") === "1";
        // A cached entry only counts as a hit if it carries everything this
        // request needs. Without this check, the inventory table (which
        // never asks for counts) poisons the cache and the item page shows
        // n/a for the next ten minutes.
        const cacheSatisfies = cached && !(wantsCount && cached.listingCount === undefined);

        if (cached && cacheSatisfies && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
          return Response.json({
            priceCents: cached.priceCents,
            exactFloatMatch: cached.exactFloatMatch,
            listingCount: cached.listingCount,
            cached: true,
          });
        }

        // Optional: see `authHeaders`. Reading prices works without it.
        const apiKey = process.env["CSFLOAT_API_KEY"];

        try {
          let matches: CsfloatListing[] = [];
          let exactFloatMatch = false;

          // Tier 1: exact float condition (verified phase, if we have one).
          if (hasFloat) {
            const minFloat = Math.max(0, floatValue! - FLOAT_TOLERANCE);
            const maxFloat = Math.min(1, floatValue! + FLOAT_TOLERANCE);
            const listings = await queryListings(
              apiKey,
              marketHashName,
              paintIndex,
              minFloat,
              maxFloat,
            );
            matches = verifiedListings(listings, paintIndex, phase);
            exactFloatMatch = matches.length > 0;
          }

          // Tier 2: no listings verified at that exact float — widen to any
          // float, still verifying phase before accepting a price.
          if (matches.length === 0) {
            const listings = await queryListings(apiKey, marketHashName, paintIndex);
            matches = verifiedListings(listings, paintIndex, phase);
            exactFloatMatch = false;
          }

          const priceCents = matches[0]?.price ?? null;

          // Counted only when asked for — it costs extra requests.
          const exactCount =
            url.searchParams.get("withCount") === "1"
              ? await countListings(apiKey, marketHashName, paintIndex, phase)
              : undefined;
          cache.set(key, { priceCents, exactFloatMatch, fetchedAt: Date.now() });
          return Response.json({
            priceCents,
            exactFloatMatch,
            cached: false,
            // Exact, or absent. Never a capped stand-in.
            listingCount: exactCount,
          });
        } catch {
          if (cached) {
            return Response.json({
              priceCents: cached.priceCents,
              exactFloatMatch: cached.exactFloatMatch,
              cached: true,
              stale: true,
            });
          }
          return Response.json({ error: "Failed to reach CSFloat" }, { status: 502 });
        }
      },
    },
  },
});
