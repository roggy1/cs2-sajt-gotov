import { createFileRoute } from "@tanstack/react-router";

// Skinport's public catalogue endpoint. Unlike Steam/CSFloat, this returns
// EVERY item in one response — so we fetch the whole thing occasionally and
// answer all per-item lookups from memory. That trivially respects their
// limit of 8 requests per 5 minutes: we make roughly one request per 90
// minutes no matter how big the user's portfolio is.
const SKINPORT_ITEMS_URL = "https://api.skinport.com/v1/items";

// Their endpoint is itself cached for 5 minutes upstream, so refreshing
// more often than this buys nothing.
const CACHE_TTL_MS = 90 * 60 * 1000; // 90 minutes

interface SkinportItem {
  market_hash_name: string;
  /** Doppler / Gamma Doppler phase ("Ruby", "Emerald", ...) or null.
   * Skinport keeps the phase HERE rather than inside market_hash_name, so
   * matching a gem means matching on both fields. */
  version?: string | null;
  min_price?: number | null;
  suggested_price?: number | null;
  quantity?: number | null;
}

type Catalogue = Map<string, SkinportItem[]>;

let catalogue: Catalogue | null = null;
let fetchedAt = 0;
// Shared in-flight promise: if several lookups arrive while the catalogue
// is being downloaded, they all await the same request instead of each
// firing their own (which would burn the rate limit instantly).
let inFlight: Promise<Catalogue> | null = null;

async function downloadCatalogue(): Promise<Catalogue> {
  const params = new URLSearchParams({ app_id: "730", currency: "EUR" });
  const res = await fetch(`${SKINPORT_ITEMS_URL}?${params.toString()}`, {
    // Required by Skinport for this endpoint — without it the request is rejected.
    headers: { "Accept-Encoding": "br" },
  });
  if (!res.ok) throw new Error(`Skinport responded ${res.status}`);

  const items = (await res.json()) as SkinportItem[];
  const map: Catalogue = new Map();
  for (const item of items) {
    if (!item?.market_hash_name) continue;
    const bucket = map.get(item.market_hash_name);
    if (bucket) bucket.push(item);
    else map.set(item.market_hash_name, [item]);
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

/**
 * Picks the catalogue entry for a given name, honouring the phase when the
 * item has one. Falls back to the phase-less entry if no exact phase match
 * exists, so a plain skin still resolves normally.
 */
function pickEntry(entries: SkinportItem[], phase?: string): SkinportItem | undefined {
  if (phase) {
    const exact = entries.find(
      (e) => (e.version ?? "").trim().toLowerCase() === phase.trim().toLowerCase(),
    );
    if (exact) return exact;
    // No phase-specific row — signal that by returning nothing, rather than
    // quietly handing back another phase's price.
    return undefined;
  }
  return entries.find((e) => !e.version) ?? entries[0];
}

export const Route = createFileRoute("/api/skinport-price")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const marketHashName = url.searchParams.get("name");
        const phase = url.searchParams.get("phase") ?? undefined;
        const force = url.searchParams.get("force") === "1";

        if (!marketHashName) {
          return Response.json({ error: "Missing 'name' query parameter" }, { status: 400 });
        }

        const hadCatalogue = catalogue !== null;

        try {
          const map = await getCatalogue(force);
          const entries = map.get(marketHashName);
          if (!entries || entries.length === 0) {
            return Response.json({ priceEur: null, status: "no_listings", cached: false });
          }

          const entry = pickEntry(entries, phase);
          if (!entry) {
            return Response.json({ priceEur: null, status: "no_listings", cached: false });
          }

          // min_price is the cheapest live listing; suggested_price is
          // Skinport's own reference used when nothing is currently listed.
          const priceEur = entry.min_price ?? entry.suggested_price ?? null;
          return Response.json({
            priceEur,
            status: priceEur === null ? "no_listings" : "ok",
            cached: Date.now() - fetchedAt > 1000,
            phaseMatched: phase ? !!entry.version : undefined,
            listingCount: entry.quantity ?? undefined,
          });
        } catch {
          // Network/rate-limit trouble: serve the last catalogue we managed
          // to download rather than wiping prices. Only report a hard error
          // when we have never had one.
          if (hadCatalogue && catalogue) {
            const entries = catalogue.get(marketHashName);
            const entry = entries ? pickEntry(entries, phase) : undefined;
            const priceEur = entry ? (entry.min_price ?? entry.suggested_price ?? null) : null;
            return Response.json({ priceEur, status: "ok", cached: true, stale: true });
          }
          return Response.json({ priceEur: null, status: "error", cached: false });
        }
      },
    },
  },
});
