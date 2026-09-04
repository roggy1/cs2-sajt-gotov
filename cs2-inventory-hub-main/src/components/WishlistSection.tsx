import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell, BellRing, Heart, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import {
  CATEGORIES,
  WEAR_STYLES,
  useMoney,
  type Category,
  type WishItem,
  type Wear,
} from "@/lib/skins";
import { useCatalog } from "@/lib/catalog/useCatalog";
import { useInspectLink } from "@/lib/inspectLink";
import { useAlerts } from "@/lib/alerts";
import { subjectFromWish } from "@/lib/alertModel";
import { useLivePriceFetcher } from "@/lib/livePrice";
import { useMarketplace, MARKETPLACES } from "@/lib/marketplace";
import { PriceAlertDialog } from "@/components/PriceAlertDialog";
import { showPriceToast } from "@/components/PriceToast";
import { availableWearsFor, isWearless } from "@/lib/wear";
import type { CatalogItem } from "@/lib/catalog/types";
import { CatalogCombobox } from "@/components/CatalogCombobox";
import { cn } from "@/lib/utils";

export function WishlistSection({
  items,
  setItems,
}: {
  items: WishItem[];
  setItems: React.Dispatch<React.SetStateAction<WishItem[]>>;
}) {
  const { t } = useI18n();
  const money = useMoney();
  const inspectLink = useInspectLink();
  const { marketplace } = useMarketplace();
  const { fetchFor } = useLivePriceFetcher();
  const { alertFor, setAlert, removeAlert } = useAlerts();
  const activeMarketLabel = MARKETPLACES.find((m) => m.id === marketplace)?.label ?? "";
  const [name, setName] = useState("");
  const [image, setImage] = useState<string | undefined>(undefined);
  const [category, setCategory] = useState<Category | "all">("all");
  const [target, setTarget] = useState("");
  const [market, setMarket] = useState("");
  // Kept alongside the typed name so the entry can record the exterior and
  // the catalog id — both are what make the card link to the right Inspect
  // page rather than to the item's default wear.
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [wear, setWear] = useState<Wear | "">("");
  const [alerting, setAlerting] = useState<WishItem | null>(null);
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());
  const [refreshingAll, setRefreshingAll] = useState(false);

  const { data: catalogItems } = useCatalog();
  const categoryOptions = useMemo(() => {
    const set = new Set<string>(CATEGORIES);
    catalogItems?.forEach((i) => set.add(i.category));
    return Array.from(set).sort();
  }, [catalogItems]);

  // Only exteriors this specific item can exist in — the same rule the
  // inventory form uses, so a wishlist entry can never point at a wear the
  // skin does not have.
  const wearOptions = useMemo<Wear[]>(
    () => (selected && !isWearless(selected) ? availableWearsFor(selected) : []),
    [selected],
  );

  /**
   * Pulls a live price for ONE wishlist entry and writes it into
   * `marketPrice`.
   *
   * That field is what the alert layer compares against, so refreshing here
   * is what makes a wishlist alert able to fire at all — without it the
   * tracked price only ever changes when the user retypes it. A failed or
   * empty lookup deliberately leaves the previous price alone rather than
   * writing 0, which would read as "free" and trigger every drop alert at
   * once.
   */
  const refreshOne = async (item: WishItem, notify: boolean): Promise<boolean> => {
    setRefreshingIds((prev) => new Set(prev).add(item.id));
    try {
      const { priceEur } = await fetchFor({ name: item.name, wear: item.wear }, marketplace, true);
      if (priceEur === null || priceEur <= 0) {
        if (notify) {
          showPriceToast({
            variant: "warning",
            title: t("noListings"),
            description: item.name,
            market: marketplace,
          });
        }
        return false;
      }
      setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, marketPrice: priceEur } : x)));
      if (notify) {
        showPriceToast({
          variant: "success",
          title: t("priceUpdated"),
          description: item.name,
          market: marketplace,
        });
      }
      return true;
    } catch (err) {
      console.warn(`[wishlist] price lookup failed for "${item.name}":`, err);
      if (notify) {
        showPriceToast({
          variant: "warning",
          title: t("csfloatFetchError"),
          description: item.name,
          market: marketplace,
        });
      }
      return false;
    } finally {
      setRefreshingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const refreshAll = async () => {
    setRefreshingAll(true);
    let updated = 0;
    for (const item of items) {
      // Sequential on purpose: the same rate-limit courtesy the inventory
      // table extends to the price APIs.
      // eslint-disable-next-line no-await-in-loop
      if (await refreshOne(item, false)) updated++;
    }
    setRefreshingAll(false);
    showPriceToast({
      variant: updated > 0 ? "success" : "warning",
      title: t("refreshedCount").replace("{count}", String(updated)),
      market: marketplace,
    });
  };

  const resetForm = () => {
    setName("");
    setImage(undefined);
    setTarget("");
    setMarket("");
    setSelected(null);
    setWear("");
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || target === "" || market === "") {
      toast.error(t("fillFields"));
      return;
    }
    const resolved: Category | undefined = category === "all" ? undefined : category;
    setItems((prev) => [
      {
        id: crypto.randomUUID(),
        name: name.trim(),
        targetPrice: Number(target),
        marketPrice: Number(market),
        category: resolved,
        image,
        wear: wear === "" ? undefined : wear,
        catalogId: selected?.id,
      },
      ...prev,
    ]);
    resetForm();
    toast.success(t("addedWish"));
  };

  return (
    <section className="panel p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Heart className="h-5 w-5 text-primary" />
        <h2 className="text-xl font-bold uppercase tracking-wide">{t("wishlist")}</h2>
        {items.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto gap-1.5 bg-secondary/60"
            disabled={refreshingAll || refreshingIds.size > 0}
            onClick={() => void refreshAll()}
            title={activeMarketLabel}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshingAll && "animate-spin")} />
            {t("refreshAll")}
          </Button>
        )}
      </div>

      <form onSubmit={add} noValidate className="grid gap-3 lg:grid-cols-12">
        <div className="space-y-1.5 lg:col-span-4">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("skinName")}
          </Label>
          <CatalogCombobox
            query={name}
            onQueryChange={(v) => {
              setName(v);
              setImage(undefined);
              // A hand-typed name is no longer the item that was picked.
              setSelected(null);
              setWear("");
            }}
            selectedImage={image}
            categoryFilter={category}
            onItemSelect={(item) => {
              setName(item.name);
              setImage(item.image);
              setSelected(item);
              const wears = isWearless(item) ? [] : availableWearsFor(item);
              setWear(wears[0] ?? "");
              if (category === "all") setCategory(item.category);
            }}
            placeholder={t("searchSkin")}
          />
        </div>
        <div className="space-y-1.5 lg:col-span-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("category")}
          </Label>
          <Select value={category} onValueChange={(v) => setCategory(v as Category | "all")}>
            <SelectTrigger>
              <SelectValue placeholder={t("selectCategory")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allCategories")}</SelectItem>
              {categoryOptions.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {wearOptions.length > 0 && (
          <div className="space-y-1.5 lg:col-span-2">
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
        <div
          className={cn("space-y-1.5", wearOptions.length > 0 ? "lg:col-span-2" : "lg:col-span-3")}
        >
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("targetPrice")}
          </Label>
          <Input
            type="number"
            step="any"
            min="0"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div
          className={cn("space-y-1.5", wearOptions.length > 0 ? "lg:col-span-2" : "lg:col-span-3")}
        >
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("marketPrice")}
          </Label>
          <Input
            type="number"
            step="any"
            min="0"
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div className="lg:col-span-12">
          <Button type="submit" variant="secondary" className="w-full gap-2 sm:w-auto">
            <Plus className="h-4 w-4" />
            {t("addToWishlist")}
          </Button>
        </div>
      </form>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {items.map((w) => {
          const gap = w.marketPrice - w.targetPrice;
          const reached = gap <= 0;
          const target = inspectLink(w);
          const details = (
            <>
              {w.image && (
                <img
                  src={w.image}
                  alt={w.name}
                  loading="lazy"
                  className="h-10 w-16 shrink-0 object-contain"
                />
              )}
              <div className="min-w-0">
                <p className="truncate font-semibold">{w.name}</p>
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  {w.category && <span>{w.category}</span>}
                  {w.wear && (
                    <span
                      className={cn(
                        "inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold",
                        WEAR_STYLES[w.wear],
                      )}
                    >
                      {w.wear}
                    </span>
                  )}
                </p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {t("targetPrice")}:{" "}
                  <span className="text-foreground">{money(w.targetPrice)}</span>
                  {"  ·  "}
                  {t("marketPrice")}:{" "}
                  <span className="text-foreground">{money(w.marketPrice)}</span>
                </p>
                <p
                  className={cn(
                    "mt-1 text-sm font-bold font-mono tabular-nums",
                    reached ? "text-profit" : "text-loss",
                  )}
                >
                  {t("toGoal")}: {reached ? "" : "+"}
                  {money(gap)}
                </p>
              </div>
            </>
          );

          return (
            <div
              key={w.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/40 p-4 transition-colors hover:border-primary/40"
            >
              {/* The whole entry is the link: a wishlist exists to be
                  checked, and checking it means opening the item's prices
                  at the exact exterior the user is waiting for. */}
              {target ? (
                <Link
                  to="/item/$id"
                  params={target.params}
                  search={target.search}
                  aria-label={t("openItemPage")}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-md outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {details}
                </Link>
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-3">{details}</div>
              )}
              {/* Same one-line action row as the inventory table: refresh,
                  alert, delete — never stacked. */}
              <div className="flex flex-nowrap items-center justify-end gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("refreshPrice")}
                  title={`${t("refreshPrice")} — ${activeMarketLabel}`}
                  disabled={refreshingIds.has(w.id) || refreshingAll}
                  onClick={() => void refreshOne(w, true)}
                >
                  <RefreshCw
                    className={cn(
                      "h-4 w-4 text-primary",
                      refreshingIds.has(w.id) && "animate-spin",
                    )}
                  />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("setPriceAlert")}
                  title={
                    alertFor(w.id)
                      ? t("activeAlert").replace("{target}", money(alertFor(w.id)!.targetPrice))
                      : t("setPriceAlert")
                  }
                  onClick={() => setAlerting(w)}
                >
                  {alertFor(w.id) ? (
                    <BellRing className="h-4 w-4 text-primary" />
                  ) : (
                    <Bell className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("delete")}
                  onClick={() => {
                    setItems((prev) => prev.filter((x) => x.id !== w.id));
                    // The alert has nothing left to watch once the entry is
                    // gone — leaving it would keep firing on a phantom.
                    removeAlert(w.id);
                    toast(t("removed"));
                  }}
                >
                  <Trash2 className="h-4 w-4 text-loss" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      {items.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("emptyWishlist")}</p>
      )}

      <PriceAlertDialog
        subject={alerting ? subjectFromWish(alerting) : null}
        currentPrice={alerting?.marketPrice}
        existing={alerting ? alertFor(alerting.id) : undefined}
        onSave={(targetPrice) => {
          if (!alerting) return;
          setAlert(subjectFromWish(alerting), targetPrice, alerting.marketPrice);
          showPriceToast({
            variant: "success",
            title: t("alertSaved"),
            description: alerting.name,
            market: marketplace,
          });
        }}
        onRemove={() => {
          if (!alerting) return;
          removeAlert(alerting.id);
          showPriceToast({
            variant: "warning",
            title: t("alertRemoved"),
            description: alerting.name,
            market: marketplace,
          });
        }}
        onOpenChange={(open) => {
          if (!open) setAlerting(null);
        }}
      />
    </section>
  );
}
