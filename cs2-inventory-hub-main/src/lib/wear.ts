/**
 * Wear (exterior) domain rules.
 *
 * Deliberately free of React and of anything that reaches a browser API,
 * for one reason: this is the logic that decides whether an item HAS an
 * exterior at all, and that rule was silently wrong for every sticker in
 * the catalog until it could be tested in isolation. `itemPage.ts`, which
 * owns the router-bound hooks, re-exports everything here so no call site
 * had to move.
 */
import { WEARLESS_CATEGORIES, type CatalogItem } from "@/lib/catalog/types";
import { floatOverrideFor } from "@/lib/catalog/corrections";

export const WEARS = [
  "Factory New",
  "Minimal Wear",
  "Field-Tested",
  "Well-Worn",
  "Battle-Scarred",
] as const;

export type Wear = (typeof WEARS)[number];

/** Float boundaries Valve uses for each wear bucket. */
const WEAR_RANGES: Record<Wear, { min: number; max: number }> = {
  "Factory New": { min: 0, max: 0.07 },
  "Minimal Wear": { min: 0.07, max: 0.15 },
  "Field-Tested": { min: 0.15, max: 0.38 },
  "Well-Worn": { min: 0.38, max: 0.45 },
  "Battle-Scarred": { min: 0.45, max: 1 },
};

export function wearRange(wear: Wear) {
  return WEAR_RANGES[wear];
}

/**
 * True for item kinds that have no exterior: stickers, agents, cases,
 * music kits, patches, graffiti, keychains.
 *
 * Checks the KIND first and falls back to the category set, so an item
 * whose category label changes upstream is still classified correctly.
 */
export function isWearless(item: Pick<CatalogItem, "kind" | "category">): boolean {
  if (item.kind && item.kind !== "skin") return true;
  return !!item.category && WEARLESS_CATEGORIES.has(item.category);
}

/**
 * The float window this skin can actually occupy, after corrections.
 *
 * Returns the bounds the rest of the app should treat as authoritative —
 * never the raw upstream numbers, which are wrong for a handful of items
 * (see FLOAT_OVERRIDES).
 */
export function floatBoundsFor(item: Pick<CatalogItem, "name" | "minFloat" | "maxFloat">): {
  min: number;
  max: number;
} {
  const override = floatOverrideFor(item.name);
  return {
    min: override?.min ?? item.minFloat ?? 0,
    max: override?.max ?? item.maxFloat ?? 1,
  };
}

/**
 * Which wear levels this skin can genuinely have.
 *
 * A skin whose float range starts at 0.18 simply does not exist in Factory
 * New or Minimal Wear — rendering those rows with an empty price looks like
 * a bug, so we filter them out instead.
 */
export function availableWearsFor(
  item: Pick<CatalogItem, "name" | "minFloat" | "maxFloat" | "wears" | "kind" | "category">,
): Wear[] {
  // Wearless items have NO exterior, and the float-overlap fallback below
  // is exactly wrong for them: with no `wears` array and no float bounds it
  // defaults to 0..1, which overlaps every bucket and returns all five.
  // That is how stickers ended up offering "Field-Tested" — a condition a
  // sticker cannot have, on a name no market indexes.
  if (isWearless(item)) return [];

  const { min, max } = floatBoundsFor(item);

  const withinFloat = WEARS.filter((w) => {
    const range = WEAR_RANGES[w];
    // Overlap test — the buckets are half-open, so touching endpoints
    // (e.g. max exactly 0.07) must not count as a match.
    return min < range.max && max > range.min;
  });

  // Valve's per-skin `wears` list is AUTHORITATIVE when it exists. The
  // float window only derives the list when there is no declared one.
  //
  // An earlier version intersected the two and let the narrower win. That
  // is the wrong default: across all 3,719 catalog entries the two signals
  // already agree, so the intersection can only ever act on a float bound
  // this app has overridden by hand — and when one of those is wrong it
  // deletes a real exterior from the item page and the portfolio at once,
  // which is exactly what happened to Chatterbox's Field-Tested.
  if (!item.wears || item.wears.length === 0) return withinFloat;

  const declared = new Set(item.wears);
  return WEARS.filter((w) => declared.has(w));
}

/**
 * True when a marketplace name for this item must carry a wear suffix.
 *
 * Cases, stickers and agents have none; skins always do. Linking to a skin
 * without its wear gives a name no market can resolve, and Steam quietly
 * lands the user on some other exterior instead of erroring.
 */
export function requiresWear(item: Pick<CatalogItem, "wears" | "kind" | "category">): boolean {
  // Answered by the same predicate as availableWearsFor, so the two can
  // never disagree about whether an item has an exterior.
  if (isWearless(item)) return false;
  if (item.wears && item.wears.length > 0) return true;
  return item.kind === "skin";
}

export function slugifyWear(wear: Wear): string {
  return wear.toLowerCase().replace(/\s+/g, "-");
}
