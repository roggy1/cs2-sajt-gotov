import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ItemFactsCard, type VariantQuote, type WearQuote } from "@/components/item/ItemFactsCard";
import { CashoutPanel, type MarketQuote, type TradeMode } from "@/components/item/CashoutPanel";
import { SalesHistoryCard } from "@/components/item/SalesHistoryCard";
import { LanguageProvider, useI18n } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";
import { CurrencyProvider } from "@/lib/currency";
import { MarketplaceProvider, useMarketplace } from "@/lib/marketplace";
// The Inspect page compares across EVERY enabled market, including the
// research-only ones the portfolio deliberately does not carry.
import { INSPECT_MARKETS } from "@/lib/markets/registry";
import { AlertsProvider, useAlerts } from "@/lib/alerts";
import { PortfolioProvider, usePortfolio, inventoryKey } from "@/lib/portfolio";
import {
  useLocalStorage,
  migrateSkins,
  getEffectivePrice,
  type Skin,
  type Wear,
} from "@/lib/skins";
import { useCatalog } from "@/lib/catalog/useCatalog";
import { useLivePriceFetcher } from "@/lib/livePrice";
import { feeBreakdown } from "@/lib/fees";
import { useItemPageState, buildMarketHashName } from "@/lib/itemPage";
import { stripPhaseSuffix } from "@/lib/catalog/doppler";
import type { MarketplaceId } from "@/lib/markets/types";
import type { CatalogItem } from "@/lib/catalog/types";

export const Route = createFileRoute("/item/$id")({
  /**
   * Without a search schema TanStack Router does not surface `?variant=`
   * and `?wear=` to the page at all — they stay in the address bar but
   * `useSearch` returns nothing. That made the page silently fall back to
   * the first wear, so the right-hand panel priced Factory New while the
   * URL (and the left column) said Battle-Scarred.
   */
  validateSearch: (search: Record<string, unknown>): { variant?: string; wear?: string } => ({
    // Keys are OMITTED rather than set to undefined. Returning them always
    // present makes TanStack treat both as required, which forces every
    // `<Link to="/item/$id">` in the app to pass a `search` object it has
    // no opinion about — and puts `?variant=undefined` in the address bar.
    ...(typeof search.variant === "string" ? { variant: search.variant } : {}),
    ...(typeof search.wear === "string" ? { wear: search.wear } : {}),
  }),
  component: ItemPage,
});

function ItemPage() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <CurrencyProvider>
          <MarketplaceProvider>
            <PortfolioProvider>
              <AlertsProvider>
                <ItemContent />
              </AlertsProvider>
            </PortfolioProvider>
          </MarketplaceProvider>
        </CurrencyProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

