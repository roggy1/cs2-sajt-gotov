import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { ArrowLeft, ExternalLink, LogOut, CalendarDays, Clock, Wallet, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { LanguageProvider, useI18n } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";
import { CurrencyProvider } from "@/lib/currency";
import { MarketplaceProvider, useMarketplace } from "@/lib/marketplace";
import { PortfolioProvider, DEFAULT_PORTFOLIO_ID, inventoryKey } from "@/lib/portfolio";
import { AlertsProvider } from "@/lib/alerts";
import {
  useLocalStorage,
  migrateSkins,
  useMoney,
  getEffectivePrice,
  sumEffectiveMarketValue,
  type Skin,
  isOpenPosition,
  countOwnedUnits,
} from "@/lib/skins";
import { useSteamProfile, steamLogout } from "@/lib/steamAuth";
import { catalogDisplayName } from "@/lib/catalog/doppler";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "Profile — CS2 Skin Tracker" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <CurrencyProvider>
          <MarketplaceProvider>
            <PortfolioProvider>
              <AlertsProvider>
                <ProfileContent />
              </AlertsProvider>
            </PortfolioProvider>
          </MarketplaceProvider>
        </CurrencyProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

function ProfileContent() {
  const { t } = useI18n();
  const money = useMoney();
  const { marketplace, steamTaxPercent } = useMarketplace();
  const { data: profile, isLoading } = useSteamProfile();

  // Deliberately reads Main only. Custom portfolios are the user's private
  // bookkeeping and must never inflate the verified Steam-backed figures.
  const [mainSkins] = useLocalStorage<Skin[]>(inventoryKey(DEFAULT_PORTFOLIO_ID), [], migrateSkins);

  const totalValue = sumEffectiveMarketValue(mainSkins, marketplace, steamTaxPercent);

  const mostExpensive = useMemo(() => {
    let best: { skin: Skin; value: number } | null = null;
    // Owned items only. A knife that was sold last month is not the most
    // expensive skin in an inventory that no longer contains it.
    for (const skin of mainSkins.filter(isOpenPosition)) {
      const value = getEffectivePrice(skin, marketplace, steamTaxPercent);
      if (value === undefined) continue;
      if (!best || value > best.value) best = { skin, value };
    }
    return best;
  }, [mainSkins, marketplace, steamTaxPercent]);

  const memberSince = profile?.memberSince
    ? new Date(profile.memberSince * 1000).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
      })
    : null;

  const logOut = async () => {
    await steamLogout();
    window.location.href = "/";
  };

  return (
    <div className="min-h-screen">
      <SiteHeader skins={mainSkins} onSteamImport={() => {}} />

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <Button variant="ghost" size="sm" className="gap-2" asChild>
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
            {t("inventory")}
          </Link>
        </Button>

        {isLoading ? (
          <div className="panel h-40 animate-pulse" />
        ) : !profile?.authenticated ? (
          <section className="panel p-8 text-center">
            <p className="mb-4 text-sm text-muted-foreground">{t("signInSteam")}</p>
            <Button asChild>
              <a href="/api/steam-login">
                <img src="/market-logos/steam.png" alt="" aria-hidden="true" className="h-4 w-4" />
                {t("signInSteam")}
              </a>
            </Button>
          </section>
        ) : (
          <>
            <section className="panel flex flex-col items-center gap-4 p-6 text-center sm:flex-row sm:text-left">
              <img
                src={profile.avatar ?? ""}
                alt=""
                className="h-24 w-24 shrink-0 rounded-full border border-white/10 object-cover"
              />
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-2xl font-bold">{profile.personaName}</h1>
                <a
                  href={`https://steamcommunity.com/profiles/${profile.steamId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
                >
                  <img
                    src="/market-logos/steam.png"
                    alt=""
                    aria-hidden="true"
                    className="h-4 w-4"
                  />
                  steamcommunity.com/profiles/{profile.steamId}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
              <Button variant="outline" className="gap-2 text-loss" onClick={logOut}>
                <LogOut className="h-4 w-4" />
                {t("signOut")}
              </Button>
            </section>

            <div className="grid gap-4 sm:grid-cols-2">
              <StatTile
                icon={<CalendarDays className="icon-glow h-5 w-5 text-primary" strokeWidth={1.5} />}
                label={t("memberSince")}
                value={memberSince ?? "—"}
                mono={false}
              />
              <StatTile
                icon={<Clock className="icon-glow h-5 w-5 text-primary" strokeWidth={1.5} />}
                label={t("cs2Playtime")}
                value={
                  profile.cs2Hours !== null && profile.cs2Hours !== undefined
                    ? `${profile.cs2Hours.toLocaleString()} ${t("hoursShort")}`
                    : "—"
                }
              />
              <StatTile
                icon={<Wallet className="icon-glow h-5 w-5 text-primary" strokeWidth={1.5} />}
                label={t("totalValue")}
                value={money(totalValue)}
              />
              <StatTile
                icon={<Trophy className="icon-glow h-5 w-5 text-primary" strokeWidth={1.5} />}
                label={t("itemCount")}
                value={String(countOwnedUnits(mainSkins))}
              />
            </div>

            {mostExpensive && (
              <section className="panel p-5 sm:p-6">
                <h2 className="mb-4 text-sm font-bold uppercase tracking-widest text-muted-foreground">
                  {t("mostExpensiveSkin")}
                </h2>
                <div className="flex items-center gap-4">
                  {mostExpensive.skin.image && (
                    <img
                      src={mostExpensive.skin.image}
                      alt=""
                      className="h-16 w-24 shrink-0 object-contain"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-semibold">
                      {catalogDisplayName(mostExpensive.skin)}
                    </p>
                    {mostExpensive.skin.wear && (
                      <p className="text-xs text-muted-foreground">{mostExpensive.skin.wear}</p>
                    )}
                    <p className="mt-1 font-mono text-2xl font-bold text-primary">
                      {money(mostExpensive.value)}
                    </p>
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  /** Figures get the monospace face; a date or a name does not. */
  mono = true,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="panel p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
        {icon}
      </div>
      <p className={cn("mt-3 text-2xl font-bold", mono && "font-mono")}>{value}</p>
    </div>
  );
}
