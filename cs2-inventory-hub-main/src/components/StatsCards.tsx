import { useState } from "react";
import {
  CircleDollarSign,
  Layers,
  Minus,
  PackageCheck,
  Pencil,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import {
  useMoney,
  sumHoldingsValue,
  sumPortfolioValue,
  sumSaleProceeds,
  sumTotalPaid,
  sumRealizedPnL,
  countOwnedUnits,
  type Skin,
} from "@/lib/skins";
import { useMarketplace } from "@/lib/marketplace";
import { Button } from "@/components/ui/button";
import { SoldItemsDialog } from "@/components/SoldItemsDialog";
import { cn } from "@/lib/utils";

export function StatsCards({
  skins,
  onSkinsChange,
}: {
  skins: Skin[];
  /**
   * Lets the realised-result card edit the sales behind its own figure.
   * Optional: without it the card still reports, it just cannot be opened —
   * so a read-only mounting of this component stays possible.
   */
  onSkinsChange?: (next: (prev: Skin[]) => Skin[]) => void;
}) {
  const { t } = useI18n();
  const [editingSales, setEditingSales] = useState(false);
  const money = useMoney();
  const { marketplace, steamTaxPercent } = useMarketplace();
  /**
   * Two different numbers, and keeping them apart is the point.
   *
   * `holdings` is what the owned items are worth on the active market —
   * the same figure the market comparison and the table show. `total` adds
   * the cash from past sales, which is the honest basis for profit but is
   * NOT inventory: showing it under a heading that says "inventory value"
   * is what made this card read €1452 while the CSFloat row said €680.
   */
  const holdings = sumHoldingsValue(skins, marketplace, steamTaxPercent);
  const cash = sumSaleProceeds(skins);
  const total = sumPortfolioValue(skins, marketplace, steamTaxPercent);
  const value = total;
  const invested = sumTotalPaid(skins);
  const ownedUnits = countOwnedUnits(skins);
  // Sale proceeds are already inside `value` and the original cost is
  // already inside `invested`, so this one subtraction covers realised and
  // unrealised results together — no separate term, no double counting.
  const net = value - invested;
  const pct = invested > 0 ? (net / invested) * 100 : 0;
  // Closed positions. These used to sit as a grey footnote under the table,
  // where a user had to scroll past every holding to find out what their
  // selling had actually earned them — so they live up here now instead.
  const soldCount = skins.filter((s) => s.sold).length;
  const realized = sumRealizedPnL(skins);
  const realizedUp = realized >= 0;
  const realizedNeutral = Number(realized.toFixed(2)) === 0;
  const realizedColorClass = realizedNeutral
    ? "text-muted-foreground"
    : realizedUp
      ? "text-profit"
      : "text-loss";
  const up = net >= 0;
  // Compare on the rounded/displayed value so a tiny non-zero pct that still
  // rounds to "0.00%" is treated as neutral too, instead of misleadingly green/red.
  const isNeutral = Number(pct.toFixed(2)) === 0;

  const cards = [
    {
      label: t("totalValue"),
      value: money(holdings),
      icon: Wallet,
      // With sales in the portfolio the ROI belongs to the total, not to
      // the holdings shown above it — so say where the rest of the money
      // is instead of pinning a percentage to the wrong number.
      sub:
        cash > 0
          ? `+ ${money(cash)} ${t("realisedCashShort")} = ${money(total)}`
          : `${t("avgReturn")}: ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
      subClass:
        cash > 0
          ? "text-muted-foreground font-semibold"
          : isNeutral
            ? "text-muted-foreground font-semibold"
            : up
              ? "text-profit font-semibold"
              : "text-loss font-semibold",
    },
    {
      label: t("invested"),
      value: money(invested),
      icon: CircleDollarSign,
      // Every record ever bought, sold ones included — that is what the
      // money was actually spent on.
      sub: `${skins.length} ${t("items")}`,
    },
    // Only what is still OWNED. Counting sold holdings here made this card
    // disagree with the table underneath it, which shows open positions.
    { label: t("itemCount"), value: String(ownedUnits), icon: Layers, sub: t("items") },
  ];

  const netColorClass = isNeutral ? "text-muted-foreground" : up ? "text-profit" : "text-loss";

  return (
    <div
      className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-4", soldCount > 0 && "xl:grid-cols-5")}
    >
      {cards.slice(0, 2).map((c) => (
        <StatCard key={c.label} {...c} />
      ))}

      <div className="panel stat-accent p-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t("netResult")}
          </p>
          {isNeutral ? (
            <Minus className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
          ) : up ? (
            <TrendingUp className="icon-glow h-5 w-5 text-profit" strokeWidth={1.5} />
          ) : (
            <TrendingDown className="icon-glow h-5 w-5 text-loss" strokeWidth={1.5} />
          )}
        </div>
        <p className={cn("mt-3 font-mono text-3xl font-bold", netColorClass)}>
          {up && !isNeutral ? "+" : ""}
          {money(net)}
        </p>
        <p className={cn("mt-1 font-mono text-sm font-semibold", netColorClass)}>
          {pct >= 0 && !isNeutral ? "+" : ""}
          {pct.toFixed(2)}%
        </p>
      </div>

      <StatCard {...cards[2]!} />

      {soldCount > 0 && (
        <div className="panel stat-accent p-5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {t("realizedResult")}
            </p>
            <span className="flex items-center gap-1">
              {/* The only way into the sales behind this number. Sits on
                  the card that reports them, because that is where a wrong
                  figure is noticed. */}
              {onSkinsChange && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  aria-label={t("editSales")}
                  title={t("editSales")}
                  onClick={() => setEditingSales(true)}
                >
                  <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              )}
              <PackageCheck
                className={cn(
                  "icon-glow h-5 w-5",
                  realizedNeutral ? "text-primary" : realizedColorClass,
                )}
                strokeWidth={1.5}
              />
            </span>
          </div>
          <p className={cn("mt-3 font-mono text-3xl font-bold", realizedColorClass)}>
            {realizedUp && !realizedNeutral ? "+" : ""}
            {money(realized)}
          </p>
          <p className="mt-1 text-sm font-semibold text-muted-foreground">
            {t("soldCountLabel").replace("{count}", String(soldCount))}
          </p>
        </div>
      )}

      {onSkinsChange && (
        <SoldItemsDialog
          skins={skins}
          open={editingSales}
          onOpenChange={setEditingSales}
          onChange={onSkinsChange}
        />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  sub,
  subClass,
}: {
  label: string;
  value: string;
  icon: typeof Wallet;
  sub: string;
  subClass?: string;
}) {
  return (
    <div className="panel stat-accent p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
        <Icon className="icon-glow h-5 w-5 text-primary" strokeWidth={1.5} />
      </div>
      <p className="mt-3 font-mono text-3xl font-bold">{value}</p>
      <p className={cn("mt-1 text-sm text-muted-foreground", subClass)}>{sub}</p>
    </div>
  );
}
