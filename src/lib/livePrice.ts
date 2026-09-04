import { useCallback, useRef } from "react";
import { useCsfloatPrice, toMarketHashName } from "@/lib/csfloat";
import { useSteamPrice, type LivePriceStatus } from "@/lib/steam";
import { useSkinportPrice } from "@/lib/skinport";
import { useMarketCsgoPrice } from "@/lib/marketcsgo";
import { useCurrency } from "@/lib/currency";
import { readQuoteCache, writeQuoteCache, invalidateQuote } from "@/lib/priceCache";
import type { MarketplaceId } from "@/lib/markets/types";
import type { Skin } from "@/lib/skins";

export interface LivePriceOutcome {
  priceEur: number | null;
  status: LivePriceStatus;
  cached: boolean;
  /** CSFloat only: false when the price came from a float fallback. */
  exactFloatMatch?: boolean | undefined;
  /** Active listings, where the market reports it. */
  listingCount?: number | undefined;
  /** Units sold in 24h, where the market reports it. */
  volume24h?: number | undefined;
}

/* -------------------------------------------------------------------------
 * Client-side pacing
 *
 * The Inspect page asks for one price per market for the selected wear AND
 * one per wear for the wear table. That is six CSFloat lookups leaving the
 * browser in the same millisecond — measured at gaps of 0-5ms — and CSFloat
 * answers a burst like that from a shared cloud IP with 429.
 *
 * The server paces its own outbound calls, but it can only pace what has
 * already arrived: six parallel requests still occupy six serverless
 * invocations, each with its own in-memory throttle. So the queue has to
 * start here, in the one place every caller goes through.
 *
 * Only markets with a configured gap are queued; the others stay parallel,
 * because serialising Skinport (one cached catalogue lookup) would slow the
 * page down for no benefit.
 * ---------------------------------------------------------------------- */
const MARKET_GAP_MS: Partial<Record<MarketplaceId, number>> = {
  // CSFloat is the one that actually refuses. 400ms keeps five wears inside
  // two seconds while looking nothing like a burst.
  csfloat: 400,
};

const marketQueues = new Map<MarketplaceId, Promise<unknown>>();

function paced<T>(market: MarketplaceId, task: () => Promise<T>): Promise<T> {
  const gap = MARKET_GAP_MS[market];
  if (!gap) return task();

  const previous = marketQueues.get(market) ?? Promise.resolve();
  // `.catch` on the CHAIN, not on the task: one failed lookup must not
  // break the queue for everything behind it.
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const result = await task();
      await new Promise((resolve) => setTimeout(resolve, gap));
      return result;
    });
  marketQueues.set(market, next);
  return next;
}

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
  const { rates } = useCurrency();
  const csfloatPrice = useCsfloatPrice(rates.usd);
  const steamPrice = useSteamPrice();
  const skinportPrice = useSkinportPrice();
  const marketCsgoPrice = useMarketCsgoPrice();

  const refs = useRef({
    csfloatPrice,
    steamPrice,
    skinportPrice,
    marketCsgoPrice,
    usdRate: rates.usd,
  });
  refs.current = { csfloatPrice, steamPrice, skinportPrice, marketCsgoPrice, usdRate: rates.usd };

  const isPending =
    csfloatPrice.isPending ||
    steamPrice.isPending ||
    skinportPrice.isPending ||
    marketCsgoPrice.isPending;

  const fetchFor = useCallback(
    async (
      skin: PriceableSkin,
      marketplace: MarketplaceId,
      force = false,
      /** Item page only — costs an extra throttled call on Steam. */
      withCount = false,
    ): Promise<LivePriceOutcome> => {
      const {
        csfloatPrice: cf,
        steamPrice: st,
        skinportPrice: sp,
        marketCsgoPrice: mc,
      } = refs.current;

      // Float is part of the identity for CSFloat lookups — two copies of
      // the same skin with different floats are different questions.
      const cacheExtra = marketplace === "csfloat" ? String(skin.floatValue ?? "") : "";
      const hashName = toMarketHashName(skin.name, skin.wear, skin.souvenir);

      if (force) {
        invalidateQuote(hashName, marketplace, cacheExtra);
      } else {
        const hit = await readQuoteCache(hashName, marketplace, cacheExtra);
        if (hit && !(withCount && !hit.depthChecked)) {
          return {
            priceEur: hit.priceEur,
            status: hit.priceEur === null ? "no_listings" : "ok",
            cached: true,
            exactFloatMatch: hit.exactFloatMatch,
            listingCount: hit.listingCount,
            volume24h: hit.volume24h,
          };
        }
      }

      try {
        let outcome: LivePriceOutcome;

        if (marketplace === "csfloat") {
          const result = await paced(marketplace, () =>
            cf.mutateAsync({
              name: skin.name,
              wear: skin.wear,
              souvenir: skin.souvenir,
              paintIndex: skin.paintIndex,
              phase: skin.phase,
              floatValue: skin.floatValue,
              withCount,
            }),
          );
          outcome = {
            priceEur: result.priceEur,
            status: result.priceEur === null ? "no_listings" : "ok",
            cached: false,
            exactFloatMatch: result.exactFloatMatch,
            listingCount: result.listingCount,
          };
        } else if (marketplace === "marketcsgo") {
          const result = await mc.mutateAsync({
            name: skin.name,
            wear: skin.wear,
            souvenir: skin.souvenir,
            force,
          });
          outcome = {
            priceEur: result.priceEur,
            status: result.status,
            cached: result.cached,
            volume24h: result.volume24h,
          };
        } else if (marketplace === "skinport") {
          const result = await sp.mutateAsync({
            name: skin.name,
            wear: skin.wear,
            souvenir: skin.souvenir,
            phase: skin.phase,
            force,
          });
          outcome = {
            priceEur: result.priceEur,
            status: result.status,
            cached: result.cached,
            listingCount: result.listingCount,
          };
        } else {
          const result = await st.mutateAsync({
            name: skin.name,
            wear: skin.wear,
            souvenir: skin.souvenir,
            phase: skin.phase,
            paintIndex: skin.paintIndex,
            force,
            withCount,
          });
          outcome = {
            priceEur: result.priceEur,
            // Steam's route distinguishes "no listings" from "we couldn't
            // ask" — pass that through untouched so the cache rule above
            // and the UI both get to see the difference.
            status: result.status,
            cached: result.cached,
            volume24h: result.volume24h,
            listingCount: result.listingCount,
          };
        }

        // Only a real answer is worth caching. A rate limit or an error is
        // a statement about the network, not about the item — caching it
        // would pin `n/a` on screen for the full TTL and make a transient
        // Steam hiccup look like a permanent "this item has no listings".
        if (outcome.status === "ok" || outcome.status === "no_listings") {
          writeQuoteCache(
            hashName,
            marketplace,
            {
              priceEur: outcome.priceEur,
              listingCount: outcome.listingCount,
              volume24h: outcome.volume24h,
              depthChecked: withCount,
              exactFloatMatch: outcome.exactFloatMatch,
            },
            cacheExtra,
          );
        }

        return outcome;
      } catch (err) {
        // Never throws: a market being down must not abort a bulk pass.
        console.warn(`[livePrice] ${marketplace} lookup failed for "${skin.name}":`, err);
        return { priceEur: null, status: "error", cached: false };
      }
    },
    [],
  );

  return { fetchFor, isPending };
}
