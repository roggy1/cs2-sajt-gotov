import { useState } from "react";
import { Layers, Trophy } from "lucide-react";
import { MarketLogo } from "@/components/MarketLogo";
import { ExternalLink } from "lucide-react";
import { buildMarketHashName } from "@/lib/itemPage";
import { useI18n } from "@/lib/i18n";
import { useMoney, type Skin, type Wear } from "@/lib/skins";
import { useMarketplace } from "@/lib/marketplace";
import { getMarket } from "@/lib/markets/registry";
import type { MarketplaceId } from "@/lib/markets/types";
import { STICKER_VARIANTS, type CatalogCrate, type CatalogItem } from "@/lib/catalog/types";
import { isWearless, wearRange, type ItemVariant } from "@/lib/itemPage";
import { floatBoundsFor } from "@/lib/wear";
import { catalogDisplayName } from "@/lib/catalog/doppler";
import { capsuleNamesTheEvent } from "@/lib/catalog/provenance";
import { cn } from "@/lib/utils";

/**
 * Best price for one sticker finish. Mirrors WearQuote so the two lists
 * can share a row component — keyed by catalog id because a finish IS a
 * separate catalog entry, not a label on this one.
 */
export interface VariantQuote {
  id: string;
  bestNet?: number | undefined;
  bestMarket?: MarketplaceId | undefined;
  loading?: boolean | undefined;
}

export interface WearQuote {
  wear: Wear;
  /** Best net proceeds across all markets for this wear. */
  bestNet?: number | undefined;
  bestMarket?: MarketplaceId | undefined;
  /** No numbers for this wear yet. Renders as a skeleton — never as the
   *  previous variant's price. */
  loading?: boolean | undefined;
}

export function ItemFactsCard({
  item,
  variant,
  onVariantChange,
  wear,
  onWearChange,
  availableWears,
  wearQuotes,
  ownedCopies,
  stickerVariants = [],
  variantQuotes = [],
  onStickerVariantSelect,
}: {
  item: CatalogItem;
  variant: ItemVariant;
  onVariantChange: (v: ItemVariant) => void;
  wear: Wear | null;
  onWearChange: (w: Wear) => void;
  availableWears: Wear[];
  wearQuotes: WearQuote[];
  ownedCopies: Skin[];
  /** Every finish of THIS sticker, this one included. Empty for skins. */
  stickerVariants?: CatalogItem[];
  /** Best price per finish, filled in as each resolves. */
  variantQuotes?: VariantQuote[];
  onStickerVariantSelect?: (item: CatalogItem) => void;
}) {
  const { t } = useI18n();
  const money = useMoney();

  // Straight off Valve's own flags. StatTrak™ and Souvenir are mutually
  // exclusive in CS2, so at most one of the two ever shows. `is*` covers
  // legacy entries that ARE already that variant, so opening a
  // "Souvenir AWP | Dragon Lore" page still offers its Souvenir tab.
  const variants: { id: ItemVariant; label: string; available: boolean }[] = [
    { id: "normal", label: t("variantNormal"), available: true },
    {
      id: "stattrak",
      label: "StatTrak™",
      available: !!item.stattrakCapable || !!item.isStattrak,
    },
    {
      id: "souvenir",
      label: t("souvenir"),
      available: !!item.souvenirCapable || !!item.isSouvenir,
    },
  ];

  return (
    <section className="panel overflow-hidden">
      <div className="p-5 sm:p-6">
        <h1 className="text-xl font-bold leading-tight">{catalogDisplayName(item)}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {item.collection && (
            <span className="inline-flex items-center gap-1.5" title={t("collectionLabel")}>
              {/* The collection's OWN artwork. This used to render the first
                  crate's image next to the collection name, which put a
                  case icon on a label that is not a case — and left every
                  collection without a crate showing a generic glyph. */}
              {item.collectionImage ? (
                <img
                  src={item.collectionImage}
                  alt=""
                  className="h-12 w-12 shrink-0 object-contain drop-shadow-md"
                  loading="lazy"
                />
              ) : (
                <Layers className="h-6 w-6" />
              )}
              <span className="text-sm">{item.collection}</span>
            </span>
          )}
          {item.rarityName && (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{
                color: item.rarityColor ?? undefined,
                backgroundColor: item.rarityColor ? `${item.rarityColor}1a` : undefined,
              }}
            >
              {item.rarityName}
            </span>
          )}
        </div>

        {item.image && (
          <div className="my-5 flex h-40 items-center justify-center">
            <img
              // Same reason as the row thumbnails: without a key React
              // reuses this node across a finish switch and keeps painting
              // the OLD texture until the new file downloads. On a slow
              // connection, or when clicking quickly between finishes, that
              // is exactly the "Foil showing the Paper image" symptom.
              key={item.id}
              src={item.image}
              alt=""
              className="max-h-40 object-contain drop-shadow-2xl"
            />
          </div>
        )}

        <CrateList
          crates={item.crates}
          tournament={item.tournament}
          tournamentImage={item.tournamentImage}
        />

        {/* StatTrak™ / Souvenir do not apply to stickers — a sticker's only
            axis is its finish, rendered below. */}
        <div
          className={cn(
            "flex rounded-lg border border-border bg-secondary/40 p-1",
            item.kind !== "skin" && "hidden",
          )}
        >
          {variants
            .filter((v) => v.available)
            .map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => onVariantChange(v.id)}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                  variant === v.id
                    ? v.id === "stattrak"
                      ? "bg-primary/15 text-primary"
                      : v.id === "souvenir"
                        ? "bg-amber-400/15 text-amber-400"
                        : "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v.label}
              </button>
            ))}
        </div>
      </div>

      <div className="border-t border-border">
        {availableWears.map((w) => {
          const range = wearRange(w);
          const quote = wearQuotes.find((q) => q.wear === w);
          return (
            <OptionRow
              key={w}
              label={w}
              sublabel={`${range.min.toFixed(2)} – ${range.max.toFixed(2)}`}
              active={wear === w}
              onSelect={() => onWearChange(w)}
              loading={quote?.loading}
              bestNet={quote?.bestNet}
              bestMarket={quote?.bestMarket}
              marketHref={
                quote?.bestMarket
                  ? getMarket(quote.bestMarket)?.itemUrl(buildMarketHashName(item, variant, w))
                  : undefined
              }
              // Deliberately NOT stopping propagation: clicking a market
              // logo also selects that row, so what the page shows and what
              // the link opens can never disagree.
              onMarketClick={() => onWearChange(w)}
            />
          );
        })}

        <StickerFinishes
          current={item}
          options={stickerVariants}
          quotes={variantQuotes}
          onSelect={onStickerVariantSelect}
        />
      </div>

      <FloatRangeBar item={item} ownedCopies={ownedCopies} />
    </section>
  );
}

