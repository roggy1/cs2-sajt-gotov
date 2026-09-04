import { useMutation } from "@tanstack/react-query";
import { stripPhaseSuffix } from "@/lib/catalog/doppler";
import { normalizeMarketHashName } from "@/lib/steamName";

/** Why a lookup came back without a price, when it did. */
export type CsfloatStatus = "ok" | "unauthorized" | "rate_limited" | "error";

interface CsfloatPriceResponse {
  priceCents: number | null;
  exactFloatMatch?: boolean;
  cached?: boolean;
  stale?: boolean;
  listingCount?: number;
  status?: CsfloatStatus;
  /** The HTTP status CSFloat itself returned, when it refused us. */
  upstreamStatus?: number;
  error?: string;
}

export interface CsfloatPriceResult {
  /** Price in EUR, or null if no Buy Now listing exists for this item at all. */
  priceEur: number | null;
  /** False when the price came from a fallback (any float) rather than the exact float requested. */
  exactFloatMatch: boolean;
  listingCount?: number | undefined;
  /**
   * "ok" even when there is no price — that just means no listing. The
   * other values mean CSFloat refused the lookup, which is a different
   * problem with a different fix (usually a missing API key on a cloud
   * deployment) and must not be reported as "this skin has no listings".
   */
  status?: CsfloatStatus | undefined;
}

/**
 * Builds the Steam-style market_hash_name CSFloat expects, e.g.
 * "StatTrak™ AK-47 | Redline (Field-Tested)". Our catalog bakes the
 * "StatTrak™ " prefix AND, for Doppler/Gamma Doppler, a "(Phase)" suffix
 * directly into the DISPLAY name — but the real Steam market_hash_name
 * never includes the phase in the text, so we strip that part back out
 * here before it's sent as an actual query. paint_index is what actually
 * disambiguates the phase server-side.
 */
export function toMarketHashName(name: string, wear?: string, souvenir?: boolean): string {
  const withoutPhase = stripPhaseSuffix(name);
  // Legacy souvenirs picked from search already carry the prefix in their
  // name; only add it for a skin the user flagged souvenir manually.
  const prefixed =
    souvenir && !withoutPhase.startsWith("Souvenir ") ? `Souvenir ${withoutPhase}` : withoutPhase;
  const assembled = wear ? `${prefixed} (${wear})` : prefixed;

  // Every market keys off this exact string, so it is the right single
  // place to clean it. Names arrive here from the catalog, from a Steam
  // inventory import and from whatever the user typed or pasted — a curly
  // apostrophe or a stray non-breaking space in any of those produces a
  // name no marketplace resolves, and the symptom is `n/a` everywhere at
  // once rather than an error anyone can act on.
  return normalizeMarketHashName(assembled);
}

/* The per-item CSFloat lookup that used to live here is GONE.
 *
 * It fetched /api/csfloat-price once per skin, which on a shared Vercel IP
 * meant 429s and requests stuck on `(pending)` — and, because the client
 * paced them through one queue, a single stuck request stalled the whole
 * table. Prices now come from the browser's price dump (priceDumpStore),
 * read synchronously with no request at all.
 *
 * The hook is deleted rather than merely unused on purpose: a component
 * cannot accidentally reintroduce a per-item fetch that does not exist.
 */
