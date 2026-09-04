import { useMutation } from "@tanstack/react-query";
import { toMarketHashName } from "@/lib/csfloat";
import type { LivePriceStatus } from "@/lib/steam";

interface SkinportPriceResponse {
  priceEur: number | null;
  cached?: boolean;
  stale?: boolean;
  status?: LivePriceStatus;
  /** True when a phase-specific catalogue row was matched. */
  phaseMatched?: boolean;
  listingCount?: number;
  error?: string;
}

export interface SkinportPriceResult {
  priceEur: number | null;
  status: LivePriceStatus;
  cached: boolean;
  listingCount?: number;
}

/**
 * Fetches a live Skinport price through our own server proxy.
 *
 * Skinport publishes the entire catalogue in one response, so the proxy
 * downloads it periodically and answers lookups from memory — one upstream
 * request per ~90 minutes regardless of portfolio size, comfortably inside
 * their 8-requests-per-5-minutes limit.
 *
 * Prices come back already in EUR (the app's internal base currency), so no
 * FX conversion happens here.
 *
 * Doppler phases: Skinport keeps the phase in a separate `version` field
 * rather than inside market_hash_name, so we send the phase along and the
 * server matches on both — a Ruby resolves to the Ruby row, not the
 * cheapest phase.
 */
export function useSkinportPrice() {
  return useMutation({
    mutationFn: async ({
      name,
      wear,
      souvenir,
      phase,
      force,
    }: {
      name: string;
      wear?: string;
      souvenir?: boolean;
      phase?: string;
      force?: boolean;
    }): Promise<SkinportPriceResult> => {
      const marketHashName = toMarketHashName(name, wear, souvenir);
      const params = new URLSearchParams({ name: marketHashName });
      if (phase) params.set("phase", phase);
      if (force) params.set("force", "1");

      const res = await fetch(`/api/skinport-price?${params.toString()}`);
      const body = (await res.json()) as SkinportPriceResponse;
      if (!res.ok || body.error) throw new Error(body.error ?? `Request failed (${res.status})`);

      return {
        // Guard against 0 for the same reason as the other markets: writing
        // 0 would silently wipe a holding's value from the totals.
        priceEur: body.priceEur !== null && body.priceEur > 0 ? body.priceEur : null,
        status: body.status ?? "ok",
        cached: !!body.cached,
        listingCount: body.listingCount,
      };
    },
  });
}
