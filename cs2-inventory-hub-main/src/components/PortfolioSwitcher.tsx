import { useEffect, useState } from "react";
import { Check, ChevronDown, Plus, Pencil, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useI18n } from "@/lib/i18n";
import {
  usePortfolio,
  isMainPortfolio,
  PORTFOLIO_ACCENTS,
  type Portfolio,
  type PortfolioIconId,
} from "@/lib/portfolio";
import { PortfolioIcon, PORTFOLIO_ICON_IDS } from "@/components/PortfolioIcon";
import { useSteamProfile } from "@/lib/steamAuth";
import { cn } from "@/lib/utils";

export function PortfolioSwitcher() {
  const { t } = useI18n();
  const { portfolios, activeId, active, setActiveId, deletePortfolio } = usePortfolio();
  const { data: steamProfile } = useSteamProfile();
  const steamAvatar = steamProfile?.authenticated ? steamProfile.avatar : null;

  /**
   * Main is the Steam-backed portfolio, so it wears the user's avatar.
   * Identified by id rather than the steamSync flag — the id is immutable,
   * whereas the flag can be missing on lists saved by an older build.
   * Falls back to the vector icon when there's no avatar (signed out, or
   * Steam didn't return one).
   */
  const renderIcon = (p: Portfolio) =>
    (isMainPortfolio(p.id) || p.steamSync) && steamAvatar ? (
      <img
        src={steamAvatar}
        alt=""
        aria-hidden="true"
        className="h-5 w-5 shrink-0 rounded-full border border-white/10 object-cover"
      />
    ) : (
      <PortfolioIcon icon={p.icon} accent={p.accent} />
    );
  const [editing, setEditing] = useState<Portfolio | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5 bg-secondary/60">
            {renderIcon(active)}
            <span className="hidden max-w-[9rem] truncate font-semibold sm:inline">
              {active.name}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>{t("portfolios")}</DropdownMenuLabel>
          {portfolios.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => setActiveId(p.id)} className="gap-2">
              {renderIcon(p)}
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {activeId === p.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
              <button
                type="button"
                aria-label={t("edit")}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setEditing(p);
                }}
                className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            {t("newPortfolio")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <PortfolioDialog
        open={creating || editing !== null}
        portfolio={editing}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
        onDelete={
          // Main is Steam-bound and permanently protected from deletion.
          editing && !isMainPortfolio(editing.id) && portfolios.length > 1
            ? () => {
                deletePortfolio(editing.id);
                setEditing(null);
              }
            : undefined
        }
      />
    </>
  );
}

function PortfolioDialog({
  open,
  portfolio,
  onOpenChange,
  onDelete,
}: {
  open: boolean;
  portfolio: Portfolio | null;
  onOpenChange: (open: boolean) => void;
  onDelete?: () => void;
}) {
  const { t } = useI18n();
  const { createPortfolio, updatePortfolio } = usePortfolio();

  const [name, setName] = useState("");
  const [icon, setIcon] = useState<PortfolioIconId>("briefcase");
  const [accent, setAccent] = useState<string>(PORTFOLIO_ACCENTS[0]);

  // Main is permanently bound to the Steam avatar, so its icon and accent
  // are not user-editable — only the name is.
  const isMain = portfolio ? isMainPortfolio(portfolio.id) : false;

  useEffect(() => {
    if (!open) return;
    setName(portfolio?.name ?? "");
    setIcon(portfolio?.icon ?? "briefcase");
    setAccent(portfolio?.accent ?? PORTFOLIO_ACCENTS[0]);
  }, [open, portfolio]);

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (portfolio) updatePortfolio(portfolio.id, { name: trimmed, icon, accent });
    else createPortfolio({ name: trimmed, icon, accent });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{portfolio ? t("editPortfolio") : t("newPortfolio")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              {t("portfolioName")}
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("portfolioNamePlaceholder")}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
              }}
            />
          </div>

          {!isMain && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                {t("icon")}
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {PORTFOLIO_ICON_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setIcon(id)}
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-md border transition-colors",
                      icon === id
                        ? "border-primary/60 bg-primary/10"
                        : "border-border bg-secondary/40 hover:bg-secondary/70",
                    )}
                  >
                    <PortfolioIcon icon={id} accent={icon === id ? accent : undefined} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {!isMain && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                {t("accentColor")}
              </Label>
              <div className="flex flex-wrap gap-2">
                {PORTFOLIO_ACCENTS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    onClick={() => setAccent(c)}
                    style={{ backgroundColor: c }}
                    className={cn(
                      "h-7 w-7 rounded-full transition-transform",
                      accent === c
                        ? "scale-110 ring-2 ring-foreground/70 ring-offset-2 ring-offset-background"
                        : "hover:scale-105",
                    )}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          {onDelete ? (
            <Button type="button" variant="ghost" onClick={onDelete} className="gap-2">
              <Trash2 className="h-4 w-4 text-loss" />
              {t("delete")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="button" onClick={save} disabled={!name.trim()}>
              {t("save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
