import { normalizeMarketHashName } from "@/lib/steamName";
import {
  parseDump,
  parseEurRate,
  type DumpMarket,
  type DumpQuote,
  type DumpRow,
} from "@/lib/priceDumpParse";

// Re-exported so existing importers keep working; the parser itself is
// shared with the browser store so the two can never disagree about what
// counts as a price.
export { isDumpMarket, type DumpMarket, type DumpQuote, type DumpRow } from "@/lib/priceDumpParse";

/* =========================================================================
 * The bulk price dump
 *
 * WHY THIS EXISTS
 *
 * Steam and CSFloat both rate-limit PER IP. On a laptop that budget belongs
 * to one person; on Vercel the egress address is shared with every other
 * tenant on that edge, so the budget is spent before this app asks for
 * anything. The symptom was not "slow" — it was 429 on the very first call,
 * every time, with no amount of client caching able to help because nothing
 * ever succeeded once.
 *
 * A per-item API is simply the wrong shape for a shared address. So the
 * pricing model is inverted: ONE request downloads a pre-built dump of the
 * entire CS2 catalogue with every market's price in it, it is held in
 * memory for the TTL below, and every lookup after that is a Map read with
 * no network at all. A forty-holding portfolio costs one HTTP request per
 * TTL instead of forty per refresh, and there is no per-item budget left to
 * exhaust.
 *
 * CONFIGURATION
 *
 *   PRICE_DUMP_URL        JSON dump of all prices. Default: csgotrader's
 *                         public latest/prices.json.
 *   PRICE_DUMP_RATES_URL  Optional FX file used to convert the dump into
 *                         EUR. Default: csgotrader's exchange_rates.json.
 *   PRICE_DUMP_RATE       Fixed multiplier applied to every price instead
 *                         of the FX file. Set this if your dump is already
 *                         in EUR (use 1) or you want to pin the rate.
 *   PRICE_DUMP_TTL_MS     How long a downloaded dump is served before a
 *                         refresh (default 20 minutes).
 *
 * A NOTE ON CURRENCY, because getting this wrong is silent and expensive:
 * the default dump publishes USD. Every value is multiplied by the rate
 * below on the way in, so the rest of the app keeps working in EUR exactly
 * as before. If the FX file cannot be read the fallback rate is used and a
 * warning is logged once — a portfolio priced with a stale rate is a few
 * percent off, which is visibly better than a portfolio with no prices, but
 * it is not something to leave unnoticed.
 * ====================================================================== */

const CONFIGURED_URL = process.env["PRICE_DUMP_URL"]?.trim() ?? "";
/**
 * Setting PRICE_DUMP_URL to "off" (or "0") disables the dump entirely and
 * sends every lookup down the live per-item path. That is how the route
 * tests exercise the Steam and CSFloat code directly, and it is the escape
 * hatch for a deployment that would rather talk to the markets itself.
 */
const DUMP_DISABLED = CONFIGURED_URL === "off" || CONFIGURED_URL === "0";
const DUMP_URL = DUMP_DISABLED
  ? ""
  : CONFIGURED_URL || "https://prices.csgotrader.app/latest/prices.json";
const RATES_URL =
  process.env["PRICE_DUMP_RATES_URL"]?.trim() ||
  "https://prices.csgotrader.app/latest/exchange_rates.json";

/** Used when the FX file is unreachable. Approximate by nature — hence the warning. */
const FALLBACK_USD_TO_EUR = 0.92;

