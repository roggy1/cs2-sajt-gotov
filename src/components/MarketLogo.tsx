import { useState } from "react";
import type { MarketplaceId } from "@/lib/marketplace";
import { getMarket } from "@/lib/markets/registry";
import { cn } from "@/lib/utils";

/**
 * Renders the official brand logo for a marketplace.
 *
 * The file is resolved from the adapter's own `logo` field (falling back to
 * the market id), so the registry stays the single place that decides which
 * asset a market uses:
 *
 *   public/market-logos/steam.png
 *   public/market-logos/skinport.png
 *   public/market-logos/csfloat.png
 *   public/market-logos/marketcsgo.png
 *
 * `.svg` is tried first and `.png` is the fallback, so upgrading one brand
 * mark to a vector is a matter of dropping the file in — no code change.
 *
 * When neither file is installed the component still renders NOTHING that
 * could be mistaken for a brand mark — inventing a logo for a real company
 * is not something this app should do. It falls back to a plain initial in
 * a muted tile: unmistakably a placeholder, and it keeps the market rows
 * aligned instead of leaving one row's text hanging where every other row
 * has an icon. Drop in the real asset and it disappears on its own.
 */
export function MarketLogo({
  market,
  label,
  className,
}: {
  market: MarketplaceId;
  /** Used for the placeholder initial when no brand asset is installed. */
  label?: string | undefined;
  className?: string;
}) {
  const [srcIndex, setSrcIndex] = useState(0);

  const file = getMarket(market)?.logo ?? market;
  const sources = [`/market-logos/${file}.svg`, `/market-logos/${file}.png`];
  const src = sources[srcIndex];

  if (!src) {
    const initial = (label ?? market).trim().charAt(0).toUpperCase();
    return (
      <span
        aria-hidden="true"
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px]",
          "bg-muted/70 text-[9px] font-bold leading-none text-muted-foreground",
          className,
        )}
      >
        {initial}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      onError={() => setSrcIndex((i) => i + 1)}
      className={cn("h-4 w-4 shrink-0 object-contain", className)}
    />
  );
}
