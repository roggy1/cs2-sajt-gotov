import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { MarketplaceId } from "@/lib/markets/types";
import { getMarket as lookupMarket } from "@/lib/markets/registry";

// Both now come from the market registry — adding a marketplace means
// adding one adapter there, not editing this file.
export type { MarketplaceId } from "@/lib/markets/types";
export { MARKETS as MARKETPLACES, getMarket } from "@/lib/markets/registry";

// Steam Community Market's standard CS2 fee: 5% Steam + 10% publisher = 15%,
// stable since 2013. This is charged on top of what the seller receives, so
// a listing price shown when browsing already includes it — see
// `applySteamFee` below for the actual (division, not subtraction) math.
export const DEFAULT_STEAM_TAX_PERCENT = 15;

const MARKETPLACE_KEY = "cs2-marketplace";
const STEAM_TAX_KEY = "cs2-steam-tax-percent";

const MarketplaceCtx = createContext<{
  marketplace: MarketplaceId;
  setMarketplace: (m: MarketplaceId) => void;
  steamTaxPercent: number;
  setSteamTaxPercent: (n: number) => void;
}>({
  marketplace: "steam",
  setMarketplace: () => {},
  steamTaxPercent: DEFAULT_STEAM_TAX_PERCENT,
  setSteamTaxPercent: () => {},
});

export function MarketplaceProvider({ children }: { children: ReactNode }) {
  const [marketplace, setMarketplaceState] = useState<MarketplaceId>("steam");
  const [steamTaxPercent, setSteamTaxPercentState] = useState<number>(DEFAULT_STEAM_TAX_PERCENT);

  useEffect(() => {
    const savedMarket = localStorage.getItem(MARKETPLACE_KEY);
    if (savedMarket && lookupMarket(savedMarket)) {
      setMarketplaceState(savedMarket);
    }

    const savedTax = localStorage.getItem(STEAM_TAX_KEY);
    if (savedTax !== null) {
      const n = Number(savedTax);
      if (Number.isFinite(n) && n >= 0 && n < 100) setSteamTaxPercentState(n);
    }
  }, []);

  const setMarketplace = useCallback((m: MarketplaceId) => {
    setMarketplaceState(m);
    localStorage.setItem(MARKETPLACE_KEY, m);
  }, []);

  const setSteamTaxPercent = useCallback((n: number) => {
    setSteamTaxPercentState(n);
    localStorage.setItem(STEAM_TAX_KEY, String(n));
  }, []);

  const value = useMemo(
    () => ({ marketplace, setMarketplace, steamTaxPercent, setSteamTaxPercent }),
    [marketplace, setMarketplace, steamTaxPercent, setSteamTaxPercent],
  );
  return <MarketplaceCtx.Provider value={value}>{children}</MarketplaceCtx.Provider>;
}

export const useMarketplace = () => useContext(MarketplaceCtx);

/**
 * Steam's fee is added ON TOP of what the seller receives — the listing
 * price you see when browsing the market already includes it. So the net
 * amount a seller actually pockets is grossPrice / (1 + percent/100), NOT
 * grossPrice * (1 - percent/100). E.g. a $1.00 listing nets the seller
 * $1.00 / 1.15 ≈ $0.87, not $1.00 * 0.85 = $0.85.
 */
/** @deprecated Use `netProceeds` from "@/lib/fees" — it handles every
 * market, volume tiers and the inclusive/exclusive distinction. Kept as a
 * thin wrapper so existing imports keep working. */
export function applySteamFee(grossPrice: number, taxPercent: number): number {
  return grossPrice / (1 + taxPercent / 100);
}
