/**
 * Steam `market_hash_name` normalization.
 *
 * Steam's market is unforgiving about names: the listings endpoint wants
 * the name byte-for-byte as Valve spells it, and the search endpoint
 * answers `{"success":true,"total_count":0,"results":[]}` — NOT an error —
 * for anything it doesn't recognise. A single wrong character therefore
 * looks exactly like "this item has no listings", which is how one bad
 * apostrophe turns into `n/a` on every market at once.
 *
 * Names reach us from three places that spell things differently:
 *
 *   - the ByMykel catalog (clean, already NFC),
 *   - Steam's own inventory API (occasionally mojibake'd when a proxy
 *     mangles UTF-8: "StatTrakâ„¢" instead of "StatTrak™"),
 *   - the user, who pastes from a browser, a spreadsheet or Discord — all
 *     of which love to "helpfully" turn ' into ’ and - into –.
 *
 * These are the characters that actually occur in the CS2 catalog, from a
 * scan of all 2,126 skins plus stickers, agents, music kits, patches,
 * graffiti and keychains:
 *
 *   ★ U+2605  673x  every knife and glove
 *   ' U+0027  109x  "Pandora's Box", "Lil' Pig", "Man-o'-war"
 *   ™ U+2122   95x  StatTrak™
 *   & U+0026    8x  "P250 | Black & Tan"
 *   ö U+00F6    5x  "Flame Jörmungandr", "Mjölnir"
 *   ~ U+007E    4x  "Music Kit | Chipzel, ~Yellow Magic~"
 *   á ā ñ ♥ and CJK (龍王, 壱, 弐, 花脸) — one or two each
 *
 * Every one of those must survive untouched. What gets normalized is only
 * the LOOKALIKES of those characters, never the characters themselves.
 *
 * Invisible and lookalike characters are written as \u escapes on purpose:
 * a literal zero-width space in source is invisible to review and to grep,
 * which is precisely the class of bug this file exists to prevent.
 */

/**
 * Lookalikes → what Valve actually uses.
 *
 * Deliberately one-directional and narrow. Stripping accents or
 * transliterating CJK would be actively wrong: "Jörmungandr" and
 * "龍王 (Dragon King)" are the real names, and an o-for-ö substitution
 * produces a name Steam has never heard of.
 */
const CONFUSABLES: Record<string, string> = {
  // Quotes — the single biggest source of breakage, because every text
  // editor and chat client rewrites ' as ’ automatically.
  "‘": "'", // ‘ left single quotation mark
  "’": "'", // ’ right single quotation mark ("Pandora’s" → "Pandora's")
  "‚": "'", // ‚ single low-9
  "‛": "'", // ‛ single high-reversed-9
  ʼ: "'", // ʼ modifier letter apostrophe
  "´": "'", // ´ acute accent typed as an apostrophe
  "`": "'", // ` backtick typed as an apostrophe
  "“": '"', // “ left double quotation mark
  "”": '"', // ” right double quotation mark
  "„": '"', // „ double low-9

  // Dashes — "Man-o'-war", "Sawed-Off", "AK-47" and every wear suffix use
  // a plain ASCII hyphen; an en dash there is a different item name.
  "‐": "-", // ‐ hyphen
  "‑": "-", // ‑ non-breaking hyphen
  "‒": "-", // ‒ figure dash
  "–": "-", // – en dash
  "—": "-", // — em dash
  "―": "-", // ― horizontal bar
  "−": "-", // − minus sign

  // Tilde — "Music Kit | Chipzel, ~Yellow Magic~" uses ASCII 0x7E.
  "～": "~", // ～ fullwidth tilde
  "∼": "~", // ∼ tilde operator
  "˜": "~", // ˜ small tilde
  "〜": "~", // 〜 wave dash

  // Separator and spaces.
  "｜": "|", // ｜ fullwidth vertical line
  "\u00a0": " ", // no-break space
  "\u2007": " ", // figure space
  "\u2009": " ", // thin space
  "\u200a": " ", // hair space
  "\u202f": " ", // narrow no-break space
  "\u3000": " ", // ideographic space

  // Zero-width junk that survives a copy-paste and matches nothing.
  "\u200b": "", // zero-width space
  "\u200c": "", // zero-width non-joiner
  "\u200d": "", // zero-width joiner
  "\ufeff": "", // byte-order mark

  // Star and trademark lookalikes → the real ones.
  "☆": "★", // ☆ white star → ★
  "⋆": "★", // ⋆ star operator → ★
  "∗": "★", // ∗ asterisk operator → ★
  "\ufe0e": "", // variation selector-15, e.g. on ™ or ★
  "\ufe0f": "", // variation selector-16
};

