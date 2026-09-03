import { useEffect, useState } from "react";
import { BellRing, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";
import { directionFor, type AlertSubject, type PriceAlert } from "@/lib/alertModel";
import { WEAR_STYLES } from "@/lib/skins";
import { cn } from "@/lib/utils";

/**
 * Sets the target price for ONE item, at ONE wear.
 *
 * Shared by the portfolio and the wishlist: both hand it an `AlertSubject`,
 * so the two lists cannot drift into two different alert dialogs.
 *
 * The target is entered and stored in EUR — the app's internal currency —
 * so switching the display currency never rewrites what the user typed.
 * The hint under the field spells out which way the price has to move,
 * because the direction is derived from today's price rather than asked:
 * a target above the current price can only mean "tell me when it rises".
 */
/**
 * Formats in EUR, NOT in the user's display currency.
 *
 * Everything about this dialog is denominated in euros — the field is
 * labelled EUR and the stored target is EUR — so converting the numbers
 * around it would put "€20" in the input and "$21.60" in the sentence
 * directly underneath it.
 */
const eur = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);

export function PriceAlertDialog({
  subject,
  currentPrice,
  existing,
  onSave,
  onRemove,
  onOpenChange,
}: {
  subject: AlertSubject | null;
  /** Live market price for the active marketplace, in EUR. */
  currentPrice?: number | undefined;
  existing?: PriceAlert | undefined;
  onSave: (targetPrice: number) => void;
  onRemove: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [target, setTarget] = useState("");

  // Re-seed whenever a different item is opened.
  useEffect(() => {
    if (!subject) return;
    setTarget(existing ? String(existing.targetPrice) : "");
  }, [subject, existing]);

  if (!subject) return null;

  const targetNum = Number(target);
  const valid = target.trim() !== "" && Number.isFinite(targetNum) && targetNum > 0;
  const direction = valid ? directionFor(targetNum, currentPrice) : "either";

  const hint = !valid
    ? t("priceAlertStored")
    : direction === "above"
      ? t("priceAlertHintAbove").replace("{target}", eur(targetNum))
      : direction === "below"
        ? t("priceAlertHintBelow").replace("{target}", eur(targetNum))
        : t("priceAlertHintUnknown");

  return (
    <Dialog open={!!subject} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-primary" />
            {existing ? t("editPriceAlert") : t("setPriceAlert")}
          </DialogTitle>
        </DialogHeader>

        <div className="-mt-2 flex items-center gap-3">
          {subject.image && (
            <img
              src={subject.image}
              alt=""
              loading="lazy"
              className="h-10 w-16 shrink-0 object-contain"
            />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{subject.name}</p>
            {subject.wear && (
              <span
                className={cn(
                  "mt-1 inline-block rounded-md border px-2 py-0.5 text-[11px] font-semibold",
                  WEAR_STYLES[subject.wear],
                )}
              >
                {subject.wear}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("targetPriceEur")}
          </Label>
          <Input
            type="number"
            step="any"
            min="0"
            autoFocus
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="0.00"
          />
          <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>
          {currentPrice !== undefined && (
            <p className="text-[11px] text-muted-foreground">
              {t("currentMarketPrice")}:{" "}
              <span className="font-mono font-semibold text-foreground">{eur(currentPrice)}</span>
            </p>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          {existing ? (
            <Button
              type="button"
              variant="ghost"
              className="gap-1.5 text-loss hover:text-loss"
              onClick={() => {
                onRemove();
                onOpenChange(false);
              }}
            >
              <Trash2 className="h-4 w-4" />
              {t("removeAlert")}
            </Button>
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button
              type="button"
              disabled={!valid}
              onClick={() => {
                if (!valid) return;
                onSave(targetNum);
                onOpenChange(false);
              }}
            >
              {t("save")}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
