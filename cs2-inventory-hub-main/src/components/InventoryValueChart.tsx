import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useI18n } from "@/lib/i18n";
import {
  sumHoldingsValue,
  sumPortfolioValue,
  sumSaleProceeds,
  sumTotalPaid,
  useMoney,
  type Skin,
} from "@/lib/skins";
import { useMarketplace } from "@/lib/marketplace";
import { usePortfolio } from "@/lib/portfolio";
import { readHistory, recordSnapshot, synthesizeBackfill, type ValuePoint } from "@/lib/history";
import { cn } from "@/lib/utils";

type TimeframeId = "7d" | "30d" | "90d" | "150d" | "1y" | "5y" | "all";

const TIMEFRAMES: { id: TimeframeId; label: string; days: number | null }[] = [
  { id: "7d", label: "7D", days: 7 },
  { id: "30d", label: "30D", days: 30 },
  { id: "90d", label: "90D", days: 90 },
  { id: "150d", label: "150D", days: 150 },
  { id: "1y", label: "1Y", days: 365 },
  { id: "5y", label: "5Y", days: 365 * 5 },
  { id: "all", label: "ALL", days: null },
];

const MIN_POINTS_FOR_ALL = 30;

function formatTick(dateStr: string, spanDays: number) {
  const d = new Date(dateStr);
  if (spanDays > 400) return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function InventoryValueChart({ skins }: { skins: Skin[] }) {
  const { t } = useI18n();
  const money = useMoney();
  const { marketplace, steamTaxPercent } = useMarketplace();
  const { activeId } = usePortfolio();
  const [timeframe, setTimeframe] = useState<TimeframeId>("30d");

  /**
   * The series plots PORTFOLIO value — holdings plus cash already banked
   * from sales — because a line that dropped every time something was sold
   * would show a crash where the user actually made money.
   *
   * The cost of that choice is that the number here is legitimately larger
   * than the market comparison below it, which counts holdings only. So the
   * two parts are spelled out in the header rather than left to be
   * discovered as an apparent bug.
   */
  const holdings = useMemo(
    () => sumHoldingsValue(skins, marketplace, steamTaxPercent),
    [skins, marketplace, steamTaxPercent],
  );
  const cash = useMemo(() => sumSaleProceeds(skins), [skins]);
  const currentValue = useMemo(
    () => sumPortfolioValue(skins, marketplace, steamTaxPercent),
    [skins, marketplace, steamTaxPercent],
  );

  // Record one snapshot per day (repeated calls just update today's point).
  useEffect(() => {
    recordSnapshot(marketplace, activeId, currentValue);
  }, [marketplace, activeId, currentValue]);

  const { data, isSynthetic } = useMemo(() => {
    const real = readHistory(marketplace, activeId);
    const today = new Date().toISOString().slice(0, 10);

    // Make sure "today" always reflects the live current value.
    const withToday = [...real];
    if (withToday.length > 0 && withToday[withToday.length - 1]!.date === today) {
      withToday[withToday.length - 1] = { date: today, value: currentValue };
    } else {
      withToday.push({ date: today, value: currentValue });
    }

    const tf = TIMEFRAMES.find((x) => x.id === timeframe)!;
    const targetDays = tf.days ?? Math.max(withToday.length, MIN_POINTS_FOR_ALL);
    const needed = targetDays - withToday.length;

    let full: ValuePoint[];
    let synthetic = false;
    if (needed > 0) {
      synthetic = true;
      const anchor = withToday[0]!;
      const backfill = synthesizeBackfill(needed, new Date(anchor.date), anchor.value);
      full = [...backfill, ...withToday];
    } else {
      full = withToday;
    }

    const sliced = tf.days ? full.slice(-tf.days) : full;
    return { data: sliced, isSynthetic: synthetic };
  }, [timeframe, currentValue, marketplace, activeId]);

  const spanDays = data.length;

  // Colour follows actual profit/loss against what was invested — NOT the
  // trend inside the visible window. A portfolio can rise over the last 30
  // days while still being deep underwater overall, and painting that green
  // would tell the user the opposite of the truth.
  const invested = sumTotalPaid(skins);
  const isUp = invested > 0 ? currentValue >= invested : true;

  return (
    <section className="panel p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            {t("valueHistory")}
          </h2>
          {cash > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground font-mono tabular-nums">
                {money(holdings)}
              </span>{" "}
              {t("holdingsShort")} +{" "}
              <span className="font-semibold text-foreground font-mono tabular-nums">
                {money(cash)}
              </span>{" "}
              {t("realisedCashShort")} ={" "}
              <span className="font-semibold text-foreground font-mono tabular-nums">
                {money(currentValue)}
              </span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-secondary/60 p-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.id}
              type="button"
              onClick={() => setTimeframe(tf.id)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
                timeframe === tf.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      <div className="h-56 w-full sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="inventoryValueGradient" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor={isUp ? "var(--profit)" : "var(--loss)"}
                  stopOpacity={0.35}
                />
                <stop
                  offset="100%"
                  stopColor={isUp ? "var(--profit)" : "var(--loss)"}
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.5} />
            <XAxis
              dataKey="date"
              tickFormatter={(v: string) => formatTick(v, spanDays)}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              hide
              domain={[
                (dataMin: number) => dataMin - Math.max(dataMin * 0.04, 1),
                (dataMax: number) => dataMax + Math.max(dataMax * 0.04, 1),
              ]}
            />
            <Tooltip
              cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const point = payload[0]!.payload as ValuePoint;
                return (
                  <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
                    <p className="text-muted-foreground">
                      {new Date(point.date).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                    <p className="mt-0.5 font-mono font-bold text-foreground">
                      {money(point.value)}
                    </p>
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={isUp ? "var(--profit)" : "var(--loss)"}
              strokeWidth={2}
              fill="url(#inventoryValueGradient)"
              isAnimationActive={true}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {isSynthetic && (
        <p className="mt-2 text-center text-[11px] text-muted-foreground/70">
          {t("sampleDataNote")}
        </p>
      )}
    </section>
  );
}