/**
 * Mojibake repair — UTF-8 bytes that were decoded as a single-byte charset.
 *
 * Steam's inventory API and a few community tools emit this when something
 * in the chain guesses the encoding wrong, and the result matches nothing
 * on the market.
 *
 * There are TWO decodings in the wild and they differ, so both are covered:
 *
 *   "StatTrak™" -> bytes E2 84 A2
 *      read as cp1252 -> "â" + "\u201e" + "¢"   (0x84 maps to a low-9 quote)
 *      read as latin1 -> "â" + "\u0084" + "¢"   (0x84 stays a control char)
 *
 * The patterns are DERIVED from each character's real UTF-8 bytes rather
 * than typed out, because a hand-written escape sequence for an invisible
 * control character is exactly the kind of thing that is wrong once and
 * then never noticed again.
 */

/** cp1252's 0x80-0x9F block, the only range where it differs from latin1. */
const CP1252_HIGH =
  "\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178";

/** Every character a single byte could have been decoded to. */
function byteAliases(byte: number): string[] {
  const latin1 = String.fromCharCode(byte);
  if (byte < 0x80 || byte > 0x9f) return [latin1];
  const cp1252 = CP1252_HIGH[byte - 0x80] ?? latin1;
  return cp1252 === latin1 ? [latin1] : [cp1252, latin1];
}

