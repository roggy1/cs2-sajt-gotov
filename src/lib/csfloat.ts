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

/** Fetches the live CSFloat price via our server proxy — never calls CSFloat directly from the browser. */
async function fetchCsfloatPrice(
  marketHashName: string,
  paintIndex?: string,
  phase?: string,
  floatValue?: number,
  withCount?: boolean,
): Promise<CsfloatPriceResponse> {
  const params = new URLSearchParams({ name: marketHashName });
  if (paintIndex) params.set("paintIndex", paintIndex);
  if (phase) params.set("phase", phase);
  if (floatValue !== undefined) params.set("float", String(floatValue));
  if (withCount) params.set("withCount", "1");

  const res = await fetch(`/api/csfloat-price?${params.toString()}`);
  const body = (await res.json()) as CsfloatPriceResponse;
  if (!res.ok || body.error) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

/**
 * Hook that fetches a single skin's live CSFloat price on demand (call
 * `.mutate({ name, wear, paintIndex, floatValue })`). When `paintIndex` is
 * provided (Doppler/Gamma Doppler phase), the server VERIFIES every
 * candidate listing's own reported paint_index before accepting its price —
 * it will return null rather than silently fall back to a different
 * phase's price. Converts cents→USD→EUR using the app's existing FX rate.
 */
export function useCsfloatPrice(usdToEurRate: number) {
  return useMutation({
    mutationFn: async ({
      name,
      wear,
      souvenir,
      paintIndex,
      phase,
      floatValue,
      withCount,
    }: {
      name: string;
      wear?: string;
      souvenir?: boolean;
      paintIndex?: string;
      phase?: string;
      floatValue?: number;
      withCount?: boolean;
    }): Promise<CsfloatPriceResult> => {
      const marketHashName = toMarketHashName(name, wear, souvenir);
      const { priceCents, exactFloatMatch, listingCount, status } = await fetchCsfloatPrice(
        marketHashName,
        paintIndex,
        phase,
        floatValue,
        withCount,
      );
      // Treat a missing OR zero price as "no listing" — writing 0 into the
      // portfolio would silently wipe out that holding's value and wreck
      // the profit/loss totals.
      if (priceCents === null || priceCents <= 0) {
        return { priceEur: null, exactFloatMatch: false, status: status ?? "ok" };
      }
      const usd = priceCents / 100;
      return {
        priceEur: usd / usdToEurRate,
        exactFloatMatch: exactFloatMatch ?? false,
        listingCount,
        status: status ?? "ok",
      };
    },
  });
}
