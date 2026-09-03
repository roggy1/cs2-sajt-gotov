import { getMarket } from "@/lib/markets/registry";
import type { MarketFeeModel, MarketplaceId } from "@/lib/markets/types";

export interface FeeBreakdown {
  /** Price as quoted by the marketplace. */
  gross: number;
  /** Rate actually applied, after tiers and any user override. */
  appliedRate: number;
  /** Money the marketplace keeps on the sale. */
  saleFee: number;
  /** What the seller is credited, before withdrawing. */
  net: number;
  /**
   * Withdrawal cost as a range, NOT subtracted from `net` — it depends on
   * the payout method, so folding one number in would misstate the total.
   * Shown separately in the UI.
   */
  payoutFee?: { min: number; max: number; note: string };
  /** False when the balance can't leave the platform (Steam Wallet). */
  isCash: boolean;
}

export interface FeeOptions {
  /**
   * Overrides the base rate for ONE market — the one the user is editing.
   *
   * Must be accompanied by `sellerFeeMarket`. Without it the override is
   * ignored, which is deliberate: the app has a single fee input, holding
   * Steam's rate, and callers pass it down on every market's row. If the
   * override applied to whichever market merely happened to be flagged
   * `userAdjustable`, adding a second such market would silently reprice
   * it at Steam's rate — a wrong number, shown with no visible cause.
   */
  sellerFeePercent?: number;
  /** The market `sellerFeePercent` belongs to. */
  sellerFeeMarket?: MarketplaceId;
}

/** Rate for a given sale value, honouring volume tiers and any override. */
export function resolveRate(
  fees: MarketFeeModel,
  gross: number,
  options?: FeeOptions,
  marketId?: MarketplaceId,
): number {
  const overrideApplies =
    fees.userAdjustable &&
    typeof options?.sellerFeePercent === "number" &&
    options.sellerFeeMarket !== undefined &&
    options.sellerFeeMarket === marketId;
  if (overrideApplies) {
    return options.sellerFeePercent! / 100;
  }
  // Highest matching threshold wins (Skinport: 6% once past €1000).
  const tier = [...(fees.tiers ?? [])]
    .sort((a, b) => b.minValue - a.minValue)
    .find((t) => gross >= t.minValue);
  return tier?.sellerFee ?? fees.sellerFee;
}

/**
 * What the seller actually receives for a sale at `gross`.
 *
 * The `inclusive` vs `exclusive` distinction is the whole point of this
 * function: Steam's fee is already baked into the price you see, so it has
 * to be divided out, while Skinport and CSFloat quote the buyer's price and
 * take their cut off the top.
 */
export function netProceeds(gross: number, marketId: MarketplaceId, options?: FeeOptions): number {
  const market = getMarket(marketId);
  if (!market || !Number.isFinite(gross)) return gross;

  const rate = resolveRate(market.fees, gross, options, marketId);
  return market.fees.mode === "inclusive" ? gross / (1 + rate) : gross * (1 - rate);
}

/** Full itemised view, for the item page's fee calculator. */
export function feeBreakdown(
  gross: number,
  marketId: MarketplaceId,
  options?: FeeOptions,
): FeeBreakdown {
  const market = getMarket(marketId);
  if (!market) {
    return { gross, appliedRate: 0, saleFee: 0, net: gross, isCash: true };
  }

  const appliedRate = resolveRate(market.fees, gross, options, marketId);
  const net = netProceeds(gross, marketId, options);

  return {
    gross,
    appliedRate,
    saleFee: gross - net,
    net,
    payoutFee: market.fees.payoutFee,
    isCash: market.fees.cashOut === "fiat",
  };
}

/**
 * Fee configs rot. This lets the UI show a quiet "rate last checked X ago"
 * hint rather than presenting a possibly outdated number as fact.
 */
const STALE_AFTER_DAYS = 180;

export function isFeeStale(marketId: MarketplaceId, now: Date = new Date()): boolean {
  const market = getMarket(marketId);
  if (!market) return false;
  const verified = new Date(market.fees.verifiedAt);
  if (Number.isNaN(verified.getTime())) return true;
  const days = (now.getTime() - verified.getTime()) / 86_400_000;
  return days > STALE_AFTER_DAYS;
}
