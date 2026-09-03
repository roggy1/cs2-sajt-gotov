import { History } from "lucide-react";
import { MarketLogo } from "@/components/MarketLogo";
import { useI18n } from "@/lib/i18n";
import { useMoney } from "@/lib/skins";
import { isEmptyWindow, useSalesHistory, type SalesWindow } from "@/lib/salesHistory";
import { cn } from "@/lib/utils";

/**
 * What copies of this exact item actually sold for on Skinport.
 *
 * Every other panel on this page shows an ASKING price — what someone
 * wants for it today. This is the only one showing a price somebody
 * actually paid, which is why the median is the headline figure and the
 * sale count sits right next to it: a €400 median off two sales is a very
 * different fact from the same median off two hundred.
 *
 * Free and key-less, but hard-limited upstream to 8 requests per 5 minutes
 * across the whole deployment, so this is a single-item, on-demand panel
 * and never a portfolio-wide lookup. When the budget runs out the panel
 * says so rather than showing a blank.
 */
export function SalesHistoryCard({ marketHashName }: { marketHashName: string }) {
  const { t } = useI18n();
  const money = useMoney();
  const { data, isLoading } = useSalesHistory(marketHashName);

  const history = data?.history ?? null;
  const rateLimited = data?.status === "rate_limited";

  const windows: { label: string; window: SalesWindow | undefined }[] = [
    { label: "24h", window: history?.last24h },
    { label: "7d", window: history?.last7d },
    { label: "30d", window: history?.last30d },
    { label: "90d", window: history?.last90d },
  ];

  return (
    <section className="panel p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <History className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-bold uppercase tracking-widest">{t("salesHistory")}</h2>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <MarketLogo market="skinport" className="h-3.5 w-3.5" />
          Skinport
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t("salesHistoryHint")}</p>

      {isLoading ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          {windows.map((w) => (
            <div key={w.label} className="h-20 animate-pulse rounded-lg bg-secondary/50" />
          ))}
        </div>
      ) : rateLimited ? (
        <p className="mt-4 text-xs italic text-muted-foreground">{t("salesHistoryBudget")}</p>
      ) : !history ? (
        <p className="mt-4 text-xs italic text-muted-foreground">{t("salesHistoryEmpty")}</p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          {windows.map(({ label, window }) => {
            const empty = !window || isEmptyWindow(window);
            return (
              <div
                key={label}
                className={cn(
                  "rounded-lg border border-border bg-secondary/40 p-3",
                  empty && "opacity-60",
                )}
              >
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {label}
                </p>
                <p className="mt-1 text-lg font-bold font-mono tabular-nums">
                  {window?.median !== null && window?.median !== undefined
                    ? money(window.median)
                    : "—"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t("medianLabel")}
                  {window && window.volume > 0 && (
                    <>
                      {" · "}
                      <span className="font-semibold text-foreground font-mono tabular-nums">
                        {window.volume}
                      </span>{" "}
                      {t("salesCount")}
                    </>
                  )}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
