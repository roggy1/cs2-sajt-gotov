/**
 * Steam Community Market access layer — server only.
 *
 * Steam is the one market in this app that has no clean "give me the price
 * and the number of listings" API, so everything awkward about it is
 * concentrated here instead of leaking into the route handler:
 *
 *   - which endpoint actually returns an exact listing count,
 *   - what to do when that endpoint 429s or answers with HTML,
 *   - how fast we are allowed to ask.
 *
 * Three Steam endpoints matter, and they are NOT interchangeable:
 *
 *  1. /market/listings/730/<name>/render/
 *     Returns `total_count` (the exact number of live listings) AND the
 *     listings themselves with `converted_price`/`converted_fee` in the
 *     currency we ask for. This is the only endpoint that answers both
 *     questions in ONE request, so it is the primary. It is also the most
 *     aggressively rate-limited, which is why it needs everything below.
 *
 *  2. /market/search/render/?norender=1
 *     Returns `sell_listings` (again the exact live listing count) and
 *     `sell_price` per matching name. Far more tolerant of repeated calls
 *     than (1), so it is the count fallback. Its price is NOT usable: the
 *     `currency` parameter is ignored here and Steam answers in whatever
 *     currency it infers from the caller, so we take the count only.
 *     It also matches loosely — a search for "AK-47 | Redline
 *     (Field-Tested)" returns the StatTrak™ and Souvenir rows too — so the
 *     result must be matched on `hash_name` exactly or the count belongs
 *     to a different item.
 *
 *  3. /market/priceoverview/
 *     Honours `currency` properly and is the only source of 24h `volume`,
 *     but reports no listing count at all. Price/volume fallback.
 *
 * (2) and (3) answer different questions and live in different rate-limit
 * buckets, so when (1) fails they are fired in PARALLEL — the fallback path
 * costs one round trip, not two.
 */

// Relative, not the "@/" alias the UI files use: that alias is resolved by
// Vite, so an aliased import here would make this module unloadable under
// plain `node --test` — and these are the parts of the app that most need
// to be testable without spinning up a bundler.
import {
  normalizeMarketHashName,
  searchQueryPlan,
  searchParams,
  steamNameKey,
} from "../steamName.ts";

const LISTINGS_RENDER_URL = "https://steamcommunity.com/market/listings/730";
const SEARCH_RENDER_URL = "https://steamcommunity.com/market/search/render/";
const PRICE_OVERVIEW_URL = "https://steamcommunity.com/market/priceoverview/";

const APP_ID = "730"; // CS2
const CURRENCY_EUR = "3"; // matches the app's internal base currency

/** How many listings to pull when asking for a price. The render endpoint
 *  is price-ascending, so 1 would do; taking a handful and using the
 *  minimum costs a couple of KB and survives Steam changing that order. */
const LISTINGS_SAMPLE = 5;

/** Per-request ceiling. A hung socket must not hold a limiter slot. */
const REQUEST_TIMEOUT_MS = 8000;

/**
 * Steam blocks or soft-fails plain server-side fetches with no browser
 * identity — the reply comes back as an HTML challenge page rather than
 * JSON, which is exactly how the old code ended up reporting `n/a`:
 * `res.ok` was true, `res.json()` threw, and the error path had no count.
 */
const STEAM_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "en-US,en;q=0.9",
  "X-Requested-With": "XMLHttpRequest",
  Referer: "https://steamcommunity.com/market/",
};

// ---------------------------------------------------------------------------
// Adaptive rate limiter
// ---------------------------------------------------------------------------

/**
 * The old implementation ran a single serial queue with a hard 2.5s gap
 * between every outbound call. That is the wrong shape of protection: it
 * costs 2.5s even when Steam is perfectly happy, it serialises unrelated
 * users behind each other, and it still 429s under a burst because the gap
 * is fixed rather than reactive.
 *
 * This limiter instead runs a small amount of concurrency at a short gap
 * and only slows down when Steam actually pushes back:
 *
 *   - 429 / 403      → gap doubles and a cooldown is entered
 *   - clean responses → gap decays back toward the baseline
 *
 * So the common case is fast, and a genuinely throttled IP still converges
 * to a rate Steam tolerates instead of being punished forever.
 */
