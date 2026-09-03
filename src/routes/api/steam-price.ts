import { createFileRoute } from "@tanstack/react-router";
import {
  getSteamQuote,
  limiterSnapshot,
  parseSteamPrice,
  type SteamQuote,
} from "@/lib/server/steamMarket.server";

// Re-exported so existing importers (and tests) keep working — the parser
// itself now lives with the rest of the Steam logic.
export { parseSteamPrice };

/** Cap on a single batch request, so one client can't queue the world. */
const MAX_BATCH = 50;

/**
 * Steam price + listing count.
 *
 * All the awkward parts — which endpoint reports an exact listing count,
 * what to do when it 429s, and how fast we may ask — live in
 * `steamMarket.server`. This handler only parses the request and shapes
 * the response.
 *
 * Two shapes:
 *   GET ?name=<market_hash_name>          → one quote
 *   GET ?names=<a>|<b>|<c>                → { results: { [name]: quote } }
 *
 * The batch form exists because a portfolio refresh used to make one HTTP
 * round trip per holding, each one queued behind a fixed 2.5s gap on the
 * server. Batching lets the limiter interleave them itself.
 */
export const Route = createFileRoute("/api/steam-price")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const single = url.searchParams.get("name");
        const many = url.searchParams.get("names");

        // Manual refresh bypasses every cache tier, but never the limiter.
        const force = url.searchParams.get("force") === "1";
        // The item page wants a real listing count; bulk refreshes don't
        // need one, and skipping it saves the fallback call.
        const withCount = url.searchParams.get("withCount") === "1";
        const withVolume = url.searchParams.get("withVolume") === "1";
        const opts = { force, withCount, withVolume };

        const diagnostics = { "X-Steam-Limiter": JSON.stringify(limiterSnapshot()) };

        if (many) {
          const names = [
            ...new Set(
              many
                .split("|")
                .map((n) => n.trim())
                .filter(Boolean),
            ),
          ];
          if (names.length === 0) {
            return Response.json({ error: "Empty 'names' parameter" }, { status: 400 });
          }
          if (names.length > MAX_BATCH) {
            return Response.json({ error: `Too many names (max ${MAX_BATCH})` }, { status: 400 });
          }

          // Fired together on purpose: the limiter owns pacing, so the
          // handler must not re-serialise what it already schedules.
          const settled = await Promise.all(
            names.map(async (name) => [name, await getSteamQuote(name, opts)] as const),
          );

          return Response.json(
            { results: Object.fromEntries(settled) as Record<string, SteamQuote> },
            { headers: diagnostics },
          );
        }

        if (!single) {
          return Response.json(
            { error: "Missing 'name' or 'names' query parameter" },
            { status: 400 },
          );
        }

        const quote = await getSteamQuote(single, opts);
        return Response.json(quote, { headers: diagnostics });
      },
    },
  },
});
