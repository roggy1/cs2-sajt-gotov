/**
 * Market adapter contract.
 *
 * Everything the app needs to know about a marketplace lives in one object,
 * so adding DMarket / SkinBaron / White.Market later means writing a single
 * adapter — no touching fee maths, tables or comparison logic.
 */

export type MarketplaceId = "steam" | "skinport" | "csfloat" | "marketcsgo" | (string & {});

/**
 * How a marketplace's cut relates to the price we store.
 *
 * - `inclusive` — the quoted price ALREADY contains the fee (Steam). The
 *   seller receives `gross / (1 + rate)`, not `gross * (1 - rate)`. Getting
 *   this backwards is a ~2 percentage point error on every single item.
 * - `exclusive` — the quoted price is what the buyer pays and the fee comes
 *   off the seller's side: `gross * (1 - rate)`.
 */
export type FeeMode = "inclusive" | "exclusive";

/** Whether money can actually leave the platform. */
export type CashOutKind = "fiat" | "wallet_only";

export interface FeeTier {
  /** Applies once the gross sale value reaches this amount (EUR). */
  minValue: number;
  sellerFee: number;
}

export interface PayoutFeeRange {
  min: number;
  max: number;
  /** Shown to the user — explains why it's a range, not one number. */
  note: string;
}

export interface MarketFeeModel {
  /** Base seller cut as a fraction, e.g. 0.08 for 8%. */
  sellerFee: number;
  mode: FeeMode;
  /**
   * Higher-value sales sometimes get a lower rate (Skinport charges 6% over
   * €1000). Checked highest-threshold-first.
   */
  tiers?: FeeTier[];
  /**
   * Withdrawal cost. Deliberately a RANGE and deliberately NOT folded into
   * the net figure: it depends on the payout method the user picks, so
   * baking one number in would quietly misstate the total. Surfaced in the
   * UI as separate information instead.
   */
  payoutFee?: PayoutFeeRange;
  cashOut: CashOutKind;
  /** Whether the user can override the rate in the UI (Steam's toggle). */
  userAdjustable?: boolean;
  /** ISO date the rate was last checked — fees change (Skinport cut theirs
   * from 12% to 8% in July 2025) and a stale config silently misprices a
   * whole portfolio. */
  verifiedAt: string;
  sourceUrl: string;
}

export interface MarketCapabilities {
  /** Exposes a live "sell to us right now" price. */
  instantSell: boolean;
  /** Reports how many copies are currently listed. */
  listingCount: boolean;
  /** Reports units sold over the last 24h. */
  volume24h: boolean;
  /** Can price a specific Doppler phase rather than the cheapest one. */
  phaseAware: boolean;
  /**
   * Whether many lookups in a row are cheap.
   *
   * Steam is false: it is the only market with a real per-IP budget, so
   * its server route runs an adaptive limiter that slows down when Steam
   * pushes back. Asking it for every wear x every market would spend that
   * budget on a browsing aid. Screens that need a lot of prices at once
   * should query only bulk-friendly markets and leave Steam for the single
   * item actually in focus.
   */
  bulkFriendly: boolean;
}

export interface MarketAdapter {
  id: MarketplaceId;
  label: string;
  fees: MarketFeeModel;
  capabilities: MarketCapabilities;
  /** File in public/market-logos/, without extension. */
  logo: string;
  /**
   * Builds a link straight to this item on the marketplace.
   *
   * Lives on the adapter so each market owns its own URL shape — adding a
   * marketplace never means editing the UI that renders the links.
   */
  itemUrl: (marketHashName: string) => string;
  /** Set false to keep an adapter in the codebase but out of the UI. */
  enabled: boolean;
  /**
   * Which surfaces this market appears on.
   *
   * - `"all"` — the portfolio too: it shows up in the market comparison,
   *   the inventory table's price columns and the active-market selector,
   *   which means every holding carries a stored price for it.
   * - `"inspect"` — the single-item Inspect page ONLY. Markets added for
   *   price *research* land here: the Inspect page fetches one item at a
   *   time on demand, so a market can be listed there without adding a
   *   per-holding price column, a stored field or a refresh cost to
   *   anyone's portfolio.
   *
   * The distinction is deliberate rather than cosmetic. Promoting a market
   * to `"all"` changes what gets persisted for every item a user owns, so
   * it is a decision to make explicitly, one market at a time.
   */
  scope: "all" | "inspect";
}
