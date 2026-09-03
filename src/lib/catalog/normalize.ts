import type { CatalogCrate, CatalogItem, CatalogItemKind, StickerVariant } from "./types";
import { resolvePhase, withPhaseSuffix } from "./doppler";
import { correctStickerRarity } from "./corrections";

// --- Raw shapes from https://github.com/ByMykel/CSGO-API (only the fields we use) ---

interface RawSkin {
  id: string;
  name: string;
  image?: string;
  category?: { name?: string } | null;
  wears?: { name: string }[];
  rarity?: { color?: string; name?: string } | null;
  collections?: { name?: string }[] | null;
  min_float?: number | null;
  max_float?: number | null;
  paint_index?: string | null;
  /** Upstream's own Doppler/Gamma Doppler phase label — authoritative when
   * present ("Ruby", "Emerald", "Phase 2"...). Each phase is its own entry
   * in their data, so each becomes its own searchable catalog item. */
  phase?: string | null;
  /** Valve's own flag for whether THIS skin can exist as a StatTrak item —
   * authoritative, so we use it directly instead of guessing by category.
   * Accepts both spellings defensively in case the upstream key differs. */
  stattrak?: boolean;
  has_stattrak?: boolean;
  /** Valve's own flag: this skin CAN exist as a souvenir. Too broad on its
   * own — see isLegacySouvenir below for the stricter test we actually use. */
  souvenir?: boolean;
  /** Containers this skin drops from. Official Major/tournament souvenirs
   * list an actual "... Souvenir Package" here. */
  crates?: { id?: string; name?: string; image?: string }[] | null;
}

/** Official Major/tournament container, e.g. "Paris 2023 Anubis Souvenir Package". */
function isSouvenirPackage(crateName: string): boolean {
  return crateName.includes("Souvenir Package");
}

/**
 * A "legacy" souvenir is one that genuinely drops from an official
 * tournament Souvenir Package (Cobblestone, Mirage, Dust II, Ancient,
 * Anubis, Overpass, Nuke, Vertigo, Train, Inferno, Cache, Safehouse, Lake,
 * Italy...). Those are the only ones that deserve their own gold
 * "Souvenir ..." entry in search.
 *
 * We detect it from the item's own `crates` list rather than a hardcoded
 * map/collection list, so new Majors are picked up automatically and the
 * rule never goes stale. The broad `souvenir: true` flag is NOT enough on
 * its own — it marks anything souvenir-capable, which would flood search
 * with duplicate entries for ordinary skins.
 */
function isLegacySouvenir(s: RawSkin): boolean {
  if (s.souvenir !== true) return false;
  return (s.crates ?? []).some((crate) => isSouvenirPackage(crate?.name ?? ""));
}

/**
 * Every container an item drops from, deduplicated and ordered so the
 * useful one is first.
 *
 * Ordering matters because `crateName`/`crateImage` (and the compact UI
 * that reads them) still show only the head of this list. Regular cases
 * come before Souvenir Packages: a skin that exists both in a case and in
 * eighteen tournament packages should lead with the case, since that is
 * the container someone actually opens for it.
 */
function toCrates(raw: RawSkin["crates"]): CatalogCrate[] {
  const seen = new Set<string>();
  const crates: CatalogCrate[] = [];

  for (const c of raw ?? []) {
    const name = (c?.name ?? "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    crates.push({
      id: c?.id,
      name,
      image: c?.image,
      souvenir: isSouvenirPackage(name),
    });
  }

  // Stable partition, not a comparator — equal elements keep upstream's
  // own order, which is roughly chronological and worth preserving.
  return [...crates.filter((c) => !c.souvenir), ...crates.filter((c) => c.souvenir)];
}

interface RawSimpleItem {
  id: string;
  name: string;
  image?: string;
  rarity?: { color?: string } | null;
}

// Valve's raw category names occasionally need a friendlier label.
// "Equipment" in the source data only ever contains the Zeus x27, so we
// rename it to be specific rather than showing a vague catch-all category.
const CATEGORY_RENAMES: Record<string, string> = {
  Equipment: "Zeus x27",
};

function resolveCategoryName(raw: string): string {
  const trimmed = raw.trim();
  return CATEGORY_RENAMES[trimmed] ?? trimmed;
}

/**
 * Builds the StatTrak™ display name in Valve's own order.
 *
 * Knives and gloves already carry a "★" prefix, and the marker goes AFTER
 * it: Steam indexes "★ StatTrak™ Bayonet | Fade", never
 * "StatTrak™ ★ Bayonet | Fade". Blindly prefixing produced the wrong order
 * for all 576 StatTrak knife and glove entries in the catalog — every one
 * of them a name Steam has never heard of, and the most valuable items in
 * the game. Verified against the live market search, which returns
 * "★ StatTrak™ M9 Bayonet | Tiger Tooth (Minimal Wear)".
 */
