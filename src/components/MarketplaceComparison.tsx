import { Check, Pencil } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { sumEffectiveMarketValue, useMoney, type Skin } from "@/lib/skins";
import { useMarketplace, MARKETPLACES } from "@/lib/marketplace";
import { MarketLogo } from "@/components/MarketLogo";
import { hasDopplerPhase, isDopplerGem } from "@/lib/catalog/doppler";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * "Killer feature" bonus: since every skin can carry a price per
 * marketplace, comparing the whole portfolio's value across markets is
 * just re-summing the same data from a different angle — no extra
 * bookkeeping needed. Steam's totals are net of the Community Market fee;
 * every other marketplace is shown at face value.
 *
 * Text only, deliberately — no icons or images, one line per market.
 */
export function MarketplaceComparison({ skins }: { skins: Skin[] }) {
  const { t } = useI18n();
  const money = useMoney();
  const { marketplace, setMarketplace, steamTaxPercent, setSteamTaxPercent } = useMarketplace();

  // If any holding is a phase-specific Doppler, the Steam total is a
  // floor estimate rather than an exact figure — Steam can't price
  // individual gems. Flag it once on the card instead of per row.
  const hasPhaseHolding = skins.some((s) => hasDopplerPhase(s) && !isDopplerGem(s));

  if (skins.length === 0) return null;

  return (
    <section className="panel p-5 sm:p-6">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-widest text-muted-foreground">
        {t("comparisonTitle")}
      </h2>
      <div className="grid gap-2 sm:grid-cols-3">
        {MARKETPLACES.map((m) => {
          const total = sumEffectiveMarketValue(skins, m.id, steamTaxPercent);
          const active = marketplace === m.id;
          const isSteam = m.id === "steam";
          return (
            <div
              key={m.id}
              role="button"
              tabIndex={0}
              onClick={() => setMarketplace(m.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setMarketplace(m.id);
                }
              }}
              title={isSteam ? `${t("netAfterFee")} · ${steamTaxPercent}%` : undefined}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2.5 text-left transition-colors",
                active
                  ? "border-primary/60 bg-primary/10"
                  : "border-border bg-secondary/40 hover:bg-secondary/70",
              )}
            >
              <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <MarketLogo market={m.id} />
                {m.label.toUpperCase()} {t("marketPrice").toUpperCase()}
              </span>
              <span className="ml-auto shrink-0 font-mono text-base font-bold tabular-nums">
                {money(total)}
              </span>
              {isSteam && hasPhaseHolding && (
                <span
                  title={t("baseFloorHint")}
                  className="shrink-0 cursor-help rounded border border-amber-400/40 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-400"
                >
                  {t("baseFloor")}
                </span>
              )}
              {active && <Check className="h-4 w-4 shrink-0 text-primary" />}

              {isSteam && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => e.stopPropagation()}
                      aria-label={t("steamFeeLabel")}
                      className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-56 space-y-2"
                    align="end"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      {t("steamFeeLabel")} (%)
                    </Label>
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      max="99"
                      value={steamTaxPercent}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n) && n >= 0 && n < 100) setSteamTaxPercent(n);
                      }}
                    />
                  </PopoverContent>
                </Popover>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