function envNumber(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** 20 minutes: inside the 15-30 the product wants, and dumps are rebuilt hourly at best. */
const TTL_MS = envNumber("PRICE_DUMP_TTL_MS", 20 * 60 * 1000);
/** Past the TTL the old dump is still served while a refresh runs behind it. */
const STALE_MS = 24 * 60 * 60 * 1000;
/** A manual refresh may pull a newer dump, but not on every click. */
const FORCE_MIN_AGE_MS = 5 * 60 * 1000;
/** Several MB of JSON; a stuck download must not hold a request open. */
const DOWNLOAD_TIMEOUT_MS = envNumber("PRICE_DUMP_TIMEOUT_MS", 20_000);
/** After a failure, stop retrying on every single lookup. */
const RETRY_AFTER_MS = 5 * 60 * 1000;

interface DumpState {
  rows: Map<string, DumpRow>;
  fetchedAt: number;
  rate: number;
}

/* -------------------------------------------------------------------------
 * Module state, pinned to globalThis
 *
 * Vite re-evaluates this module on every edit and a serverless runtime
 * reuses a warm instance across invocations. A plain module-level variable
 * would quietly become two copies under HMR — two dumps, two downloads, two
 * TTLs — so the one that matters lives on the global object.
 * ---------------------------------------------------------------------- */
const STATE_KEY = "__cs2hub_price_dump__";
const store = globalThis as typeof globalThis & {
  [STATE_KEY]?: {
    state: DumpState | null;
    inFlight: Promise<DumpState> | null;
    failedAt: number;
    warnedAboutRate: boolean;
  };
};
const dump = (store[STATE_KEY] ??= {
  state: null,
  inFlight: null,
  failedAt: 0,
  warnedAboutRate: false,
});

/* -------------------------------------------------------------------------
 * Downloading
 * ---------------------------------------------------------------------- */

/** The multiplier that turns a dump value into EUR. */
async function resolveRate(): Promise<number> {
  const pinned = Number(process.env["PRICE_DUMP_RATE"] ?? "");
  if (Number.isFinite(pinned) && pinned > 0) return pinned;

  try {
    const res = await fetch(RATES_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`rates responded ${res.status}`);

    const eur = parseEurRate(await res.json());
    if (eur !== null) return eur;
    throw new Error("no EUR rate in the response");
  } catch (err) {
    if (!dump.warnedAboutRate) {
      dump.warnedAboutRate = true;
      console.warn(
        `[price-dump] could not read an EUR rate from ${RATES_URL} (${String(err)}). ` +
          `Falling back to ${FALLBACK_USD_TO_EUR}. Set PRICE_DUMP_RATE to pin it, or 1 if ` +
          `your dump is already in EUR.`,
      );
    }
    return FALLBACK_USD_TO_EUR;
  }
}

async function download(): Promise<DumpState> {
  const rate = await resolveRate();

  const res = await fetch(DUMP_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`price dump responded ${res.status}`);

  // Throws when nothing parses — nearly always a URL pointed at an item
  // catalogue rather than a price dump. Failing loudly beats answering "no
  // listings" for every holding in the portfolio.
  const rows = parseDump(await res.json(), rate);
  return { rows, fetchedAt: Date.now(), rate };
}

/**
 * The dump, downloading it if needed. NEVER throws.
 *
 * Stale-while-revalidate: once a dump exists it is answered from memory
 * immediately and any refresh happens behind the answer, so no user request
 * ever waits on a multi-megabyte download except the very first one.
 */
export async function getDump(force = false): Promise<DumpState | null> {
  if (DUMP_DISABLED) return null;
  const state = dump.state;
  const age = state ? Date.now() - state.fetchedAt : Number.POSITIVE_INFINITY;

  const refresh = (): Promise<DumpState> => {
    if (dump.inFlight) return dump.inFlight;
    dump.inFlight = download()
      .then((next) => {
        dump.state = next;
        dump.failedAt = 0;
        console.info(
          `[price-dump] loaded ${next.rows.size} items from ${DUMP_URL} (rate ${next.rate})`,
        );
        return next;
      })
      .catch((err: unknown) => {
        dump.failedAt = Date.now();
        console.warn("[price-dump] download failed:", err);
        throw err;
      })
      .finally(() => {
        dump.inFlight = null;
      });
    return dump.inFlight;
  };

  if (state && age < TTL_MS && !(force && age > FORCE_MIN_AGE_MS)) return state;

  if (state && age < STALE_MS) {
    // Serve the old dump now, refresh behind it. The `catch` matters: an
    // unhandled rejection from a background task takes the process down.
    if (Date.now() - dump.failedAt > RETRY_AFTER_MS) void refresh().catch(() => undefined);
    return state;
  }

  // Nothing usable in memory and the last attempt failed recently: don't
  // retry on every lookup of a portfolio refresh.
  if (!state && Date.now() - dump.failedAt < RETRY_AFTER_MS) return null;

  try {
    return await refresh();
  } catch {
    return state;
  }
}

/**
 * One market's price for one item, straight out of memory.
 *
 * `null` means the dump is loaded and has nothing for this item/market —
 * a real answer. `undefined` means the dump itself is unavailable, which is
 * a different thing and lets a caller decide whether to fall back to a live
 * API rather than reporting "no listings" for something that may well have
 * plenty.
 */
export async function dumpQuote(
  marketHashName: string,
  market: DumpMarket,
  force = false,
): Promise<DumpQuote | null | undefined> {
  const state = await getDump(force);
  if (!state) return undefined;
  const row = state.rows.get(normalizeMarketHashName(marketHashName));
  return row?.[market] ?? null;
}

/** Every market we have for one item — what the batch endpoint serves. */
export async function dumpRow(
  marketHashName: string,
  force = false,
): Promise<DumpRow | null | undefined> {
  const state = await getDump(force);
  if (!state) return undefined;
  return state.rows.get(normalizeMarketHashName(marketHashName)) ?? null;
}

/** Diagnostics for response headers — cheap to compute, useful in the field. */
export function dumpSnapshot(): { items: number; ageMs: number | null; rate: number | null } {
  const state = dump.state;
  return {
    items: state?.rows.size ?? 0,
    ageMs: state ? Date.now() - state.fetchedAt : null,
    rate: state?.rate ?? null,
  };
}
