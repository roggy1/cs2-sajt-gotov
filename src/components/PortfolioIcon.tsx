import {
  Briefcase,
  Gem,
  Crosshair,
  Swords,
  TrendingUp,
  Wallet,
  Package,
  Star,
  Shield,
  Flame,
  Target,
  Coins,
  type LucideIcon,
} from "lucide-react";
import type { PortfolioIconId } from "@/lib/portfolio";
import { cn } from "@/lib/utils";

/**
 * Curated icon set for portfolios — clean Lucide vectors only, no generated
 * imagery. Gaming, weapon and finance motifs so a portfolio reads at a
 * glance ("Investments" vs "Play skins" vs "Steam sync").
 */
export const PORTFOLIO_ICONS: Record<PortfolioIconId, LucideIcon> = {
  briefcase: Briefcase,
  gem: Gem,
  crosshair: Crosshair,
  swords: Swords,
  trending: TrendingUp,
  wallet: Wallet,
  package: Package,
  star: Star,
  shield: Shield,
  flame: Flame,
  target: Target,
  coins: Coins,
};

export const PORTFOLIO_ICON_IDS = Object.keys(PORTFOLIO_ICONS) as PortfolioIconId[];

export function PortfolioIcon({
  icon,
  accent,
  className,
}: {
  icon: PortfolioIconId;
  accent?: string;
  className?: string;
}) {
  const Icon = PORTFOLIO_ICONS[icon] ?? Briefcase;
  return (
    <Icon
      className={cn("h-4 w-4 shrink-0", className)}
      strokeWidth={1.75}
      style={accent ? { color: accent } : undefined}
    />
  );
}
