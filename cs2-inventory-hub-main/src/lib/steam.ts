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

/* The per-item Steam lookup and the batch prefetch that used to live here
 * are GONE.
 *
 * Steam rate-limits per IP and a Vercel egress address is shared with every
 * tenant on the edge, so those calls came back 429 far more often than they
 * came back with a price. Prices now come from the browser's price dump
 * (priceDumpStore), read synchronously with no request at all. The status
 * type above is still used to describe an outcome.
 */
