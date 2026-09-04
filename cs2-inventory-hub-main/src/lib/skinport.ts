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

/* The per-item Skinport lookup that used to live here is GONE — prices now
 * come from the browser's price dump (priceDumpStore), read synchronously.
 * Skinport's own catalogue endpoint was never the rate-limit problem, but
 * keeping one market on a per-item path would have kept the per-row request
 * machinery alive for all of them.
 */
