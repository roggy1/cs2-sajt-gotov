/**
 * Corrections to upstream catalog data.
 *
 * Every entry here overrides a value the ByMykel/Valve dump gets wrong, and
 * every one carries the evidence for why. This file is deliberately small
 * and deliberately explicit: a correction that cannot be justified in a
 * comment does not belong in it, because silently disagreeing with the
 * source is how a catalog drifts away from the game.
 */

/** Valve's own rarity colours, so a correction never invents a shade. */
const RARITY_COLORS = {
  "High Grade": "#4b69ff",
  Remarkable: "#8847ff",
  Exotic: "#d32ce6",
  Extraordinary: "#eb4b4b",
  Contraband: "#e4ae39",
} as const satisfies Record<string, string>;

function colorFor(name: string): string | undefined {
  return (RARITY_COLORS as Record<string, string>)[name];
}

export interface RarityTier {
  name: string;
  color: string;
}

/**
 * Corrects the rarity of a tournament Gold sticker.
 *
 * VERIFIED AGAINST STEAM. The market's own `asset_description` is the
 * authority here, and it says:
 *
 *   Sticker | s1mple (Gold) | Berlin 2019    "Extraordinary Sticker"  eb4b4b
 *   Sticker | RpK (Gold) | Berlin 2019       "Extraordinary Sticker"  eb4b4b
 *   ...144 results for that query, every one Extraordinary...
 *   Sticker | Hello AK-47 (Gold)             "Remarkable Sticker"     8847ff
 *
 * So a gold is not automatically the top tier — but a TOURNAMENT gold is,
 * without exception. The dump disagrees for 641 of them, all tagged
 * Exotic, and every one of those belongs to an event: "FURIA (Gold) |
 * Berlin 2019", "Natus Vincere (Gold) | Cologne 2015", the whole 2014-2015
 * era. Their tier is a placeholder Valve never filled in.
 *
 * The split is exact. Of 2,861 Gold stickers:
 *
 *   with a tournament     2832   (2191 already Extraordinary, 641 mis-tagged)
 *   without a tournament    29   (16 Remarkable, 13 Exotic — all correct)
 *
 * Every sticker Steam was asked about falls on the right side of that
 * line, which is why the rule keys on the tournament rather than on
 * whether the dump happens to carry a market name: FURIA and NaVi golds
 * have no `market_hash_name` at all, yet they trade on the market as
 * Extraordinary.
 */
export function correctStickerRarity(
  variant: string | undefined,
  raw: { name?: string | undefined; color?: string | undefined },
  isTournament: boolean,
): RarityTier | undefined {
  if (variant === "Gold" && isTournament) {
    return { name: "Extraordinary", color: RARITY_COLORS.Extraordinary };
  }

  if (!raw.name) return undefined;
  return {
    name: raw.name,
    // Prefer Valve's canonical colour for the tier over whatever hex the
    // dump carried, so two stickers on the same tier can never render in
    // two different shades.
    color: colorFor(raw.name) ?? raw.color ?? RARITY_COLORS.Exotic,
  };
}

// ---------------------------------------------------------------------------
// Float ranges
// ---------------------------------------------------------------------------

export interface FloatBounds {
  min: number;
  max: number;
}

/**
 * Skins whose published float range disagrees with the game.
 *
 * Keyed by the bare paint-kit name — no ★, no StatTrak™, no Souvenir, no
 * wear suffix — so one entry covers every variant of the same skin.
 *
 * DELIBERATELY EMPTY. The table exists as the one place a verified
 * correction can go, but nothing is in it, because an unverified entry
 * here does real damage: a "Galil AR | Chatterbox" override at 0.40 sat
 * in this table and silently removed Field-Tested from a skin that has
 * it, in the item page, the float bar AND the portfolio dropdown.
 *
 * Measured across the whole catalog, upstream's `wears` array and its
 * float window agree for all 3,719 entries — there is no skin where the
 * published data contradicts itself. So the bar for adding an entry here
 * is a source that outranks Valve's own dump, not a report that something
 * looks wrong.
 */
const FLOAT_OVERRIDES: Record<string, FloatBounds> = {};

/**
 * Reduces a display name to the paint kit, so one override entry covers
 * the plain, StatTrak™, Souvenir and phase-suffixed variants alike.
 */
export function paintKitKey(name: string): string {
  return name
    .replace(/^★\s*/, "") // ★
    .replace(/^StatTrak™\s*/, "")
    .replace(/^Souvenir\s*/, "")
    .replace(/\s*\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/, "")
    .replace(/\s*\((Ruby|Sapphire|Black Pearl|Emerald|Phase [1-4])\)\s*$/, "")
    .trim();
}

export function floatOverrideFor(name: string | undefined): FloatBounds | undefined {
  if (!name) return undefined;
  return FLOAT_OVERRIDES[paintKitKey(name)];
}

/** Exposed so a test can assert every override is actually reachable. */
export const FLOAT_OVERRIDE_NAMES = Object.keys(FLOAT_OVERRIDES);
