/**
 * Doppler / Gamma Doppler phase handling.
 *
 * PRIMARY SOURCE: ByMykel's CSGO-API exposes a `phase` field directly on
 * skin entries ("Ruby", "Sapphire", "Black Pearl", "Emerald", "Phase 1"...).
 * That's authoritative and is what we use — each phase is already its own
 * entry in their data, so every phase naturally becomes its own searchable
 * catalog item.
 *
 * FALLBACK: if `phase` is ever missing but `paint_index` is present, we map
 * it ourselves. These paint kit indices are corroborated by two independent
 * sources (a CS2 server-admin skin-spawn command list, and qwkdev/csapi's
 * per-phase "finish-catalog" mapping).
 *
 * NOTE: paint_index (the paint KIT id — 415, 568, ...) is a completely
 * different field from the pattern/paint SEED (0-1000) a user types in
 * manually. Conflating those two is the classic Doppler pricing bug.
 *
 * Steam's own market_hash_name never contains the phase in its text — every
 * phase of a given knife shares one literal Steam name. So we bake the
 * phase into the DISPLAY name for the user, then strip it back out when
 * building an actual marketplace query, passing paint_index as the real
 * structured disambiguator instead.
 */
const DOPPLER_PHASE_BY_PAINT_INDEX: Record<string, string> = {
  "415": "Ruby",
  "416": "Sapphire",
  "417": "Black Pearl",
  "418": "Phase 1",
  "419": "Phase 2",
  "420": "Phase 3",
  "421": "Phase 4",
};

const GAMMA_DOPPLER_PHASE_BY_PAINT_INDEX: Record<string, string> = {
  "568": "Emerald",
  "569": "Phase 1",
  "570": "Phase 2",
  "571": "Phase 3",
  "572": "Phase 4",
};

/**
 * Resolves the phase label for a skin. Prefers the upstream `phase` field
 * (authoritative); falls back to our own paint_index mapping only when
 * that's absent. Returns undefined for non-Doppler items.
 */
export function resolvePhase(
  name: string,
  phaseField: string | null | undefined,
  paintIndex: string | null | undefined,
): string | undefined {
  if (phaseField && phaseField.trim()) return phaseField.trim();
  if (!paintIndex) return undefined;
  const isGamma = name.includes("Gamma Doppler");
  if (!isGamma && !name.includes("Doppler")) return undefined;
  return (isGamma ? GAMMA_DOPPLER_PHASE_BY_PAINT_INDEX : DOPPLER_PHASE_BY_PAINT_INDEX)[paintIndex];
}

/** Appends " (Phase)" to a clean base name, when a phase applies. */
export function withPhaseSuffix(name: string, phase: string | undefined): string {
  if (!phase) return name;
  return name.includes(`(${phase})`) ? name : `${name} (${phase})`;
}

/**
 * Reverses withPhaseSuffix using a KNOWN phase list, so the name is safe to
 * send as a real marketplace market_hash_name (which never includes the
 * phase in its text). Safe to call on any name.
 */
const ALL_PHASE_LABELS = [
  ...new Set([
    ...Object.values(DOPPLER_PHASE_BY_PAINT_INDEX),
    ...Object.values(GAMMA_DOPPLER_PHASE_BY_PAINT_INDEX),
  ]),
];

export function stripPhaseSuffix(name: string): string {
  for (const phase of ALL_PHASE_LABELS) {
    const suffix = ` (${phase})`;
    if (name.endsWith(suffix)) return name.slice(0, -suffix.length);
  }
  return name;
}

/**
 * The four "gem" phases. These are the ones where Steam's floor price is
 * wildly wrong — a gem routinely sells for several times the cheapest
 * Doppler on the market, and Steam lists them all under one name.
 *
 * Matched by phase LABEL rather than paint_index on purpose: the index
 * isn't constant across knives (Black Pearl is 417 on most, but 617 on the
 * Butterfly Knife and Shadow Daggers), so the label is the reliable key.
 *
 * Regular Phase 1-4 are deliberately NOT here: they sit close enough to the
 * market floor that Steam's figure remains a usable approximation, and it's
 * already flagged in the UI with the "Base floor" badge.
 */
const GEM_PHASES = new Set(["Ruby", "Sapphire", "Black Pearl", "Emerald"]);

/**
 * True when the item is a Doppler gem (Ruby/Sapphire/Black Pearl/Emerald),
 * i.e. one where a Steam floor quote would be badly misleading.
 */
export function isDopplerGem(item: {
  name: string;
  phase?: string | null | undefined;
  paintIndex?: string | null | undefined;
}): boolean {
  const base = stripPhaseSuffix(item.name);
  const phase = resolvePhase(base, item.phase, item.paintIndex);
  return phase !== undefined && GEM_PHASES.has(phase);
}

/**
 * True when this item is a Doppler/Gamma Doppler with a specific phase
 * (Ruby, Sapphire, Black Pearl, Emerald, Phase 1-4).
 *
 * Matters for pricing: Steam lists every phase of a knife under one single
 * market_hash_name, so a Steam quote for such an item is the FLOOR price
 * across all phases — not the price of that gem. CSFloat can filter by
 * paint_index and does return the exact phase price.
 */
export function hasDopplerPhase(item: {
  name: string;
  phase?: string | null | undefined;
  paintIndex?: string | null | undefined;
}): boolean {
  const base = stripPhaseSuffix(item.name);
  return resolvePhase(base, item.phase, item.paintIndex) !== undefined;
}

/**
 * The name to actually RENDER in the UI (search dropdown, inventory table).
 *
 * This is the last line of defense: it re-derives the phase from whatever
 * fields are available and guarantees the "(Phase)" suffix is present, so
 * two different Doppler phases can never render as identical text — even if
 * the item came from an older cache written before phases were handled.
 */
export function catalogDisplayName(item: {
  name: string;
  phase?: string | null | undefined;
  paintIndex?: string | null | undefined;
}): string {
  const base = stripPhaseSuffix(item.name);
  const phase = resolvePhase(base, item.phase, item.paintIndex);
  return withPhaseSuffix(base, phase);
}
