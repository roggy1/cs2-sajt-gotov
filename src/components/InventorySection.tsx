import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  Backpack,
  ChevronDown,
  Info,
  RefreshCw,
  Pencil,
  Bell,
  BellRing,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
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
  WEARS,
  WEAR_STYLES,
  useMoney,
  getEffectivePrice,
  getQuantity,
  getTotalPaid,
  isOpenPosition,
  enforceStattrakSouvenirExclusivity,
  countMissingPrices,
  type Category,
  type Skin,
  type Wear,
} from "@/lib/skins";
import { WEARLESS_CATEGORIES } from "@/lib/catalog/types";
import { catalogDisplayName, hasDopplerPhase, isDopplerGem } from "@/lib/catalog/doppler";
import { useCatalog } from "@/lib/catalog/useCatalog";
import { useMarketplace, MARKETPLACES, type MarketplaceId } from "@/lib/marketplace";
import { availableWearsFor } from "@/lib/wear";
import type { CatalogItem } from "@/lib/catalog/types";
import { useCsfloatPrice, toMarketHashName } from "@/lib/csfloat";
import { useSteamPrice, prefetchSteamPrices } from "@/lib/steam";
import { useSkinportPrice } from "@/lib/skinport";
import { useCurrency } from "@/lib/currency";
import { CatalogCombobox } from "@/components/CatalogCombobox";
import { MarketLogo } from "@/components/MarketLogo";
import { showPriceToast, showFormToast } from "@/components/PriceToast";
import { EditSkinDialog } from "@/components/EditSkinDialog";
import { PriceAlertDialog } from "@/components/PriceAlertDialog";
import { useAlerts } from "@/lib/alerts";
import { subjectFromSkin } from "@/lib/alertModel";
import { cn } from "@/lib/utils";

