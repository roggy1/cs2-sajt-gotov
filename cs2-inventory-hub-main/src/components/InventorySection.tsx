import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Loader2,
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
  getMarketPrice,
  getQuantity,
  getTotalPaid,
  isOpenPosition,
  enforceStattrakSouvenirExclusivity,
  countMissingPrices,
  type Category,
  type Skin,
  type Wear,
} from "@/lib/skins";
import { usePriceDump } from "@/lib/priceDumpStore";
import { WEARLESS_CATEGORIES } from "@/lib/catalog/types";
import { catalogDisplayName, hasDopplerPhase, isDopplerGem } from "@/lib/catalog/doppler";
import { useCatalog } from "@/lib/catalog/useCatalog";
import { useMarketplace, MARKETPLACES, type MarketplaceId } from "@/lib/marketplace";
import { availableWearsFor } from "@/lib/wear";
import type { CatalogItem } from "@/lib/catalog/types";
// Only the name builder is still needed here. The per-item price hooks
// (useCsfloatPrice / useSteamPrice / useSkinportPrice) are deliberately NOT
// imported any more: this table must not be able to make a network request
// for a price, and the surest way to guarantee that is to not have the
// means.
import { toMarketHashName } from "@/lib/csfloat";
import { useCurrency } from "@/lib/currency";
import { CatalogCombobox } from "@/components/CatalogCombobox";
import { MarketLogo } from "@/components/MarketLogo";
import { showPriceToast, showFormToast } from "@/components/PriceToast";
import { EditSkinDialog } from "@/components/EditSkinDialog";
import { PriceAlertDialog } from "@/components/PriceAlertDialog";
import { useAlerts } from "@/lib/alerts";
import { usePortfolio } from "@/lib/portfolio";
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
  // The auto-load below is scoped per portfolio as well as per market:
  // switching portfolio swaps the whole holdings list, so the pass has to
  // run again for the new one.
  const { activeId } = usePortfolio();
  const { alertFor, setAlert, removeAlert } = useAlerts();
  const { rates } = useCurrency();
  /**
   * The ONLY source of prices in this table.
   *
   * There used to be one network request per row per market — which is
   * what filled the Network tab with `(pending)` /api/csfloat-price calls
   * and got the app rate-limited. Every one of those is gone: the dump is
   * downloaded once by the provider and every price below is a lookup in
   * an object already in memory.
   */
  const priceDump = usePriceDump();
  // Every marketplace now has a live price source.
  const supportsLivePrices = true;
  /** True only while the one dump download is in the air — never per row. */
  const livePriceBusy = priceDump.status === "loading";
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
  /**
   * Only the whole-portfolio refresh has a busy state now.
   *
   * The per-row `refreshingIds` and `pendingIds` sets are gone with the
   * requests they tracked: a row reads its price out of the dump in memory,
   * so there is no moment at which a row is "waiting" for anything. A cell
   * shows a price or it shows "No listings" — never a spinner.
   */
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

  // Auto-fill the Market Price field from the dump when a real catalog item
  // is selected (it has an image, so we know it wasn't just free-typed
  // partial text). This used to fire a debounced request per keystroke on
  // the float field; it is now a lookup in memory, so there is nothing to
  // debounce and nothing to cancel.
  useEffect(() => {
    if (!supportsLivePrices || !name.trim() || !image) return;
    const price = priceDump.quote(
      toMarketHashName(name.trim(), showWear ? wear : undefined, showSouvenir && souvenir),
      marketplace,
    )?.priceEur;
    // A missing price leaves the field alone rather than writing 0.00 — an
    // empty field is a question, a zero is a wrong answer.
    if (price === undefined) return;
    setMarketPrice(price.toFixed(2));
    setErrors((prev) => (prev.marketPrice ? { ...prev, marketPrice: undefined } : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    marketplace,
    supportsLivePrices,
    priceDump,
    name,
    image,
    wear,
    souvenir,
    showSouvenir,
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
   * One holding's price on the active market, straight out of the dump.
   *
   * Synchronous by design: there is nothing to await, which is exactly why
   * no row can be left spinning. `null` means the dump has no price for
   * this item, and the row says so.
   */
  const dumpPriceFor = useCallback(
    (skin: { name: string; wear?: string | undefined; souvenir?: boolean | undefined }) =>
      priceDump.quote(toMarketHashName(skin.name, skin.wear, skin.souvenir), marketplace)
        ?.priceEur ?? null,
    [priceDump, marketplace],
  );

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
   * Re-reads ONE holding's price from the dump and writes it back under the
   * active market's key.
   *
   * No network. This used to be a per-item `fetch` to /api/csfloat-price or
   * /api/steam-price — one per row, queued behind each other, and the
   * source of every `(pending)` request in the Network tab. The row's
   * refresh button now just re-reads the store, so it is instant and can
   * never hang.
   *
   * A missing price NEVER overwrites an existing one: a gap in the dump
   * must not wipe a figure the user already has.
   */
  const refreshOne = (skin: Skin, opts?: { notify?: boolean }) => {
    if (!supportsLivePrices) return false;

    const priceEur = dumpPriceFor(skin);
    if (priceEur === null) {
      if (opts?.notify) {
        showPriceToast({
          variant: "warning",
          title: t("noListings"),
          description: catalogDisplayName(skin),
          market: marketplace,
        });
      }
      return false;
    }

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
        title: t("priceUpdated"),
        description: catalogDisplayName(skin),
        market: marketplace,
      });
    }
    return true;
  };

  /**
   * Prices every holding from the dump, for the market on screen.
   *
   * This one effect replaces the entire asynchronous machinery that used to
   * live here: a worker pool, a per-item "already loaded" ledger, a pending
   * set driving per-row spinners, and one HTTP request per holding per
   * market. All of it existed to manage requests that no longer happen.
   *
   * Because the dump is already in memory, the pass is a synchronous map
   * over the holdings — every row gets its number in the same render, and
   * switching price source re-runs it against a different key of the same
   * object. No request is made, so there is nothing to wait for and no row
   * can be left on "Loading…".
   *
   * A holding the dump does not cover is left untouched rather than
   * written as 0, and the row renders "No listings".
   */
  useEffect(() => {
    if (!supportsLivePrices || priceDump.status !== "ready") return;

    setSkins((prev) => {
      let changed = false;
      const next = prev.map((skin) => {
        if (skin.sold) return skin;
        const price = priceDump.quote(
          toMarketHashName(skin.name, skin.wear, skin.souvenir),
          marketplace,
        )?.priceEur;
        if (price === undefined || skin.marketPrices[marketplace] === price) return skin;
        changed = true;
        return { ...skin, marketPrices: { ...skin.marketPrices, [marketplace]: price } };
      });
      // Same array when nothing moved: this effect runs on every dump or
      // market change, and returning a new array each time would write to
      // localStorage and re-render the whole table for no reason.
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceDump, marketplace, activeId, supportsLivePrices, openSkins.length]);

  /**
   * Re-prices everything.
   *
   * Downloads a fresh dump — ONE request for the whole catalogue, not one
   * per holding — and the effect above then re-applies it to every row.
   */
  const refreshAllPrices = async () => {
    setRefreshingAll(true);
    try {
      await priceDump.refresh();
      const updated = openSkins.filter((s) => dumpPriceFor(s) !== null).length;
      // Deliberately a single grouped toast: refreshing 40 skins should
      // not fire 40 notifications.
      showPriceToast({
        variant: updated > 0 ? "success" : "warning",
        title: t("refreshedCount").replace("{count}", String(updated)),
        ...(updated < openSkins.length
          ? {
              description: t("refreshedSkipped").replace(
                "{count}",
                String(openSkins.length - updated),
              ),
            }
          : {}),
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
    // The market price is NOT required.
    //
    // It used to be, back when the form fetched it per skin: the field was
    // filled in for you, so demanding it was invisible. Now it is read from
    // the price dump, and a skin the dump does not cover left the field
    // empty — which turned "we have no price for this yet" into "Please
    // enter the current market price" and blocked the user from adding a
    // holding they had every right to add. What they know is what they
    // PAID; the current price is ours to find, and an empty field simply
    // means we have not found it yet.

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);

      // Re-arm the pulse so repeated submits keep drawing the eye.
      setFlashErrors(false);
      window.setTimeout(() => setFlashErrors(true), 0);
      window.setTimeout(() => setFlashErrors(false), 1600);

      const missing = [
        nextErrors.name && t("skinName"),
        nextErrors.buyPrice && t("buyPrice"),
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

    // A price only goes in if it IS one. An empty, zero or unparseable
    // field leaves the market unpriced, so the row reads as "no listings"
    // and the auto-refresh pass below treats it as something still to ask
    // about — rather than storing 0 and rendering a confident "0.00".
    const marketPrices: Partial<Record<MarketplaceId, number>> = {};
    const usable = (value: string | undefined): number | undefined => {
      if (value === undefined || value.trim() === "") return undefined;
      const n = Number(value);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };

    const own = usable(marketPrice);
    if (own !== undefined) marketPrices[marketplace] = own;
    for (const m of otherMarkets) {
      const other = usable(otherPrices[m.id]);
      if (other !== undefined) marketPrices[m.id] = other;
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
            disabled={refreshingAll}
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
              {/* The one place a spinner is still honest: the single dump
                  download, which the whole page shares. */}
              {supportsLivePrices && livePriceBusy && !refreshingAll && (
                <RefreshCw className="h-3 w-3 animate-spin text-primary" />
              )}
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
                          disabled={refreshingAll}
                          onClick={() => refreshOne(s, { notify: true })}
                        >
                          <RefreshCw
                            className={cn("h-4 w-4 text-primary", refreshingAll && "animate-spin")}
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
