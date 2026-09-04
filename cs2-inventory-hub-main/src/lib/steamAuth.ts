import { useMutation, useQuery } from "@tanstack/react-query";

export interface SteamProfile {
  authenticated: boolean;
  steamId?: string;
  personaName?: string | null;
  avatar?: string | null;
  profileUrl?: string | null;
  /** Unix seconds — formatted client-side so it follows the user's locale. */
  memberSince?: number | null;
  cs2Hours?: number | null;
  error?: string;
}

export interface ImportedItem {
  assetId: string;
  marketHashName: string;
  iconUrl: string;
  inspectLink: string | null;
}

export type InventoryImportError =
  "private_inventory" | "rate_limited" | "steam_unreachable" | "not_authenticated";

export interface InventoryImportResult {
  items: ImportedItem[];
  error?: InventoryImportError;
}

/** Current Steam session, if any. Returns `authenticated: false` when logged out. */
export function useSteamProfile() {
  return useQuery<SteamProfile>({
    queryKey: ["steam-profile"],
    queryFn: async () => {
      const res = await fetch("/api/steam-profile");
      return (await res.json()) as SteamProfile;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

/**
 * Pulls the signed-in user's CS2 inventory.
 *
 * A private inventory is NOT treated as a failure — it resolves normally
 * with an `error` code so the UI can show a helpful banner instead of a
 * crash or an empty portfolio with no explanation.
 */
export function useSteamInventoryImport() {
  return useMutation<InventoryImportResult>({
    mutationFn: async () => {
      const res = await fetch("/api/steam-inventory");
      const body = (await res.json()) as {
        items?: ImportedItem[];
        error?: InventoryImportError;
      };
      return { items: body.items ?? [], error: body.error };
    },
  });
}

export async function steamLogout(): Promise<void> {
  await fetch("/api/steam-logout", { method: "POST" });
}