export function InventorySection({
  skins,
  setSkins,
}: {
  skins: Skin[];
  setSkins: React.Dispatch<React.SetStateAction<Skin[]>>;
}) {
  const { t } = useI18n();
  const money = useMoney();
  const { marketplace, steamTaxPercent } = useMarketplace();
  const { alertFor, setAlert, removeAlert } = useAlerts();
  const { rates } = useCurrency();
  const csfloatPrice = useCsfloatPrice(rates.usd);
  const steamPrice = useSteamPrice();
  const skinportPrice = useSkinportPrice();
  // Every marketplace now has a live price source.
  const supportsLivePrices = true;
  const livePriceBusy = csfloatPrice.isPending || steamPrice.isPending || skinportPrice.isPending;
  const activeMarketLabel = MARKETPLACES.find((m) => m.id === marketplace)?.label ?? "";
  const otherMarkets = MARKETPLACES.filter((m) => m.id !== marketplace);

  const [name, setName] = useState("");
  const [image, setImage] = useState<string | undefined>(undefined);
  const [paintIndex, setPaintIndex] = useState<string | undefined>(undefined);
  const [phase, setPhase] = useState<string | undefined>(undefined);
  // The category of the item picked from search. Tracked separately from
  // the `category` FILTER so choosing a skin never yanks the user's filter
  // to a different value mid-entry.
  const [selectedItemCategory, setSelectedItemCategory] = useState<string | undefined>(undefined);
  // The whole catalog entry, not just its category: the wear dropdown needs
  // this item's own float window to decide which exteriors it can offer.
  const [selectedItem, setSelectedItem] = useState<CatalogItem | undefined>(undefined);
  const [category, setCategory] = useState<Category | "all">("all");
  const [wear, setWear] = useState<Wear>("Factory New");
  const [stattrak, setStattrak] = useState(false);
  const [souvenir, setSouvenir] = useState(false);
  // True when the picked catalog item is itself a "Souvenir ..." entry.
  const [isLegacySouvenir, setIsLegacySouvenir] = useState(false);
  const [buyPrice, setBuyPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  // Which single row is currently fetching. Tracked by id so one row's
  // refresh never puts every other row into a loading state.
  // A SET, not a single id: the bulk refresh now runs several holdings
  // at once, and every row that is genuinely in flight should say so.
  const [refreshingIds, setRefreshingIds] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [editing, setEditing] = useState<Skin | null>(null);
  const [alerting, setAlerting] = useState<Skin | null>(null);
  const [marketPrice, setMarketPrice] = useState("");
  const [otherPrices, setOtherPrices] = useState<Partial<Record<MarketplaceId, string>>>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [floatValue, setFloatValue] = useState("");
  const [paintSeed, setPaintSeed] = useState("");
  const [note, setNote] = useState("");
  // Briefly pulses the offending fields on each failed submit. Kept as a
  // separate flag (not derived from `errors`) so a repeat submit with the
  // same errors re-triggers the animation instead of sitting still.
  const [flashErrors, setFlashErrors] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; buyPrice?: string; marketPrice?: string }>(
    {},
  );

  const { data: catalogItems } = useCatalog();
  // Curated defaults merged with whatever the live catalog actually contains,
  // so the filter always reflects real data instead of a hardcoded guess.
  const categoryOptions = useMemo(() => {
    const set = new Set<string>(CATEGORIES);
    catalogItems?.forEach((i) => set.add(i.category));
    return Array.from(set).sort();
  }, [catalogItems]);

  // Stickers, agents, cases, music kits, patches, graffiti and keychains
  // don't have a wear/float value — hide the field for those.
  // Effective category of the item being entered: what was picked from
  // search, else whatever the filter is narrowed to.
  const effectiveCategory = selectedItemCategory ?? (category === "all" ? undefined : category);
  const showWear = !effectiveCategory || !WEARLESS_CATEGORIES.has(effectiveCategory);

  // Exteriors this specific item can actually exist in. Before this, the
  // dropdown always listed all five, so a portfolio could hold a
  // "Galil AR | Chatterbox (Factory New)" — an item that does not exist and
  // that no marketplace will ever return a price for.
  const wearOptions = useMemo<readonly Wear[]>(() => {
    if (!selectedItem) return WEARS;
    const allowed = availableWearsFor(selectedItem);
    // Nothing known about this item's range: offer everything rather than
    // block the user on missing upstream data.
    return allowed.length > 0 ? allowed : WEARS;
  }, [selectedItem]);

  // Picking a new item can invalidate the wear already in the field —
  // switching from an AK to a Chatterbox must not silently keep
  // "Factory New" and save an impossible holding.
  useEffect(() => {
    if (!wearOptions.includes(wear)) setWear(wearOptions[0] ?? "Factory New");
  }, [wearOptions, wear]);
  // Souvenir never applies to knives, gloves or agents. It is also hidden
  // for items that are ALREADY a legacy souvenir, and for StatTrak™
  // variants — in CS2 an item is one or the other, never both.
  const SOUVENIR_EXCLUDED = ["Knives", "Gloves", "Agent"];
  const showSouvenir =
    !stattrak &&
    showWear &&
    !(effectiveCategory && SOUVENIR_EXCLUDED.some((x) => effectiveCategory.includes(x)));
  // A legacy souvenir already IS a souvenir — the box is shown ticked but
  // locked, so its name can never get a second "Souvenir " prefix.
  const souvenirChecked = isLegacySouvenir || souvenir;

  // Live "you are about to spend this much" preview under the price field.
  const formTotalSpent = (() => {
    const unit = Number(buyPrice);
    if (buyPrice === "" || !Number.isFinite(unit)) return null;
    const qty = Math.max(1, Math.floor(Number(quantity) || 1));
    return unit * qty;
  })();

  // Auto-fill the Market Price field with a live price when the active
  // marketplace supports one and a real catalog item (has an image, so we
  // know it wasn't just free-typed partial text) is selected. Debounced so
  // adjusting the float value doesn't spam requests while typing.
  useEffect(() => {
    if (!supportsLivePrices || !name.trim() || !image) return;

    const applyPrice = (priceEur: number | null) => {
      if (priceEur === null) return;
      setMarketPrice(priceEur.toFixed(2));
      setErrors((prev) => (prev.marketPrice ? { ...prev, marketPrice: undefined } : prev));
    };

    const timeout = setTimeout(() => {
      if (marketplace === "csfloat") {
        const floatNum = floatValue !== "" ? Number(floatValue) : undefined;
        csfloatPrice.mutate(
          {
            name: name.trim(),
            wear: showWear ? wear : undefined,
            souvenir: showSouvenir && souvenir,
            paintIndex,
            phase,
            floatValue: floatNum !== undefined && Number.isFinite(floatNum) ? floatNum : undefined,
          },
          { onSuccess: (result) => applyPrice(result.priceEur) },
        );
      } else if (marketplace === "skinport") {
        skinportPrice.mutate(
          {
            name: name.trim(),
            wear: showWear ? wear : undefined,
            souvenir: showSouvenir && souvenir,
            phase,
          },
          { onSuccess: (result) => applyPrice(result.priceEur) },
        );
      } else {
        steamPrice.mutate(
          {
            name: name.trim(),
            wear: showWear ? wear : undefined,
            souvenir: showSouvenir && souvenir,
            phase,
            paintIndex,
          },
          { onSuccess: (result) => applyPrice(result.priceEur) },
        );
      }
    }, 500);

    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    marketplace,
    supportsLivePrices,
    name,
    image,
    wear,
    souvenir,
    showSouvenir,
    paintIndex,
    phase,
    floatValue,
    showWear,
  ]);

  // Sold holdings leave the active table entirely — they are history, not
  // something the user still owns. Their money is still accounted for in
  // the totals above (proceeds count as value, cost stays in invested).
  // The realised total and the sold count now live in the stat cards at the
  // top of this section, so nothing here needs to recompute them.
  const openSkins = useMemo(() => skins.filter(isOpenPosition), [skins]);

  const missingCount = countMissingPrices(openSkins, marketplace);

  /**
   * Maps a holding to its catalog entry so the row can link to /item/$id.
   * Matched on the phase-stripped, prefix-stripped name because the
   * catalog's display name carries our own additions.
   */
  const catalogIdByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of catalogItems ?? []) map.set(entry.name, entry.id);
    return map;
  }, [catalogItems]);

  /**
   * Fetches a live price for ONE holding from whichever marketplace is
   * active, and writes it back under that marketplace's key.
   *
   * Deliberately scoped to a single item: clicking a row's refresh spins
   * that row only and never re-prices the whole portfolio. A null/failed
   * result NEVER overwrites an existing price, so a rate limit can't wipe
   * the portfolio.
   */
  const refreshOne = async (skin: Skin, opts?: { notify?: boolean; force?: boolean }) => {
    if (!supportsLivePrices) return false;
    setRefreshingIds((prev) => new Set(prev).add(skin.id));
    try {
      let priceEur: number | null = null;
      let successMessage = t("priceUpdated");

      if (marketplace === "csfloat") {
        const result = await csfloatPrice.mutateAsync({
          name: skin.name,
          wear: skin.wear,
          souvenir: skin.souvenir,
          paintIndex: skin.paintIndex,
          phase: skin.phase,
          floatValue: skin.floatValue,
        });
        priceEur = result.priceEur;
        // The lookup is no longer float-conditional, so a price is simply
        // the market's cheapest Buy Now listing and "no price" means the
        // item has no listings at all — not that this copy's float could
        // not be matched, which is what the old wording claimed.
        successMessage = t("csfloatUpdated");
        if (priceEur === null && opts?.notify) {
          showPriceToast({
            variant: "warning",
            title: t("noListings"),
            description: catalogDisplayName(skin),
            market: marketplace,
          });
        }
      } else if (marketplace === "skinport") {
        const result = await skinportPrice.mutateAsync({
          name: skin.name,
          wear: skin.wear,
          souvenir: skin.souvenir,
          phase: skin.phase,
          force: opts?.force ?? false,
        });
        priceEur = result.priceEur;
        if (priceEur === null && opts?.notify) {
          showPriceToast({
            variant: "warning",
            title: t("noListings"),
            description: catalogDisplayName(skin),
            market: marketplace,
          });
        } else if (result.cached) {
          successMessage = `${t("priceUpdated")} (${t("priceCached")})`;
        }
      } else {
        const result = await steamPrice.mutateAsync({
          name: skin.name,
          wear: skin.wear,
          souvenir: skin.souvenir,
          phase: skin.phase,
          paintIndex: skin.paintIndex,
          force: opts?.force ?? false,
        });
        priceEur = result.priceEur;
        if (result.status === "phase_unsupported") {
          if (opts?.notify) {
            showPriceToast({
              variant: "warning",
              title: t("gemNotOnSteam"),
              description: catalogDisplayName(skin),
              market: marketplace,
            });
          }
        } else if (result.status === "rate_limited") {
          if (opts?.notify) {
            showPriceToast({
              variant: "warning",
              title: t("priceRateLimited"),
              description: catalogDisplayName(skin),
              market: marketplace,
            });
          }
        } else if (priceEur === null && opts?.notify) {
          showPriceToast({
            variant: "warning",
            title: t("noListings"),
            description: catalogDisplayName(skin),
            market: marketplace,
          });
        } else if (result.cached) {
          successMessage = `${t("priceUpdated")} (${t("priceCached")})`;
        }
      }

      if (priceEur === null) return false;

      setSkins((prev) =>
        prev.map((x) =>
          x.id === skin.id
            ? { ...x, marketPrices: { ...x.marketPrices, [marketplace]: priceEur } }
            : x,
        ),
      );
      if (opts?.notify) {
        showPriceToast({
          variant: "success",
          title: successMessage,
          description: catalogDisplayName(skin),
          market: marketplace,
        });
      }
      return true;
    } catch {
      if (opts?.notify) {
        showPriceToast({
          variant: "warning",
          title: t("csfloatFetchError"),
          description: catalogDisplayName(skin),
          market: marketplace,
        });
      }
      return false;
    } finally {
      setRefreshingIds((prev) => {
        const next = new Set(prev);
        next.delete(skin.id);
        return next;
      });
    }
  };

  /**
   * How many holdings are priced at once.
   *
   * The old version did one at a time, which on Steam meant every holding
   * waited out the previous one's server-side 2.5s gap — forty skins took
   * minutes. Pacing is now the server limiter's job (it backs off only when
   * Steam actually pushes back), so the client's job is just to not open an
   * unbounded number of sockets.
   */
  const REFRESH_CONCURRENCY = 6;

  /**
   * Refreshes every holding.
   *
   * On Steam this starts with ONE batch request that warms the server cache
   * for the whole portfolio, so the per-holding calls that follow are cache
   * hits rather than N separate trips out to Steam.
   *
   * This deliberately does NOT pass `force`, so anything already refreshed
   * within the cache window is served from cache and costs no API call.
   */
  const refreshAllPrices = async () => {
    setRefreshingAll(true);
    let updated = 0;
    try {
      if (marketplace === "steam") {
        await prefetchSteamPrices(
          openSkins.map((s) => toMarketHashName(s.name, s.wear, s.souvenir)),
        );
      }

      // A fixed pool of workers pulling from one shared cursor: keeps
      // exactly REFRESH_CONCURRENCY requests in flight without waiting for
      // a whole batch to finish before starting the next.
      let cursor = 0;
      await Promise.all(
        Array.from({ length: Math.min(REFRESH_CONCURRENCY, openSkins.length) }, async () => {
          for (;;) {
            const next = openSkins[cursor++];
            if (!next) return;
            if (await refreshOne(next)) updated++;
          }
        }),
      );
      // Deliberately a single grouped toast: refreshing 40 skins should
      // not fire 40 notifications.
      showPriceToast({
        variant: updated > 0 ? "success" : "warning",
        title: t("refreshedCount").replace("{count}", String(updated)),
        description:
          updated < skins.length
            ? t("refreshedSkipped").replace("{count}", String(openSkins.length - updated))
            : undefined,
        market: marketplace,
      });
    } finally {
      setRefreshingAll(false);
    }
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors: typeof errors = {};
    if (!name.trim()) nextErrors.name = t("errorRequiredName");
    if (buyPrice === "") nextErrors.buyPrice = t("errorRequiredBuyPrice");
    if (marketPrice === "") nextErrors.marketPrice = t("errorRequiredMarketPrice");

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);

      // Re-arm the pulse so repeated submits keep drawing the eye.
      setFlashErrors(false);
      window.setTimeout(() => setFlashErrors(true), 0);
      window.setTimeout(() => setFlashErrors(false), 1600);

      const missing = [
        nextErrors.name && t("skinName"),
        nextErrors.buyPrice && t("buyPrice"),
        nextErrors.marketPrice && t("marketPrice"),
      ].filter(Boolean) as string[];

      showFormToast({
        variant: "warning",
        title: t("fillFields"),
        description: t("fillFieldsDetail").replace("{fields}", missing.join(", ")),
      });
      return;
    }
    setErrors({});
    const resolved: Category = effectiveCategory ?? "";

    const marketPrices: Partial<Record<MarketplaceId, number>> = {
      [marketplace]: Number(marketPrice),
    };
    for (const m of otherMarkets) {
      const v = otherPrices[m.id];
      if (v !== undefined && v !== "") marketPrices[m.id] = Number(v);
    }

    setSkins((prev) => [
      enforceStattrakSouvenirExclusivity({
        id: crypto.randomUUID(),
        name: name.trim(),
        category: resolved,
        wear: showWear ? wear : undefined,
        stattrak: stattrak || undefined,
        paintIndex,
        phase,
        souvenir: showSouvenir && souvenir ? true : undefined,
        quantity: Math.max(1, Math.floor(Number(quantity) || 1)),
        buyPrice: Number(buyPrice),
        marketPrices,
        image,
        floatValue: floatValue !== "" ? Number(floatValue) : undefined,
        paintSeed: paintSeed !== "" ? Number(paintSeed) : undefined,
        note: note.trim() !== "" ? note.trim() : undefined,
      }),
      ...prev,
    ]);
    setName("");
    setImage(undefined);
    setPaintIndex(undefined);
    setPhase(undefined);
    setSelectedItemCategory(undefined);
    setSelectedItem(undefined);
    setStattrak(false);
    setSouvenir(false);
    setIsLegacySouvenir(false);
    setQuantity("1");
    setCategory("all");
    setBuyPrice("");
    setMarketPrice("");
    setOtherPrices({});
    setFloatValue("");
    setPaintSeed("");
    setNote("");
    setAdvancedOpen(false);
    showPriceToast({
      variant: "success",
      title: t("addedInv"),
      description: name.trim(),
      market: marketplace,
    });
  };

  return (
    <section className="panel p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Backpack className="icon-glow h-5 w-5 text-primary" strokeWidth={1.5} />
        <h2 className="text-xl font-bold uppercase tracking-wide">{t("inventory")}</h2>
        {supportsLivePrices && openSkins.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto gap-2"
            disabled={refreshingAll || refreshingIds.size > 0}
            onClick={() => void refreshAllPrices()}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshingAll && "animate-spin")} />
            {t("refreshAll")}
          </Button>
        )}
      </div>

      <form
        onSubmit={add}
        // noValidate: the browser's native validation bubble is an
        // unstyleable light-theme popup. We do our own validation with
        // red field borders and a themed toast instead.
        noValidate
        // gap-y is wider than gap-x on purpose: helper and error messages
        // hang out of the flow under their field, and this is the space
        // they hang in — without it they land on the submit button. The
        // stacked (mobile) layout needs less of it because a full-width
        // field never wraps its message onto a second line.
        className="grid gap-x-3 gap-y-6 lg:gap-y-8 lg:grid-cols-[repeat(16,minmax(0,1fr))]"
      >
        <Field className="lg:col-span-4" label={t("skinName")} error={errors.name}>
          <CatalogCombobox
            query={name}
            onQueryChange={(v) => {
              setName(v);
              setImage(undefined);
              setPaintIndex(undefined);
              setPhase(undefined);
              setSelectedItemCategory(undefined);
              setSelectedItem(undefined);
              setStattrak(false);
              setIsLegacySouvenir(false);
              setSouvenir(false);
              if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }));
            }}
            selectedImage={image}
            categoryFilter={category}
            onItemSelect={(item) => {
              setName(catalogDisplayName(item));
              setImage(item.image);
              setPaintIndex(item.paintIndex);
              setPhase(item.phase);
              setStattrak(!!item.isStattrak);
              setIsLegacySouvenir(!!item.isSouvenir);
              // Enforce the StatTrak™ ⊕ Souvenir rule at selection time too:
              // a legacy souvenir already IS one (so no manual flag, and no
              // "Souvenir Souvenir ..." query), and picking a StatTrak™
              // variant clears any souvenir flag left over from before.
              if (item.isSouvenir || item.isStattrak) setSouvenir(false);
              setSelectedItemCategory(item.category);
              setSelectedItem(item);
              if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }));
            }}
            placeholder={t("searchSkin")}
            error={!!errors.name}
            flash={!!errors.name && flashErrors}
          />
        </Field>
        <Field className="lg:col-span-2" label={t("category")}>
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
        </Field>
        {showSouvenir && (
          <Field className="lg:col-span-2" label={t("souvenir")}>
            <div className="flex h-9 items-center gap-2 rounded-md border border-input px-3">
              <Checkbox
                id="souvenir-toggle"
                checked={souvenirChecked}
                disabled={isLegacySouvenir}
                onCheckedChange={(v) => {
                  if (isLegacySouvenir) return;
                  const next = v === true;
                  setSouvenir(next);
                  // Mutually exclusive with StatTrak™.
                  if (next) setStattrak(false);
                }}
              />
              <label
                htmlFor="souvenir-toggle"
                className={cn(
                  "select-none text-sm",
                  isLegacySouvenir
                    ? "cursor-default text-amber-400"
                    : "cursor-pointer text-muted-foreground",
                )}
              >
                {souvenirChecked ? t("yes") : t("no")}
              </label>
            </div>
          </Field>
        )}
        {showWear && (
          <Field className="lg:col-span-2" label={t("wear")}>
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
          </Field>
        )}
        <Field className="lg:col-span-1" label={t("quantity")}>
          <Input
            type="number"
            step="1"
            min="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="1"
          />
        </Field>
        <Field
          className="lg:col-span-2"
          label={t("buyPrice")}
          error={errors.buyPrice}
          hint={
            formTotalSpent !== null ? (
              <>
                💡 {t("totalSpent")}:{" "}
                <span className="font-mono font-semibold text-foreground tabular-nums">
                  {money(formTotalSpent)}
                </span>
              </>
            ) : undefined
          }
        >
          <Input
            type="number"
            step="any"
            min="0"
            value={buyPrice}
            onChange={(e) => {
              setBuyPrice(e.target.value);
              if (errors.buyPrice) setErrors((prev) => ({ ...prev, buyPrice: undefined }));
            }}
            placeholder="0.00"
            aria-invalid={!!errors.buyPrice}
            className={cn(
              errors.buyPrice && "border-red-500 focus-visible:ring-red-500",
              errors.buyPrice && flashErrors && "field-error-flash",
            )}
          />
        </Field>
        <Field
          className="lg:col-span-3"
          label={
            <span
              className="inline-flex items-center gap-1.5"
              title={
                marketplace === "steam" ? `${t("netAfterFee")} · ${steamTaxPercent}%` : undefined
              }
            >
              <MarketLogo market={marketplace} />
              {activeMarketLabel.toUpperCase()} {t("marketPrice").toUpperCase()}
              {/* Steam prices every Doppler phase under one name, so warn
                  that this figure is the all-phase floor, not this gem. */}
              {marketplace === "steam" && phase && (
                <span
                  title={t("baseFloorHint")}
                  className="cursor-help rounded border border-amber-400/40 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-400"
                >
                  {t("baseFloor")}
                </span>
              )}
              {/* Only the form's own auto-fetch should spin here — a row's
                  refresh shares the same mutation but is not this field. */}
              {supportsLivePrices &&
                livePriceBusy &&
                refreshingIds.size === 0 &&
                !refreshingAll && <RefreshCw className="h-3 w-3 animate-spin text-primary" />}
            </span>
          }
          error={errors.marketPrice}
        >
          <Input
            type="number"
            step="any"
            min="0"
            value={marketPrice}
            onChange={(e) => {
              setMarketPrice(e.target.value);
              if (errors.marketPrice) setErrors((prev) => ({ ...prev, marketPrice: undefined }));
            }}
            placeholder="0.00"
            aria-invalid={!!errors.marketPrice}
            className={cn(
              errors.marketPrice && "border-red-500 focus-visible:ring-red-500",
              errors.marketPrice && flashErrors && "field-error-flash",
            )}
          />
        </Field>
        <div className="lg:col-span-16">
          <Button
            type="submit"
            size="lg"
            className="w-full gap-2 text-base font-bold shadow-[0_0_24px_-6px_var(--primary)] sm:w-auto sm:px-10"
          >
            <Plus className="h-5 w-5" />
            {t("addSkin")}
          </Button>
        </div>

        <div className="lg:col-span-16">
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform", advancedOpen && "rotate-180")}
                />
                {t("advancedOptions")}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={t("floatValue")}>
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    max="1"
                    value={floatValue}
                    onChange={(e) => setFloatValue(e.target.value)}
                    placeholder="0.0034211..."
                  />
                </Field>
                <Field label={t("paintSeed")}>
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    value={paintSeed}
                    onChange={(e) => setPaintSeed(e.target.value)}
                    placeholder="661"
                  />
                </Field>
                <Field label={t("note")} className="sm:col-span-3">
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t("notePlaceholder")}
                    rows={2}
                  />
                </Field>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("otherMarketPrices")}
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {otherMarkets.map((m) => (
                    <Field key={m.id} label={m.label}>
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        value={otherPrices[m.id] ?? ""}
                        onChange={(e) =>
                          setOtherPrices((prev) => ({ ...prev, [m.id]: e.target.value }))
                        }
                        placeholder="0.00"
                      />
                    </Field>
                  ))}
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </form>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[720px] border-separate border-spacing-y-2 text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-widest text-muted-foreground">
              <th className="px-3 pb-1 font-semibold">{t("skinName")}</th>
              <th className="px-3 pb-1 font-semibold">{t("category")}</th>
              <th className="px-3 pb-1 font-semibold">{t("wear")}</th>
              <th className="px-3 pb-1 text-right font-semibold">{t("quantity")}</th>
              <th className="px-3 pb-1 text-right font-semibold">{t("buyPrice")}</th>
              <th
                className="px-3 pb-1 text-right font-semibold"
                title={
                  marketplace === "steam" ? `${t("netAfterFee")} · ${steamTaxPercent}%` : undefined
                }
              >
                <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap">
                  <MarketLogo market={marketplace} />
                  {activeMarketLabel.toUpperCase()} {t("marketPrice").toUpperCase()}
                </span>
              </th>
              <th className="px-3 pb-1 text-right font-semibold">{t("diff")}</th>
              <th className="px-3 pb-1" />
            </tr>
          </thead>
          <tbody>
            {openSkins.map((s) => {
              const qty = getQuantity(s);
              // Marketplace APIs quote UNIT prices, so the holding's current
              // value is qty * unit, compared against the total amount paid.
              const unitPrice = getEffectivePrice(s, marketplace, steamTaxPercent);
              const positionValue = unitPrice !== undefined ? unitPrice * qty : undefined;
              const totalPaid = getTotalPaid(s);
              const diff = positionValue !== undefined ? positionValue - totalPaid : undefined;
              const pct = diff !== undefined && totalPaid > 0 ? (diff / totalPaid) * 100 : 0;
              const up = diff !== undefined && diff >= 0;
              const fullName = catalogDisplayName(s);
              const isStattrakName = fullName.startsWith("StatTrak™ ");
              const isSouvenirName = fullName.startsWith("Souvenir ") || s.souvenir === true;
              const displayName = isStattrakName
                ? fullName.slice("StatTrak™ ".length)
                : fullName.startsWith("Souvenir ")
                  ? fullName.slice("Souvenir ".length)
                  : fullName;
              return (
                <tr key={s.id} className="bg-secondary/40 transition-colors hover:bg-secondary/70">
                  <td className="rounded-l-lg px-3 py-3 font-semibold">
                    <span className="flex items-center gap-3">
                      {s.image && (
                        <img
                          src={s.image}
                          alt={s.name}
                          loading="lazy"
                          className="h-8 w-12 shrink-0 object-contain"
                        />
                      )}
                      {isStattrakName && <span className="font-bold text-primary">StatTrak™ </span>}
                      {isSouvenirName && (
                        <span className="font-bold text-amber-400">Souvenir </span>
                      )}
                      {catalogIdByName.get(fullName) ? (
                        <Link
                          to="/item/$id"
                          params={{ id: catalogIdByName.get(fullName)! }}
                          className="hover:text-primary hover:underline"
                        >
                          {displayName}
                        </Link>
                      ) : (
                        displayName
                      )}
                      {(s.floatValue !== undefined || s.paintSeed !== undefined || s.note) && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              aria-label={t("advancedOptions")}
                              className="text-muted-foreground transition-colors hover:text-primary"
                            >
                              <Info className="h-3.5 w-3.5" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-64 space-y-1.5 text-xs" align="start">
                            {s.floatValue !== undefined && (
                              <p>
                                <span className="text-muted-foreground">{t("floatValue")}: </span>
                                <span className="font-semibold font-mono tabular-nums">
                                  {s.floatValue}
                                </span>
                              </p>
                            )}
                            {s.paintSeed !== undefined && (
                              <p>
                                <span className="text-muted-foreground">{t("paintSeed")}: </span>
                                <span className="font-semibold font-mono tabular-nums">
                                  {s.paintSeed}
                                </span>
                              </p>
                            )}
                            {s.note && (
                              <p>
                                <span className="text-muted-foreground">{t("note")}: </span>
                                <span className="font-medium">{s.note}</span>
                              </p>
                            )}
                          </PopoverContent>
                        </Popover>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">{s.category || "—"}</td>
                  <td className="px-3 py-3">
                    {s.wear ? (
                      <span
                        className={cn(
                          "inline-block rounded-md border px-2 py-0.5 text-xs font-semibold",
                          WEAR_STYLES[s.wear],
                        )}
                      >
                        {s.wear}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">{qty}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">
                    <span className="inline-flex flex-col items-end leading-tight">
                      <span>{money(s.buyPrice)}</span>
                      {qty > 1 && (
                        <span className="text-[10px] font-normal text-muted-foreground">
                          {t("totalLabel")}: {money(totalPaid)}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">
                    {positionValue !== undefined ? (
                      <span className="inline-flex flex-col items-end leading-tight">
                        <span className="inline-flex items-center gap-1.5">
                          {/* Steam prices every Doppler phase under one name,
                              so this figure is the all-phase floor. */}
                          {marketplace === "steam" && hasDopplerPhase(s) && (
                            <span
                              title={t("baseFloorHint")}
                              className="cursor-help rounded border border-amber-400/40 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-400"
                            >
                              {t("baseFloor")}
                            </span>
                          )}
                          {money(positionValue)}
                        </span>
                        {qty > 1 && (
                          <span className="text-[10px] font-normal text-muted-foreground">
                            {money(unitPrice!)} {t("unitPrice")}
                          </span>
                        )}
                      </span>
                    ) : // A Steam gem quote is deliberately withheld rather
                    // than showing the all-phase floor, which would be far
                    // below the gem's real value.
                    marketplace === "steam" && isDopplerGem(s) ? (
                      <span
                        className="cursor-help text-xs font-semibold text-amber-400"
                        title={t("gemNotOnSteamHint")}
                      >
                        {t("gemNotOnSteam")}
                      </span>
                    ) : (
                      <span
                        className="text-xs italic text-muted-foreground"
                        title={t("noListingsHint")}
                      >
                        {t("noListings")}
                      </span>
                    )}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-3 text-right font-bold font-mono tabular-nums",
                      diff === undefined
                        ? "text-muted-foreground"
                        : up
                          ? "text-profit"
                          : "text-loss",
                    )}
                  >
                    {diff === undefined ? (
                      "—"
                    ) : (
                      <>
                        {up ? "+" : ""}
                        {money(diff)}
                        <span className="ml-1 text-xs opacity-80">
                          ({pct >= 0 ? "+" : ""}
                          {pct.toFixed(1)}%)
                        </span>
                      </>
                    )}
                  </td>
                  {/* One row of actions, never wrapping. The buttons are
                      inline-flex boxes, so with only `text-right` on the
                      cell they reflowed onto a second line as soon as the
                      column got tight — which is how delete ended up sitting
                      under the others. A nowrap flex row with `w-px` (the
                      table gives the cell its real width) keeps refresh,
                      edit, alert and delete on one baseline at every width. */}
                  <td className="w-px whitespace-nowrap rounded-r-lg px-3 py-3">
                    <div className="flex flex-nowrap items-center justify-end gap-0.5">
                      {supportsLivePrices && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("refreshCsfloatPrice")}
                          disabled={refreshingIds.has(s.id) || refreshingAll}
                          onClick={() => void refreshOne(s, { notify: true, force: true })}
                        >
                          <RefreshCw
                            className={cn(
                              "h-4 w-4 text-primary",
                              refreshingIds.has(s.id) && "animate-spin",
                            )}
                          />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("edit")}
                        onClick={() => setEditing(s)}
                      >
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("setPriceAlert")}
                        title={
                          alertFor(s.id)
                            ? t("activeAlert").replace(
                                "{target}",
                                money(alertFor(s.id)!.targetPrice),
                              )
                            : t("setPriceAlert")
                        }
                        onClick={() => setAlerting(s)}
                      >
                        {alertFor(s.id) ? (
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
                          setSkins((prev) => prev.filter((x) => x.id !== s.id));
                          toast(t("removed"));
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-loss" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {openSkins.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("emptyInventory")}</p>
        )}
        {openSkins.length > 0 && missingCount > 0 && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            {missingCount} {t("noPriceCountSuffix")}
          </p>
        )}
      </div>

      <PriceAlertDialog
        subject={alerting ? subjectFromSkin(alerting) : null}
        currentPrice={
          alerting ? getEffectivePrice(alerting, marketplace, steamTaxPercent) : undefined
        }
        existing={alerting ? alertFor(alerting.id) : undefined}
        onSave={(targetPrice) => {
          if (!alerting) return;
          setAlert(
            subjectFromSkin(alerting),
            targetPrice,
            getEffectivePrice(alerting, marketplace, steamTaxPercent),
          );
          showPriceToast({
            variant: "success",
            title: t("alertSaved"),
            description: catalogDisplayName(alerting),
            market: marketplace,
          });
        }}
        onRemove={() => {
          if (!alerting) return;
          removeAlert(alerting.id);
          showPriceToast({
            variant: "warning",
            title: t("alertRemoved"),
            description: catalogDisplayName(alerting),
            market: marketplace,
          });
        }}
        onOpenChange={(open) => {
          if (!open) setAlerting(null);
        }}
      />

      <EditSkinDialog
        skin={editing}
        onSave={(updated) => {
          const safe = enforceStattrakSouvenirExclusivity(updated);
          setSkins((prev) => prev.map((x) => (x.id === safe.id ? safe : x)));
          showPriceToast({
            variant: "success",
            title: t("itemUpdated"),
            description: catalogDisplayName(safe),
            market: marketplace,
          });
        }}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </section>
  );
}

/**
 * One labelled control in the add-skin row.
 *
 * The control is anchored to the BOTTOM of its grid cell, which is the only
 * reason every field lines up. Labels are not all one line high: "Weapon /
 * Category" wraps in English, Serbian and Russian (but not in German), and
 * with a plain top-down stack that second line pushed the category dropdown
 * 24px below every other control in the row. Anchoring at the bottom makes a
 * long label grow upward into the empty space instead.
 *
 * The helper and error lines are taken out of the flow for the same reason:
 * a message appearing under one field must not shove that field's control
 * out of the row — which is what happened the moment the "total spent" hint
 * showed up under the price. The row gap on the form is what leaves them
 * room to hang in.
 */
function Field({
  label,
  children,
  className,
  error,
  hint,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  error?: string;
  /** Rendered under the control, floating — never affects the row. */
  hint?: React.ReactNode;
}) {
  return (
    <div className={cn("relative flex h-full flex-col", className)}>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="mt-auto pt-1.5">{children}</div>
      {hint && !error && (
        <p className="absolute left-0 top-full mt-1 text-[11px] text-muted-foreground">{hint}</p>
      )}
      {error && (
        <p className="absolute left-0 top-full mt-1 text-xs font-medium text-red-500">{error}</p>
      )}
    </div>
  );
}
