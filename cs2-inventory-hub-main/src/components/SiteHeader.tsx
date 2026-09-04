import { Link } from "@tanstack/react-router";
import { Check, ChevronDown, Palette } from "lucide-react";
import { useI18n, type Lang } from "@/lib/i18n";
import { useTheme, type ThemeId } from "@/lib/theme";
import { useCurrency, CURRENCY_CODE, CURRENCY_SYMBOL, type Currency } from "@/lib/currency";
import { FlagIcon } from "@/components/FlagIcon";
import { PortfolioSwitcher } from "@/components/PortfolioSwitcher";
import { SteamProfileMenu } from "@/components/SteamProfileMenu";
import { NotificationBell } from "@/components/NotificationBell";
import { ShimmerText } from "@/components/ShimmerText";
import type { Skin } from "@/lib/skins";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import classicIcon from "@/assets/theme-icons/theme-icon-classic.svg";
import ctIcon from "@/assets/theme-icons/theme-icon-ct.png";
import tIcon from "@/assets/theme-icons/theme-icon-t.png";
import brandLogo from "@/assets/brand/logo.png";

const THEME_ICON_SRC: Record<ThemeId, string> = {
  go: classicIcon,
  ct: ctIcon,
  t: tIcon,
};

function ThemeIcon({ theme, className }: { theme: ThemeId; className?: string }) {
  return (
    <img
      src={THEME_ICON_SRC[theme]}
      alt=""
      className={cn(theme === "go" ? "object-contain" : "rounded-full object-cover", className)}
    />
  );
}

const CURRENCIES: Currency[] = ["usd", "eur", "gbp", "rub"];

const LANGS: { id: Lang; flag: "gb" | "rs" | "de" | "ru" | "es" | "pt"; label: string }[] = [
  { id: "en", flag: "gb", label: "EN" },
  { id: "de", flag: "de", label: "DE" },
  { id: "ru", flag: "ru", label: "RU" },
  { id: "es", flag: "es", label: "ES" },
  { id: "pt", flag: "pt", label: "PT" },
  { id: "sr", flag: "rs", label: "SR" },
];

export function SiteHeader({
  skins,
  onSteamImport,
}: {
  skins: Skin[];
  onSteamImport: (items: { marketHashName: string; iconUrl: string; assetId: string }[]) => void;
}) {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  const { currency, setCurrency } = useCurrency();

  const activeLang = LANGS.find((l) => l.id === lang) ?? LANGS[0]!;

  const themes: { id: ThemeId; label: string }[] = [
    { id: "go", label: t("themeGO") },
    { id: "ct", label: t("themeCT") },
    { id: "t", label: t("themeT") },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <Link
          to="/"
          aria-label={t("appTitle")}
          className="group flex items-center gap-3 rounded-md outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <img
            src={brandLogo}
            alt=""
            width={44}
            height={44}
            className="h-11 w-11 shrink-0 object-contain drop-shadow-[0_0_10px_rgba(0,0,0,0.45)] transition-transform duration-200 group-hover:scale-105"
          />
          <div className="leading-tight">
            <ShimmerText as="h1" text={t("appTitle")} className="text-lg" />
            <p className="text-xs text-muted-foreground">{t("appSub")}</p>
          </div>
        </Link>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <PortfolioSwitcher />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 bg-secondary/60">
                <FlagIcon code={activeLang.flag} />
                <span className="font-semibold">{activeLang.label}</span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuLabel>{t("language")}</DropdownMenuLabel>
              {LANGS.map((l) => (
                <DropdownMenuItem key={l.id} onSelect={() => setLang(l.id)} className="gap-2">
                  <FlagIcon code={l.flag} />
                  <span className="flex-1 font-semibold">{l.label}</span>
                  {lang === l.id && <Check className="h-4 w-4 text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 bg-secondary/60">
                <span className="font-semibold">{CURRENCY_SYMBOL[currency]}</span>
                <span>{CURRENCY_CODE[currency]}</span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-32">
              {CURRENCIES.map((c) => (
                <DropdownMenuItem key={c} onSelect={() => setCurrency(c)} className="gap-2">
                  <span className="w-4 font-semibold">{CURRENCY_SYMBOL[c]}</span>
                  <span className="flex-1">{CURRENCY_CODE[c]}</span>
                  {currency === c && <Check className="h-4 w-4 text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 bg-secondary/60">
                <ThemeIcon theme={theme} className="h-4 w-4" />
                <Palette className="h-4 w-4 sm:hidden" />
                <span className="hidden sm:inline">{t("theme")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>{t("theme")}</DropdownMenuLabel>
              {themes.map((th) => (
                <DropdownMenuItem key={th.id} onSelect={() => setTheme(th.id)} className="gap-2">
                  <ThemeIcon theme={th.id} className="h-4 w-4" />
                  <span className="flex-1">{th.label}</span>
                  {theme === th.id && <Check className="h-4 w-4 text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Permanently next to the profile avatar: price alerts are
              worthless if the user has to go looking for them. */}
          <NotificationBell />

          <SteamProfileMenu skins={skins} onImport={onSteamImport} />
        </div>
      </div>
    </header>
  );
}
