import { Crown, Wallet, Gamepad2, ArrowUpRight, Tag } from "lucide-react";
import { MarketLogo } from "@/components/MarketLogo";
import { useI18n } from "@/lib/i18n";
import { useMoney } from "@/lib/skins";
import { useMarketplace } from "@/lib/marketplace";
import { feeBreakdown } from "@/lib/fees";
import type { MarketplaceId } from "@/lib/markets/types";
import { getMarket } from "@/lib/markets/registry";
import type { CatalogItem } from "@/lib/catalog/types";
import { buildMarketHashName, type ItemVariant } from "@/lib/itemPage";
import type { Wear } from "@/lib/skins";
import { cn } from "@/lib/utils";

export type TradeMode = "buying" | "selling";

export interface MarketQuote {
  market: MarketplaceId;
  lowestSell?: number | undefined;
  listingCount?: number | undefined;
  /** This market hasn't answered yet for the current selection. A row in
   *  this state renders as a skeleton — never as `n/a`, and never carrying
   *  the previous wear's number. */
  loading?: boolean | undefined;
}

/**
 * Market comparison, framed by what the user is trying to do.
 *
 *  - BUYING  → cheapest listing wins; prices shown gross, which is what a
 *              buyer hands over.
 *  - SELLING → highest NET wins; prices shown after each market's fee,
 *              which is what actually reaches the seller.
 *
 * The two are opposites and must never share one set of colours.
 *
 * Note the props: this takes the item, variant and wear rather than a
 * pre-built name string. Passing a ready-made `market_hash_name` through
 * several components is how a stale one slipped through and sent Steam
 * links to the wrong exterior — building it here from the current
 * selection makes that impossible.
 */
