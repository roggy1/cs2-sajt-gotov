import { toast } from "sonner";
import { Check, TriangleAlert } from "lucide-react";
import { MarketLogo } from "@/components/MarketLogo";
import type { MarketplaceId } from "@/lib/marketplace";
import { cn } from "@/lib/utils";

type PriceToastVariant = "success" | "warning";

interface PriceToastOptions {
  variant: PriceToastVariant;
  title: string;
  /** Usually the skin name, or a short explanation for warnings. */
  description?: string;
  market?: MarketplaceId;
}

const VARIANT_STYLES: Record<
  PriceToastVariant,
  { rail: string; iconRing: string; icon: string; glow: string }
> = {
  success: {
    rail: "bg-emerald-400",
    iconRing: "border-emerald-400/30 bg-emerald-400/10",
    icon: "text-emerald-400",
    glow: "shadow-[0_0_28px_-10px_theme(colors.emerald.400)]",
  },
  warning: {
    // Amber rather than a hard red: a missing quote is information, not a
    // failure the user needs to panic about.
    rail: "bg-amber-400",
    iconRing: "border-amber-400/30 bg-amber-400/10",
    icon: "text-amber-400",
    glow: "shadow-[0_0_28px_-10px_theme(colors.amber.400)]",
  },
};

function PriceToastCard({ variant, title, description, market }: PriceToastOptions) {
  const styles = VARIANT_STYLES[variant];
  const Icon = variant === "success" ? Check : TriangleAlert;

  return (
    <div
      className={cn(
        "toast-enter pointer-events-auto flex w-[min(21rem,calc(100vw-2rem))] items-start gap-3",
        "overflow-hidden rounded-xl border border-white/10 bg-background/70 p-3 pl-0",
        "shadow-xl backdrop-blur-md",
        styles.glow,
      )}
    >
      <span
        className={cn("toast-accent-enter h-full w-[3px] self-stretch rounded-r", styles.rail)}
      />

      <span
        className={cn(
          "toast-icon-enter mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
          styles.iconRing,
        )}
      >
        <Icon className={cn("h-3.5 w-3.5", styles.icon)} strokeWidth={2.5} />
      </span>

      <div className="min-w-0 flex-1 pr-1">
        <p className="flex items-center gap-1.5 text-sm font-semibold leading-tight text-foreground">
          {market && <MarketLogo market={market} className="h-3.5 w-3.5" />}
          {title}
        </p>
        {description && (
          <p className="mt-0.5 truncate text-xs leading-tight text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Shows a price-refresh toast.
 *
 * Rendered through `toast.custom` so the card owns its own markup — that's
 * what makes the glass treatment, the accent rail and the staggered icon
 * animation possible, none of which Sonner's default toast exposes.
 */
export function showPriceToast(options: PriceToastOptions) {
  toast.custom(() => <PriceToastCard {...options} />, {
    duration: 2800,
  });
}

/**
 * Same card, for messages that aren't tied to a marketplace — form
 * validation and similar. Held slightly longer than a price toast, since
 * the user has to read *which* fields still need filling in.
 */
export function showFormToast(options: Omit<PriceToastOptions, "market">) {
  toast.custom(() => <PriceToastCard {...options} />, {
    duration: 3400,
  });
}
