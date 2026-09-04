import { createFileRoute } from "@tanstack/react-router";

// Server-side proxy for CSFloat (docs.csfloat.com). Runs only on the server:
// the API key never reaches the browser, and server-to-server calls have no
// CORS restrictions.
const CSFLOAT_LISTINGS_URL = "https://csfloat.com/api/v1/listings";

// How close (in float units) a listing's float must be to the requested
// float to count as "the same condition" for price matching.
const FLOAT_TOLERANCE = 0.001;

/* -------------------------------------------------------------------------
 * Cache + throttle
 *
 * CSFloat answers a shared cloud IP with 429 long before it answers a
 * laptop, because the budget belongs to the ADDRESS and on Vercel that
 * address is shared with every other tenant on the edge. A portfolio
 * refresh firing one request per holding as fast as the event loop allows
 * is exactly the traffic shape that trips it.
 *
 * Three things keep this route inside the budget, and all three matter:
 *
 *   1. A price is remembered for FRESH_TTL and served from memory — a
 *      second lookup of the same skin costs nothing at all.
 *   2. Past that, the remembered price is still served immediately while a
 *      refresh runs behind it (stale-while-revalidate), so a slow or
 *      throttled upstream is never something the user waits for.
 *   3. Upstream calls are serialised with a gap between them, so twenty
 *      holdings become twenty paced requests rather than twenty
 *      simultaneous ones.
 *
 * And when 429 arrives anyway, the last known price is what comes back.
 * ---------------------------------------------------------------------- */

/** A price this new is served without asking CSFloat at all. */
const FRESH_TTL_MS = 12 * 60 * 1000;
/** Older than FRESH but still worth showing while a refresh runs behind. */
const STALE_TTL_MS = 6 * 60 * 60 * 1000;
/** After a failure, don't retry this item for a while. */
const ERROR_BACKOFF_MS = 60 * 1000;
/** Pause between consecutive upstream calls (the "batching" delay). */
const REQUEST_GAP_MS = Number(process.env["CSFLOAT_GAP_MS"] ?? "300");
/** One at a time: parallelism is what makes a gap meaningless. */
const MAX_CONCURRENT = 1;
/** How long to stand down after CSFloat says 429, doubling each time. */
const COOLDOWN_MS = 5_000;
const MAX_COOLDOWN_MS = 2 * 60 * 1000;
/**
 * How long a request may sit in the queue before we answer from cache
 * instead.
 *
 * Pacing a refresh is right; making the fortieth holding hold a serverless
 * invocation open for twelve seconds is not — the platform kills it, and
 * the user gets a failure where a slightly older price would have done.
 */
const MAX_QUEUE_WAIT_MS = 4_000;

/**
 * How long we wait for CSFloat itself before giving up on the request.
 *
 * A serverless function that is still waiting on an upstream is a request
 * stuck on `Pending` in the browser, and because the client paces CSFloat
 * through a single queue, ONE pending request used to stall every item
 * behind it. Four seconds is well past CSFloat's normal response time, so
 * this only fires when the upstream has effectively stopped answering.
 */
const UPSTREAM_TIMEOUT_MS = Number(process.env["CSFLOAT_TIMEOUT_MS"] ?? "4000");

/**
 * Hard ceiling on the whole handler.
 *
 * The upstream timeout above bounds ONE call; this bounds the request,
 * including the time it spends queued behind other calls on a warm
 * instance. Past it the route answers with whatever it knows — a stale
 * price, or nothing — and lets the refresh finish in the background. An
 * answer of `null` is a cell the user can look at; `Pending` is not.
 */
const HANDLER_DEADLINE_MS = Number(process.env["CSFLOAT_DEADLINE_MS"] ?? "6000");

// How many listings we pull per lookup. Doubles as the ceiling for the
// reported listing count, so the two must never drift apart.
const LISTING_QUERY_LIMIT = 50;

type CacheEntry = {
  priceCents: number | null;
  exactFloatMatch: boolean;
  /** Undefined when this entry was written by a request that didn't ask
   * for a count — such an entry must NOT satisfy one that does. */
  listingCount?: number;
  fetchedAt: number;
  /** When the last attempt to refresh this entry failed. */
  failedAt?: number;
};

/**
 * Pinned to globalThis, like the Steam layer's cache.
 *
 * Vite re-evaluates this module on every edit and a serverless runtime
 * reuses a warm instance across invocations; a plain module-level Map would
 * quietly become two Maps under HMR, each believing it holds the only copy
 * of the rate budget.
 */
