import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { LogOut, Download, Loader2, ShieldAlert, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { useSteamProfile, useSteamInventoryImport, steamLogout } from "@/lib/steamAuth";
import type { Skin } from "@/lib/skins";
import { showPriceToast, showFormToast } from "@/components/PriceToast";

const STEAM_PRIVACY_URL = "https://steamcommunity.com/my/edit/settings";

export function SteamProfileMenu({
  onImport,
}: {
  skins: Skin[];
  onImport: (items: { marketHashName: string; iconUrl: string; assetId: string }[]) => void;
}) {
  const { t } = useI18n();
  const { data: profile, isLoading } = useSteamProfile();
  const importInventory = useSteamInventoryImport();
  const [privateInventory, setPrivateInventory] = useState(false);

  if (isLoading) {
    return <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-secondary/60" />;
  }

  if (!profile?.authenticated) {
    return (
      <Button variant="outline" size="sm" className="gap-2 bg-secondary/60" asChild>
        <a href="/api/steam-login">
          <img src="/market-logos/steam.png" alt="" aria-hidden="true" className="h-4 w-4" />
          <span className="hidden sm:inline">{t("signInSteam")}</span>
        </a>
      </Button>
    );
  }

  const runImport = () => {
    setPrivateInventory(false);
    importInventory.mutate(undefined, {
      onSuccess: (result) => {
        if (result.error) {
          console.warn("[steam-import] failed:", result.error);
        }
        if (result.error === "private_inventory") {
          setPrivateInventory(true);
          showFormToast({ variant: "warning", title: t("privateInventoryTitle") });
          return;
        }
        if (result.error === "rate_limited") {
          showFormToast({ variant: "warning", title: t("inventoryRateLimited") });
          return;
        }
        if (result.items.length === 0) {
          // Genuinely nothing to import. This is NOT a pricing problem —
          // the old wording ("no listings") made it look like one.
          console.warn("[steam-import] Steam returned an empty CS2 inventory");
          showFormToast({ variant: "warning", title: t("emptyInventoryTitle") });
          return;
        }
        console.info(`[steam-import] received ${result.items.length} items`);
        // Guarded so a failure inside the handler can never surface as an
        // unhandled rejection or leave the user without feedback.
        try {
          onImport(result.items);
          showPriceToast({
            variant: "success",
            title: t("importedCount").replace("{count}", String(result.items.length)),
            description: profile.personaName ?? undefined,
          });
        } catch (err) {
          console.error("[steam-import] handler threw:", err);
          showFormToast({ variant: "warning", title: t("csfloatFetchError") });
        }
      },
      onError: (err) => {
        console.error("[steam-import] request threw:", err);
        showFormToast({ variant: "warning", title: t("csfloatFetchError") });
      },
    });
  };

  return (
    <div className="flex items-center gap-1.5">
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("importInventory")}
              disabled={importInventory.isPending}
              onClick={runImport}
              className="border-emerald-400/40 bg-emerald-400/10 text-emerald-400 hover:border-emerald-400/60 hover:bg-emerald-400/20 hover:text-emerald-300 hover:shadow-[0_0_16px_-4px_theme(colors.emerald.400)]"
            >
              {importInventory.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {importInventory.isPending ? t("importing") : t("importInventory")}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Avatar goes straight to the full profile page. */}
      <Link
        to="/profile"
        aria-label={profile.personaName ?? "Steam profile"}
        className="shrink-0 rounded-full ring-offset-background transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        <img
          src={profile.avatar ?? ""}
          alt=""
          className="h-8 w-8 rounded-full border border-white/10 object-cover"
        />
      </Link>

      {/* Quick sign-out, no need to open the profile page first. */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("signOut")}
        title={t("signOut")}
        onClick={async () => {
          await steamLogout();
          window.location.href = "/";
        }}
      >
        <LogOut className="h-4 w-4 text-muted-foreground transition-colors hover:text-loss" />
      </Button>

      {privateInventory && (
        <div className="fixed right-4 top-20 z-50 w-72 rounded-xl border border-amber-400/30 bg-background/70 p-4 shadow-xl backdrop-blur-md">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-400">
            <ShieldAlert className="h-4 w-4" />
            {t("privateInventoryTitle")}
          </p>
          <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
            {t("privateInventoryBody")}
          </p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <a
              href={STEAM_PRIVACY_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-amber-400 hover:underline"
            >
              {t("openSteamSettings")} <ExternalLink className="h-3 w-3" />
            </a>
            <button
              type="button"
              onClick={() => setPrivateInventory(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
