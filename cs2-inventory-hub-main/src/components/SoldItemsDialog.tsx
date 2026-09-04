import { useEffect, useState } from "react";
import { PackageCheck, RotateCcw, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/lib/i18n";
import { catalogDisplayName } from "@/lib/catalog/doppler";
import {
  getQuantity,
  removeHolding,
  revertSale,
  soldHoldings,
  updateSalePrice,
  useMoney,
  WEAR_STYLES,
  type Skin,
} from "@/lib/skins";
import { showPriceToast } from "@/components/PriceToast";
import { cn } from "@/lib/utils";

/**
 * The history behind the realised result, made editable.
 *
 * Selling was a one-way door: the sale price was typed once into the edit
 * dialog and then only ever surfaced as a total, so a fat-fingered figure
 * quietly skewed the realised P/L forever and an item sold by mistake could
 * not be brought back. This lists every closed position and offers the
 * three corrections that were missing — fix the price, un-sell, or drop the
 * record.
 *
 * Every change is applied straight to the portfolio as it is made, which is
 * what makes the cards and the value chart move while the dialog is still
 * open: they read the same state.
 */
export function SoldItemsDialog({
  skins,
  open,
  onOpenChange,
  onChange,
}: {
  skins: Skin[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (next: (prev: Skin[]) => Skin[]) => void;
}) {
  const { t } = useI18n();
  const money = useMoney();
  const sold = soldHoldings(skins);

  /**
   * Price fields are held as TEXT while being typed.
   *
   * Round-tripping every keystroke through the number in state would make
   * "12." collapse to "12" under the cursor and a cleared field snap back
   * to 0 — so the text is local, and only a valid figure is committed.
   */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** Delete asks twice: this holds the id waiting for the second click. */
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  // Reopening starts clean — a half-typed price from last time is not a
  // pending edit, and a delete must never stay armed across sessions.
  useEffect(() => {
    if (!open) {
      setDrafts({});
      setPendingDelete(null);
    }
  }, [open]);

  const commitPrice = (skin: Skin, raw: string) => {
    setDrafts((prev) => ({ ...prev, [skin.id]: raw }));
    if (raw.trim() === "") return;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return;
    onChange((prev) => updateSalePrice(prev, skin.id, n));
  };

  const revert = (skin: Skin) => {
    onChange((prev) => revertSale(prev, skin.id));
    showPriceToast({
      variant: "success",
      title: t("revertedToInventory"),
      description: catalogDisplayName(skin),
    });
  };

  const remove = (skin: Skin) => {
    if (pendingDelete !== skin.id) {
      setPendingDelete(skin.id);
      return;
    }
    setPendingDelete(null);
    onChange((prev) => removeHolding(prev, skin.id));
    showPriceToast({
      variant: "warning",
      title: t("recordDeleted"),
      description: catalogDisplayName(skin),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageCheck className="h-4 w-4 text-primary" />
            {t("soldItemsTitle")}
          </DialogTitle>
        </DialogHeader>
        <p className="-mt-2 text-xs text-muted-foreground">{t("soldItemsHint")}</p>

        {sold.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t("noSoldItems")}</p>
        ) : (
          <ScrollArea className="max-h-[26rem] pr-2">
            <ul className="space-y-2">
              {sold.map((s) => {
                const qty = getQuantity(s);
                const price = s.sold!.pricePerUnit;
                const result = (price - s.buyPrice) * qty;
                const resultUp = result >= 0;
                const armed = pendingDelete === s.id;
                return (
                  <li
                    key={s.id}
                    className="rounded-lg border border-border bg-secondary/40 p-3 transition-colors hover:border-primary/30"
                  >
                    <div className="flex flex-wrap items-start gap-3">
                      {s.image && (
                        <img
                          src={s.image}
                          alt=""
                          loading="lazy"
                          className="h-10 w-16 shrink-0 object-contain"
                        />
                      )}
                      {/* Full width on a phone so the name is not squeezed
                          into an ellipsis by the controls; back on one line
                          from `sm` up. */}
                      <div className="min-w-0 flex-1 basis-[calc(100%-5rem)] sm:basis-auto">
                        <p className="truncate text-sm font-semibold">{catalogDisplayName(s)}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          {s.wear && (
                            <span
                              className={cn(
                                "rounded border px-1.5 py-0.5 font-semibold",
                                WEAR_STYLES[s.wear],
                              )}
                            >
                              {s.wear}
                            </span>
                          )}
                          <span className="font-mono tabular-nums">
                            {qty} × {money(s.buyPrice)}
                          </span>
                          <span>
                            {t("soldOn")}{" "}
                            <span className="font-mono tabular-nums">{s.sold!.date}</span>
                          </span>
                        </p>
                      </div>

                      {/* Price, result and actions are ONE flex child, so
                          `ml-auto` can never push the buttons onto a line
                          of their own while the fields stay put. */}
                      <div className="ml-auto flex items-end gap-2">
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            {t("salePriceLabel")}
                          </span>
                          <Input
                            type="number"
                            step="any"
                            min="0"
                            aria-label={`${t("salePriceLabel")} — ${catalogDisplayName(s)}`}
                            className="h-8 w-28 font-mono tabular-nums"
                            value={drafts[s.id] ?? String(price)}
                            onChange={(e) => commitPrice(s, e.target.value)}
                          />
                        </label>
                        <span className="flex flex-col gap-1">
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            {t("realizedResult")}
                          </span>
                          <span
                            className={cn(
                              "flex h-8 items-center font-mono text-sm font-bold tabular-nums",
                              resultUp ? "text-profit" : "text-loss",
                            )}
                          >
                            {resultUp ? "+" : ""}
                            {money(result)}
                          </span>
                        </span>

                        <div className="flex flex-nowrap items-center gap-0.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t("revertToInventory")}
                            title={t("revertToInventory")}
                            onClick={() => revert(s)}
                          >
                            <RotateCcw className="h-4 w-4 text-primary" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t("deleteRecord")}
                            title={armed ? t("confirmDeleteRecord") : t("deleteRecord")}
                            onClick={() => remove(s)}
                            className={cn(armed && "bg-loss/15 ring-1 ring-loss/50")}
                          >
                            <Trash2 className="h-4 w-4 text-loss" />
                          </Button>
                        </div>
                      </div>
                    </div>

                    {armed && (
                      <p className="mt-2 text-[11px] leading-snug text-loss">
                        {t("confirmDeleteRecord")} — {t("deleteRecordHint")}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