const CACHE_KEY = "__cs2hub_csfloat_cache__";
const INFLIGHT_KEY = "__cs2hub_csfloat_inflight__";
const globalStore = globalThis as typeof globalThis & {
  [CACHE_KEY]?: Map<string, CacheEntry>;
  [INFLIGHT_KEY]?: Map<string, Promise<CacheEntry>>;
};
const cache: Map<string, CacheEntry> = (globalStore[CACHE_KEY] ??= new Map());
/** One upstream lookup per item at a time, however many callers ask. */
const inFlight: Map<string, Promise<CacheEntry>> = (globalStore[INFLIGHT_KEY] ??= new Map());

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Serialises upstream calls and spaces them out.
 *
 * The cooldown is the part that matters under a real 429: without it the
 * queue keeps feeding requests into a door that is already closed, which is
 * how a rate limit turns from a pause into a ban. Each refusal doubles the
 * wait, and the first success clears it.
 */
class Throttle {
  private active = 0;
  private queue: (() => void)[] = [];
  private nextSlotAt = 0;
  private cooldownMs = 0;

  /**
   * Roughly how long a call queued right now would wait for its slot.
   *
   * Counts the BACKLOG, not just the next slot: `nextSlotAt` only advances
   * as tasks start, so on its own it never shows more than one gap ahead
   * however many callers are waiting — which would make the congestion
   * guard that reads this permanently blind.
   */
  estimatedWaitMs(): number {
    const ahead = this.queue.length + this.active;
    const perCall = REQUEST_GAP_MS + this.cooldownMs;
    return ahead * perCall + Math.max(0, this.nextSlotAt - Date.now());
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    while (this.active >= MAX_CONCURRENT) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      const now = Date.now();
      const earliest = Math.max(now, this.nextSlotAt);
      this.nextSlotAt = earliest + REQUEST_GAP_MS + this.cooldownMs;
      if (earliest > now) await sleep(earliest - now);
      const result = await task();
      this.cooldownMs = 0; // it worked — stop standing down
      return result;
    } catch (err) {
      if (err instanceof CsfloatRejected && err.status === 429) {
        this.cooldownMs = Math.min(
          this.cooldownMs > 0 ? this.cooldownMs * 2 : COOLDOWN_MS,
          MAX_COOLDOWN_MS,
        );
        console.warn(`[csfloat] 429 — backing off ${this.cooldownMs}ms between calls`);
      }
      throw err;
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
}

const THROTTLE_KEY = "__cs2hub_csfloat_throttle__";
const throttleStore = globalThis as typeof globalThis & { [THROTTLE_KEY]?: Throttle };
const throttle: Throttle = (throttleStore[THROTTLE_KEY] ??= new Throttle());

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
/**
 * The listings endpoint answers with a bare array on some deployments and
 * an envelope on others, and the envelope has carried the depth figure
 * under three different names. Both shapes are declared here so the count
 * can be read without a cast at the call site.
 */
type CsfloatListingsBody =
  | CsfloatListing[]
  | {
      data?: CsfloatListing[];
      total?: number;
      total_count?: number;
      count?: number;
    };

function listingPaintIndex(l: CsfloatListing): string | undefined {
  const raw = l.item?.paint_index ?? l.paint_index;
  return raw === undefined || raw === null ? undefined : String(raw);
}

/** Pulls a phase label out of a listing, if the API provides one. */
function listingPhase(l: CsfloatListing): string | undefined {
  return l.item?.phase ?? l.phase;
}

/**
 * What makes two lookups "the same question".
 *
 * Float is NOT part of it: the route prices the SKIN, not one particular
 * copy of it, so keying by float would split one answer into as many cache
 * entries as the user has copies — and spend an upstream call on each.
 */
function cacheKey(marketHashName: string, paintIndex?: string, phase?: string): string {
  return `${marketHashName}::${paintIndex ?? ""}::${phase ?? ""}`;
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
 * Headers for every CSFloat read.
 *
 * Two things matter here, and both were learned the hard way on Vercel.
 *
 * 1. AUTHORIZATION. CSFloat documents `GET /api/v1/listings` as public, and
 *    it is — from a home IP. From a shared cloud IP (Vercel, Netlify,
 *    Fly...) the anonymous quota is spent by everyone else on that address,
 *    so the request comes back 403/429 and the route turned that into a
 *    502. A key makes the request OURS instead of the datacentre's, which
 *    is why `CSFLOAT_API_KEY` is effectively required in production even
 *    though the endpoint is nominally open.
 *
 * 2. USER-AGENT. Server-side `fetch` sends either nothing or a bare
 *    runtime string, which is exactly the fingerprint a bot filter drops.
 *    A real, identifying UA with a contact URL is both the polite thing to
 *    send and the thing that gets through.
 */
const USER_AGENT =
  "CS2SkinTracker/1.0 (+https://github.com/cmigi/cs2-inventory-hub; portfolio price tracker)";

function csfloatHeaders(apiKey: string | undefined): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };
  // CSFloat takes the raw key in Authorization — no "Bearer " prefix.
  if (apiKey) headers["Authorization"] = apiKey;
  return headers;
}

