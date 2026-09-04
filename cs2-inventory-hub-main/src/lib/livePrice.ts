import { useCallback, useRef } from "react";
import { toMarketHashName } from "@/lib/csfloat";
import type { LivePriceStatus } from "@/lib/steam";
import { useMarketCsgoPrice } from "@/lib/marketcsgo";
import { usePriceDump } from "@/lib/priceDumpStore";
import { isDumpMarket } from "@/lib/priceDumpParse";
import type { MarketplaceId } from "@/lib/markets/types";
import type { Skin } from "@/lib/skins";

export interface LivePriceOutcome {
  priceEur: number | null;
  status: LivePriceStatus;
  cached: boolean;
  /** Kept for callers that still read it. The dump carries no float data,
   *  so a dump-sourced price is never float-matched. */
  exactFloatMatch?: boolean | undefined;
  /** Active listings, where the market reports it. */
  listingCount?: number | undefined;
  /** Units sold in 24h, where the market reports it. */
  volume24h?: number | undefined;
}

/* -------------------------------------------------------------------------
 * Where prices come from
 *
 * Steam, CSFloat and Skinport are answered ENTIRELY from the price dump the
 * browser downloaded once (see priceDumpStore). No request leaves this
 * module for those three — not from the inventory table, not from the add
 * form, not from the Steam import, not from the Inspect page. That is the
 * point: per-item calls to /api/csfloat-price and /api/steam-price are what
 * filled the Network tab with `(pending)` requests and got a shared Vercel
 * IP rate-limited, and the surest way to stop them is to delete the code
 * that could make them.
 *
 * Market.CSGO is the one exception and keeps its own route: it is not in
 * the dump, has never been IP-blocked, and answers the whole catalogue in
 * one cached server-side request rather than one per item.
 *
 * Everything that used to live here — the client quote cache, the CSFloat
 * pacing queue, the per-item timeout — went with the requests. A Map read
 * needs no cache, no pacing and no timeout.
 * ---------------------------------------------------------------------- */

type PriceableSkin = Pick<
  Skin,
  "name" | "wear" | "souvenir" | "paintIndex" | "phase" | "floatValue"
>;

/**
 * One place that knows how to price a skin on any marketplace.
 *
 * Shared so the inventory table, the Steam import and the item page run
 * through identical logic — otherwise they drift and an item gets priced
 * differently depending on how it was reached.
 *
 * `fetchFor` is deliberately given an EMPTY dependency array and reads its
 * mutations through refs. React Query mutation objects get a new identity on
 * every render, so a `useCallback` that depended on them would change
 * identity constantly — and any `useEffect` depending on `fetchFor` would
 * re-run, fetch, re-render, and loop forever. That bug is what made the app
 * feel slow.
 */
export function useLivePriceFetcher() {
  const priceDump = usePriceDump();
  const marketCsgoPrice = useMarketCsgoPrice();

  // Read through a ref so `fetchFor` can keep a stable identity: React Query
  // mutation objects get a new one on every render, and a `useCallback` that
  // depended on them would change identity constantly — any `useEffect`
  // depending on `fetchFor` would then re-run, fetch, re-render and loop.
  const refs = useRef({ priceDump, marketCsgoPrice });
  refs.current = { priceDump, marketCsgoPrice };

  const fetchFor = useCallback(
    async (
      skin: PriceableSkin,
      marketplace: MarketplaceId,
      force = false,
      _withCount = false,
    ): Promise<LivePriceOutcome> => {
      const { priceDump: dump, marketCsgoPrice: mc } = refs.current;
      const hashName = toMarketHashName(skin.name, skin.wear, skin.souvenir);

      // The dump: synchronous, no network, cannot fail or hang.
      if (isDumpMarket(marketplace)) {
        const quote = dump.quote(hashName, marketplace);
        if (quote) {
          return {
            priceEur: quote.priceEur,
            status: "ok",
            cached: true,
            listingCount: quote.listingCount,
          };
        }
        // Two different situations, told apart honestly: the dump is loaded
        // and has nothing for this item ("no listings"), or the dump itself
        // has not arrived yet ("error" — not a claim about the item).
        return {
          priceEur: null,
          status: dump.status === "ready" ? "no_listings" : "error",
          cached: true,
        };
      }

      try {
        const result = await mc.mutateAsync({
          name: skin.name,
          wear: skin.wear,
          souvenir: skin.souvenir,
          force,
        });
        return {
          priceEur: result.priceEur,
          status: result.status,
          cached: result.cached,
          volume24h: result.volume24h,
        };
      } catch (err) {
        // Never throws: a market being down must not abort a bulk pass.
        console.warn(`[livePrice] ${marketplace} lookup failed for "${skin.name}":`, err);
        return { priceEur: null, status: "error", cached: false };
      }
    },
    [],
  );

  return { fetchFor, isPending: marketCsgoPrice.isPending };
}