function escapeForClass(ch: string): string {
  return `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
}

/** A regex matching every mis-decoding of `real`'s UTF-8 bytes. */
function mojibakePattern(real: string): RegExp {
  const bytes = [...new TextEncoder().encode(real)];
  const source = bytes
    .map((b) => {
      const aliases = byteAliases(b);
      return aliases.length === 1
        ? escapeForClass(aliases[0]!)
        : `[${aliases.map(escapeForClass).join("")}]`;
    })
    .join("");
  return new RegExp(source, "g");
}

/**
 * Characters worth repairing: the ones that actually appear in CS2 names.
 * Order matters — longer sequences are listed first so a shorter rule
 * cannot eat another's prefix and leave a stray character behind.
 */
const MOJIBAKE: [RegExp, string][] = [
  "\u2122", // ™
  "\u2605", // ★
  "\u2019", // ’ (folded to ' below)
  "\u2013", // –
  "\u2014", // —
  "\u2665", // ♥
  "\u00f6", // ö
  "\u00e1", // á
  "\u00f1", // ñ
  "\u0101", // ā
].map((ch) => [mojibakePattern(ch), ch] as [RegExp, string]);

/** Valve always writes these in one fixed order: ★ then StatTrak™. */
const STAR = "★";
const STATTRAK = "StatTrak™";

/**
 * Cleans a name into the exact form Steam indexes.
 *
 * Idempotent, so it can sit at every entry point without anyone having to
 * track whether a given string has already been through it.
 */
export function normalizeMarketHashName(raw: string): string {
  if (!raw) return "";

  let out = raw;
  for (const [pattern, replacement] of MOJIBAKE) out = out.replace(pattern, replacement);

  // NFC composes "o + combining diaeresis" into a single "ö". Steam stores
  // the composed form, and the two are different byte sequences that
  // compare unequal despite looking identical on screen.
  out = out.normalize("NFC");

  let mapped = "";
  for (const ch of out) mapped += CONFUSABLES[ch] ?? ch;

  // Collapse runs of whitespace and trim. " AK-47  |  Redline " is a name
  // Steam does not have.
  mapped = mapped.replace(/\s+/g, " ").trim();

  return reorderPrefixes(mapped);
}

/**
 * Puts the ★ and StatTrak™ prefixes back into Valve's order.
 *
 * A knife is "★ StatTrak™ Karambit | Doppler (Factory New)". Users, and a
 * couple of import paths, routinely produce "StatTrak™ ★ Karambit ...",
 * which is a name Steam has never indexed.
 */
function reorderPrefixes(name: string): string {
  let rest = name;
  let star = false;
  let stattrak = false;
  let souvenir = false;

  // Peel prefixes off in whatever order they arrive.
  for (;;) {
    if (rest.startsWith(`${STAR} `)) {
      star = true;
      rest = rest.slice(STAR.length + 1);
    } else if (rest.startsWith(STAR) && rest.length > STAR.length) {
      // "★Karambit" — a missing space is common in hand-typed names.
      star = true;
      rest = rest.slice(STAR.length).trimStart();
    } else if (rest.startsWith(`${STATTRAK} `)) {
      stattrak = true;
      rest = rest.slice(STATTRAK.length + 1);
    } else if (rest.startsWith("Souvenir ")) {
      souvenir = true;
      rest = rest.slice("Souvenir ".length);
    } else {
      break;
    }
  }

  // StatTrak™ and Souvenir are mutually exclusive in CS2. If both somehow
  // arrived, StatTrak wins — Souvenir is the one added by a manual toggle,
  // so it is the likelier mistake.
  if (stattrak) souvenir = false;

  return [star ? STAR : "", stattrak ? STATTRAK : "", souvenir ? "Souvenir" : "", rest]
    .filter(Boolean)
    .join(" ");
}

/**
 * A loose key for COMPARING two names — never for querying.
 *
 * Steam's search results are matched against this instead of `===`. Exact
 * string equality silently drops the right row whenever Steam's spelling
 * differs from ours by a character that does not change which item is
 * meant, and a dropped row is indistinguishable from "no listings".
 */
export function steamNameKey(raw: string): string {
  return normalizeMarketHashName(raw)
    .toLowerCase()
    .replace(/[★™]/g, "") // ★ and ™ carry no matching information
    .replace(/[^\p{L}\p{N}]+/gu, " ") // punctuation out, letters and digits in
    .trim();
}

/** Wear suffix at the end of a name, e.g. "(Field-Tested)". */
const WEAR_SUFFIX = /\s*\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/;

export function stripWearSuffix(name: string): string {
  return name.replace(WEAR_SUFFIX, "").trim();
}

export function wearSuffixOf(name: string): string | undefined {
  return WEAR_SUFFIX.exec(name)?.[1];
}

/**
 * Steam market search facets.
 *
 * `query=` alone is a blunt full-text match, but the search endpoint also
 * accepts the same category filters the website's sidebar uses. Sending
 * them turns "64 Sport Gloves of every exterior" into "the handful in
 * Field-Tested", which matters because the endpoint pages at only ten rows
 * — without a facet the row we want can sit on page seven and look, from
 * page one, exactly like an item with no listings.
 */
const EXTERIOR_TAGS: Record<string, string> = {
  "Factory New": "tag_WearCategory0",
  "Minimal Wear": "tag_WearCategory1",
  "Field-Tested": "tag_WearCategory2",
  "Well-Worn": "tag_WearCategory3",
  "Battle-Scarred": "tag_WearCategory4",
};

/**
 * Valve's quality tags.
 *
 * The ★ items are the trap: knives and gloves are "unusual", NOT "normal",
 * and sending `tag_normal` for a glove returns an empty array — which is
 * indistinguishable from "no listings" and is exactly the failure this
 * whole module exists to stop. Verified live: "Sport Gloves" with
 * tag_normal returns 0 rows, the same query with no quality facet returns
 * 15, all of them the right exterior.
 */
const QUALITY_NORMAL = "tag_normal";
const QUALITY_STATTRAK = "tag_strange";
const QUALITY_SOUVENIR = "tag_tournament";
const QUALITY_UNUSUAL = "tag_unusual"; // ★ knives and gloves
const QUALITY_UNUSUAL_STATTRAK = "tag_unusual_strange"; // ★ StatTrak™

export interface SteamSearchQuery {
  /** Free-text part, sent as `query=`. */
  query: string;
  /** `category_730_Exterior[]`, when the name carries a wear. */
  exterior?: string | undefined;
  /** `category_730_Quality[]` — normal vs StatTrak™ vs Souvenir. */
  quality?: string | undefined;
}

/**
 * Progressively looser searches, most specific first.
 *
 * The search index is NOT a substring match over every item that exists —
 * it only covers items that currently have listings, and it gives up on
 * long punctuated queries. A single exact-name query is therefore a coin
 * flip for rare items. Measured against the live endpoint:
 *
 *   "★ Sport Gloves | Pandora's Box (Field-Tested)"  ->  0 rows
 *   "Sport Gloves | Pandora's Box (Field-Tested)"    ->  0 rows
 *   "Sport Gloves | Pandora"                         ->  0 rows
 *   "Sport Gloves"                                   -> 64 rows
 *
 * — all four naming the same real item. So the ladder ends at the item
 * TYPE (the part before the "|"), which is always a phrase Steam indexes,
 * and leans on the facets to keep that broad query small. The caller stops
 * at the first tier that returns rows and matches them by `steamNameKey`.
 */
export function searchQueryPlan(marketHashName: string): SteamSearchQuery[] {
  const full = normalizeMarketHashName(marketHashName);
  const wear = wearSuffixOf(full);
  const exterior = wear ? EXTERIOR_TAGS[wear] : undefined;

  const noWear = stripWearSuffix(full);
  const starred = noWear.startsWith(STAR);
  const stattrak = noWear.includes(STATTRAK);
  const quality = starred
    ? stattrak
      ? QUALITY_UNUSUAL_STATTRAK
      : QUALITY_UNUSUAL
    : stattrak
      ? QUALITY_STATTRAK
      : noWear.startsWith("Souvenir ")
        ? QUALITY_SOUVENIR
        : QUALITY_NORMAL;

  const bare = noWear
    .replace(new RegExp(`^${STAR}\\s*`), "")
    .replace(new RegExp(`^${STATTRAK}\\s*`), "")
    .replace(/^Souvenir\s*/, "")
    .trim();

  // Everything before the "|" — "Sport Gloves", "AK-47", "Music Kit".
  // Deliberately keeps its own punctuation ("AK-47", "Sawed-Off"), because
  // that is how Steam indexes it.
  const type = (bare.split("|")[0] ?? "").trim();

  // Exterior before quality on purpose. The exterior facet is verified to
  // narrow correctly; the quality facet is inferred from the name and a
  // wrong guess empties the result set silently, so it only ever appears
  // on a LATER tier than the same query without it. A broad-but-correct
  // answer always gets its chance before a narrow-but-risky one.
  const tiers: SteamSearchQuery[] = [
    { query: full },
    { query: noWear, exterior },
    { query: bare, exterior },
    { query: type, exterior },
    { query: type, exterior, quality },
  ];

  // Drop empties and any tier whose free text repeats the previous one —
  // re-asking an identical question just spends rate budget.
  const seen = new Set<string>();
  return tiers.filter((t) => {
    if (!t.query) return false;
    const key = `${t.query}::${t.exterior ?? ""}::${t.quality ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Turns one tier into the query parameters Steam's search endpoint wants. */
export function searchParams(
  tier: SteamSearchQuery,
  start: number,
  count: number,
): URLSearchParams {
  const params = new URLSearchParams({
    query: tier.query,
    appid: "730",
    norender: "1",
    search_descriptions: "0",
    start: String(start),
    count: String(count),
  });
  // Array-style keys are what the market website itself sends; the endpoint
  // ignores anything it does not recognise, so an unknown tag degrades to a
  // plain text search rather than an error.
  if (tier.exterior) params.append("category_730_Exterior[]", tier.exterior);
  if (tier.quality) params.append("category_730_Quality[]", tier.quality);
  return params;
}
