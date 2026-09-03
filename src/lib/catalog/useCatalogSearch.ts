import { useMemo } from "react";
import Fuse from "fuse.js";
import type { CatalogItem } from "./types";
import { catalogDisplayName } from "./doppler";
import { useDebouncedValue } from "@/lib/useDebouncedValue";

const RESULT_LIMIT = 50;
// How many raw fuzzy matches to pull before filtering by category — generous
// enough that a category filter rarely hides a relevant match.
const FUSE_POOL = 300;

/**
 * Fuzzy-searches the full catalog (typo-tolerant, via Fuse.js), debounced so
 * typing stays instant, capped to RESULT_LIMIT rendered rows so the dropdown
 * never has to paint hundreds of DOM nodes at once.
 *
 * The index is built over the RENDERED display name (which always carries
 * the Doppler phase and any StatTrak™ prefix), not the raw upstream name —
 * otherwise typing "Ruby" or "StatTrak" would match nothing.
 */
export function useCatalogSearch(
  items: CatalogItem[] | undefined,
  query: string,
  category: string,
): CatalogItem[] {
  const debouncedQuery = useDebouncedValue(query, 150);

  const fuse = useMemo(() => {
    if (!items || items.length === 0) return null;
    const indexed = items.map((item) => ({ item, searchName: catalogDisplayName(item) }));
    return new Fuse(indexed, {
      keys: ["searchName"],
      threshold: 0.35,
      ignoreLocation: true,
    });
  }, [items]);

  return useMemo(() => {
    if (!items) return [];
    const q = debouncedQuery.trim();

    if (!q) {
      if (category !== "all") {
        return items.filter((i) => i.category === category).slice(0, RESULT_LIMIT);
      }
      // With no query and no category filter, the raw catalog order would
      // show a monotonous run of one category (it's grouped upstream).
      // Round-robin across categories instead, picking randomly within each,
      // so the first thing the user sees is a varied mix — knives, gloves,
      // rifles, cases — rather than 50 stickers in a row.
      const byCategory = new Map<string, CatalogItem[]>();
      for (const item of items) {
        const bucket = byCategory.get(item.category);
        if (bucket) bucket.push(item);
        else byCategory.set(item.category, [item]);
      }

      const buckets = Array.from(byCategory.values()).map((bucket) => {
        const offset = Math.floor(Math.random() * bucket.length);
        return { bucket, offset };
      });

      const mixed: CatalogItem[] = [];
      for (let round = 0; mixed.length < RESULT_LIMIT && round < RESULT_LIMIT; round++) {
        let addedThisRound = false;
        for (const { bucket, offset } of buckets) {
          if (round >= bucket.length) continue;
          const picked = bucket[(offset + round) % bucket.length];
          if (picked) {
            mixed.push(picked);
            addedThisRound = true;
          }
          if (mixed.length >= RESULT_LIMIT) break;
        }
        if (!addedThisRound) break;
      }
      return mixed;
    }

    if (!fuse) return [];
    const matches = fuse.search(q, { limit: FUSE_POOL }).map((r) => r.item.item);
    const filtered = category === "all" ? matches : matches.filter((i) => i.category === category);
    return filtered.slice(0, RESULT_LIMIT);
  }, [items, fuse, debouncedQuery, category]);
}