/**
 * A sticker's finish selector.
 *
 * Replaces the wear list, which a sticker must never show: there is no
 * "Field-Tested" sticker, only Paper, Glitter, Holo, Foil and Gold (plus
 * the rarer Embroidered and Lenticular, which exist in the data).
 *
 * Only the finishes THIS sticker actually has are offered — most have
 * three or four of the seven, and a couple exist in one finish only.
 * Rendering an unavailable finish greyed out would suggest a variant the
 * user could go and buy, which is worse than not showing it.
 *
 * Selecting one switches to that finish's own catalog entry, because
 * upstream models each finish as a separate item with its own artwork,
 * its own market name and — for 659 of the 3,664 sticker groups — its own
 * capsule. So the picture, the name, the capsule and the prices all follow
 * from the switch rather than each needing to be updated by hand.
 */
/**
 * One selectable row — a wear for a skin, a finish for a sticker.
 *
 * Shared on purpose. The two lists answer the same question ("which
 * version of this item am I looking at?") and previously looked nothing
 * alike: full-width rows with a left accent for wears, a scatter of small
 * chips for finishes. One component means they cannot drift apart again,
 * and a change to the row style lands on both.
 */
function OptionRow({
  label,
  sublabel,
  sublabelStyle,
  thumbnail,
  active,
  onSelect,
  loading,
  bestNet,
  bestMarket,
  marketHref,
  onMarketClick,
}: {
  label: string;
  sublabel?: string | undefined;
  /** Lets a sticker row tint its sublabel with Valve's own rarity colour. */
  sublabelStyle?: React.CSSProperties | undefined;
  thumbnail?: string | undefined;
  active: boolean;
  onSelect: () => void;
  loading?: boolean | undefined;
  bestNet?: number | undefined;
  bestMarket?: MarketplaceId | undefined;
  marketHref?: string | undefined;
  onMarketClick?: (() => void) | undefined;
}) {
  const { t } = useI18n();
  const money = useMoney();
  const marketLabel = bestMarket ? getMarket(bestMarket)?.label : null;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "flex w-full items-center justify-between gap-3 border-l-2 px-5 py-3 text-left transition-colors sm:px-6",
        active ? "border-l-primary bg-primary/5" : "border-l-transparent hover:bg-secondary/40",
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        {thumbnail && (
          <img
            // Keyed by its own URL so React swaps the element rather than
            // reusing one node and repainting its src — a reused node keeps
            // showing the PREVIOUS finish until the new file arrives, which
            // reads as the wrong texture on the wrong row.
            key={thumbnail}
            src={thumbnail}
            alt=""
            loading="lazy"
            width={44}
            height={44}
            className="h-11 w-11 shrink-0 object-contain"
          />
        )}
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{label}</span>
          {sublabel && (
            <span
              className="block truncate text-[11px] font-mono tabular-nums text-muted-foreground"
              style={sublabelStyle}
            >
              {sublabel}
            </span>
          )}
        </span>
      </span>

      <span className="shrink-0 text-right">
        {loading ? (
          <span className="inline-block h-4 w-16 animate-pulse rounded bg-secondary" />
        ) : bestNet !== undefined ? (
          <>
            <span className="block font-mono text-base font-bold">{money(bestNet)}</span>
            {bestMarket && marketHref && (
              <a
                href={marketHref}
                target="_blank"
                rel="noreferrer"
                onClick={onMarketClick}
                title={t("openOnMarket")}
                className="flex items-center justify-end gap-1 text-[10px] text-muted-foreground transition-colors hover:text-primary"
              >
                <MarketLogo market={bestMarket} className="h-3 w-3" />
                {marketLabel}
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </>
        ) : (
          <span className="text-xs text-muted-foreground/60">—</span>
        )}
      </span>
    </button>
  );
}

/**
 * A sticker's finish rows.
 *
 * Renders in the same list, with the same row component, as a skin's wear
 * rows — one per line, full width, same accent on the selected one.
 *
 * Each row shows the finish's OWN rarity tier straight from Valve's data
 * rather than a tier this app decides. That matters because the scheme is
 * not fixed: it changes per tournament. Measured across the catalog,
 *
 *   2014-2016   Paper High Grade · Holo Remarkable · Foil Exotic · Gold Exotic
 *   2017-2019   Paper High Grade · Holo Remarkable · Foil Remarkable · Gold Extraordinary
 *   2020-2021   Paper High Grade · Holo Remarkable · Foil Exotic · Gold Extraordinary
 *   2022-2024   Paper High Grade · Glitter Remarkable · Holo Exotic · Gold Extraordinary
 *   2025-2026   Paper High Grade · Holo Exotic · Foil Remarkable · Gold Extraordinary
 *
 * so "Foil is always Exotic" is wrong for most of the catalog, and any
 * fixed mapping would file finishes under a tier Valve does not give them.
 * Showing each entry's real tier, in its real colour, is also what stops
 * two different finishes from reading as the same group.
 */
function StickerFinishes({
  current,
  options,
  quotes = [],
  onSelect,
}: {
  current: CatalogItem;
  options: CatalogItem[];
  quotes?: VariantQuote[] | undefined;
  onSelect?: ((item: CatalogItem) => void) | undefined;
}) {
  // One finish is not a choice — a selector with a single row implies
  // alternatives that do not exist.
  if (current.kind !== "sticker" || options.length < 2) return null;

  // Fixed display order, cheapest finish first, and only the finishes this
  // sticker actually has. Driven by the shared constant so the order can
  // never disagree with the type.
  const ordered = STICKER_VARIANTS.map((v) => options.find((o) => o.variant === v)).filter(
    (o): o is CatalogItem => o !== undefined,
  );

  return (
    <>
      {ordered.map((option) => {
        const quote = quotes.find((q) => q.id === option.id);
        return (
          <OptionRow
            key={option.id}
            label={option.variant ?? "Paper"}
            sublabel={option.rarityName}
            sublabelStyle={option.rarityColor ? { color: option.rarityColor } : undefined}
            thumbnail={option.image}
            active={option.id === current.id}
            onSelect={() => onSelect?.(option)}
            loading={quote?.loading}
            bestNet={quote?.bestNet}
            bestMarket={quote?.bestMarket}
            marketHref={
              quote?.bestMarket
                ? getMarket(quote.bestMarket)?.itemUrl(option.marketHashName ?? option.name)
                : undefined
            }
          />
        );
      })}
    </>
  );
}

/**
 * Every container this item can come out of.
 *
 * Showing only the first is wrong for 818 of the 2,126 skins in the
 * catalog. It matters most exactly where the money is: "★ Karambit |
 * Doppler" drops from Chroma, Chroma 2 AND Chroma 3, and a collector
 * deciding what to open needs all three. At the other extreme, 296
 * souvenir-capable skins appear in several tournament packages — AWP |
 * Pink DDPAT is in eighteen — so the list is capped and the rest are
 * summarised rather than turned into a wall of thumbnails.
 */
function CrateList({
  crates,
  tournament,
  tournamentImage,
}: {
  crates?: CatalogCrate[] | undefined;
  tournament?: string | undefined;
  tournamentImage?: string | undefined;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  // 1,148 stickers carry no capsule, and it is not a data-loading bug: for
  // the old events the paper and gold finishes were never sold in one.
  // Cologne 2015 shipped only "(Foil)" capsules, Katowice 2015 only
  // "(Holo/Foil)" — so there is no container to name, and crates.json
  // recovers a capsule for just 9 of them.
  //
  // Dropping the row entirely loses the one true answer we do have. The
  // event is real provenance, present on 10,176 of 11,134 stickers, so it
  // is shown in the capsule's place rather than inventing a container the
  // sticker never came from.
  if (!crates || crates.length === 0) {
    if (!tournament) return null;
    return (
      <div className="mb-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {t("tournamentLabel")}
        </p>
        <span className="inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-secondary/40 px-2 py-1.5">
          {tournamentImage ? (
            <img
              src={tournamentImage}
              alt=""
              loading="lazy"
              className="h-9 w-9 shrink-0 object-contain"
            />
          ) : (
            <Trophy className="h-7 w-7 shrink-0 opacity-60" />
          )}
          <span className="truncate text-xs leading-tight">{tournament}</span>
        </span>
      </div>
    );
  }

  const VISIBLE = 4;
  const shown = expanded ? crates : crates.slice(0, VISIBLE);
  const hidden = crates.length - shown.length;

  return (
    <div className="mb-4">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {t("dropsFrom")}
        {crates.length > 1 && (
          <span className="ml-1.5 rounded bg-secondary px-1 py-0.5 font-mono tabular-nums">
            {crates.length}
          </span>
        )}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        {shown.map((crate) => (
          <span
            key={crate.id ?? crate.name}
            title={crate.name}
            className={cn(
              "inline-flex max-w-full items-center gap-2 rounded-md border px-2 py-1.5",
              // Souvenir packages read differently from cases, and for a
              // Souvenir item they are the only containers that can
              // actually produce it — worth distinguishing at a glance.
              crate.souvenir
                ? "border-amber-400/25 bg-amber-400/5"
                : "border-border bg-secondary/40",
            )}
          >
            {crate.image ? (
              <img
                src={crate.image}
                alt=""
                className="h-9 w-9 shrink-0 object-contain"
                loading="lazy"
              />
            ) : (
              <Layers className="h-7 w-7 shrink-0 opacity-60" />
            )}
            <span className="truncate text-xs leading-tight">{crate.name}</span>
          </span>
        ))}

        {tournament && !crates.some((c) => capsuleNamesTheEvent(c.name, tournament)) && (
          <span
            title={t("tournamentLabel")}
            className="inline-flex max-w-full items-center gap-2 rounded-md border border-border/60 bg-secondary/20 px-2 py-1.5"
          >
            <Trophy className="h-7 w-7 shrink-0 opacity-60" />
            <span className="truncate text-xs leading-tight">{tournament}</span>
          </span>
        )}

        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("moreContainers").replace("{count}", String(hidden))}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Where this skin's float can land, and where the user's own copies sit.
 *
 * The bar is scaled to the skin's OWN range, not to 0–1: for a skin capped
 * at 0.50, a 0.45 float is near the worst possible, while for a skin
 * starting at 0.40 the same number is excellent. An absolute scale would
 * imply the wrong verdict in both directions.
 */
function FloatRangeBar({ item, ownedCopies }: { item: CatalogItem; ownedCopies: Skin[] }) {
  const { t } = useI18n();
  // A sticker, agent or music kit has no float at all. The defaults below
  // would silently invent a full 0.00-1.00 range for them and draw a bar
  // that means nothing — the same "missing data looks like every value"
  // mistake that had stickers offering five wear conditions.
  if (isWearless(item)) return null;

  // The CORRECTED bounds, the same ones the wear rows are built from.
  // Reading item.minFloat directly here is what made the bar contradict
  // the list: for "Galil AR | Chatterbox" the rows correctly offered only
  // Well-Worn and Battle-Scarred while the bar still drew a span starting
  // at upstream's 0.35, well inside Field-Tested territory.
  const { min, max } = floatBoundsFor(item);
  const span = max - min;

  if (span <= 0) return null;

  const withFloat = ownedCopies.filter(
    (s) => typeof s.floatValue === "number" && Number.isFinite(s.floatValue),
  );

  // The bar is the FULL 0.00–1.00 float scale, not the skin's own range.
  // That way a skin capped at 0.80 visibly stops four fifths across
  // instead of appearing to span everything, and two different skins can
  // be compared against the same yardstick.
  const pct = (value: number) => Math.min(100, Math.max(0, value * 100));

  return (
    <div className="border-t border-border p-5 sm:p-6">
      <p className="mb-6 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {t("floatRange")}
      </p>

      {/*
        Exactly two marks: the skin's absolute minimum and maximum float.
        Everything else that used to be drawn here — four faint ticks at
        Valve's wear boundaries, a pair of chevrons duplicating the same
        two positions, and two translucent panels over the unreachable
        ends — added no information this skin's own range does not already
        carry, and together they read as a chart with five different
        meanings on one 8px strip.
      */}
      <div className="relative h-2 rounded-full bg-secondary">
        {/* The reachable span, drawn as the only filled region. */}
        <span
          className="absolute inset-y-0 rounded-full bg-gradient-to-r from-emerald-400 via-amber-400 to-red-500"
          style={{ left: `${pct(min)}%`, width: `${pct(max) - pct(min)}%` }}
        />

        {(
          [
            ["min", min],
            ["max", max],
          ] as const
        ).map(([edge, value]) => (
          <span
            key={edge}
            className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
            style={{ left: `${pct(value)}%` }}
            title={`${edge} ${value.toFixed(4)}`}
          >
            <span
              className={cn(
                "absolute top-5 text-[10px] font-semibold font-mono tabular-nums text-foreground",
                // Pin the labels inward at the extremes so neither one
                // hangs off the end of the track.
                pct(value) < 12
                  ? "left-0"
                  : pct(value) > 88
                    ? "right-0"
                    : "left-1/2 -translate-x-1/2",
              )}
            >
              {value.toFixed(2)}
            </span>
          </span>
        ))}

        {/* The user's own copies — dots, deliberately not lines, so they
            can never be mistaken for the two boundaries. */}
        {withFloat.map((skin) => (
          <span
            key={skin.id}
            className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-background"
            style={{ left: `${pct(skin.floatValue!)}%` }}
            title={String(skin.floatValue)}
          />
        ))}
      </div>

      <p className="mt-8 text-[11px] text-muted-foreground">
        {t("possibleRange")}:{" "}
        <span className="font-mono tabular-nums">
          {min.toFixed(4)} – {max.toFixed(4)}
        </span>
      </p>

      {withFloat.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {withFloat.map((skin) => {
            // "How good is this float" stays relative to the SKIN's own
            // range — 0.20 is poor on a 0.00-capped skin but excellent on
            // one that starts at 0.18.
            const position = (skin.floatValue! - min) / span;
            return (
              <li key={skin.id} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{t("yourCopy")}</span>
                <span className="font-mono tabular-nums">
                  <span className="font-semibold">{skin.floatValue}</span>
                  <span className="ml-2 text-muted-foreground">
                    {t("topPercent").replace(
                      "{percent}",
                      String(Math.round(Math.min(1, Math.max(0, position)) * 100)),
                    )}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground/70">{t("noFloatRecorded")}</p>
      )}
    </div>
  );
}
