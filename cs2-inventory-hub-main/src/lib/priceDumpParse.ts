import { normalizeMarketHashName } from "@/lib/steamName";
import type { MarketplaceId } from "@/lib/markets/types";

/**
 * Reading a public price dump.
 *
 * Kept free of any server or browser API so the SAME parser runs in both:
 * the browser store downloads the dump and parses it here, and the server
 * route (for the Inspect page and anything else that still asks the API)
 * parses it here too. One implementation means the two can never disagree
 * about what a price is — which matters, because "what counts as a price"
 * is the whole bug class this file exists to close.
 */

/** Markets a dump can answer for. Market.CSGO keeps its own API, which is
 *  not IP-blocked and reports live listing counts. */
export type DumpMarket = Extract<MarketplaceId, "steam" | "csfloat" | "skinport">;

export const DUMP_MARKETS: DumpMarket[] = ["steam", "csfloat", "skinport"];

export function isDumpMarket(market: MarketplaceId): market is DumpMarket {
  return (DUMP_MARKETS as MarketplaceId[]).includes(market);
}

export interface DumpQuote {
  priceEur: number;
  /** Active listings, where the dump reports depth. */
  listingCount?: number | undefined;
}

export type DumpRow = Partial<Record<DumpMarket, DumpQuote>>;

/* -------------------------------------------------------------------------
 * Value rules
 *
 * Strict on purpose. A missing, zero, negative or unparseable price is "no
 * price" — never 0, because a 0 written into a portfolio reads as "this
 * skin is worthless" and drags every total down with it.
 * ---------------------------------------------------------------------- */

export function num(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function count(raw: unknown): number | undefined {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
}

export function obj(raw: unknown): Record<string, unknown> | undefined {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined;
}

/**
 * Where each market's price and depth live, in order of preference.
 *
 * Public dumps spell their fields differently and change them over time, so
 * each market is a LIST of candidate paths and the first usable number
 * wins. A schema tweak upstream costs one line here rather than a dead
 * column in the UI.
 */
const MARKET_FIELDS: Record<
  DumpMarket,
  { containers: string[]; price: string[]; count: string[] }
> = {
  steam: {
    containers: ["steam", "steam_price"],
    // Steam publishes averages over windows, not a live ask. The shortest
    // window is the closest thing to "what it goes for right now".
    price: ["last_24h", "last_7d", "last_30d", "last_90d", "price", "median", "safe_price"],
    count: ["volume", "quantity"],
  },
  csfloat: {
    // "csgofloat" is the historical key; "csfloat" is the current name.
    containers: ["csfloat", "csgofloat", "float"],
    price: ["price", "starting_at", "lowest_price", "min_price"],
    count: ["quantity", "count", "total"],
  },
  skinport: {
    containers: ["skinport"],
    // `starting_at` is the cheapest live listing — the number a buyer
    // actually pays. `suggested_price` is Skinport's own estimate and is
    // only worth using when there is nothing on offer.
    price: ["starting_at", "min_price", "price", "suggested_price"],
    count: ["quantity", "count"],
  },
};

function readMarket(entry: Record<string, unknown>, market: DumpMarket): DumpQuote | undefined {
  const fields = MARKET_FIELDS[market];

  for (const containerName of fields.containers) {
    const raw = entry[containerName];

    // Some dumps put a bare number where others nest an object.
    const flat = num(raw);
    if (flat !== null) return { priceEur: flat };

    const container = obj(raw);
    if (!container) continue;

    for (const field of fields.price) {
      const price = num(container[field]);
      if (price === null) continue;

      let listingCount: number | undefined;
      for (const c of fields.count) {
        listingCount = count(container[c]);
        if (listingCount !== undefined) break;
      }
      return listingCount === undefined ? { priceEur: price } : { priceEur: price, listingCount };
    }
  }
  return undefined;
}

export function readDumpRow(value: unknown, rate: number): DumpRow | null {
  // The oldest accepted shape: `{ "<name>": 12.34 }` — a Steam price and
  // nothing else. Kept because the original Steam-only feed used it.
  const bare = num(value);
  if (bare !== null) return { steam: { priceEur: bare * rate } };

  const entry = obj(value);
  if (!entry) return null;

  const row: DumpRow = {};
  for (const market of DUMP_MARKETS) {
    const quote = readMarket(entry, market);
    if (!quote) continue;
    row[market] = {
      priceEur: quote.priceEur * rate,
      ...(quote.listingCount !== undefined ? { listingCount: quote.listingCount } : {}),
    };
  }
  return Object.keys(row).length > 0 ? row : null;
}

/**
 * Turns a whole downloaded dump into a lookup map.
 *
 * Names are normalised on the way IN, so a lookup for a name carrying a
 * curly apostrophe or a stray non-breaking space still finds its row.
 *
 * @throws when nothing parses — which nearly always means the URL points at
 *         an item CATALOGUE rather than a price dump (CSGO-API's skins.json
 *         is the usual culprit and has no price field at all). Failing
 *         loudly beats answering "no listings" for every holding.
 */
export function parseDump(body: unknown, rate: number): Map<string, DumpRow> {
  const rows = new Map<string, DumpRow>();

  const add = (name: unknown, value: unknown) => {
    if (typeof name !== "string") return;
    const key = normalizeMarketHashName(name);
    const row = readDumpRow(value, rate);
    if (key && row) rows.set(key, row);
  };

  if (Array.isArray(body)) {
    for (const item of body) {
      const entry = obj(item);
      if (entry) add(entry["market_hash_name"] ?? entry["name"], entry);
    }
  } else {
    const top = obj(body);
    // Some dumps wrap the map in `items` / `prices`.
    const map = obj(top?.["items"]) ?? obj(top?.["prices"]) ?? top;
    if (map) for (const [name, value] of Object.entries(map)) add(name, value);
  }

  if (rows.size === 0) {
    throw new Error(
      "price dump parsed to 0 usable rows — is the URL a price dump rather than an item " +
        "catalogue (e.g. CSGO-API skins.json, which has no prices)?",
    );
  }
  return rows;
}

/** Reads the EUR multiplier out of an FX file, in either shape it ships in. */
export function parseEurRate(body: unknown): number | null {
  const top = obj(body);
  // Two shapes in the wild: a flat { "EUR": 0.92 } map, or
  // { base: "USD", rates: { "EUR": 0.92 } }.
  const rates = obj(top?.["rates"]) ?? top;
  return num(rates?.["EUR"]) ?? num(rates?.["eur"]);
}
