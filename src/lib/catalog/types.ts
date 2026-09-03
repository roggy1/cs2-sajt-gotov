/**
 * Normalized shape for every item in the full CS2 catalog (skins, stickers,
 * agents, cases, music kits, patches, graffiti, keychains), regardless of
 * which ByMykel CSGO-API endpoint it came from.
 */
export type CatalogItemKind =
  "skin" | "sticker" | "agent" | "case" | "musicKit" | "patch" | "graffiti" | "keychain";

/**
 * A sticker's finish.
 *
 * Stickers have no wear — they have a FINISH, and the two are not
 * interchangeable: a sticker is never "Field-Tested", it is Paper or Holo
 * or Gold. Upstream calls this `effect` and spells plain stickers "Other",
 * which is a data-model word, not something to show a user.
 *
 * Embroidered and Lenticular are in the list because they are in the data
 * (198 and 25 stickers respectively). They were not in the original
 * request, but a sticker that exists must not render under a wrong label.
 */
export type StickerVariant =
  "Paper" | "Glitter" | "Holo" | "Foil" | "Gold" | "Embroidered" | "Lenticular";

/** Display order, cheapest finish first — the order the selector renders. */
export const STICKER_VARIANTS: StickerVariant[] = [
  "Paper",
  "Glitter",
  "Holo",
  "Foil",
  "Gold",
  "Embroidered",
  "Lenticular",
];

export interface CatalogItem {
  id: string;
  kind: CatalogItemKind;
  name: string;
  image: string;
  /** Display category, e.g. "Rifle", "Gloves", "Sticker", "Case"... */
  category: string;
  /** Available wear conditions (Factory New...Battle-Scarred) — skins only. */
  wears?: string[] | undefined;
  /** Rarity accent color from Valve's data, e.g. "#eb4b4b" — optional flourish. */
  rarityColor?: string | undefined;
  /**
   * Valve's "paint kit" id — for most skins this is just an internal id, but
   * for Doppler/Gamma Doppler it's the ONLY thing that identifies the phase
   * (Ruby/Sapphire/Black Pearl/Phase 1-4). This is a completely different
   * number from the pattern/paint SEED (0-1000) the user can enter manually
   * — mixing the two up is the classic Doppler pricing mistake.
   */
  paintIndex?: string | undefined;
  /** Doppler/Gamma Doppler phase label ("Ruby", "Emerald", "Phase 2"...),
   * taken from upstream data when available. Baked into `name` for display;
   * kept here separately so queries can strip it back out. */
  phase?: string | undefined;
  /** True for the StatTrak™-prefixed variant of a skin that actually
   * supports StatTrak (per Valve's own data) — a separate, selectable
   * catalog entry rather than a manual toggle. */
  isStattrak?: boolean | undefined;
  /** True for the "Souvenir "-prefixed variant — the legacy souvenirs that
   * drop from official Major Souvenir Packages. Also a separate, selectable
   * catalog entry, so it never needs a toggle. */
  isSouvenir?: boolean | undefined;
  /** Whether this skin CAN exist as a souvenir at all (Valve's own flag). */
  souvenirCapable?: boolean | undefined;
  /** Whether this skin CAN exist as StatTrak™ (Valve's own flag). In CS2 a
   * skin is StatTrak-capable OR Souvenir-capable, never both. */
  stattrakCapable?: boolean | undefined;
  /** Rarity label as Valve names it ("Covert", "Restricted"...). */
  rarityName?: string | undefined;
  /**
   * Sticker finish. Every finish is its OWN catalog entry upstream, with
   * its own artwork and its own capsule — which is why switching finish is
   * a switch to a different item, not a flag on this one.
   */
  variant?: StickerVariant | undefined;
  /**
   * Shared key across every finish of the same sticker.
   *
   * Built by removing only the finish token from the name's parenthetical
   * and keeping any qualifier, so "Sticker | rain (Holo, Champion)" and
   * "Sticker | rain (Gold, Champion)" group together while the Champion
   * variant stays separate from the ordinary one. Over the real 11,134
   * stickers this yields 3,664 groups.
   */
  variantGroupId?: string | undefined;
  /**
   * The event a tournament sticker belongs to, e.g. "2019 StarLadder
   * Berlin Major".
   *
   * Doubles as provenance: 1,148 stickers carry no capsule at all because
   * their finish was never sold in one, and for those the event is the
   * only true answer to "where does this come from".
   */
  tournament?: string | undefined;
  /**
   * Artwork for the event, borrowed from a capsule of the SAME sticker
   * group when this finish has none of its own.
   *
   * 885 of the 1,148 stickers with no capsule have a sibling finish that
   * does — NaVi's paper Cologne 2015 was never sold in a capsule, but its
   * Foil came from "ESL One Cologne 2015 Legends (Foil)". Borrowing that
   * image gives the event row a real icon instead of a generic glyph. It
   * is labelled as the EVENT, never as this sticker's capsule, because
   * this finish did not drop from it.
   */
  tournamentImage?: string | undefined;
  /**
   * Upstream's own `market_hash_name`, when it has one.
   *
   * Preferred over deriving a name from the display name: for stickers the
   * two can differ, and upstream is the authority on what Steam indexes.
   */
  marketHashName?: string | undefined;
  /** Collection this skin belongs to, e.g. "The Horizon Collection". */
  collection?: string | undefined;
  /**
   * The collection's own artwork.
   *
   * Comes from upstream's collections.json, which carries an image for all
   * 110 collections — so this is an index lookup, not a hand-maintained
   * map. A map would need a new entry every time Valve ships a case, and
   * would be missing exactly the newest collections users ask about.
   */
  collectionImage?: string | undefined;
  /**
   * The float range this skin can actually exist in. Crucial for two
   * things: hiding wear rows that are impossible for it (a skin with
   * minFloat 0.18 has no Factory New), and judging a float relative to
   * THIS skin rather than the absolute 0–1 scale.
   */
  minFloat?: number | undefined;
  maxFloat?: number | undefined;
  /**
   * FIRST container this skin drops from — kept because several call sites
   * only ever show one thumbnail. Prefer `crates` when the answer matters:
   * 818 of 2,126 skins drop from more than one container, so this field
   * alone is wrong more often than it is right.
   */
  crateName?: string | undefined;
  crateImage?: string | undefined;
  /**
   * EVERY container this item drops from.
   *
   * The single-crate assumption breaks badly at both ends of the value
   * range: "★ Karambit | Doppler" comes from Chroma, Chroma 2 AND Chroma 3,
   * and 296 souvenir-capable skins appear in several tournament packages
   * (AWP | Pink DDPAT is in eighteen). Showing only the first tells a
   * collector the wrong thing about where their item can come from and
   * what it is worth opening for.
   */
  crates?: CatalogCrate[] | undefined;
}

/** One container an item can drop from. */
export interface CatalogCrate {
  id?: string | undefined;
  name: string;
  image?: string | undefined;
  /** True for official Major "... Souvenir Package" containers. */
  souvenir?: boolean | undefined;
}

/** Categories that don't have a wear/float value in CS2's economy. */
export const WEARLESS_CATEGORIES = new Set<string>([
  "Sticker",
  "Agent",
  "Case",
  "Music Kit",
  "Patch",
  "Graffiti",
  "Keychain",
]);
