import { createFileRoute } from "@tanstack/react-router";
import { dumpRow, dumpSnapshot, type DumpRow } from "@/lib/server/priceDump.server";

/**
 * Every market's price for many items, in ONE request.
 *
 * This is the endpoint the inventory table warms itself with. The old
 * model was one HTTP call per holding per market — forty holdings meant
 * forty calls to price the current market and forty more the moment the
 * user switched source, each one a chance to be rate-limited. Here the
 * whole portfolio is answered from the in-memory dump in a single round
 * trip, for all three markets at once, so switching source afterwards costs
 * no network at all: the client already has the numbers.
 *
 *   GET /api/prices?names=<a>|<b>|<c>   → { results: { [name]: row } }
 *   GET /api/prices?name=<a>            → one row
 *
 * A row is `{ steam?: {...}, csfloat?: {...}, skinport?: {...} }`, and a
 * market is ABSENT when we have no price for it — never present with a 0,
 * which the UI would have to render as a real figure.
 */

/** One request should not be able to ask for the world. */
const MAX_BATCH = 400;

interface PriceRowResponse {
  steam?: { priceEur: number; listingCount?: number };
  csfloat?: { priceEur: number; listingCount?: number };
  skinport?: { priceEur: number; listingCount?: number };
}

function toResponse(row: DumpRow | null | undefined): PriceRowResponse {
  if (!row) return {};
  const out: PriceRowResponse = {};
  for (const market of ["steam", "csfloat", "skinport"] as const) {
    const quote = row[market];
    // The > 0 test is the last line of defence for the "0.00" bug: a zero
    // must never reach the client as a price, whatever a dump decides to
    // publish.
    if (!quote || !Number.isFinite(quote.priceEur) || quote.priceEur <= 0) continue;
    out[market] = {
      priceEur: quote.priceEur,
      ...(quote.listingCount !== undefined ? { listingCount: quote.listingCount } : {}),
    };
  }
  return out;
}

export const Route = createFileRoute("/api/prices")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const single = url.searchParams.get("name");
          const many = url.searchParams.get("names");
          const force = url.searchParams.get("force") === "1";

          const diagnostics = { "X-Price-Dump": JSON.stringify(dumpSnapshot()) };

          if (single) {
            const row = await dumpRow(single, force);
            return Response.json(
              { name: single, ...toResponse(row), available: row !== undefined },
              { headers: diagnostics },
            );
          }

          if (!many) {
            return Response.json(
              { error: "Missing 'name' or 'names' query parameter" },
              { status: 400 },
            );
          }

          // The separator is a BARE pipe, and a market_hash_name contains a
          // SPACED one: "AK-47 | Redline (Field-Tested)". Splitting on "|"
          // alone shreds every name into fragments, which is a bug this
          // codebase has already paid for once on the Steam route.
          const names = [
            ...new Set(
              many
                .split(/(?<! )\|(?! )/)
                .map((n) => n.trim())
                .filter(Boolean),
            ),
          ].slice(0, MAX_BATCH);

          if (names.length === 0) {
            return Response.json({ error: "Empty 'names' parameter" }, { status: 400 });
          }

          // One dump read per name — a Map lookup each, no network.
          const results: Record<string, PriceRowResponse> = {};
          let available = false;
          for (const name of names) {
            const row = await dumpRow(name, force);
            if (row !== undefined) available = true;
            results[name] = toResponse(row);
          }

          return Response.json({ results, available }, { headers: diagnostics });
        } catch (err) {
          // Nothing may throw out of this handler: on Vercel an uncaught
          // error is a 502, and the client cannot tell that apart from the
          // whole deployment being broken. An empty result set is one round
          // of missing prices; a 502 is a wall of red.
          console.error("[prices] handler failed:", err);
          return Response.json({ results: {}, available: false });
        }
      },
    },
  },
});
