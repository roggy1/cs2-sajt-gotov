import { useState } from "react";
import type { MarketplaceId } from "@/lib/marketplace";
import { getMarket } from "@/lib/markets/registry";
import { cn } from "@/lib/utils";

/**
 * Renders the official brand logo for a marketplace.
 *
 * The file comes from the adapter's own `logo` field, extension included,
 * so exactly one request is made for a file that is known to exist:
 *
 *   public/market-logos/steam.png
 *   public/market-logos/skinport.png
 *   public/market-logos/csfloat.png
 *   public/market-logos/marketcsgo.png
 *
 * Everything under `public/` is served from the site ROOT, so
 * `public/market-logos/steam.png` is fetched as `/market-logos/steam.png` —
 * the `public` segment never appears in the URL. To switch a brand to a
 * vector, drop `steam.svg` in beside it and change the adapter's `logo` to
 * "steam.svg"; no component change, no guessing, and no 404 either way.
 *
 * If the file is genuinely missing the component still renders NOTHING that
 * could be mistaken for a brand mark — inventing a logo for a real company
 * is not something this app should do. It falls back to a plain initial in
 * a muted tile: unmistakably a placeholder, and it keeps the market rows
 * aligned instead of leaving one row's text hanging where every other row
 * has an icon.
 */
export function MarketLogo({
  market,
  label,
  className,
}: {
  market: MarketplaceId;
  /** Used for the placeholder initial when the brand asset is missing. */
  label?: string | undefined;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  const file = getMarket(market)?.logo;

  if (!file || failed) {
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
      src={`/market-logos/${file}`}
      alt=""
      aria-hidden="true"
      onError={() => setFailed(true)}
      className={cn("h-4 w-4 shrink-0 object-contain", className)}
    />
  );
}
