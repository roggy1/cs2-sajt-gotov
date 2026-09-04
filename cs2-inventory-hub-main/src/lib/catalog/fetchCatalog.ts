import type { CatalogItem } from "./types";
import { normalizeSkins, normalizeSimple, normalizeStickers } from "./normalize";

// ByMykel/CSGO-API — free, open-source, no API key, updated daily via CI.
// https://github.com/ByMykel/CSGO-API
const BASE = "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en";

async function fetchJson<T>(file: string): Promise<T> {
  const res = await fetch(`${BASE}/${file}`);
  if (!res.ok) throw new Error(`Failed to fetch ${file}: ${res.status}`);
  return (await res.json()) as T;
}

interface RawCollection {
  name?: string;
  image?: string;
}

/**
 * Collection name → artwork.
 *
 * Upstream ships an image for all 110 collections, so this replaces what
 * would otherwise be a hand-written icon map. A hardcoded map is wrong by
 * construction here: it needs a new entry every time Valve ships a case,
 * which means the collections people are actually asking about — Gods and
 * Monsters, Boreal, whatever lands next — are exactly the ones missing.
 */
function indexCollectionImages(raw: RawCollection[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const c of raw) {
    if (c?.name && c.image) index.set(c.name, c.image);
  }
  return index;
}

/**
 * Fetches the full CS2 item catalog: skins (grouped by pattern — wear is
 * chosen separately in the UI), stickers, agents, cases, music kits,
 * patches, graffiti and keychains. ~10,000+ items combined.
 */
export async function fetchFullCatalog(): Promise<CatalogItem[]> {
  const [skins, collections, stickers, agents, cases, musicKits, patches, graffiti, keychains] =
    await Promise.all([
      fetchJson<Parameters<typeof normalizeSkins>[0]>("skins.json"),
      fetchJson<RawCollection[]>("collections.json"),
      fetchJson<Parameters<typeof normalizeStickers>[0]>("stickers.json"),
      fetchJson<Parameters<typeof normalizeSimple>[0]>("agents.json"),
      fetchJson<Parameters<typeof normalizeSimple>[0]>("crates.json"),
      fetchJson<Parameters<typeof normalizeSimple>[0]>("music_kits.json"),
      fetchJson<Parameters<typeof normalizeSimple>[0]>("patches.json"),
      fetchJson<Parameters<typeof normalizeSimple>[0]>("graffiti.json"),
      fetchJson<Parameters<typeof normalizeSimple>[0]>("keychains.json"),
    ]);

  return [
    ...normalizeSkins(skins, indexCollectionImages(collections)),
    ...normalizeStickers(stickers),
    ...normalizeSimple(agents, "agent", "Agent"),
    ...normalizeSimple(cases, "case", "Case"),
    ...normalizeSimple(musicKits, "musicKit", "Music Kit"),
    ...normalizeSimple(patches, "patch", "Patch"),
    ...normalizeSimple(graffiti, "graffiti", "Graffiti"),
    ...normalizeSimple(keychains, "keychain", "Keychain"),
  ];
}
