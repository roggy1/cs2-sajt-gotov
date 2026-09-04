/**
 * Portfolio arithmetic.
 *
 * Deliberately free of React so it can be tested on its own — this is the
 * code that decides what the user's money is worth, and until it lived
 * here it could not be run outside a browser at all. `skins.ts` re-exports
 * every symbol, so no call site had to move.
 *
 * The vocabulary matters, because three different numbers were all being
 * called "value" and the difference is what made the dashboard look wrong:
 *
 *   HOLDINGS VALUE  — what the items you still own would fetch on one
 *                     market, net of that market's selling fee. This is the
 *                     number the market comparison shows and the number the
 *                     inventory table's column adds up to.
 *   REALISED CASH   — what already-sold holdings were sold FOR. Money you
 *                     have; not an item, and not tied to any market.
 *   PORTFOLIO VALUE — holdings value + realised cash. What the whole
 *                     position is worth, which is why selling something
 *                     does not make this number drop.
 *
 * Mixing the first and the third under one label is what produced a chart
 * reading €1452 next to a market total reading €680: both were right, they
 * were just answering different questions.
 */
import type { Wear } from "@/lib/wear";
import { netProceeds } from "@/lib/fees";
import type { MarketplaceId } from "@/lib/markets/types";

// Curated seed list for the category filter — ONLY the labels this app
// assigns itself (stickers, agents, cases...), so they can never collide
// with upstream naming. Weapon categories (Rifles, Pistols, Knives...) are
// intentionally NOT hardcoded here — they're merged in dynamically from the
// live catalog data at runtime, using Valve's own naming exactly as-is, so
// there's no risk of guessing wrong and creating duplicates like
// "Pistol" vs "Pistols".
export const CATEGORIES = [
  "Sticker",
  "Agent",
  "Case",
  "Music Kit",
  "Patch",
  "Graffiti",
  "Keychain",
] as const;
export type Category = string;

export type Skin = {
  id: string;
  name: string;
  category: Category;
  wear?: Wear | undefined;
  /** AVERAGE price paid PER UNIT (PriceEmpire model). Total invested is
   * quantity * buyPrice — see getTotalPaid. */
  buyPrice: number;
  /** Price on each marketplace the user has entered, in EUR. Missing entry
   * means "not tracked on that market yet", not zero. */
  marketPrices: Partial<Record<MarketplaceId, number>>;
  image?: string | undefined;
  /** Advanced/optional metadata — PriceEmpire-style extras. */
  floatValue?: number | undefined;
  paintSeed?: number | undefined;
  note?: string | undefined;
  /** Doppler/Gamma Doppler phase identifier, captured from the catalog when
   * the skin is selected — NOT the same as paintSeed (the 0-1000 pattern). */
  paintIndex?: string | undefined;
  /** Doppler/Gamma Doppler phase label, kept alongside paintIndex so live
   * price lookups can verify they got the right phase back. */
  phase?: string | undefined;
  stattrak?: boolean | undefined;
  souvenir?: boolean | undefined;
  /** How many copies of this item are held. Market prices are always UNIT
   * prices, so total value must be quantity * unit price. Defaults to 1 for
   * items saved before quantity existed. */
  quantity?: number | undefined;
  /** Steam asset id, present only on items pulled from a Steam inventory
   * import. Used to update in place on re-import instead of duplicating. */
  assetId?: string | undefined;
  /**
   * Set once the holding has been sold. It stays in the portfolio as a
   * historical record: excluded from current market value and from money
   * still invested, but its realised profit or loss keeps counting toward
   * the portfolio's overall result.
   */
  sold?:
    | {
        /** Price received PER UNIT, net of whatever the user actually got. */
        pricePerUnit: number;
        /** ISO date the sale happened. */
        date: string;
      }
    | undefined;
};

/** A holding that is still owned (i.e. not yet sold). */
export function isOpenPosition(skin: Skin): boolean {
  return !skin.sold;
}

/**
 * HARD INVARIANT: in CS2 an item is StatTrak™ OR Souvenir OR neither —
 * never both. This normalizes any holding to obey that, so the rule holds
 * even for data written by an older build or hand-edited storage.
 * StatTrak™ wins if somehow both are set, since it's the one carried in the
 * item's own name from the catalog.
 */
export function enforceStattrakSouvenirExclusivity(skin: Skin): Skin {
  const nameSaysStattrak = skin.name.startsWith("StatTrak™ ");
  const isStattrak = skin.stattrak === true || nameSaysStattrak;
  if (isStattrak && skin.souvenir) {
    return { ...skin, stattrak: true, souvenir: undefined };
  }
  return skin;
}

/** Quantity held, defaulting to 1 for items saved before quantity existed. */
export function getQuantity(skin: Skin): number {
  const q = skin.quantity;
  return typeof q === "number" && Number.isFinite(q) && q > 0 ? q : 1;
}