function stattrakName(displayName: string): string {
  const STAR = "\u2605"; // ★
  return displayName.startsWith(`${STAR} `)
    ? `${STAR} StatTrak\u2122 ${displayName.slice(2)}`
    : `StatTrak\u2122 ${displayName}`;
}

/**
 * skins.json — grouped by pattern; wear is chosen separately in the app.
 *
 * Two expansions happen here so search offers every real variant as its own
 * selectable option:
 *  - Doppler/Gamma Doppler phases arrive as separate upstream entries, and
 *    we surface the phase in the display name — "★ Bowie Knife | Doppler (Ruby)".
 *  - For every skin Valve's data marks as StatTrak-capable, we emit a second
 *    "StatTrak™ ..." entry. Items that can't be StatTrak (gloves, most
 *    knives' vanilla variants, etc.) never get one.
 */
export function normalizeSkins(
  raw: RawSkin[],
  /** Collection name → artwork, built from upstream's collections.json. */
  collectionImages: Map<string, string> = new Map(),
): CatalogItem[] {
  const items: CatalogItem[] = [];

  for (const s of raw) {
    if (!s.image || !s.name) continue;

    const crates = toCrates(s.crates);
    const collection = s.collections?.[0]?.name ?? undefined;

    const phase = resolvePhase(s.name, s.phase, s.paint_index);
    const displayName = withPhaseSuffix(s.name, phase);

    const base: CatalogItem = {
      id: s.id,
      kind: "skin",
      name: displayName,
      image: s.image,
      category: resolveCategoryName(s.category?.name ?? ""),
      wears: s.wears?.map((w) => w.name),
      rarityColor: s.rarity?.color ?? undefined,
      rarityName: s.rarity?.name ?? undefined,
      collection,
      collectionImage: collection ? collectionImages.get(collection) : undefined,
      crates,
      // Head of the same list, so the compact single-thumbnail call sites
      // and the full list can never disagree about which crate is "the"
      // one — they are literally the same entry.
      crateName: crates[0]?.name,
      crateImage: crates[0]?.image,
      minFloat: typeof s.min_float === "number" ? s.min_float : undefined,
      maxFloat: typeof s.max_float === "number" ? s.max_float : undefined,
      paintIndex: s.paint_index ?? undefined,
      phase,
      souvenirCapable: s.souvenir === true,
      stattrakCapable: s.stattrak === true || s.has_stattrak === true,
    };
    items.push(base);

    // StatTrak™ and Souvenir are mutually exclusive in CS2 — a given skin
    // is one or the other, never both, so these two branches never overlap.
    if (s.stattrak === true || s.has_stattrak === true) {
      items.push({
        ...base,
        id: `${s.id}-st`,
        name: stattrakName(displayName),
        isStattrak: true,
      });
    }

    if (isLegacySouvenir(s)) {
      // The Souvenir entry gets the same crates with the ordering flipped:
      // a Souvenir AK-47 does not come out of a case, it comes out of a
      // tournament package, and leading with the case would point a
      // collector at a container that cannot produce this item.
      const souvenirFirst = [
        ...crates.filter((c) => c.souvenir),
        ...crates.filter((c) => !c.souvenir),
      ];
      items.push({
        ...base,
        id: `${s.id}-sv`,
        name: `Souvenir ${displayName}`,
        isSouvenir: true,
        crates: souvenirFirst,
        crateName: souvenirFirst[0]?.name,
        crateImage: souvenirFirst[0]?.image,
      });
    }
  }

  return items;
}

// --- stickers -------------------------------------------------------------

interface RawSticker {
  id: string;
  name: string;
  image?: string;
  rarity?: { color?: string; name?: string } | null;
  /** Upstream's finish field. "Other" means a plain paper sticker. */
  effect?: string | null;
  /** The capsule(s) this sticker comes out of. */
  crates?: { id?: string; name?: string; image?: string }[] | null;
  /** Authoritative Steam name; null for the ~700 unreleased entries. */
  market_hash_name?: string | null;
  type?: string | null;
  /** The event this sticker belongs to. Present on 10,176 of 11,134, and
   *  the signal that decides whether a Gold's tier can be trusted. */
  tournament?: { name?: string } | null;
}

/**
 * Upstream's `effect` → the label a user recognises.
 *
 * "Other" is upstream's word for "no special finish", which on the market
 * is simply a paper sticker. Showing "Other" in a finish selector would be
 * meaningless, so it is mapped here rather than in the view.
 */
