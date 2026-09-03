import { useMutation } from "@tanstack/react-query";
import { toMarketHashName } from "@/lib/csfloat";
import { isDopplerGem } from "@/lib/catalog/doppler";

export type LivePriceStatus =
  | "ok"
  | "no_listings"
  | "rate_limited"
  | "error"
  /** Steam cannot price this item: it is a Doppler gem, and Steam lists
   *  every phase under one market_hash_name. */
  | "phase_unsupported";

interface SteamPriceResponse {
  priceEur: number | null;
  cached?: boolean;
  stale?: boolean;
  status?: LivePriceStatus;
  volume24h?: number;
  listingCount?: number;
  error?: string;
}

interface SteamBatchResponse {
  results?: Record<string, SteamPriceResponse>;
  error?: string;
}

/** Server cap — must match MAX_BATCH in the route. */
const BATCH_SIZE = 50;

export interface SteamPriceResult {
  /** Lowest listing price in EUR, or null when Steam has no listings. */
  priceEur: number | null;
  status: LivePriceStatus;
  /** True when the value came from cache rather than a fresh Steam call. */
  cached: boolean;
  volume24h?: number;
  listingCount?: number;
}

/**
 * Fetches a live Steam Community Market price through our own server proxy.
 *
 * The proxy exists for two reasons: Steam sends no CORS headers (a direct
 * browser call is blocked outright), and it rate-limits hard — the server
 * side owns the cache and the request queue so those protections can't be
 * bypassed by opening a second tab.
 *
 * Steam is queried with currency=3 (EUR), which is already the app's
 * internal base currency, so no FX conversion happens here.
 */
export function useSteamPrice() {
  return useMutation({
    mutationFn: async ({
      name,
      wear,
      souvenir,
      phase,
      paintIndex,
      force,
      withCount,
    }: {
      name: string;
      wear?: string;
      souvenir?: boolean;
      phase?: string;
      paintIndex?: string;
      force?: boolean;
      /** Ask for the real listing count — one extra throttled call. */
      withCount?: boolean;
    }): Promise<SteamPriceResult> => {
      // Doppler gems (Ruby/Sapphire/Black Pearl/Emerald): Steam's quote for
      // these is the cheapest Doppler of ANY phase under the same name,
      // which is routinely several times below the gem's real value. There
      // is no Steam parameter that can narrow it — phase can only be read
      // from an item's inspect link, which the price API doesn't expose.
      //
      // So we return nothing rather than a number that looks real and would
      // silently understate the portfolio. The UI points the user at
      // CSFloat (which prices the exact phase) or a manual override.
      if (isDopplerGem({ name, phase, paintIndex })) {
        return { priceEur: null, status: "phase_unsupported", cached: false };
      }

      const marketHashName = toMarketHashName(name, wear, souvenir);
      const params = new URLSearchParams({ name: marketHashName });
      if (force) params.set("force", "1");
      // The listing count now rides along on the SAME Steam request as the
      // price (the listings render endpoint returns `total_count` next to
      // the listings), so asking for it no longer costs a second call.
      if (withCount) params.set("withCount", "1");

      const res = await fetch(`/api/steam-price?${params.toString()}`);
      const body = (await res.json()) as SteamPriceResponse;
      if (!res.ok || body.error) throw new Error(body.error ?? `Request failed (${res.status})`);

      return {
        // Guard against 0 for the same reason as CSFloat: writing 0 would
        // silently wipe a holding's value out of the portfolio totals.
        priceEur: body.priceEur !== null && body.priceEur > 0 ? body.priceEur : null,
        status: body.status ?? "ok",
        cached: !!body.cached,
        volume24h: body.volume24h,
        listingCount: body.listingCount,
      };
    },
  });
}

/**
 * Warms the server-side cache for many items in ONE HTTP round trip.
 *
 * A portfolio refresh used to make one request per holding, each awaiting
 * the previous one. The server now paces Steam itself with an adaptive
 * limiter, so handing it the whole list at once lets it interleave the
 * outbound calls — and every per-item lookup that follows is a cache hit.
 *
 * Deliberately best-effort and never throws: this is an optimisation, and
 * a failure here just means the normal per-item path does the work.
 */
export async function prefetchSteamPrices(marketHashNames: string[]): Promise<void> {
  const unique = [...new Set(marketHashNames.filter(Boolean))];

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const chunk = unique.slice(i, i + BATCH_SIZE);
    try {
      const params = new URLSearchParams({ names: chunk.join("|") });
      const res = await fetch(`/api/steam-price?${params.toString()}`);
      if (!res.ok) return;
      const body = (await res.json()) as SteamBatchResponse;
      if (body.error) return;
    } catch {
      // Network hiccup — fall through to the per-item path.
      return;
    }
  }
}