/**
 * Total amount invested in a holding. `buyPrice` is the AVERAGE PRICE PER
 * UNIT (PriceEmpire-style), so the money actually spent is qty * unit.
 * For the quantity-1 items that predate this, the two are identical.
 */
export function getTotalPaid(skin: Skin): number {
  return skin.buyPrice * getQuantity(skin);
}

/** Sum invested across all holdings. */
export function sumTotalPaid(skins: Skin[]): number {
  // Includes sold holdings on purpose: money spent is money spent, and
  // dropping it the moment something is sold would make a profitable sale
  // look like it shrank the portfolio.
  return skins.reduce((sum, s) => sum + getTotalPaid(s), 0);
}

/**
 * Cash received from sold holdings.
 *
 * Selling moves money from "holdings" to "cash" — it does not destroy it.
 * Counting proceeds alongside open positions is what keeps the value chart
 * flat through a sale instead of showing a phantom crash, and it makes
 * `value − invested` come out to the same number whether a position is
 * still open or already realised.
 */
export function sumSaleProceeds(skins: Skin[]): number {
  return skins.reduce((sum, s) => {
    if (!s.sold) return sum;
    return sum + s.sold.pricePerUnit * getQuantity(s);
  }, 0);
}

/**
 * HOLDINGS VALUE — what the items still owned would fetch on one market,
 * net of that market's selling fee.
 *
 * This is the headline "inventory value": it is the same figure the market
 * comparison shows and the same figure the inventory table's price column
 * adds up to, so those three can never disagree again.
 */
export function sumHoldingsValue(
  skins: Skin[],
  marketplace: MarketplaceId,
  steamTaxPercent: number,
): number {
  return sumEffectiveMarketValue(skins, marketplace, steamTaxPercent);
}

/**
 * PORTFOLIO VALUE — holdings value PLUS cash already banked from sales.
 *
 * Strictly larger than the holdings value as soon as anything has been
 * sold, and that gap is the single most confusing thing this dashboard can
 * show: a chart reading €1452 beside a market total reading €680 looks like
 * a bug even though both are correct. So this figure is only ever used
 * where the label says so — the value chart and the profit maths — never
 * under a heading that says "inventory".
 *
 * Note what the cash term is NOT: it is not market-specific. A sale
 * happened once, at one price, and the money is the same whichever market
 * is on screen — so switching market changes the holdings term only.
 */
export function sumPortfolioValue(
  skins: Skin[],
  marketplace: MarketplaceId,
  steamTaxPercent: number,
): number {
  return sumHoldingsValue(skins, marketplace, steamTaxPercent) + sumSaleProceeds(skins);
}

/**
 * Profit or loss already banked from sold holdings.
 *
 * Kept separate from unrealised value on purpose: a portfolio that is up
 * €200 on paper and has banked €50 is a different situation from one that
 * is up €250 on paper, and collapsing them hides that.
 */
export function sumRealizedPnL(skins: Skin[]): number {
  return skins.reduce((sum, s) => {
    if (!s.sold) return sum;
    return sum + (s.sold.pricePerUnit - s.buyPrice) * getQuantity(s);
  }, 0);
}

/** The price of a skin on a given marketplace, or undefined if not entered. */
export function getMarketPrice(skin: Skin, marketplace: MarketplaceId): number | undefined {
  return skin.marketPrices[marketplace];
}

/**
 * Same as getMarketPrice, but net of that marketplace's seller fee — i.e.
 * what the user would actually be credited, not the sticker price.
 *
 * Every market is now fee-aware (Steam 15% inclusive, Skinport 8% with a
 * 6% tier over €1000, CSFloat 2%), so this no longer special-cases Steam.
 * `steamTaxPercent` still flows through as the user's override for the one
 * market whose rate is adjustable in the UI.
 */
export function getEffectivePrice(
  skin: Skin,
  marketplace: MarketplaceId,
  steamTaxPercent: number,
): number | undefined {
  const raw = skin.marketPrices[marketplace];
  if (raw === undefined) return undefined;
  return netProceeds(raw, marketplace, {
    sellerFeePercent: steamTaxPercent,
    sellerFeeMarket: "steam",
  });
}

/** Total value of one holding: quantity * unit price (undefined if untracked). */
export function getPositionValue(
  skin: Skin,
  marketplace: MarketplaceId,
  steamTaxPercent: number,
): number | undefined {
  const unit = getEffectivePrice(skin, marketplace, steamTaxPercent);
  return unit === undefined ? undefined : unit * getQuantity(skin);
}