const EFFECT_TO_VARIANT: Record<string, StickerVariant> = {
  Other: "Paper",
  Paper: "Paper",
  Glitter: "Glitter",
  Holo: "Holo",
  Foil: "Foil",
  Gold: "Gold",
  Embroidered: "Embroidered",
  Lenticular: "Lenticular",
};

/** Finish tokens that appear inside a sticker name's parentheses. */
const VARIANT_TOKENS = new Set(["Glitter", "Holo", "Foil", "Gold", "Embroidered", "Lenticular"]);

/**
 * The key that ties every finish of one sticker together.
 *
 * A sticker name's parenthetical can hold a finish, a qualifier, or both:
 *
 *   "Sticker | Natus Vincere (Holo) | Katowice 2015"
 *   "Sticker | rain (Holo, Champion) | Antwerp 2022"
 *
 * Only the FINISH is removed. Dropping the whole parenthetical would merge
 * the Champion sticker into the ordinary one — a different, more valuable
 * item — and dropping nothing would leave every finish in a group of one.
 */
export function stickerGroupId(name: string): string {
  return name
    .replace(/\s*\(([^)]*)\)/g, (_full, inner: string) => {
      const kept = inner
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0 && !VARIANT_TOKENS.has(part));
      return kept.length > 0 ? ` (${kept.join(", ")})` : "";
    })
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * stickers.json — one entry per FINISH, each with its own artwork and its
 * own capsule.
 *
 * That last part is why finishes are separate catalog entries rather than a
 * toggle on one: across the real data, 659 of 3,664 groups have finishes
 * that come from different capsules (Natus Vincere Katowice 2015 has its
 * Holo and Foil in a Legends capsule while the paper and gold versions have
 * none). A single entry with a finish flag would have to lie about one of
 * them.
 */
export function normalizeStickers(raw: RawSticker[]): CatalogItem[] {
  // First pass: one capsule image per sticker group.
  //
  // Old tournament stickers only ever sold SOME of their finishes in a
  // capsule — Cologne 2015 shipped "(Foil)" capsules and nothing for paper
  // or gold — so those finishes carry no container and, before this, no
  // artwork at all. The group's own capsule is the closest true image for
  // the event, and it is exact rather than a fuzzy name match: it comes
  // from another finish of the SAME sticker.
  const groupCapsuleImage = new Map<string, string>();
  for (const s of raw) {
    if (!s.name) continue;
    const image = (s.crates ?? []).find((c) => c?.image)?.image;
    if (!image) continue;
    const key = stickerGroupId(s.name);
    if (!groupCapsuleImage.has(key)) groupCapsuleImage.set(key, image);
  }

  const items: CatalogItem[] = [];
  // Upstream ships a couple of exact duplicates (two "Sticker | Mirage
  // (Gold)" rows, no market name, no capsule). Keeping both would put two
  // identical buttons in the finish selector, so the first wins.
  const seen = new Set<string>();

  for (const s of raw) {
    if (!s.image || !s.name) continue;

    const variant = EFFECT_TO_VARIANT[(s.effect ?? "").trim()] ?? "Paper";
    const groupId = stickerGroupId(s.name);
    const crates = toCrates(s.crates);

    const dedupeKey = `${groupId}::${variant}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    // Tournament membership is what decides whether a Gold sticker's tier
    // can be trusted — see correctStickerRarity for the Steam evidence.
    const tournament = s.tournament?.name?.trim() || undefined;
    const rarity = correctStickerRarity(variant, s.rarity ?? {}, !!tournament);

    items.push({
      id: s.id,
      kind: "sticker",
      name: s.name,
      image: s.image,
      category: "Sticker",
      rarityColor: rarity?.color,
      rarityName: rarity?.name,
      variant,
      variantGroupId: groupId,
      tournament,
      // Only when this finish has no capsule of its own — otherwise the
      // real container's icon is already on screen.
      tournamentImage:
        crates.length === 0 && tournament ? groupCapsuleImage.get(groupId) : undefined,
      marketHashName: s.market_hash_name ?? undefined,
      crates,
      crateName: crates[0]?.name,
      crateImage: crates[0]?.image,
    });
  }

  return items;
}

/** Shared shape for agents, crates, music kits, patches, graffiti, keychains. */
export function normalizeSimple(
  raw: RawSimpleItem[],
  kind: CatalogItemKind,
  category: string,
): CatalogItem[] {
  return raw
    .filter((x) => x.image && x.name)
    .map((x) => ({
      id: x.id,
      kind,
      name: x.name,
      image: x.image!,
      category,
      rarityColor: x.rarity?.color ?? undefined,
    }));
}