export function CashoutPanel({
  item,
  variant,
  wear,
  quotes,
  loading,
  mode,
  onModeChange,
}: {
  item: CatalogItem;
  variant: ItemVariant;
  wear: Wear | null;
  quotes: MarketQuote[];
  loading?: boolean;
  mode: TradeMode;
  onModeChange: (mode: TradeMode) => void;
}) {
  const { t } = useI18n();
  const money = useMoney();
  const { steamTaxPercent } = useMarketplace();
  const selling = mode === "selling";

  // Every marketplace link is derived from the live selection, right here.
  const hashName = buildMarketHashName(item, variant, wear);

  const rows = quotes.map((quote) => {
    const listed =
      quote.lowestSell !== undefined
        ? feeBreakdown(quote.lowestSell, quote.market, {
            sellerFeePercent: steamTaxPercent,
            sellerFeeMarket: "steam",
          })
        : undefined;
    const rank = listed ? (selling ? listed.net : listed.gross) : undefined;
    return { quote, listed, rank };
  });

  const anyPending = quotes.some((q) => q.loading);

  // Markets keep their registry order until every one has answered.
  // Re-sorting on each arrival would make rows jump under the cursor while
  // results stream in; one settle at the end is calmer and just as clear.
  const sorted = anyPending
    ? rows
    : [...rows].sort((a, b) => {
        if (a.rank === undefined) return 1;
        if (b.rank === undefined) return -1;
        return selling ? b.rank - a.rank : a.rank - b.rank;
      });

  const priced = rows.filter((r) => r.rank !== undefined);
  const ranked = [...priced].sort((a, b) => (selling ? b.rank! - a.rank! : a.rank! - b.rank!));
  // Crowning a winner before every market has reported would name the wrong
  // one and then silently change its mind.
  const bestMarket = anyPending ? undefined : ranked[0]?.quote.market;
  const worstMarket =
    !anyPending && ranked.length > 1 ? ranked[ranked.length - 1]?.quote.market : undefined;

  const bestCashMarket =
    selling && !anyPending
      ? [...priced].filter((r) => r.listed!.isCash).sort((a, b) => b.listed!.net - a.listed!.net)[0]
          ?.quote.market
      : undefined;

  // A running total across a half-loaded set is just a wrong number, so it
  // stays hidden until the last market lands.
  const totalListings = anyPending ? 0 : quotes.reduce((sum, q) => sum + (q.listingCount ?? 0), 0);

  return (
    <section className="panel overflow-hidden">
      {/* Terminal-style header: the mode switch IS the title. */}
      <header className="flex flex-wrap items-center gap-4 border-b border-white/5 px-5 py-4 sm:px-6">
        <div className="relative flex rounded-xl border border-white/10 bg-secondary/60 p-1 shadow-inner">
          <span
            aria-hidden="true"
            className={cn(
              "absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-lg transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
              selling
                ? "left-[calc(50%)] bg-emerald-400/20 shadow-[0_0_20px_-6px_theme(colors.emerald.400)]"
                : "left-1 bg-primary/20 shadow-[0_0_20px_-6px_var(--primary)]",
            )}
          />
          {(["buying", "selling"] as TradeMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onModeChange(m)}
              className={cn(
                "relative z-10 min-w-[6rem] rounded-lg px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors duration-200",
                mode === m
                  ? m === "selling"
                    ? "text-emerald-400"
                    : "text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "buying" ? t("modeBuying") : t("modeSelling")}
            </button>
          ))}
        </div>

        <div className="ml-auto text-right">
          {totalListings > 0 && (
            <span
              title={t("acrossAllMarketsHint")}
              className="inline-flex cursor-help items-center gap-1.5 text-muted-foreground"
            >
              <Tag className="h-4 w-4 opacity-60" />
              <span className="font-mono text-lg font-bold tabular-nums text-foreground">
                {totalListings.toLocaleString()}
              </span>
              <span className="text-xs uppercase tracking-wider">{t("listingsLabel")}</span>
            </span>
          )}
        </div>
      </header>

      <div key={mode} className="mode-swap divide-y divide-white/5">
        {sorted.map(({ quote, listed }) => {
          const adapter = getMarket(quote.market);
          const isBest = quote.market === bestMarket;
          const isWorst = quote.market === worstMarket;
          const isBestCash = quote.market === bestCashMarket;
          const isWallet = listed ? !listed.isCash : false;

          return (
            <a
              key={quote.market}
              href={hashName ? adapter?.itemUrl(hashName) : undefined}
              target="_blank"
              rel="noreferrer"
              title={hashName}
              className={cn(
                "group relative grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-6 px-5 py-4 transition-colors sm:px-6",
                isBest
                  ? "bg-emerald-400/[0.04] hover:bg-emerald-400/[0.08]"
                  : "hover:bg-white/[0.03]",
                !hashName && "pointer-events-none opacity-40",
              )}
            >
              {/* A hairline accent instead of a full coloured card. */}
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-y-0 left-0 w-0.5 transition-all",
                  isBest ? "bg-emerald-400" : isWorst ? "bg-red-500/50" : "bg-transparent",
                )}
              />

              <span className="flex min-w-0 items-center gap-3">
                <MarketLogo
                  market={quote.market}
                  label={adapter?.label}
                  className="h-6 w-6 text-[11px]"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 truncate text-sm font-semibold tracking-tight">
                    {adapter?.label}
                    {isBestCash && (
                      <Crown
                        className="h-3.5 w-3.5 shrink-0 text-emerald-400"
                        title={t("bestPayoutHint")}
                      />
                    )}
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
                  </span>
                  {listed && selling && (
                    <span className="mt-0.5 flex items-center gap-1.5 text-[11px] font-mono tabular-nums text-muted-foreground">
                      {money(listed.gross)}
                      <span className="text-muted-foreground/50">
                        −{(listed.appliedRate * 100).toFixed(0)}%
                      </span>
                      {isWallet ? (
                        <span className="inline-flex items-center gap-0.5 text-amber-400/90">
                          <Gamepad2 className="h-2.5 w-2.5" />
                          {t("walletOnly")}
                        </span>
                      ) : (
                        <Wallet className="h-2.5 w-2.5 text-emerald-400/60" />
                      )}
                    </span>
                  )}
                </span>
              </span>

              {/* Exact count or a plain N/A — never a symbol standing in
                  for a number we don't actually have. */}
              <span className="whitespace-nowrap text-right">
                {quote.loading ? (
                  <span className="ml-auto block h-4 w-16 animate-pulse rounded bg-secondary" />
                ) : quote.listingCount !== undefined ? (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Tag className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    <span className="text-sm font-semibold font-mono tabular-nums">
                      {quote.listingCount.toLocaleString()}
                    </span>
                    <span className="text-xs">{t("listingsLabel")}</span>
                  </span>
                ) : (
                  <span
                    className="text-xs text-muted-foreground/40"
                    title={t("listingsNotReported")}
                  >
                    {t("notAvailableShort")}
                  </span>
                )}
              </span>

              <span className="min-w-[6.5rem] text-right font-mono tabular-nums">
                {quote.loading ? (
                  <span className="ml-auto block h-6 w-20 animate-pulse rounded bg-secondary" />
                ) : listed ? (
                  <>
                    <span
                      className={cn(
                        "block font-mono text-xl font-bold leading-none tracking-tight",
                        isBest ? "text-emerald-400" : isWorst ? "text-red-400" : "text-foreground",
                      )}
                    >
                      {money(selling ? listed.net : listed.gross)}
                    </span>
                    {(isBest || isWorst) && (
                      <span
                        className={cn(
                          "mt-1 inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest",
                          isBest
                            ? "bg-emerald-400/10 text-emerald-400"
                            : "bg-red-500/10 text-red-400",
                        )}
                      >
                        {isBest ? t("bestDeal") : t("worstDeal")}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground/40">{t("notAvailableShort")}</span>
                )}
              </span>
            </a>
          );
        })}

        {/* Rows now always exist (one per market, skeleton until it
            answers), so this only covers a genuinely empty registry. */}
        {!loading && rows.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">{t("noListings")}</p>
        )}
      </div>

      {selling && (
        <p className="border-t border-white/5 px-5 py-3 text-[11px] leading-snug text-muted-foreground/60 sm:px-6">
          {t("payoutFeeNote")}
        </p>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  tone?: string;
}) {
  return (
    <span className="flex flex-col items-end leading-none" title={hint}>
      <span className={cn("font-mono text-base font-bold tabular-nums", tone)}>{value}</span>
      <span className="mt-1 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60">
        {icon}
        {label}
      </span>
    </span>
  );
}
