import { useQuery } from "@tanstack/react-query";
import { fetchFullCatalog } from "./fetchCatalog";
import { readCatalogCache, writeCatalogCache } from "./idbCache";
import type { CatalogItem } from "./types";

async function loadCatalog(): Promise<CatalogItem[]> {
  const cached = await readCatalogCache();
  if (cached) return cached;

  const fresh = await fetchFullCatalog();
  void writeCatalogCache(fresh); // fire-and-forget; don't block on cache write
  return fresh;
}

/**
 * Loads the full CS2 item catalog (~10,000+ items) once, cached in
 * IndexedDB for 24h so repeat visits are instant. Runs in the background —
 * the rest of the app (the user's own inventory/wishlist) doesn't wait on it.
 */
export function useCatalog() {
  return useQuery<CatalogItem[]>({
    queryKey: ["cs2-item-catalog"],
    queryFn: loadCatalog,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: Infinity,
    retry: 1,
  });
}
