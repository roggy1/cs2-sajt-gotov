import { useMutation } from "@tanstack/react-query";
import { toMarketHashName } from "@/lib/csfloat";
import type { LivePriceStatus } from "@/lib/steam";

interface MarketCsgoPriceResponse {
  priceEur: number | null;
  cached?: boolean | undefined;
  stale?: boolean | undefined;
  status?: LivePriceStatus | undefined;
  volume24h?: number | undefined;
  error?: string | undefined;
}

export interface MarketCsgoPriceResult {
  priceEur: number | null;
  status: LivePriceStatus;
  cached: boolean;
  /** Units sold in 24h. This market publishes no live listing count. */
  volume24h?: number | undefined;
}

/**
 * Fetches a live Market.CSGO price through our own server proxy.
 *
 * Same shape as Skinport: the whole catalogue arrives in one upstream
 * response, so the server holds it in memory and every per-item lookup is
 * free. Prices are already EUR, so nothing is converted here.
 */
export function useMarketCsgoPrice() {
  return useMutation({
    mutationFn: async ({
      name,
      wear,
      souvenir,
      force,
    }: {
      name: string;
      wear?: string | undefined;
      souvenir?: boolean | undefined;
      force?: boolean | undefined;
    }): Promise<MarketCsgoPriceResult> => {
      const marketHashName = toMarketHashName(name, wear, souvenir);
      const params = new URLSearchParams({ name: marketHashName });
      if (force) params.set("force", "1");

      const res = await fetch(`/api/marketcsgo-price?${params.toString()}`);
      const body = (await res.json()) as MarketCsgoPriceResponse;
      if (!res.ok || body.error) throw new Error(body.error ?? `Request failed (${res.status})`);

      return {
        // Guard against 0 for the same reason as every other market:
        // writing 0 would silently wipe a holding out of the totals.
        priceEur: body.priceEur !== null && body.priceEur > 0 ? body.priceEur : null,
        status: body.status ?? "ok",
        cached: !!body.cached,
        volume24h: body.volume24h,
      };
    },
  });
}
