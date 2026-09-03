import { useCallback, useMemo } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  availableWearsFor,
  floatBoundsFor,
  isWearless,
  requiresWear,
  slugifyWear,
  wearRange,
  WEARS,
  type Wear,
} from "@/lib/wear";

// Re-exported so callers keep importing wear helpers from the module that
// owns the page's state. The rules themselves live in `wear.ts`, which has
// no React dependency and can therefore be tested on its own.
export { availableWearsFor, floatBoundsFor, isWearless, requiresWear, slugifyWear, wearRange };
import type { CatalogItem } from "@/lib/catalog/types";
import { stripPhaseSuffix } from "@/lib/catalog/doppler";

export type ItemVariant = "normal" | "stattrak" | "souvenir";

export interface ItemPageState {
  variant: ItemVariant;
  wear: Wear | null;
  setVariant: (v: ItemVariant) => void;
  setWear: (w: Wear) => void;
  /** The exact market_hash_name to price, for the current variant + wear. */
  marketHashName: string;
  /** Wear levels this skin can actually exist in. */
  availableWears: Wear[];
}

/**
 * Page state lives in the URL rather than a context.
 *
 * Variant and wear change which market_hash_name we price, so they define
 * what the page IS — keeping them in the URL makes a link shareable, the
 * back button meaningful, and makes it impossible for two components to
 * disagree about which variant is on screen.
 */
export function useItemPageState(item: CatalogItem | undefined): ItemPageState {
  const navigate = useNavigate();
  // `strict: false` keeps this hook reusable from any route; the schema is
  // declared on the item route so the params actually survive parsing.
  const search = useSearch({ strict: false }) as { variant?: string; wear?: string };

  const availableWears = useMemo(() => (item ? availableWearsFor(item) : []), [item]);

  const variant: ItemVariant =
    search.variant === "stattrak" || search.variant === "souvenir" ? search.variant : "normal";

  const wear = useMemo<Wear | null>(() => {
    const fromUrl = WEARS.find((w) => slugifyWear(w) === search.wear);
    // Whatever the user picked WINS. The previous version also required the
    // wear to appear in `availableWears` and silently substituted a
    // different exterior when it didn't — which is exactly how selecting
    // Factory New could end up opening Well-Worn on Steam. A wear that
    // genuinely doesn't exist just returns no price, which is honest.
    if (fromUrl) return fromUrl;
    return availableWears[0] ?? null;
  }, [search.wear, availableWears]);

  const setVariant = useCallback(
    (v: ItemVariant) => {
      void navigate({
        search: (prev: Record<string, unknown>) => ({ ...prev, variant: v }),
        replace: true,
      });
    },
    [navigate],
  );

  const setWear = useCallback(
    (w: Wear) => {
      void navigate({
        search: (prev: Record<string, unknown>) => ({ ...prev, wear: slugifyWear(w) }),
        replace: true,
      });
    },
    [navigate],
  );

  const marketHashName = useMemo(() => {
    if (!item) return "";
    // A skin without its exterior produces a name no marketplace resolves,
    // and Steam silently substitutes a different one. Better to emit
    // nothing than a name that sends the user to the wrong item.
    if (requiresWear(item) && !wear) return "";
    return buildMarketHashName(item, variant, wear);
  }, [item, variant, wear]);

  return { variant, wear, setVariant, setWear, marketHashName, availableWears };
}

/**
 * Assembles the name a marketplace actually indexes.
 *
 * The catalog's display name carries our own additions — a "(Ruby)" phase
 * suffix and, for the StatTrak/Souvenir catalog entries, a prefix. Those
 * have to be stripped back off and rebuilt from the chosen variant,
 * otherwise a StatTrak entry viewed in Souvenir mode would produce a
 * nonsense name like "Souvenir StatTrak™ ...".
 */
export function buildMarketHashName(
  item: CatalogItem,
  variant: ItemVariant,
  wear: Wear | null,
): string {
  // Upstream publishes the real market_hash_name for stickers, agents,
  // music kits and the rest. For those there is nothing to derive — no
  // wear to append, no StatTrak™ or Souvenir prefix to reassemble — so the
  // authoritative string wins outright over anything we could rebuild from
  // a display name.
  if (isWearless(item) && item.marketHashName) return item.marketHashName;

  let base = stripPhaseSuffix(item.name);
  base = base.replace(/^StatTrak™\s+/, "").replace(/^Souvenir\s+/, "");

  if (variant === "stattrak") base = `StatTrak™ ${base}`;
  else if (variant === "souvenir") base = `Souvenir ${base}`;

  return wear ? `${base} (${wear})` : base;
}
