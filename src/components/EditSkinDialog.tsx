import { useEffect, useMemo, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { usePortfolio, isMainPortfolio } from "@/lib/portfolio";
import { HandCoins } from "lucide-react";
import { WEARS, WEAR_STYLES, getQuantity, type Skin, type Wear } from "@/lib/skins";
import { WEARLESS_CATEGORIES } from "@/lib/catalog/types";
import { useMarketplace, MARKETPLACES } from "@/lib/marketplace";
import { catalogDisplayName } from "@/lib/catalog/doppler";
import { useCatalog } from "@/lib/catalog/useCatalog";
import { availableWearsFor } from "@/lib/wear";
import { cn } from "@/lib/utils";

/**
 * Edit one existing holding. The manual market-price field writes straight
 * into `marketPrices` for the ACTIVE marketplace, so a user can override a
 * live price (or fill one in for a market the API can't reach) without
 * touching the other markets' prices.
 */
export function EditSkinDialog({
  skin,
  onSave,
  onOpenChange,
}: {
  skin: Skin | null;
  onSave: (updated: Skin) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const { marketplace } = useMarketplace();
  const activeMarketLabel = MARKETPLACES.find((m) => m.id === marketplace)?.label ?? "";

  const [quantity, setQuantity] = useState("1");
  const [buyPrice, setBuyPrice] = useState("");
  const [wear, setWear] = useState<Wear>("Factory New");
  const [manualPrice, setManualPrice] = useState("");
  const [soldPrice, setSoldPrice] = useState("");

  const { activeId } = usePortfolio();
  // Selling is a manual bookkeeping action for portfolios the user curates.
  // Main mirrors the live Steam inventory, so marking something sold there
  // would be overwritten by the next sync and would misreport reality.
  const allowSelling = !isMainPortfolio(activeId);

  // Re-seed the form whenever a different item is opened.
  useEffect(() => {
    if (!skin) return;
    setQuantity(String(getQuantity(skin)));
    setBuyPrice(String(skin.buyPrice));
    setWear(skin.wear ?? "Factory New");
    const existing = skin.marketPrices[marketplace];
    setManualPrice(existing !== undefined ? String(existing) : "");
    setSoldPrice(skin.sold ? String(skin.sold.pricePerUnit) : "");
  }, [skin, marketplace]);

  const { data: catalogItems } = useCatalog();

  // Same rule as the add form: only exteriors this skin can actually exist
  // in. A holding saved before this check could still carry an impossible
  // wear, so the value already on the record is kept in the list — editing
  // an unrelated field must not silently rewrite what is already stored —
  // but nothing NEW can be picked that the item cannot have.
  const wearOptions = useMemo<readonly Wear[]>(() => {
    if (!skin) return WEARS;
    const match = catalogItems?.find((i) => catalogDisplayName(i) === skin.name);
    const allowed = match ? availableWearsFor(match) : [];
    if (allowed.length === 0) return WEARS;
    const current = skin.wear;
    return current && !allowed.includes(current) ? [current, ...allowed] : allowed;
  }, [catalogItems, skin]);

  if (!skin) return null;

  const showWear = !skin.category || !WEARLESS_CATEGORIES.has(skin.category);
  const qtyNum = Math.max(1, Math.floor(Number(quantity) || 1));
  const buyNum = Number(buyPrice) || 0;

  const handleSave = () => {
    const nextPrices = { ...skin.marketPrices };
    if (manualPrice.trim() === "") {
      delete nextPrices[marketplace];
    } else {
      const n = Number(manualPrice);
      if (Number.isFinite(n) && n >= 0) nextPrices[marketplace] = n;
    }

    const soldNum = Number(soldPrice);
    const enteredSale =
      soldPrice.trim() !== "" && Number.isFinite(soldNum) && soldNum >= 0
        ? { pricePerUnit: soldNum, date: new Date().toISOString().slice(0, 10) }
        : undefined;
    // Main hides the sale field entirely (its contents mirror Steam), and
    // the old code turned that into `sold: undefined` — so editing the
    // quantity of an item sold in another portfolio, then viewing it in
    // Main, silently erased the sale and with it the realised profit. When
    // selling is not offered, whatever is on the record is left alone.
    const sold = allowSelling ? enteredSale : skin.sold;

    onSave({
      ...skin,
      quantity: qtyNum,
      buyPrice: buyNum,
      wear: showWear ? wear : undefined,
      marketPrices: nextPrices,
      sold,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={!!skin} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="truncate">{t("editItem")}</DialogTitle>
        </DialogHeader>

        <p className="-mt-2 truncate text-sm text-muted-foreground">{catalogDisplayName(skin)}</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              {t("quantity")}
            </Label>
            <Input
              type="number"
              step="1"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              {t("buyPrice")}
            </Label>
            <Input
              type="number"
              step="any"
              min="0"
              value={buyPrice}
              onChange={(e) => setBuyPrice(e.target.value)}
            />
          </div>

          <p className="-mt-2 text-xs text-muted-foreground sm:col-span-2">
            💡 {t("totalSpent")}:{" "}
            <span className="font-semibold text-foreground">{(qtyNum * buyNum).toFixed(2)}</span>
          </p>

          {showWear && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                {t("wear")}
              </Label>
              <Select value={wear} onValueChange={(v) => setWear(v as Wear)}>
                <SelectTrigger>
                  <SelectValue placeholder={t("selectWear")} />
                </SelectTrigger>
                <SelectContent>
                  {wearOptions.map((w) => (
                    <SelectItem key={w} value={w}>
                      <span className={cn("rounded border px-1.5 py-0.5 text-xs", WEAR_STYLES[w])}>
                        {w}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              {t("manualPrice")} — {activeMarketLabel}
            </Label>
            <Input
              type="number"
              step="any"
              min="0"
              value={manualPrice}
              onChange={(e) => setManualPrice(e.target.value)}
              placeholder="0.00"
            />
            <p className="text-[11px] text-muted-foreground">{t("manualPriceHint")}</p>
          </div>

          {allowSelling && (
            <div className="space-y-1.5 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.04] p-3 sm:col-span-2">
              <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-emerald-400">
                <HandCoins className="h-3.5 w-3.5" />
                {t("markAsSold")}
              </Label>
              <Input
                type="number"
                step="any"
                min="0"
                value={soldPrice}
                onChange={(e) => setSoldPrice(e.target.value)}
                placeholder={t("soldPricePlaceholder")}
              />
              {soldPrice.trim() !== "" && Number.isFinite(Number(soldPrice)) && (
                <p className="text-xs">
                  <span className="text-muted-foreground">{t("realizedResult")}: </span>
                  <span
                    className={cn(
                      "font-semibold font-mono tabular-nums",
                      (Number(soldPrice) - buyNum) * qtyNum >= 0 ? "text-profit" : "text-loss",
                    )}
                  >
                    {((Number(soldPrice) - buyNum) * qtyNum).toFixed(2)}
                  </span>
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">{t("markAsSoldHint")}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" onClick={handleSave}>
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
