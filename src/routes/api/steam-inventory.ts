import { createFileRoute } from "@tanstack/react-router";
import { readSession } from "@/lib/session.server";

const CS2_APP_ID = "730";
const CONTEXT_ID = "2";
const IMAGE_BASE = "https://community.cloudflare.steamstatic.com/economy/image/";

// Steam's inventory endpoint is aggressively rate-limited; a short cache
// stops a double-click or a re-render from triggering repeat pulls.
const CACHE_TTL_MS = 5 * 60 * 1000;
type Cached = { data: unknown; fetchedAt: number };
const cache = new Map<string, Cached>();

// Steam caps each response at 5000 assets and signals more with
// `more_items` + `last_assetid`. Large inventories need several passes,
// otherwise everything past the first page is silently dropped.
const PAGE_SIZE = 5000;
const MAX_PAGES = 10; // 50k items — far past any real inventory
const PAGE_GAP_MS = 400;

interface SteamAsset {
  assetid: string;
  classid: string;
  instanceid: string;
  amount?: string;
}

interface SteamDescription {
  classid: string;
  instanceid: string;
  market_hash_name?: string;
  name?: string;
  icon_url?: string;
  actions?: { link?: string; name?: string }[];
}

interface InventoryPage {
  assets?: SteamAsset[] | null;
  descriptions?: SteamDescription[] | null;
  more_items?: number;
  last_assetid?: string;
}

export interface ImportedItem {
  assetId: string;
  marketHashName: string;
  iconUrl: string;
  inspectLink: string | null;
}

type FailureReason = "private_inventory" | "rate_limited" | "steam_unreachable";

function fail(steamId: string, reason: FailureReason, detail: string) {
  const log = reason === "steam_unreachable" ? console.error : console.warn;
  log(`[steam-inventory] ${steamId}: ${detail}`);
  return Response.json({ error: reason, items: [] }, { status: 200 });
}

export const Route = createFileRoute("/api/steam-inventory")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const steamId = readSession(request);
        if (!steamId) {
          return Response.json({ error: "not_authenticated", items: [] }, { status: 401 });
        }

        const cached = cache.get(steamId);
        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
          return Response.json(cached.data);
        }

        const allAssets: SteamAsset[] = [];
        const descriptions = new Map<string, SteamDescription>();
        let startAssetId: string | undefined;

        try {
          for (let page = 1; page <= MAX_PAGES; page++) {
            const params = new URLSearchParams({ l: "english", count: String(PAGE_SIZE) });
            if (startAssetId) params.set("start_assetid", startAssetId);

            const res = await fetch(
              `https://steamcommunity.com/inventory/${steamId}/${CS2_APP_ID}/${CONTEXT_ID}?${params.toString()}`,
              { headers: { Accept: "application/json" } },
            );

            if (res.status === 403 || res.status === 401) {
              return fail(steamId, "private_inventory", `${res.status} — inventory is private`);
            }
            if (res.status === 429) {
              // Anything already collected is still worth returning.
              if (allAssets.length === 0) {
                return fail(steamId, "rate_limited", "429 — Steam rate limit hit");
              }
              console.warn(
                `[steam-inventory] ${steamId}: 429 on page ${page}, returning ${allAssets.length} assets collected so far`,
              );
              break;
            }
            if (!res.ok) {
              if (allAssets.length === 0) {
                return fail(steamId, "steam_unreachable", `unexpected status ${res.status}`);
              }
              console.error(
                `[steam-inventory] ${steamId}: status ${res.status} on page ${page}, keeping partial result`,
              );
              break;
            }

            const body = (await res.json()) as InventoryPage | null;

            if (!body || !body.assets || !body.descriptions) {
              if (allAssets.length === 0) {
                // Steam answers 200 with a null body for private inventories
                // too, so this is the same situation as a 403.
                return fail(
                  steamId,
                  "private_inventory",
                  `200 but empty body (assets=${!!body?.assets}, descriptions=${!!body?.descriptions}) — treating as private`,
                );
              }
              break;
            }

            allAssets.push(...body.assets);
            for (const d of body.descriptions) {
              descriptions.set(`${d.classid}_${d.instanceid}`, d);
            }

            console.info(
              `[steam-inventory] ${steamId}: page ${page} -> +${body.assets.length} assets (total ${allAssets.length})`,
            );

            if (!body.more_items || !body.last_assetid) break;
            startAssetId = body.last_assetid;
            await new Promise((resolve) => setTimeout(resolve, PAGE_GAP_MS));
          }

          const items: ImportedItem[] = [];
          let unnamed = 0;

          for (const asset of allAssets) {
            const description = descriptions.get(`${asset.classid}_${asset.instanceid}`);

            // Never drop an asset just because its metadata is odd — fall
            // back to the display name so it still lands in the portfolio
            // and the user can price it manually.
            const marketHashName = description?.market_hash_name ?? description?.name;
            if (!marketHashName) {
              unnamed++;
              continue;
            }

            const rawInspect = description?.actions?.find((a) =>
              (a.link ?? "").includes("csgo_econ_action_preview"),
            )?.link;

            items.push({
              assetId: asset.assetid,
              marketHashName,
              iconUrl: description?.icon_url ? `${IMAGE_BASE}${description.icon_url}` : "",
              inspectLink: rawInspect
                ? rawInspect.replace("%owner_steamid%", steamId).replace("%assetid%", asset.assetid)
                : null,
            });
          }

          if (unnamed > 0) {
            console.warn(`[steam-inventory] ${steamId}: ${unnamed} assets had no usable name`);
          }
          console.info(
            `[steam-inventory] ${steamId}: ${allAssets.length} assets -> ${items.length} importable items`,
          );

          const data = { items, count: items.length };
          cache.set(steamId, { data, fetchedAt: Date.now() });
          return Response.json(data);
        } catch (err) {
          console.error(`[steam-inventory] ${steamId}: request threw`, err);
          return Response.json({ error: "steam_unreachable", items: [] }, { status: 200 });
        }
      },
    },
  },
});
