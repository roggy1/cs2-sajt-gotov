import type { MarketAdapter, MarketplaceId } from "./types";

/**
 * The market registry.
 *
 * Adding a marketplace = adding one entry here. Fee maths, the comparison
 * panel, the inventory table and the item page all read from this, so no
 * other file needs to change.
 *
 * Fee rates are dated on purpose. They move: Skinport cut its seller fee
 * from 12% to 8% in July 2025, and anything hardcoded would have quietly
 * mispriced every portfolio for months. `verifiedAt` lets the UI flag a
 * config that has gone stale instead of trusting it forever.
 */
export const MARKET_ADAPTERS: MarketAdapter[] = [
  {
    id: "steam",
    label: "Steam",
    logo: "steam",
    enabled: true,
    scope: "all",
    /**
     * Steam market SEARCH, not the per-exterior listing page.
     *
     * Steam does have one canonical page per exterior, but in practice
     * linking straight to it kept landing users on a different wear than
     * the one they had selected — repeatedly, across several attempts to
     * pin down the encoding. Rather than keep shipping a link that lies
     * about where it goes, we send the user to Steam's own search for the
     * exact name (wear and StatTrak™ included). Search never redirects, so
     * what opens always matches what was clicked, and the right item is the
     * first result.
     */
    itemUrl: (name) =>
      `https://steamcommunity.com/market/search?appid=730&q=${encodeURIComponent(name)}`,
    fees: {
      // 5% Steam + 10% CS2 publisher. Charged ON TOP of what the seller
      // receives, so the listed price already includes it — hence
      // `inclusive`, and net = gross / 1.15 (≈87%), not gross * 0.85 (85%).
      sellerFee: 0.15,
      mode: "inclusive",
      // Steam pays into the Steam Wallet only — this money can buy games,
      // but it can never be withdrawn. Treating it as cash is the single
      // biggest way a "max cashout" figure ends up lying to the user.
      cashOut: "wallet_only",
      userAdjustable: true,
      verifiedAt: "2026-08-29",
      sourceUrl: "https://help.steampowered.com/en/faqs/view/61F0-74F7-1DA5-1C1B",
    },
    capabilities: {
      instantSell: false,
      // `total_count` off the listings render endpoint, with the search
      // endpoint's `sell_listings` as a fallback when that one is throttled.
      listingCount: true,
      volume24h: true, // priceoverview returns 24h `volume`
      phaseAware: false, // one market_hash_name covers every Doppler phase
      // Still the most rate-limited of the three, so screens that need many
      // prices at once should stick to the other two — but the server-side
      // limiter is adaptive now rather than a flat multi-second gap, so
      // this is a preference, not the hard ceiling it used to be.
      bulkFriendly: false,
    },
  },
  {
    id: "skinport",
    label: "Skinport",
    logo: "skinport",
    enabled: true,
    scope: "all",
    /**
     * Skinport's own API hands back `market_page` in the form
     * `/market?item=<name>&cat=<category>`, but the name it uses there has
     * the exterior split out into a separate filter. Their slugs aren't
     * derivable from a market_hash_name either, so the reliable route is a
     * plain text search on the full name — wear included — which lands on
     * the right item instead of an unfiltered market page.
     */
    itemUrl: (name) => `https://skinport.com/market?search=${encodeURIComponent(name)}`,
    fees: {
      // Cut from 12% to 8% in July 2025. 2% applies to private listings,
      // which we don't model since the app tracks public market value.
      sellerFee: 0.08,
      mode: "exclusive",
      tiers: [{ minValue: 1000, sellerFee: 0.06 }],
      payoutFee: {
        min: 0,
        max: 0,
        note: "SEPA bank transfer, no Skinport payout fee (KYC required).",
      },
      cashOut: "fiat",
      verifiedAt: "2026-08-29",
      sourceUrl: "https://skinport.com/faq",
    },
    capabilities: {
      instantSell: false, // no bot instant-sell; items must be listed
      listingCount: true, // /v1/items returns `quantity`
      volume24h: false,
      phaseAware: true, // phase lives in the separate `version` field
      bulkFriendly: true, // whole catalogue is held in server memory
    },
  },
  {
    id: "marketcsgo",
    label: "Market.CSGO",
    logo: "marketcsgo",
    enabled: true,
    scope: "inspect",
    itemUrl: (name) => `https://market.csgo.com/en/?search=${encodeURIComponent(name)}`,
    fees: {
      // NOT VERIFIED. Their FAQ does not state the seller commission in a
      // page this app could read, so 5% is the widely-cited figure rather
      // than a confirmed one. Correct this the moment someone can cite the
      // real number — and until then it is at least this market's OWN
      // figure rather than a borrowed one.
      sellerFee: 0.05,
      mode: "exclusive",
      cashOut: "fiat",
      // NOT user-adjustable. The app's single fee input holds STEAM's rate;
      // flagging a second market as adjustable made this row quietly
      // reprice itself at 15% instead of its own configured rate.
      userAdjustable: false,
      verifiedAt: "2026-09-02",
      sourceUrl: "https://market.csgo.com/en/faq",
    },
    capabilities: {
      instantSell: false,
      // Their price feed carries 24h SALES VOLUME, not a count of live
      // offers. Reporting it as a listing count would state a number the
      // market never published.
      listingCount: false,
      volume24h: true,
      phaseAware: false,
      bulkFriendly: true, // whole catalogue held in server memory
    },
  },
  {
    id: "csfloat",
    label: "CSFloat",
    logo: "csfloat",
    enabled: true,
    scope: "all",
    itemUrl: (name) =>
      `https://csfloat.com/search?market_hash_name=${encodeURIComponent(name)}&sort_by=lowest_price`,
    fees: {
      sellerFee: 0.02,
      mode: "exclusive",
      payoutFee: {
        min: 0.005,
        max: 0.025,
        note: "Bank (Stripe) or USDC payout, 0.5–2.5% depending on method.",
      },
      cashOut: "fiat",
      verifiedAt: "2026-08-29",
      sourceUrl: "https://docs.csfloat.com/",
    },
    capabilities: {
      instantSell: true,
      listingCount: true,
      volume24h: false,
      phaseAware: true, // paint_index filtering
      bulkFriendly: true, // per-item call, but unthrottled
    },
  },
];

/**
 * Every enabled market — the full set the Inspect page compares across.
 */
export const INSPECT_MARKETS: MarketAdapter[] = MARKET_ADAPTERS.filter((m) => m.enabled);

/**
 * The markets the PORTFOLIO knows about.
 *
 * Narrower than `INSPECT_MARKETS` on purpose. A market listed here gets a
 * stored price on every holding, a column in the inventory table and a slot
 * in the comparison panel, so research-only markets stay out of it and
 * appear on the Inspect page alone.
 */
export const MARKETS: MarketAdapter[] = INSPECT_MARKETS.filter((m) => m.scope === "all");

const BY_ID = new Map(MARKET_ADAPTERS.map((m) => [m.id, m]));

export function getMarket(id: MarketplaceId): MarketAdapter | undefined {
  return BY_ID.get(id);
}

/** Markets whose balance can actually be withdrawn as real money. */
export const FIAT_MARKETS = MARKETS.filter((m) => m.fees.cashOut === "fiat");