/** Sum of all holdings' unit prices * quantity (missing prices count as 0). */
export function sumMarketValue(skins: Skin[], marketplace: MarketplaceId): number {
  return skins
    .filter(isOpenPosition)
    .reduce((sum, s) => sum + (s.marketPrices[marketplace] ?? 0) * getQuantity(s), 0);
}

/** Tax-aware version of sumMarketValue — nets out the Steam fee when applicable. */
export function sumEffectiveMarketValue(
  skins: Skin[],
  marketplace: MarketplaceId,
  steamTaxPercent: number,
): number {
  return skins
    .filter(isOpenPosition)
    .reduce((sum, s) => sum + (getPositionValue(s, marketplace, steamTaxPercent) ?? 0), 0);
}

/**
 * How many OWNED skins have no price for a given marketplace.
 *
 * Sold holdings are excluded: they are history, they are not shown in the
 * table, and nothing would be gained by pricing them — counting them made
 * the "N skins have no price" footer accuse the user of gaps that were not
 * there.
 */
export function countMissingPrices(skins: Skin[], marketplace: MarketplaceId): number {
  return skins.filter((s) => isOpenPosition(s) && s.marketPrices[marketplace] === undefined).length;
}

/** How many holdings are still owned — what the inventory table shows. */
export function countOpenPositions(skins: Skin[]): number {
  return skins.filter(isOpenPosition).length;
}

/** Total units held (quantity-aware), for the "items" counters. */
export function countOwnedUnits(skins: Skin[]): number {
  return skins.filter(isOpenPosition).reduce((sum, s) => sum + getQuantity(s), 0);
}

export type WishItem = {
  id: string;
  name: string;
  targetPrice: number;
  marketPrice: number;
  category?: Category | undefined;
  image?: string | undefined;
  /**
   * Exterior the user is tracking. Optional because a wishlist entry can be
   * a case or a sticker, and because entries saved before this existed have
   * none — those simply open the Inspect page on its default wear.
   */
  wear?: Wear | undefined;
  /**
   * Catalog id captured when the item was picked from the item database.
   * Stored so the card can link straight to the right Inspect page instead
   * of re-deriving it from a name that the user may have typed by hand.
   */
  catalogId?: string | undefined;
};

/**
 * Migrates skins saved before the multi-marketplace feature (a single
 * `marketPrice: number`) into the new `marketPrices` shape, treating the old
 * value as the Steam Market price. No-op for already-migrated data.
 */
export function migrateSkins(raw: unknown): Skin[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    if (item && typeof item === "object" && !("marketPrices" in item) && "marketPrice" in item) {
      const legacy = item as { marketPrice: number } & Record<string, unknown>;
      const { marketPrice, ...rest } = legacy;
      return enforceStattrakSouvenirExclusivity({
        ...rest,
        marketPrices: { steam: marketPrice },
      } as unknown as Skin);
    }
    return enforceStattrakSouvenirExclusivity(item as Skin);
  });
}

/**
 * Every holding that has been sold, newest sale first.
 *
 * The portfolio keeps sold items as history rather than deleting them, but
 * nothing on screen listed them — so a mistyped sale price was permanent in
 * practice. This is what the sold-items editor reads.
 */
export function soldHoldings(skins: Skin[]): Skin[] {
  return skins
    .filter((s): s is Skin & { sold: NonNullable<Skin["sold"]> } => !!s.sold)
    .slice()
    .sort((a, b) => b.sold.date.localeCompare(a.sold.date));
}

/**
 * Corrects the price a holding was sold at, per unit.
 *
 * The sale DATE is deliberately preserved: fixing a typo in the amount is
 * not the same event as selling the item again, and rewriting the date
 * would silently move the sale in any history that reads it.
 */
export function updateSalePrice(skins: Skin[], id: string, pricePerUnit: number): Skin[] {
  if (!Number.isFinite(pricePerUnit) || pricePerUnit < 0) return skins;
  return skins.map((s) =>
    s.id === id && s.sold ? { ...s, sold: { ...s.sold, pricePerUnit } } : s,
  );
}

/**
 * Un-sells a holding: it goes back to being owned.
 *
 * Only the sale is dropped. Quantity, cost basis and every stored market
 * price stay exactly as they were, so an item reverted by mistake can be
 * sold again without re-entering anything.
 */
export function revertSale(skins: Skin[], id: string): Skin[] {
  return skins.map((s) => {
    if (s.id !== id || !s.sold) return s;
    const { sold, ...rest } = s;
    void sold;
    return rest;
  });
}

/**
 * Deletes a holding outright — the sale AND what was paid for it.
 *
 * Distinct from reverting: this is for a record that should never have
 * existed. It moves the invested total as well as the realised result,
 * which is why the UI asks twice before calling it.
 */
export function removeHolding(skins: Skin[], id: string): Skin[] {
  return skins.filter((s) => s.id !== id);
}
