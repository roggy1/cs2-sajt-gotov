import { Info } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { ShimmerText } from "@/components/ShimmerText";
import { cn } from "@/lib/utils";
import bmcLogo from "@/assets/brand/buymeacoffee.png";

/** Where the coffee button points. */
const BUY_ME_A_COFFEE_URL = "https://buymeacoffee.com/cmigi";

/**
 * Not translated, on purpose — the same rule the Valve notice follows.
 * "Buy me a coffee" is the platform's own wording and the signature is a
 * name; running either through the dictionary would produce six different
 * spellings of one brand.
 */
const BUY_ME_A_COFFEE_LABEL = "Buy me a coffee";
const AUTHOR_SIGNATURE = "Developed by cmigi";

/**
 * Legal disclaimer, support link and author signature, shown on every page.
 *
 * The disclaimers are two separate statements, deliberately kept apart:
 *
 * 1. Our own caveat about the numbers. Every price here is a snapshot of a
 *    third-party market taken minutes or hours ago, net of a fee schedule
 *    we do not control — so it is a guide, not a quote.
 * 2. Valve's trademark notice, which is a fixed legal formula and is
 *    therefore NOT translated; the surrounding text is.
 *
 * Layout: one centred column on phones, two columns from `md` up — the
 * legal text takes the width it needs, the support block sits against the
 * right edge. The legal text stays first in the DOM at every width, since
 * that is the order it should be read (and announced) in.
 */
export function SiteFooter({ className }: { className?: string }) {
  const { t } = useI18n();

  return (
    <footer
      className={cn("mt-10 border-t border-border/70 bg-background/60 backdrop-blur-sm", className)}
    >
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between md:gap-10">
          <div className="space-y-3 text-center md:max-w-3xl md:text-left">
            <p className="flex flex-col items-center gap-2 text-xs leading-relaxed text-muted-foreground sm:flex-row sm:items-start sm:text-left">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.5} />
              <span>{t("footerPrices")}</span>
            </p>
            <p className="text-[11px] leading-relaxed text-muted-foreground/80">
              {t("footerValve")} {t("footerAffiliation")}
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-center gap-3 md:items-end">
            <a
              href={BUY_ME_A_COFFEE_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={BUY_ME_A_COFFEE_LABEL}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-4 py-2",
                // Buy Me a Coffee's own colours (#FFDD00 on #0D0C22), so the
                // button reads as theirs rather than as one of ours — which
                // is what their brand guidance asks for, and what makes it
                // recognisable at a glance.
                "bg-[#FFDD00] text-[#0D0C22] shadow-sm",
                "text-sm font-semibold tracking-tight",
                "transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-md",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFDD00] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              )}
            >
              <img
                src={bmcLogo}
                alt=""
                aria-hidden="true"
                width={20}
                height={20}
                className="h-5 w-5 shrink-0 object-contain"
              />
              {BUY_ME_A_COFFEE_LABEL}
            </a>

            {/* The exact effect the header title uses — the same component,
                so the two can never drift apart. */}
            <ShimmerText text={AUTHOR_SIGNATURE} className="text-xs" />
          </div>
        </div>
      </div>
    </footer>
  );
}
