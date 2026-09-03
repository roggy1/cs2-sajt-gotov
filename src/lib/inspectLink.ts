import { useCallback, useMemo } from "react";
import { catalogDisplayName } from "@/lib/catalog/doppler";
import { useCatalog } from "@/lib/catalog/useCatalog";
import { slugifyWear, type Wear } from "@/lib/wear";

/**
 * Anything the app can point at the Inspect page: a holding, a wishlist
 * entry or a notification. Only the name is required — everything else
 * narrows down WHICH version of the item opens.
 */
export interface InspectSubject {
  name: string;
  wear?: Wear | undefined;
  stattrak?: boolean | undefined;
  souvenir?: boolean | undefined;
  /** Catalog id captured when the item was picked, used in preference to
   * the name lookup because it survives a rename upstream. */
  catalogId?: string | undefined;
  phase?: string | undefined;
  paintIndex?: string | undefined;
}

/** Route params + search for `<Link to="/item/$id">`. */
export interface InspectTarget {
  params: { id: string };
  search: { variant?: string; wear?: string };
}

/**
 * Resolves an item to its Inspect page, wear and variant included.
 *
 * The Inspect page reads `?wear=` and `?variant=` to decide what it prices,
 * so a link that omits them lands on the first available exterior — which
 * is how clicking a Battle-Scarred holding used to open Factory New. Every
 * caller goes through this one helper so that can't drift apart again.
 */
export function useInspectLink(): (subject: InspectSubject) => InspectTarget | null {
  const { data: catalogItems } = useCatalog();

  const idByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of catalogItems ?? []) {
      map.set(entry.name, entry.id);
      // The catalog's own display name (phase suffix included) is what the
      // portfolio stores, so index both spellings.
      map.set(catalogDisplayName(entry), entry.id);
    }
    return map;
  }, [catalogItems]);

  return useCallback(
    (subject: InspectSubject) => {
      const id =
        subject.catalogId ??
        idByName.get(catalogDisplayName(subject)) ??
        idByName.get(subject.name);
      if (!id) return null;

      const variant = subject.stattrak ? "stattrak" : subject.souvenir ? "souvenir" : undefined;

      return {
        params: { id },
        // Keys are omitted rather than set to undefined — the item route's
        // search schema treats a present key as meaningful, and
        // `?variant=undefined` in the address bar is worse than no key.
        search: {
          ...(variant ? { variant } : {}),
          ...(subject.wear ? { wear: slugifyWear(subject.wear) } : {}),
        },
      };
    },
    [idByName],
  );
}
