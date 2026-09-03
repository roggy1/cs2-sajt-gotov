import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bell, CheckCheck, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/lib/i18n";
import { useAlerts, type PriceNotification } from "@/lib/alerts";
import { useInspectLink } from "@/lib/inspectLink";
import { useMoney, WEAR_STYLES } from "@/lib/skins";
import { MarketLogo } from "@/components/MarketLogo";
import { cn } from "@/lib/utils";

/**
 * The notification centre, permanently next to the profile avatar.
 *
 * Every entry is one price alert that has fired. Clicking it marks it read
 * and opens the Inspect page for exactly that item and wear — the whole
 * point of the notification is to get the user to the price they were
 * waiting for, so it never drops them on a generic page.
 */
export function NotificationBell() {
  const { t } = useI18n();
  const money = useMoney();
  const navigate = useNavigate();
  const inspectLink = useInspectLink();
  const { notifications, unreadCount, markRead, markAllRead, clearNotifications } = useAlerts();
  const [open, setOpen] = useState(false);

  const openNotification = (n: PriceNotification) => {
    markRead(n.notificationId);
    setOpen(false);
    const target = inspectLink(n);
    // Without a catalog match there is no Inspect page to open. Marking it
    // read is still right — the user has seen it.
    if (!target) return;
    void navigate({ to: "/item/$id", params: target.params, search: target.search });
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={
            unreadCount > 0
              ? `${t("notifications")} — ${t("unreadNotifications").replace("{count}", String(unreadCount))}`
              : t("notifications")
          }
          className="relative bg-secondary/60"
        >
          <Bell className={cn("h-4 w-4", unreadCount > 0 && "text-primary")} />
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground shadow"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[22rem] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
          <p className="text-sm font-semibold">{t("notifications")}</p>
          {notifications.length > 0 && (
            <span className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label={t("markAllRead")}
                title={t("markAllRead")}
                onClick={markAllRead}
              >
                <CheckCheck className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label={t("clearAll")}
                title={t("clearAll")}
                onClick={clearNotifications}
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </span>
          )}
        </div>

        {notifications.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            {t("noNotifications")}
          </p>
        ) : (
          <ScrollArea className="max-h-80">
            <ul className="divide-y divide-border/60">
              {notifications.map((n) => {
                const up = n.direction === "up";
                return (
                  <li key={n.notificationId}>
                    <button
                      type="button"
                      onClick={() => openNotification(n)}
                      className={cn(
                        "flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-secondary/70",
                        !n.read && "bg-primary/[0.06]",
                      )}
                    >
                      {n.image ? (
                        <img
                          src={n.image}
                          alt=""
                          loading="lazy"
                          className="h-8 w-12 shrink-0 object-contain"
                        />
                      ) : (
                        <span className="h-8 w-12 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-semibold">{n.name}</span>
                          {!n.read && (
                            <span
                              aria-hidden="true"
                              className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                            />
                          )}
                        </span>
                        {n.wear && (
                          <span
                            className={cn(
                              "mt-0.5 inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold",
                              WEAR_STYLES[n.wear],
                            )}
                          >
                            {n.wear}
                          </span>
                        )}
                        <span
                          className={cn(
                            "mt-1 flex items-center gap-1.5 font-mono text-xs font-semibold",
                            up ? "text-profit" : "text-loss",
                          )}
                        >
                          {up ? (
                            <TrendingUp className="h-3.5 w-3.5" />
                          ) : (
                            <TrendingDown className="h-3.5 w-3.5" />
                          )}
                          {(up ? t("alertHitUp") : t("alertHitDown")).replace(
                            "{price}",
                            money(n.price),
                          )}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                          <MarketLogo market={n.market} className="h-3 w-3" />
                          {t("targetPrice")}: {money(n.targetPrice)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