/** Warn once per cold start, not once per holding in the portfolio. */
let warnedAboutMissingKey = false;

function readApiKey(): string | undefined {
  // Bracket access because `process.env` is an index signature under this
  // project's TS settings, and because a bundler that inlines env vars
  // (Vite/Vercel) rewrites exactly this form.
  const key = process.env["CSFLOAT_API_KEY"]?.trim();
  if (!key) {
    if (!warnedAboutMissingKey) {
      warnedAboutMissingKey = true;
      console.warn(
        "[csfloat] CSFLOAT_API_KEY is not set. Reads still work from an unblocked IP, but a " +
          "shared cloud IP (Vercel) will usually be refused — set it in the project's " +
          "environment variables and redeploy.",
      );
    }
    return undefined;
  }
  return key;
}

/** Upstream refused us rather than failed — worth reporting differently. */
class CsfloatRejected extends Error {
  // Written out rather than a TS parameter property so this module stays
  // loadable by plain `node --experimental-strip-types`, which is how the
  // route's logic is tested without spinning up a bundler.
  readonly status: number;

  constructor(status: number) {
    super(`CSFloat responded ${status}`);
    this.status = status;
  }
}

async function queryListings(
  apiKey: string | undefined,
  marketHashName: string,
  paintIndex?: string,
  minFloat?: number,
  maxFloat?: number,
  limit = LISTING_QUERY_LIMIT,
): Promise<{ listings: CsfloatListing[]; total?: number | undefined }> {
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
    headers: csfloatHeaders(apiKey),
    // A serverless function is billed by the second and killed at its
    // timeout; hanging on a silent upstream is the worst of both.
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) throw new CsfloatRejected(res.status);

  const body = (await res.json()) as CsfloatListingsBody;
  if (Array.isArray(body)) return { listings: body };

  const total = readTotal(body);
  return {
    listings: body.data ?? [],
    ...(total !== undefined ? { total } : {}),
  };
}

/**
 * The depth figure, whatever CSFloat decided to call it this month.
 *
 * The listings endpoint has shipped the total under several names over
 * time (and sometimes not at all), so every known spelling is read and the
 * first sane number wins. Anything non-numeric or negative is ignored
 * rather than surfaced as a count.
 */
function readTotal(body: Exclude<CsfloatListingsBody, CsfloatListing[]>): number | undefined {
  for (const value of [body.total, body.total_count, body.count]) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
}

/**
 * How many listings are on offer, WITHOUT spending extra requests.
 *
 * This used to walk up to eight pages. That was the single biggest source
 * of CSFloat 429s: one item page asked for five wears, and each of those
 * quietly became up to eight upstream calls. The count is now read from
 * the same response the price came from:
 *
 *   1. the `total` (or `total_count`/`count`) field, when CSFloat sends
 *      one — that is the exact depth of the order book;
 *   2. otherwise the rows we already have, but only when the page came
 *      back SHORT, which proves there is no second page;
 *   3. otherwise nothing. An item with a full first page has "at least 50"
 *      listings, and a floor presented as a count is a wrong number.
 */