class RateLimited extends Error {
  constructor() {
    super("Steam rate limited");
    this.name = "RateLimited";
  }
}

interface LimiterConfig {
  maxConcurrent: number;
  baseGapMs: number;
  maxGapMs: number;
  cooldownMs: number;
  maxCooldownMs: number;
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

class AdaptiveLimiter {
  private readonly config: LimiterConfig;
  private active = 0;
  private gapMs: number;
  private nextSlotAt = 0;
  private cooldownUntil = 0;
  private consecutive429 = 0;
  private waiters: Array<() => void> = [];

  constructor(config: LimiterConfig) {
    this.config = config;
    this.gapMs = config.baseGapMs;
  }

  /** Diagnostics, surfaced on the API response so throttling is visible. */
  snapshot() {
    return {
      gapMs: Math.round(this.gapMs),
      active: this.active,
      queued: this.waiters.length,
      cooldownMs: Math.max(0, this.cooldownUntil - Date.now()),
    };
  }

  /**
   * `maxWaitMs` is a hard ceiling on how long a caller may sit in the
   * queue. A deep cooldown must never hold an HTTP response hostage — past
   * the ceiling the caller is rejected immediately so the handler can serve
   * a cached value and say `rate_limited`, which is a far better answer
   * than a request that hangs for a minute.
   */
  async run<T>(fn: () => Promise<T>, maxWaitMs = Infinity): Promise<T> {
    await this.acquire(maxWaitMs);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** Called when Steam answers 429/403 — slow down, hard. */
  penalise(): void {
    this.consecutive429 += 1;
    this.gapMs = Math.min(this.config.maxGapMs, Math.max(this.gapMs, 1) * 2);
    const cooldown = Math.min(
      this.config.maxCooldownMs,
      this.config.cooldownMs * 2 ** (this.consecutive429 - 1),
    );
    this.cooldownUntil = Date.now() + cooldown;
  }

  /** Called after a clean response — creep back toward the baseline. */
  reward(): void {
    this.consecutive429 = 0;
    this.gapMs = Math.max(this.config.baseGapMs, this.gapMs * 0.8);
  }

  private async acquire(maxWaitMs: number): Promise<void> {
    const deadline = Date.now() + maxWaitMs;

    while (this.active >= this.config.maxConcurrent) {
      if (Date.now() >= deadline) throw new RateLimited();
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;

    // Reserve this call's slot on the shared timeline before awaiting, so
    // concurrent callers space out instead of all waking at the same
    // instant and firing together.
    const now = Date.now();
    const earliest = Math.max(now, this.nextSlotAt, this.cooldownUntil);
    const wait = earliest - now;

    if (wait > maxWaitMs) {
      // Give the slot straight back — this caller is not going to use it.
      this.release();
      throw new RateLimited();
    }

    this.nextSlotAt = earliest + this.gapMs;
    if (wait > 0) await sleep(wait);
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * ONE LIMITER PER ENDPOINT, not one for all of Steam.
 *
 * This is the whole point of having a fallback chain. The listings render
 * endpoint has by far the tightest budget; search and priceoverview are
 * much more tolerant and Steam throttles them separately. A single shared
 * limiter would put a render 429 in front of the very calls meant to
 * rescue it — the fallback would sit out a cooldown it never earned,
 * turning a sub-second recovery into a multi-second stall.
 *
 * Pinned to globalThis so Vite's HMR (which re-evaluates this module on
 * edit) cannot end up with two sets that each think they own the budget.
 */
type Endpoint = "listings" | "search" | "overview";

const globalKey = "__cs2hub_steam_limiter__";
const globalStore = globalThis as typeof globalThis & {
  [globalKey]?: Record<Endpoint, AdaptiveLimiter>;
};

function makeLimiter(maxConcurrent: number, baseGapMs: number): AdaptiveLimiter {
  return new AdaptiveLimiter({
    maxConcurrent,
    baseGapMs,
    maxGapMs: envInt("STEAM_MAX_GAP_MS", 8000),
    cooldownMs: envInt("STEAM_COOLDOWN_MS", 5000),
    maxCooldownMs: envInt("STEAM_MAX_COOLDOWN_MS", 120_000),
  });
}

const limiters: Record<Endpoint, AdaptiveLimiter> = (globalStore[globalKey] ??= {
  listings: makeLimiter(envInt("STEAM_MAX_CONCURRENT", 3), envInt("STEAM_BASE_GAP_MS", 350)),
  search: makeLimiter(envInt("STEAM_SEARCH_CONCURRENT", 2), envInt("STEAM_SEARCH_GAP_MS", 250)),
  overview: makeLimiter(
    envInt("STEAM_OVERVIEW_CONCURRENT", 2),
    envInt("STEAM_OVERVIEW_GAP_MS", 250),
  ),
});

/**
 * How long any single request may spend queued before we give up and
 * answer from cache. Deliberately short: a user staring at a spinner is
 * worse than a slightly stale number carrying a `stale` flag.
 */
const MAX_QUEUE_WAIT_MS = envInt("STEAM_MAX_QUEUE_WAIT_MS", 3000);

// ---------------------------------------------------------------------------
// Low-level Steam calls
// ---------------------------------------------------------------------------

export type SteamQuoteStatus = "ok" | "no_listings" | "rate_limited" | "error";

/**
 * A single throttled Steam request that insists on JSON.
 *
 * Steam answers a blocked or challenged request with HTTP 200 and an HTML
 * body. Parsing that as JSON throws deep inside the caller, which is how a
 * soft block used to look identical to "this item has no listings". Content
 * type is checked here so the caller gets a clear failure instead.
 */
async function steamJson<T>(url: string, endpoint: Endpoint): Promise<T> {
  const limiter = limiters[endpoint];
  return limiter.run(async () => {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: STEAM_HEADERS,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(`Steam request failed: ${(err as Error).message}`);
    }

    if (res.status === 429 || res.status === 403) {
      limiter.penalise();
      throw new RateLimited();
    }
    if (!res.ok) throw new Error(`Steam responded ${res.status}`);

    const text = await res.text();
    const looksJson = text.trimStart().startsWith("{") || text.trimStart().startsWith("[");
    if (!looksJson) {
      // An HTML body on a 200 means Steam served a challenge/blocked page.
      limiter.penalise();
      throw new RateLimited();
    }

    limiter.reward();
    return JSON.parse(text) as T;
  }, MAX_QUEUE_WAIT_MS);
}

interface RenderResponse {
  success?: boolean;
  total_count?: number;
  listinginfo?: Record<
    string,
    { converted_price?: number; converted_fee?: number; price?: number; fee?: number }
  > | null;
}

/**
 * PRIMARY call: exact listing count + lowest EUR price in one request.
 *
 * `converted_price` excludes the buyer fee; the buyer actually pays
 * price + fee, which is the gross figure the rest of the app compares
 * against on other markets.
 */
async function fetchRender(
  marketHashName: string,
): Promise<{ priceEur: number | null; listingCount?: number | undefined }> {
  const url =
    `${LISTINGS_RENDER_URL}/${encodeURIComponent(marketHashName)}/render/` +
    `?start=0&count=${LISTINGS_SAMPLE}&currency=${CURRENCY_EUR}&language=english&format=json`;

  const body = await steamJson<RenderResponse>(url, "listings");

  const listingCount = typeof body.total_count === "number" ? body.total_count : undefined;

  const prices = Object.values(body.listinginfo ?? {})
    .map((l) => (l.converted_price ?? 0) + (l.converted_fee ?? 0))
    .filter((n) => n > 0);

  return {
    priceEur: prices.length > 0 ? Math.min(...prices) / 100 : null,
    listingCount,
  };
}

interface SearchResponse {
  success?: boolean;
  /** Number of item NAMES matching the query — not a listing count. */
  total_count?: number;
  results?: Array<{ hash_name?: string; sell_listings?: number }>;
}

/** Rows per search page. Steam caps this at 10 whatever we ask for. */
const SEARCH_PAGE = 10;

/** Pages to walk per tier before giving up — bounds a broad query's cost. */
const SEARCH_MAX_PAGES = 5;

export interface SearchCountResult {
  /** Listings for the exact item, or 0 when it is genuinely unlisted. */
  count?: number | undefined;
  /**
   * False means "Steam never gave us a usable answer" — the caller must
   * report n/a rather than a number. Distinguishing this from a real 0 is
   * the whole point: an unlisted item HAS zero listings, and saying `n/a`
   * there hides a fact we actually know.
   */
  confident: boolean;
}

/**
 * COUNT FALLBACK: `sell_listings` off the market search endpoint.
 *
 * Three things make this harder than it looks, all verified against the
 * live endpoint:
 *
 *  1. The index only covers items that CURRENTLY have listings. A rare
 *     item with none returns `{"success":true,"total_count":0,"results":[]}`
 *     — a successful response, not an error.
 *  2. Pages are ten rows regardless of `count`, so a name can sit several
 *     pages deep behind its siblings.
 *  3. A long exact-name query often matches nothing even when the item is
 *     listed, which is why `searchQueryPlan` walks from the exact name
 *     down to the bare item type.
 *
 * Matching is by `steamNameKey`, never `===`: the same search returns the
 * StatTrak™ and Souvenir rows next to the plain one, so position is
 * meaningless, and a one-character spelling difference between Steam and
 * us must not read as "no listings".
 */
async function fetchSearchCount(marketHashName: string): Promise<SearchCountResult> {
  const wanted = steamNameKey(marketHashName);

  for (const tier of searchQueryPlan(marketHashName)) {
    let sawRows = false;
    let total = Infinity;

    for (let page = 0; page < SEARCH_MAX_PAGES; page += 1) {
      const start = page * SEARCH_PAGE;
      if (start >= total) break;

      const body = await steamJson<SearchResponse>(
        `${SEARCH_RENDER_URL}?${searchParams(tier, start, SEARCH_PAGE).toString()}`,
        "search",
      );

      if (typeof body.total_count === "number") total = body.total_count;
      const rows = body.results ?? [];
      if (rows.length === 0) break;
      sawRows = true;

      const match = rows.find((r) => r.hash_name && steamNameKey(r.hash_name) === wanted);
      if (match && typeof match.sell_listings === "number") {
        return { count: match.sell_listings, confident: true };
      }
    }

    // The tier found the item's family but not the item, and we reached the
    // end of the list rather than a page cap. Since a narrowed tier returns
    // every currently-listed sibling of the right exterior, our absence
    // from it means the item has no listings — which is 0, not unknown.
    const exhausted = total <= SEARCH_MAX_PAGES * SEARCH_PAGE;
    if (sawRows && exhausted && tier.exterior) {
      return { count: 0, confident: true };
    }
  }

  return { confident: false };
}

interface PriceOverviewResponse {
  success?: boolean;
  lowest_price?: string;
  median_price?: string;
  /** Units sold in the last 24h — Steam's only liquidity signal. */
  volume?: string;
}

/** PRICE/VOLUME FALLBACK: correct EUR figures, but no listing count. */
async function fetchPriceOverview(
  marketHashName: string,
): Promise<{ priceEur: number | null; volume24h?: number | undefined }> {
  const params = new URLSearchParams({
    appid: APP_ID,
    currency: CURRENCY_EUR,
    market_hash_name: marketHashName,
  });

  const body = await steamJson<PriceOverviewResponse>(
    `${PRICE_OVERVIEW_URL}?${params.toString()}`,
    "overview",
  );
  if (body.success === false) return { priceEur: null };

  const parsedVolume = Number((body.volume ?? "").replace(/[^\d]/g, ""));
  return {
    priceEur: parseSteamPrice(body.lowest_price ?? body.median_price),
    volume24h: Number.isFinite(parsedVolume) && parsedVolume > 0 ? parsedVolume : undefined,
  };
}

/**
 * Steam returns a localized, symbol-laden string ("1,23€", "1.234,56€").
 * Figure out which separator is the decimal one by position rather than
 * assuming a locale, then strip the rest.
 */
export function parseSteamPrice(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d.,]/g, "");
  if (!cleaned) return null;

