import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { StatsCards } from "@/components/StatsCards";
import { InventoryValueChart } from "@/components/InventoryValueChart";
import { MarketplaceComparison } from "@/components/MarketplaceComparison";
import { InventorySection } from "@/components/InventorySection";
import { WishlistSection } from "@/components/WishlistSection";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LanguageProvider, useI18n } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";
import { CurrencyProvider } from "@/lib/currency";
import { MarketplaceProvider } from "@/lib/marketplace";
import {
  useLocalStorage,
  migrateSkins,
  getEffectivePrice,
  type Skin,
  type WishItem,
} from "@/lib/skins";
import { AlertsProvider, useAlerts } from "@/lib/alerts";
import {
  PortfolioProvider,
  usePortfolio,
  inventoryKey,
  wishlistKey,
  readPortfolioRaw,
  writePortfolioRaw,
  DEFAULT_PORTFOLIO_ID,
} from "@/lib/portfolio";
import { useLivePriceFetcher } from "@/lib/livePrice";
import { useMarketplace, MARKETPLACES, type MarketplaceId } from "@/lib/marketplace";
import { WEARS, type Wear } from "@/lib/skins";
import { showPriceToast } from "@/components/PriceToast";
import { useCallback, useEffect, useMemo } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CS2 Skin Tracker — Prices, Budget & Investments" },
      {
        name: "description",
        content:
          "Track your CS2 skin inventory value, invested budget, profit or loss and wishlist targets in a dark-mode gaming dashboard.",
      },
      { property: "og:title", content: "CS2 Skin Tracker — Prices, Budget & Investments" },
      {
        property: "og:description",
        content:
          "Dark-mode CS2 dashboard for skin prices, budget tracking, profit/loss and wishlist targets.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <CurrencyProvider>
          <MarketplaceProvider>
            <PortfolioProvider>
              <AlertsProvider>
                <Dashboard />
              </AlertsProvider>
            </PortfolioProvider>
          </MarketplaceProvider>
        </CurrencyProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

function Dashboard() {
  const { t } = useI18n();
  const { activeId, setActiveId } = usePortfolio();
  const { marketplace, steamTaxPercent } = useMarketplace();
  const { fetchFor } = useLivePriceFetcher();
  const { evaluate } = useAlerts();

  // Storage keys are per portfolio, so switching swaps the whole dataset —
  // holdings, wishlist and value history stay fully isolated.
  const [skins, setSkins] = useLocalStorage<Skin[]>(inventoryKey(activeId), [], migrateSkins);
  const [wish, setWish] = useLocalStorage<WishItem[]>(wishlistKey(activeId), []);

  /**
   * Every price an alert could be watching, from BOTH lists.
   *
   * Holdings are compared net of the active market's fee — the same figure
   * the table shows — while a wishlist entry is compared on its tracked
   * price, since nothing is being sold there and no fee applies.
   */
  const alertPrices = useMemo(
    () => [
      ...skins.map((s) => ({
        id: s.id,
        price: getEffectivePrice(s, marketplace, steamTaxPercent),
      })),
      ...wish.map((w) => ({ id: w.id, price: w.marketPrice })),
    ],
    [skins, wish, marketplace, steamTaxPercent],
  );

  /**
   * Price alerts are checked against whatever prices are currently stored:
   * on first load, and again after every refresh (a refresh writes into
   * `skins` or `wish`, which is this effect's input). Nothing here fetches
   * — the alert layer only ever reads the prices the app already has, so a
   * notification can never cost an extra API call.
   */
  useEffect(() => {
    evaluate(alertPrices, marketplace);
  }, [alertPrices, marketplace, evaluate]);

  /**
   * STEP 2 — pricing.
   *
   * Runs only after the items are already safely in storage, and every
   * single call is isolated: a throw, a timeout or a "no listings" answer
   * for one skin can never abort the pass or undo the import. Progress is
   * flushed to storage as it goes, so even a hard failure halfway through
   * keeps whatever was priced up to that point.
   */
  const priceImportedItems = useCallback(
    async (list: Skin[]) => {
      const mainKey = inventoryKey(DEFAULT_PORTFOLIO_ID);
      // Active marketplace first, then the others as fallbacks for rarer
      // items. Each price is stored under the market it actually came from.
      const fallbackOrder: MarketplaceId[] = [
        marketplace,
        ...MARKETPLACES.map((m) => m.id).filter((id) => id !== marketplace),
      ];

      const working = [...list];
      let priced = 0;
      let unpriced = 0;

      const flush = () => {
        try {
          writePortfolioRaw(mainKey, working);
          if (activeId === DEFAULT_PORTFOLIO_ID) setSkins([...working]);
        } catch (err) {
          console.error("[steam-import] failed to persist pricing progress:", err);
        }
      };

      for (let i = 0; i < working.length; i++) {
        const skin = working[i]!;
        if (skin.marketPrices[marketplace] !== undefined) continue;

        let found = false;
        for (const market of fallbackOrder) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const { priceEur } = await fetchFor(skin, market);
            if (priceEur !== null) {
              working[i] = {
                ...skin,
                marketPrices: { ...skin.marketPrices, [market]: priceEur },
              };
              priced++;
              found = true;
              break;
            }
          } catch (err) {
            // Isolated on purpose: log and move on to the next market.
            console.warn(`[steam-import] pricing threw for "${skin.name}" on ${market}:`, err);
          }
        }

        if (!found) {
          unpriced++;
          console.info(
            `[steam-import] no listings on any market for "${skin.name}" — kept unpriced`,
          );
        }

        // Flush periodically so a crash never costs the whole pass.
        if (i % 10 === 9) flush();
      }

      flush();
      console.info(
        `[steam-import] pricing done — ${priced} priced, ${unpriced} without listings, ${working.length} total`,
      );
      showPriceToast({
        variant: priced > 0 ? "success" : "warning",
        title: t("refreshedCount").replace("{count}", String(priced)),
        market: marketplace,
      });
    },
    [activeId, setSkins, marketplace, fetchFor, t],
  );

  /**
   * STEP 1 — import.
   *
   * Saves every pulled item into Main straight away, before a single price
   * is requested. Pricing is kicked off afterwards and deliberately not
   * awaited, so the import is complete and durable regardless of what any
   * marketplace does.
   */
  const handleSteamImport = useCallback(
    (items: { marketHashName: string; iconUrl: string; assetId: string }[]) => {
      let merged: Skin[];
      try {
        const mainKey = inventoryKey(DEFAULT_PORTFOLIO_ID);
        const existingSkins = readPortfolioRaw<Skin[]>(mainKey, []);
        const byAsset = new Map(existingSkins.filter((s) => s.assetId).map((s) => [s.assetId!, s]));

        const imported: Skin[] = items.map((item) => {
          const { name, wear } = splitWear(item.marketHashName);
          const existing = byAsset.get(item.assetId);
          // Re-import updates in place and keeps prices already fetched.
          if (existing) return { ...existing, name, wear, image: item.iconUrl };
          return {
            id: crypto.randomUUID(),
            assetId: item.assetId,
            name,
            wear,
            category: "",
            buyPrice: 0,
            // No price yet — pricing is a separate, later step.
            marketPrices: {},
            image: item.iconUrl,
            quantity: 1,
          };
        });

        // Hand-added rows (no assetId) are never touched by a Steam sync.
        merged = [...imported, ...existingSkins.filter((s) => !s.assetId)];

        // Steam data always lands in Main, whichever portfolio is on screen.
        writePortfolioRaw(mainKey, merged);
        if (activeId === DEFAULT_PORTFOLIO_ID) setSkins(merged);
        else setActiveId(DEFAULT_PORTFOLIO_ID);

        console.info(`[steam-import] saved ${imported.length} items to Main portfolio`);
      } catch (err) {
        console.error("[steam-import] failed to save imported items:", err);
        showPriceToast({ variant: "warning", title: t("csfloatFetchError") });
        return;
      }

      // Fire-and-forget: the import above is already committed.
      void priceImportedItems(merged).catch((err) => {
        console.error("[steam-import] pricing pass failed entirely:", err);
      });
    },
    [activeId, setActiveId, setSkins, priceImportedItems, t],
  );

  return (
    <div className="min-h-screen">
      <SiteHeader skins={skins} onSteamImport={handleSteamImport} />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <StatsCards skins={skins} onSkinsChange={setSkins} />
        <InventoryValueChart skins={skins} />
        <MarketplaceComparison skins={skins} />
        <Tabs defaultValue="inventory">
          <TabsList>
            <TabsTrigger value="inventory">{t("inventory")}</TabsTrigger>
            <TabsTrigger value="wishlist">{t("wishlist")}</TabsTrigger>
          </TabsList>
          <TabsContent value="inventory" className="mt-4">
            <InventorySection skins={skins} setSkins={setSkins} />
          </TabsContent>
          <TabsContent value="wishlist" className="mt-4">
            <WishlistSection items={wish} setItems={setWish} />
          </TabsContent>
        </Tabs>
      </main>
      <SiteFooter />
    </div>
  );
}

/**
 * Steam's market_hash_name bakes the wear into the name
 * ("AK-47 | Redline (Field-Tested)"), while the app keeps them apart so the
 * table can show a wear badge. Split it back out, leaving anything without
 * a recognised wear untouched (cases, stickers, agents...).
 */
function splitWear(marketHashName: string): { name: string; wear?: Wear } {
  for (const wear of WEARS) {
    const suffix = ` (${wear})`;
    if (marketHashName.endsWith(suffix)) {
      return { name: marketHashName.slice(0, -suffix.length), wear };
    }
  }
  return { name: marketHashName };
}
