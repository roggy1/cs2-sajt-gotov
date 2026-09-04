import { get, set, del } from "idb-keyval";
import type { CatalogItem } from "./types";

/**
 * IMPORTANT: bump this whenever the SHAPE or CONTENT of normalized catalog
 * items changes (see normalizeSkins) — e.g. adding the Doppler phase suffix
 * to names, or emitting separate StatTrak™ entries.
 *
 * The cache stores already-normalized items, so without a version bump a
 * returning user keeps being served the OLD normalized array for up to 24h
 * and none of the normalization changes are visible in the UI at all.
 */
// v9: items gained `collectionImage` and the full `crates` list.
// v10: stickers gained `variant`, `variantGroupId`, `marketHashName` and
//      their capsules. Without this bump a returning user keeps the v9
//      array for up to 24h, and the finish selector has nothing to group.
// v11: gold sticker rarity is corrected by tournament, and stickers now
//      carry their event as provenance. Without a bump a returning user
//      keeps seeing the old Exotic tag for up to 24h.
// v12: stickers gained tournamentImage (event artwork borrowed from a
//      sibling finish) and the Chatterbox float override was removed.
const CACHE_VERSION = 12;

const CACHE_KEY = `cs2-item-catalog-v${CACHE_VERSION}`;
const META_KEY = `cs2-item-catalog-v${CACHE_VERSION}-meta`;
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 1 day — the upstream data changes rarely

interface CacheMeta {
  fetchedAt: number;
}

/** Clears caches written by older versions so they don't sit around taking up space. */
async function purgeOldVersions(): Promise<void> {
  const deletions: Promise<void>[] = [];
  for (let v = 1; v < CACHE_VERSION; v++) {
    deletions.push(del(`cs2-item-catalog-v${v}`), del(`cs2-item-catalog-v${v}-meta`));
  }
  try {
    await Promise.all(deletions);
  } catch {
    /* ignore */
  }
}

/** Returns the cached catalog if present and younger than MAX_AGE_MS, else null. */
export async function readCatalogCache(): Promise<CatalogItem[] | null> {
  try {
    void purgeOldVersions();
    const meta = await get<CacheMeta>(META_KEY);
    if (!meta || Date.now() - meta.fetchedAt > MAX_AGE_MS) return null;
    const items = await get<CatalogItem[]>(CACHE_KEY);
    return items && items.length > 0 ? items : null;
  } catch {
    // IndexedDB unavailable (private browsing, old browser, etc) — just skip caching.
    return null;
  }
}

export async function writeCatalogCache(items: CatalogItem[]): Promise<void> {
  try {
    await set(CACHE_KEY, items);
    await set(META_KEY, { fetchedAt: Date.now() } satisfies CacheMeta);
  } catch {
    /* ignore — non-fatal, the app just re-fetches next time */
  }
}