function deriveListingCount(
  matches: CsfloatListing[],
  pageSize: number,
  reportedTotal: number | undefined,
): number | undefined {
  if (reportedTotal !== undefined) return reportedTotal;
  return pageSize < LISTING_QUERY_LIMIT ? matches.length : undefined;
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

/* -------------------------------------------------------------------------
 * Lookup policy
 * ---------------------------------------------------------------------- */

interface LookupParams {
  marketHashName: string;
  paintIndex?: string | undefined;
  phase?: string | undefined;
  floatValue?: number | undefined;
  wantsCount: boolean;
}

/** One live lookup: the cheapest Buy Now listing, throttled and paced. */
async function fetchFresh(params: LookupParams): Promise<CacheEntry> {
  const { marketHashName, paintIndex, phase, floatValue, wantsCount } = params;
  const apiKey = readApiKey();

  return throttle.run(async () => {
    /**
     * ONE query: the cheapest Buy Now listing for this exact
     * market_hash_name (the wear is already part of that name).
     *
     * Float is deliberately NOT part of the question. Asking for listings
     * within ±0.001 of the user's own float spends a request on a window
     * nobody is selling in, and made a perfectly liquid skin report "no
     * matching listing for this float".
     */
    const { listings, total } = await queryListings(apiKey, marketHashName, paintIndex);

    /**
     * Phase IS still verified, which is a different thing from float:
     * Doppler phases share one market_hash_name, so the cheapest listing
     * overall can be a Phase 1 when the user owns a Ruby. That would be a
     * wrong price, not an approximate one.
     */
    const matches = verifiedListings(listings, paintIndex, phase);

    // Cheapest first is what CSFloat sorts by, but the minimum is taken
    // explicitly so the answer does not depend on their sort surviving a
    // future API change.
    const priceCents = matches.reduce<number | null>(
      (lowest, l) =>
        typeof l.price === "number" && l.price > 0 && (lowest === null || l.price < lowest)
          ? l.price
          : lowest,
      null,
    );

    // Informational only: "the price came from a listing with a float close
    // to yours". It never gates the price any more.
    const exactFloatMatch =
      floatValue !== undefined &&
      matches.some((l) => {
        const f = l.item?.float_value;
        return typeof f === "number" && Math.abs(f - floatValue) <= FLOAT_TOLERANCE;
      });

    // Free: read off the response we already have, no extra requests.
    const listingCount = wantsCount
      ? deriveListingCount(matches, listings.length, total)
      : undefined;

    const entry: CacheEntry = { priceCents, exactFloatMatch, fetchedAt: Date.now() };
    if (listingCount !== undefined) entry.listingCount = listingCount;
    return entry;
  });
}

/** Runs at most one live lookup per cache key at a time. */
function fetchDeduped(key: string, params: LookupParams): Promise<CacheEntry> {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = fetchFresh(params)
    .then((entry) => {
      cache.set(key, entry);
      return entry;
    })
    .catch((err: unknown) => {
      // Remember the FAILURE against the previous value, so the price is
      // kept and the backoff has something to hang on.
      const previous = cache.get(key);
      if (previous) cache.set(key, { ...previous, failedAt: Date.now() });
      throw err;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

interface QuoteResult {
  priceCents: number | null;
  exactFloatMatch: boolean;
  listingCount?: number | undefined;
  cached: boolean;
  stale?: boolean | undefined;
  status?: "ok" | "unauthorized" | "rate_limited" | "error" | undefined;
  upstreamStatus?: number | undefined;
}

/**
 * Cache-first, stale-while-revalidate, and never louder than the situation.
 *
 * The order below is the whole rate-limit strategy:
 *   fresh cache → answer, no upstream call at all
 *   stale cache → answer NOW, refresh quietly behind
 *   nothing     → one throttled call, and on failure whatever we knew
 */
async function getQuote(key: string, params: LookupParams): Promise<QuoteResult> {
  const entry = cache.get(key);
  const now = Date.now();

  // An entry written without a count must not satisfy a request that wants
  // one, or the inventory table would leave the item page showing n/a.
  const satisfies = entry && !(params.wantsCount && entry.listingCount === undefined);

  if (entry && satisfies) {
    const age = now - entry.fetchedAt;
    if (age < FRESH_TTL_MS) {
      return {
        priceCents: entry.priceCents,
        exactFloatMatch: entry.exactFloatMatch,
        listingCount: entry.listingCount,
        cached: true,
      };
    }

    if (age < STALE_TTL_MS) {
      // Refresh behind the answer, unless this item failed very recently.
      // The catch matters: an unhandled rejection from a background task
      // takes the whole server process down.
      if (!entry.failedAt || now - entry.failedAt > ERROR_BACKOFF_MS) {
        void fetchDeduped(key, params).catch(() => undefined);
      }
      return {
        priceCents: entry.priceCents,
        exactFloatMatch: entry.exactFloatMatch,
        listingCount: entry.listingCount,
        cached: true,
        stale: true,
      };
    }
  }

  // Congested: the queue ahead of this request is longer than a serverless
  // invocation should be held open. A known price now beats a fresh price
  // that arrives after the platform has already killed the function.
  if (entry && entry.priceCents !== null && throttle.estimatedWaitMs() > MAX_QUEUE_WAIT_MS) {
    if (!entry.failedAt || now - entry.failedAt > ERROR_BACKOFF_MS) {
      void fetchDeduped(key, params).catch(() => undefined);
    }
    return {
      priceCents: entry.priceCents,
      exactFloatMatch: entry.exactFloatMatch,
      listingCount: entry.listingCount,
      cached: true,
      stale: true,
      status: "ok",
    };
  }

  try {
    const fresh = await fetchDeduped(key, params);
    return {
      priceCents: fresh.priceCents,
      exactFloatMatch: fresh.exactFloatMatch,
      listingCount: fresh.listingCount,
      cached: false,
    };
  } catch (err) {
    const rejected = err instanceof CsfloatRejected ? err.status : null;

    // THE 429 RULE: a refusal must never cost the user a price they already
    // had. Any age is acceptable here — a price from this morning is a fact
    // about the market; an empty cell is not.
    if (entry && entry.priceCents !== null) {
      return {
        priceCents: entry.priceCents,
        exactFloatMatch: entry.exactFloatMatch,
        listingCount: entry.listingCount,
        cached: true,
        stale: true,
        // Deliberately "ok": the user is looking at a real price, and a
        // warning toast about rate limits would be about our plumbing
        // rather than about their portfolio.
        status: "ok",
      };
    }

    if (rejected !== null) {
      console.warn(
        `[csfloat] upstream ${rejected} for "${params.marketHashName}"` +
          (rejected === 429 ? " — throttling further calls" : ""),
      );
    } else {
      console.warn(`[csfloat] lookup failed for "${params.marketHashName}":`, err);
    }

    return {
      priceCents: null,
      exactFloatMatch: false,
      cached: false,
      status:
        rejected === 401 || rejected === 403
          ? "unauthorized"
          : rejected === 429
            ? "rate_limited"
            : "error",
      upstreamStatus: rejected ?? undefined,
    };
  }
}

/**
 * What we say when the deadline wins the race.
 *
 * The last known price if there is one — a price from ten minutes ago is
 * still a fact about the market. Otherwise a null price, which the UI
 * renders as `n/a`. The listing count is deliberately left ABSENT rather
 * than reported as 0: "0 listings" is a claim about the market that we have
 * not verified, and it would read as "nobody is selling this".
 */
function deadlineAnswer(key: string): { answer: Promise<QuoteResult>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const answer = new Promise<QuoteResult>((resolve) => {
    timer = setTimeout(() => {
      const entry = cache.get(key);
      resolve({
        priceCents: entry?.priceCents ?? null,
        exactFloatMatch: entry?.exactFloatMatch ?? false,
        listingCount: entry?.listingCount,
        cached: entry !== undefined,
        stale: entry !== undefined,
        status: entry?.priceCents != null ? "ok" : "error",
      });
    }, HANDLER_DEADLINE_MS);
  });
  // Cleared when the real answer wins, so a timer that is no longer needed
  // cannot keep the invocation alive for the rest of the deadline.
  return { answer, cancel: () => clearTimeout(timer) };
}

export const Route = createFileRoute("/api/csfloat-price")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Outer guard: whatever happens below, this route answers with a
        // price-shaped body. An uncaught throw here is a 500/502 on Vercel,
        // and the client turns that into a failed refresh for the WHOLE
        // portfolio rather than one missing cell.
        let name: string | null = null;
        try {
          const url = new URL(request.url);
          name = url.searchParams.get("name");
          if (!name) {
            return Response.json({ error: "Missing 'name' query parameter" }, { status: 400 });
          }

          const floatParam = url.searchParams.get("float");
          const parsedFloat = floatParam !== null ? Number(floatParam) : Number.NaN;
          const floatValue = Number.isFinite(parsedFloat) ? parsedFloat : undefined;
          const paintIndex = url.searchParams.get("paintIndex") ?? undefined;
          const phase = url.searchParams.get("phase") ?? undefined;
          const wantsCount = url.searchParams.get("withCount") === "1";

          // The float is NOT part of the key any more: two copies of the
          // same skin now get the same answer, so keying by float would
          // just be two cache entries and two upstream calls for one price.
          const key = cacheKey(name, paintIndex, phase);
          const lookup = getQuote(key, {
            marketHashName: name,
            paintIndex,
            phase,
            floatValue,
            wantsCount,
          });

          // Whichever comes first: the real answer, or the deadline. The
          // lookup is not cancelled — it keeps running and populates the
          // cache, so the retry a few seconds later is an instant hit.
          const deadline = deadlineAnswer(key);
          try {
            const quote = await Promise.race([lookup, deadline.answer]);
            return Response.json(quote);
          } finally {
            deadline.cancel();
          }
        } catch (err) {
          console.error(`[csfloat] handler failed for "${name ?? "?"}":`, err);
          return Response.json({
            priceCents: null,
            exactFloatMatch: false,
            cached: false,
            status: "error",
          });
        }
      },
    },
  },
});