function ItemContent() {
  const { t } = useI18n();
  const { id } = Route.useParams();
  const { activeId } = usePortfolio();
  const { data: catalog, isLoading } = useCatalog();
  const { fetchFor } = useLivePriceFetcher();
  const { marketplace, steamTaxPercent } = useMarketplace();
  const navigate = useNavigate();

  const [skins] = useLocalStorage<Skin[]>(inventoryKey(activeId), [], migrateSkins);
  const { evaluate } = useAlerts();

  // Same check the dashboard runs, so landing straight on an Inspect link
  // (from a notification, a bookmark or a shared URL) still surfaces any
  // alert that has fired since the last visit. Only holdings are priced
  // here — the wishlist lives on the dashboard and is checked there.
  const alertPrices = useMemo(
    () =>
      skins.map((s) => ({ id: s.id, price: getEffectivePrice(s, marketplace, steamTaxPercent) })),
    [skins, marketplace, steamTaxPercent],
  );
  useEffect(() => {
    evaluate(alertPrices, marketplace);
  }, [alertPrices, marketplace, evaluate]);

  // Buying vs selling flips both the ranking and the colours, and the
  // wear table follows it too so the whole page answers one question.
  const [mode, setMode] = useState<TradeMode>("selling");

  const item = useMemo(() => catalog?.find((i) => i.id === id), [catalog, id]);
  const pageState = useItemPageState(item);
  const { variant, wear, setVariant, setWear, marketHashName, availableWears } = pageState;

  /**
   * Live quotes, keyed by the exact selection they belong to.
   *
   * The key is stored WITH the data and compared during render, not reset
   * inside an effect. An effect runs after the commit, so a version that
   * cleared state there always painted one frame of the previous wear's
   * prices first — which read as "nothing happened" when switching wear.
   * Comparing here means data for a selection that is no longer on screen
   * can never be rendered at all.
   */
  const quoteKey = `${item?.id ?? ""}::${marketHashName}`;
  const [quoteState, setQuoteState] = useState<{
    key: string;
    byMarket: Partial<Record<MarketplaceId, MarketQuote>>;
  }>({ key: "", byMarket: {} });

  // Every market always has a row. A market still in flight renders as a
  // skeleton rather than being absent, so rows don't pop in and shift the
  // layout as each one lands — and, crucially, a row whose data belongs to
  // a selection the user has left is a skeleton too, not a stale number.
  const quotes = useMemo<MarketQuote[]>(() => {
    const byMarket = quoteState.key === quoteKey ? quoteState.byMarket : {};
    return INSPECT_MARKETS.map((m) => byMarket[m.id] ?? { market: m.id, loading: true });
  }, [quoteState, quoteKey]);

  const quotesLoading = quotes.some((q) => q.loading);

  const wearKey = `${item?.id ?? ""}::${variant}::${mode}`;
  const [wearState, setWearState] = useState<{ key: string; quotes: WearQuote[] }>({
    key: "",
    quotes: [],
  });
  const wearQuotes = useMemo<WearQuote[]>(() => {
    const ready = wearState.key === wearKey ? wearState.quotes : [];
    // Same rule as above: until this selection's own numbers exist, every
    // row is a skeleton — never the previous variant's prices.
    return availableWears.map((w) => ready.find((q) => q.wear === w) ?? { wear: w, loading: true });
  }, [wearState, wearKey, availableWears]);

  /**
   * Every finish of this sticker — its own entry included.
   *
   * Upstream models each finish as a separate catalog item, so the siblings
   * are already loaded; this just gathers the ones sharing a group id.
   * Skins have no group id and fall straight through to an empty list.
   */
  const stickerVariants = useMemo(() => {
    if (!catalog || !item?.variantGroupId) return [];
    return catalog.filter((c) => c.variantGroupId === item.variantGroupId);
  }, [catalog, item]);

  /**
   * Best price per finish, so the finish rows carry the same numbers the
   * wear rows do.
   *
   * Deliberately the SAME shape as the wear table: bulk-friendly markets
   * only, one row committed as it resolves, keyed so a stale reply for a
   * sticker the user has left is dropped rather than merged.
   */
  const variantKey = `${item?.variantGroupId ?? ""}::${mode}`;
  const [variantState, setVariantState] = useState<{ key: string; quotes: VariantQuote[] }>({
    key: "",
    quotes: [],
  });
  const variantQuotes = useMemo<VariantQuote[]>(() => {
    const ready = variantState.key === variantKey ? variantState.quotes : [];
    return stickerVariants.map(
      (v) => ready.find((q) => q.id === v.id) ?? { id: v.id, loading: true },
    );
  }, [variantState, variantKey, stickerVariants]);

  useEffect(() => {
    if (stickerVariants.length < 2) return;
    let cancelled = false;

    const fastMarkets = INSPECT_MARKETS.filter((m) => m.capabilities.bulkFriendly);
    setVariantState({ key: variantKey, quotes: [] });

    for (const option of stickerVariants) {
      void (async () => {
        // Every row commits exactly once, whatever happens in between.
        // A row that never commits stays a skeleton forever, which is how
        // a single unexpected throw used to leave the table spinning; the
        // fallback row renders as "n/a", which is at least the truth.
        let row: VariantQuote = { id: option.id };
        try {
          const priced = await Promise.all(
            fastMarkets.map(async (market) => {
              const { priceEur } = await fetchFor(
                { name: option.marketHashName ?? option.name },
                market.id,
              );
              if (priceEur === null) return null;
              const breakdown = feeBreakdown(priceEur, market.id, {
                sellerFeePercent: steamTaxPercent,
                sellerFeeMarket: "steam",
              });
              return {
                market: market.id,
                net: mode === "selling" ? breakdown.net : breakdown.gross,
              };
            }),
          );

          const best = priced
            .filter((p): p is { market: MarketplaceId; net: number } => p !== null)
            .sort((a, b) => (mode === "selling" ? b.net - a.net : a.net - b.net))[0];

          row = { id: option.id, bestNet: best?.net, bestMarket: best?.market };
        } catch (err) {
          console.warn("[item] variant quote failed:", err);
        } finally {
          if (!cancelled) {
            setVariantState((prev) =>
              prev.key !== variantKey
                ? prev
                : {
                    key: prev.key,
                    quotes: [...prev.quotes.filter((q) => q.id !== option.id), row],
                  },
            );
          }
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [stickerVariants, variantKey, fetchFor, steamTaxPercent, mode]);

  /**
   * Switching finish is a navigation, not a local state change.
   *
   * Each finish is a different catalog entry with its own artwork, market
   * name and capsule, so routing to it updates the picture, the title, the
   * capsule and the live prices through the paths that already exist —
   * and leaves a URL that points at the finish actually on screen.
   */
  const selectStickerVariant = useCallback(
    (next: CatalogItem) => {
      void navigate({ to: "/item/$id", params: { id: next.id } });
    },
    [navigate],
  );

  /** Copies of this skin the user actually owns, matched by base name. */
  const ownedCopies = useMemo(() => {
    if (!item) return [];
    const base = stripPhaseSuffix(item.name).replace(/^(StatTrak™|Souvenir)\s+/, "");
    return skins.filter((s) =>
      stripPhaseSuffix(s.name)
        .replace(/^(StatTrak™|Souvenir)\s+/, "")
        .includes(base),
    );
  }, [skins, item]);

  // Prices for the currently selected variant + wear.
  //
  // Each market is committed to state the moment IT resolves instead of
  // awaiting Promise.all. Steam is by far the slowest of the three, and
  // waiting for it meant Skinport and CSFloat — both effectively instant —
  // sat invisible behind it for as long as Steam took.
  useEffect(() => {
    if (!item || !marketHashName) return;
    let cancelled = false;

    setQuoteState({ key: quoteKey, byMarket: {} });

    for (const market of INSPECT_MARKETS) {
      void (async () => {
        // Same contract as the tables below: this row leaves the loading
        // state no matter what, even if the lookup throws outright.
        let row: MarketQuote = { market: market.id };
        try {
          const result = await fetchFor(
            { name: marketHashName, phase: item.phase, paintIndex: item.paintIndex },
            market.id,
            false,
            true, // withCount — the item page shows per-market depth
          );
          row = {
            market: market.id,
            lowestSell: result.priceEur ?? undefined,
            listingCount: result.listingCount,
            volume24h: result.volume24h,
          };
        } catch (err) {
          console.warn(`[item] ${market.id} quote failed:`, err);
        } finally {
          if (!cancelled) {
            setQuoteState((prev) =>
              // A late reply for a wear the user already navigated away
              // from is dropped, not merged.
              prev.key !== quoteKey
                ? prev
                : { key: prev.key, byMarket: { ...prev.byMarket, [market.id]: row } },
            );
          }
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [item, marketHashName, quoteKey, fetchFor]);

  // Wear table: every wear x every market would mean ~15 lookups. The table
  // is a browsing aid, so it queries only the bulk-friendly markets and runs
  // them all in parallel; Steam is priced for the one wear actually
  // selected, in the panel above. Rows also commit individually, so the
  // cheap wears fill in without waiting for the slowest.
  useEffect(() => {
    if (!item || availableWears.length === 0) return;
    let cancelled = false;

    const fastMarkets = INSPECT_MARKETS.filter((m) => m.capabilities.bulkFriendly);
    setWearState({ key: wearKey, quotes: [] });

    for (const w of availableWears) {
      void (async () => {
        const name = buildMarketHashName(item, variant, w);
        let row: WearQuote = { wear: w };
        try {
          const priced = await Promise.all(
            fastMarkets.map(async (market) => {
              const { priceEur } = await fetchFor(
                { name, phase: item.phase, paintIndex: item.paintIndex },
                market.id,
              );
              if (priceEur === null) return null;
              const breakdown = feeBreakdown(priceEur, market.id, {
                sellerFeePercent: steamTaxPercent,
                sellerFeeMarket: "steam",
              });
              // Buyers rank on what they pay, sellers on what they receive.
              return {
                market: market.id,
                net: mode === "selling" ? breakdown.net : breakdown.gross,
              };
            }),
          );

          const best = priced
            .filter((p): p is { market: MarketplaceId; net: number } => p !== null)
            .sort((a, b) => (mode === "selling" ? b.net - a.net : a.net - b.net))[0];

          row = { wear: w, bestNet: best?.net, bestMarket: best?.market };
        } catch (err) {
          console.warn("[item] wear quote failed:", err);
        } finally {
          if (!cancelled) {
            setWearState((prev) =>
              prev.key !== wearKey
                ? prev
                : { key: prev.key, quotes: [...prev.quotes.filter((q) => q.wear !== w), row] },
            );
          }
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [item, variant, wearKey, availableWears, fetchFor, steamTaxPercent, mode]);

  return (
    <div className="min-h-screen">
      <SiteHeader skins={skins} onSteamImport={() => {}} />

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <Button variant="ghost" size="sm" className="gap-2" asChild>
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
            {t("inventory")}
          </Link>
        </Button>

        {isLoading ? (
          <div className="panel h-96 animate-pulse" />
        ) : !item ? (
          <section className="panel p-8 text-center text-sm text-muted-foreground">
            {t("noSkinFound")}
          </section>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <ItemFactsCard
              item={item}
              variant={variant}
              onVariantChange={setVariant}
              wear={wear}
              onWearChange={setWear}
              availableWears={availableWears}
              wearQuotes={wearQuotes}
              ownedCopies={ownedCopies}
              stickerVariants={stickerVariants}
              variantQuotes={variantQuotes}
              onStickerVariantSelect={selectStickerVariant}
            />
            <CashoutPanel
              item={item}
              variant={variant}
              wear={wear}
              quotes={quotes}
              loading={quotesLoading}
              mode={mode}
              onModeChange={setMode}
            />

            {/* Full width under both columns: sales history is about the
                item, not about one market's current offer. */}
            <div className="lg:col-span-2">
              <SalesHistoryCard marketHashName={marketHashName} />
            </div>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