  const lastSep = Math.max(cleaned.lastIndexOf(","), cleaned.lastIndexOf("."));
  let normalized: string;
  if (lastSep === -1) {
    normalized = cleaned;
  } else {
    const decimals = cleaned.length - lastSep - 1;
    normalized =
      decimals >= 1 && decimals <= 2
        ? `${cleaned.slice(0, lastSep).replace(/[.,]/g, "")}.${cleaned.slice(lastSep + 1)}`
        : cleaned.replace(/[.,]/g, "");
  }

  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * Three TTLs, because "fresh", "usable" and "known bad" are different
 * questions:
 *
 *  - SOFT: past this the value is still served IMMEDIATELY, and a refresh
 *    is kicked off in the background. The user gets an instant answer and
 *    the next visit gets the new number. This is what removes the visible
 *    wait without hammering Steam.
 *  - HARD: past this the value is too old to show; the caller waits for a
 *    real fetch.
 *  - ERROR: a failed lookup is remembered briefly so a name Steam refuses
 *    (or that genuinely does not exist) is not retried on every render.
 */
const SOFT_TTL_MS = envInt("STEAM_SOFT_TTL_MS", 10 * 60 * 1000); // 10 min
const HARD_TTL_MS = envInt("STEAM_HARD_TTL_MS", 3 * 60 * 60 * 1000); // 3 h
const ERROR_TTL_MS = envInt("STEAM_ERROR_TTL_MS", 60 * 1000); // 1 min

export interface SteamQuote {
  priceEur: number | null;
  // `| undefined` spelled out because the project runs with
  // exactOptionalPropertyTypes: "absent" and "present but undefined" are
  // distinct types there, and these fields are genuinely built by
  // assignment rather than by omission.
  listingCount?: number | undefined;
  volume24h?: number | undefined;
  status: SteamQuoteStatus;
  /** True when served from cache rather than a fresh Steam call. */
  cached: boolean;
  /** True when the cached value is past SOFT_TTL and is refreshing behind. */
  stale?: boolean | undefined;
}

interface CacheEntry {
  priceEur: number | null;
  listingCount?: number | undefined;
  volume24h?: number | undefined;
  fetchedAt: number;
  /** Timestamp of the last failed attempt, for the error backoff. */
  failedAt?: number | undefined;
}

const cacheKey = "__cs2hub_steam_cache__";
const inFlightKey = "__cs2hub_steam_inflight__";
const store = globalThis as typeof globalThis & {
  [cacheKey]?: Map<string, CacheEntry>;
  [inFlightKey]?: Map<string, Promise<CacheEntry>>;
};

const cache: Map<string, CacheEntry> = (store[cacheKey] ??= new Map());
/** Shared in-flight promises: N concurrent lookups of the same name make
 *  ONE Steam call, not N. The item page alone used to fire duplicates
 *  whenever the wear table and the comparison panel overlapped. */
const inFlight: Map<string, Promise<CacheEntry>> = (store[inFlightKey] ??= new Map());

/** Bounded so a long-running server can't grow the cache without limit. */
const MAX_CACHE_ENTRIES = 5000;
function rememberEntry(name: string, entry: CacheEntry): void {
  if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(name)) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.delete(name);
  cache.set(name, entry);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface QuoteOptions {
  /** Bypass every cache tier and go straight to Steam. */
  force?: boolean | undefined;
  /** Ask for the exact listing count. Costs at most one extra parallel call. */
  withCount?: boolean | undefined;
  /** Ask for 24h volume. Only priceoverview carries it. */
  withVolume?: boolean | undefined;
}

/**
 * The fallback chain.
 *
 * Best case is a single request: `render` answers price AND count together.
 * When it fails — 429, a challenge page, a name Steam does not index — the
 * two replacement endpoints run in parallel, so degrading costs one extra
 * round trip rather than the serialised 5+ seconds the old queue imposed.
 */
async function fetchFresh(
  marketHashName: string,
  previous: CacheEntry | undefined,
  opts: QuoteOptions,
): Promise<CacheEntry> {
  let priceEur: number | null = null;
  let listingCount: number | undefined;
  let volume24h: number | undefined;
  let rateLimited = false;

  /**
   * Does this caller actually need a listing COUNT?
   *
   * It decides which endpoint we open with, and that turned out to be the
   * difference between Steam prices loading and not loading at all on a
   * shared cloud IP. `render` is the only endpoint that answers price and
   * count together, but it also has by far the tightest budget — so
   * starting there meant a plain portfolio refresh, which wants nothing but
   * prices, spent its first request on the endpoint most likely to 429 and
   * only then limped to the cheap one. Now the heavy call is made only when
   * its extra answer is wanted (the Inspect page), and a bulk refresh goes
   * straight to `priceoverview`, which is both the most tolerant endpoint
   * and the one that reports the LOWEST listing price.
   *
   * `undefined` still means "yes" so that existing callers (and the tests)
   * keep the original behaviour; the route passes an explicit false.
   */
  const wantsCount = opts.withCount !== false;

  if (wantsCount) {
    try {
      const render = await fetchRender(marketHashName);
      priceEur = render.priceEur;
      listingCount = render.listingCount;
    } catch (err) {
      if (err instanceof RateLimited) rateLimited = true;
      else console.warn(`[steam] render failed for "${marketHashName}":`, (err as Error).message);
    }
  }

  const needsCount = wantsCount && listingCount === undefined;
  const needsPrice = priceEur === null;
  const needsVolume = opts.withVolume === true;

  if (needsCount || needsPrice || needsVolume) {
    const [countResult, overviewResult] = await Promise.allSettled([
      needsCount
        ? fetchSearchCount(marketHashName)
        : Promise.resolve({ confident: false } as SearchCountResult),
      needsPrice || needsVolume
        ? fetchPriceOverview(marketHashName)
        : Promise.resolve({ priceEur: null as number | null, volume24h: undefined }),
    ]);

    if (countResult.status === "fulfilled" && countResult.value.confident) {
      // A confident 0 is a real answer and must survive the `??` chains
      // below — `listingCount ?? previous` would be fine, but an earlier
      // version used `||` here and turned every genuine 0 back into n/a.
      listingCount = countResult.value.count;
      rateLimited = false;
    } else if (countResult.status === "rejected" && countResult.reason instanceof RateLimited) {
      rateLimited = true;
    }

    if (overviewResult.status === "fulfilled") {
      if (priceEur === null) priceEur = overviewResult.value.priceEur;
      volume24h = overviewResult.value.volume24h;
      if (overviewResult.value.priceEur !== null) rateLimited = false;
    } else if (overviewResult.reason instanceof RateLimited) {
      rateLimited = true;
    }
  }

  // Price-only request whose cheap endpoint came up empty: `render` is
  // still worth one try, because it is a different budget and answers for
  // items priceoverview refuses. It is the fallback here rather than the
  // opening move, which is the whole point of the reordering above.
  if (!wantsCount && priceEur === null) {
    try {
      const render = await fetchRender(marketHashName);
      priceEur = render.priceEur;
      listingCount = render.listingCount;
      if (priceEur !== null) rateLimited = false;
    } catch (err) {
      if (err instanceof RateLimited) rateLimited = true;
      else console.warn(`[steam] render failed for "${marketHashName}":`, (err as Error).message);
    }
  }

  // Nothing came back at all: keep whatever we knew before rather than
  // overwriting a good value with nulls, and mark the failure so the error
  // backoff applies.
  if (priceEur === null && listingCount === undefined && rateLimited) {
    const entry: CacheEntry = {
      priceEur: previous?.priceEur ?? null,
      listingCount: previous?.listingCount,
      volume24h: previous?.volume24h,
      fetchedAt: previous?.fetchedAt ?? 0,
      failedAt: Date.now(),
    };
    rememberEntry(marketHashName, entry);
    throw new RateLimited();
  }

  const entry: CacheEntry = {
    priceEur,
    // A missing field never erases a previously known one — a rate-limited
    // count must not turn a real number back into `n/a` on screen.
    listingCount: listingCount ?? previous?.listingCount,
    volume24h: volume24h ?? previous?.volume24h,
    fetchedAt: Date.now(),
  };
  rememberEntry(marketHashName, entry);
  return entry;
}

/** Runs `fetchFresh` at most once per name at a time. */
function fetchDeduped(
  marketHashName: string,
  previous: CacheEntry | undefined,
  opts: QuoteOptions,
): Promise<CacheEntry> {
  const existing = inFlight.get(marketHashName);
  if (existing) return existing;

  const promise = fetchFresh(marketHashName, previous, opts).finally(() => {
    inFlight.delete(marketHashName);
  });
  inFlight.set(marketHashName, promise);
  return promise;
}

function toQuote(entry: CacheEntry, cached: boolean, stale = false): SteamQuote {
  return {
    priceEur: entry.priceEur,
    listingCount: entry.listingCount,
    volume24h: entry.volume24h,
    status: entry.priceEur === null && !entry.listingCount ? "no_listings" : "ok",
    cached,
    ...(stale ? { stale: true } : {}),
  };
}

/**
 * The single entry point the route handler uses.
 *
 * Resolution order: satisfied cache hit → stale-but-usable hit (served now,
 * refreshed behind) → live fetch → stale value on failure → error.
 */
export async function getSteamQuote(rawName: string, opts: QuoteOptions = {}): Promise<SteamQuote> {
  // Normalize ONCE, here, so every downstream call, the cache key and the
  // in-flight dedupe key all agree. Two spellings of the same item that
  // differ only by a curly apostrophe would otherwise be two cache entries
  // and two Steam calls, and only one of them would ever get an answer.
  const marketHashName = normalizeMarketHashName(rawName);
  if (!marketHashName) return { priceEur: null, status: "error", cached: false };

  const entry = cache.get(marketHashName);
  const now = Date.now();

  if (entry && !opts.force) {
    const age = now - entry.fetchedAt;
    // An entry written by a request that didn't ask for a count must not
    // satisfy one that does, or a bulk portfolio refresh would leave the
    // item page showing `n/a` until the TTL expired.
    const satisfies =
      !(opts.withCount && entry.listingCount === undefined) &&
      !(opts.withVolume && entry.volume24h === undefined);

    if (satisfies && age < SOFT_TTL_MS) return toQuote(entry, true);

    if (satisfies && age < HARD_TTL_MS) {
      // Stale-while-revalidate: answer instantly from cache, refresh behind.
      // The `catch` matters — an unhandled rejection here would crash the
      // server process, and a failed background refresh is not a user error.
      if (!entry.failedAt || now - entry.failedAt > ERROR_TTL_MS) {
        void fetchDeduped(marketHashName, entry, opts).catch(() => undefined);
      }
      return toQuote(entry, true, true);
    }
  }

  // Recently failed and we have something to show: don't retry yet.
  if (entry?.failedAt && now - entry.failedAt < ERROR_TTL_MS && !opts.force) {
    return { ...toQuote(entry, true, true), status: "rate_limited" };
  }

  try {
    const fresh = await fetchDeduped(marketHashName, entry, opts);
    return toQuote(fresh, false);
  } catch (err) {
    const status: SteamQuoteStatus = err instanceof RateLimited ? "rate_limited" : "error";
    if (entry) return { ...toQuote(entry, true, true), status };
    return { priceEur: null, status, cached: false };
  }
}

/** Exposed for the route's diagnostics header. */
export function limiterSnapshot() {
  return {
    listings: limiters.listings.snapshot(),
    search: limiters.search.snapshot(),
    overview: limiters.overview.snapshot(),
  };
}
