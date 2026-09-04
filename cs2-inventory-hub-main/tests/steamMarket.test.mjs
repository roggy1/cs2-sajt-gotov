/**
 * Behavioural tests for the Steam market layer, run against a stubbed
 * global fetch so nothing touches the real Steam API.
 */
import assert from "node:assert/strict";
import test from "node:test";

// The Steam route now answers from the shared price dump by default; these
// tests exercise the live Steam layer, so the dump is switched off and the
// live path switched on for them.
process.env.PRICE_DUMP_URL = "off";
process.env.STEAM_LIVE = "1";

const MOD = "../src/lib/server/steamMarket.server.ts";
const NAME = "AK-47 | Redline (Field-Tested)";

/** Records every outbound URL and answers from a scripted routing table. */
function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    for (const [match, respond] of routes) {
      if (String(url).includes(match)) return respond();
    }
    throw new Error(`unrouted: ${url}`);
  };
  return calls;
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const renderOk = () =>
  json({
    success: true,
    total_count: 1229,
    listinginfo: {
      a: { converted_price: 3500, converted_fee: 344 },
      b: { converted_price: 3600, converted_fee: 354 },
    },
  });

/**
 * The limiter, cache and in-flight map are pinned to globalThis on purpose
 * (so Vite HMR can't create two limiters that each think they own the full
 * rate budget). That makes them true process singletons, so a test has to
 * clear them explicitly rather than relying on a fresh module instance.
 */
async function freshModule() {
  delete globalThis.__cs2hub_steam_limiter__;
  delete globalThis.__cs2hub_steam_cache__;
  delete globalThis.__cs2hub_steam_inflight__;
  return import(`${MOD}?v=${Math.random()}`);
}

test("parseSteamPrice handles Steam's localized strings", async () => {
  const { parseSteamPrice } = await freshModule();
  assert.equal(parseSteamPrice("35,10€"), 35.1);
  assert.equal(parseSteamPrice("$38.44"), 38.44);
  assert.equal(parseSteamPrice("1.234,56€"), 1234.56);
  assert.equal(parseSteamPrice("1,234.56€"), 1234.56);
  assert.equal(parseSteamPrice(undefined), null);
  assert.equal(parseSteamPrice("—"), null);
});

test("happy path: price AND exact listing count from ONE request", async () => {
  const { getSteamQuote } = await freshModule();
  const calls = stubFetch([["/render/", renderOk]]);

  const quote = await getSteamQuote(NAME, { withCount: true });

  assert.equal(quote.listingCount, 1229, "exact count from total_count");
  assert.equal(quote.priceEur, 38.44, "cheapest listing, price + buyer fee");
  assert.equal(quote.status, "ok");
  assert.equal(calls.length, 1, "must not make a second Steam call");
});

test("fallback: search endpoint supplies the count when render 429s", async () => {
  const { getSteamQuote } = await freshModule();
  const calls = stubFetch([
    ["/listings/730/", () => json({}, 429)],
    [
      "/market/search/render/",
      () =>
        json({
          success: true,
          results: [
            { hash_name: `StatTrak™ ${NAME}`, sell_listings: 159 },
            { hash_name: NAME, sell_listings: 1229 },
            { hash_name: `Souvenir ${NAME}`, sell_listings: 3 },
          ],
        }),
    ],
    ["/priceoverview/", () => json({ success: true, lowest_price: "35,10€", volume: "90" })],
  ]);

  const quote = await getSteamQuote(NAME, { withCount: true });

  assert.equal(quote.listingCount, 1229, "must pick the EXACT hash_name, not results[0]");
  assert.equal(quote.priceEur, 35.1);
  assert.equal(quote.status, "ok");
  assert.ok(calls.some((c) => c.includes("search/render")));
});

test("an HTML challenge page is treated as a block, not as 'no listings'", async () => {
  const { getSteamQuote } = await freshModule();
  stubFetch([
    ["/listings/730/", () => new Response("<html>blocked</html>", { status: 200 })],
    ["/market/search/render/", () => json({ results: [{ hash_name: NAME, sell_listings: 7 }] })],
    ["/priceoverview/", () => json({ success: true, lowest_price: "1,00€" })],
  ]);

  const quote = await getSteamQuote(NAME, { withCount: true });
  assert.equal(quote.listingCount, 7, "recovers via fallback instead of reporting n/a");
});

test("total Steam outage returns rate_limited, never a fake zero", async () => {
  const { getSteamQuote } = await freshModule();
  stubFetch([["steamcommunity.com", () => json({}, 429)]]);

  const quote = await getSteamQuote(NAME, { withCount: true });
  assert.equal(quote.status, "rate_limited");
  assert.equal(quote.priceEur, null);
  assert.equal(quote.listingCount, undefined, "n/a is honest here; 0 would be a lie");
});

test("a later failure never erases a count we already knew", async () => {
  const { getSteamQuote } = await freshModule();
  stubFetch([["/render/", renderOk]]);
  await getSteamQuote(NAME, { withCount: true });

  // Steam goes down; force a refetch past every cache tier.
  stubFetch([["steamcommunity.com", () => json({}, 429)]]);
  const quote = await getSteamQuote(NAME, { withCount: true, force: true });

  assert.equal(quote.listingCount, 1229, "keeps the last known good count");
  assert.equal(quote.priceEur, 38.44, "and the last known good price");
  assert.equal(quote.cached, true);
  assert.equal(quote.stale, true, "honestly marked as not fresh");
  // Deliberately NOT "rate_limited": the user is looking at a real price,
  // and a warning about our request budget describes our plumbing rather
  // than their portfolio. The status stays honest when there is nothing to
  // show — see the next test.
  assert.equal(quote.status, "ok");
});

test("a 429 with nothing cached still reports rate_limited", async () => {
  const { getSteamQuote } = await freshModule();
  stubFetch([["steamcommunity.com", () => json({}, 429)]]);

  const quote = await getSteamQuote(NAME, { withCount: true });

  assert.equal(quote.priceEur, null, "nothing to fall back on");
  assert.equal(quote.status, "rate_limited", "so the status must say why");
});

test("concurrent lookups of the same name make ONE Steam call", async () => {
  const { getSteamQuote } = await freshModule();
  let hits = 0;
  globalThis.fetch = async () => {
    hits += 1;
    await new Promise((r) => setTimeout(r, 20));
    return renderOk();
  };

  const quotes = await Promise.all(
    Array.from({ length: 8 }, () => getSteamQuote(NAME, { withCount: true })),
  );

  assert.equal(hits, 1, "in-flight dedupe");
  for (const q of quotes) assert.equal(q.listingCount, 1229);
});

test("a cache hit costs no Steam call and returns immediately", async () => {
  const { getSteamQuote } = await freshModule();
  let hits = 0;
  globalThis.fetch = async () => {
    hits += 1;
    return renderOk();
  };

  await getSteamQuote(NAME, { withCount: true });
  const started = Date.now();
  const second = await getSteamQuote(NAME, { withCount: true });

  assert.equal(hits, 1);
  assert.equal(second.cached, true);
  assert.ok(Date.now() - started < 50, "cached reads must not wait on the limiter");
});

test("an entry without a count does not satisfy a request that needs one", async () => {
  const { getSteamQuote } = await freshModule();
  const calls = stubFetch([
    [
      "/listings/730/",
      () =>
        json({ success: true, listinginfo: { a: { converted_price: 100, converted_fee: 15 } } }),
    ],
    ["/market/search/render/", () => json({ results: [{ hash_name: NAME, sell_listings: 42 }] })],
    ["/priceoverview/", () => json({ success: true, lowest_price: "1,15€" })],
  ]);

  const bulk = await getSteamQuote(NAME, { withCount: false });
  assert.equal(bulk.listingCount, undefined);

  calls.length = 0;
  const itemPage = await getSteamQuote(NAME, { withCount: true });
  assert.equal(itemPage.listingCount, 42, "must refetch rather than serve n/a from cache");
});

test("no fixed multi-second gap: several distinct names resolve promptly", async () => {
  const { getSteamQuote } = await freshModule();
  globalThis.fetch = async () => renderOk();

  const started = Date.now();
  await Promise.all(
    Array.from({ length: 9 }, (_, i) => getSteamQuote(`Item ${i}`, { withCount: true })),
  );
  const elapsed = Date.now() - started;

  // The old serial queue cost 2.5s per item: 9 items = 22.5s minimum.
  assert.ok(elapsed < 4000, `9 lookups took ${elapsed}ms; the old queue needed 22500ms`);
});

test("a 429 on the listings endpoint does NOT stall the fallback endpoints", async () => {
  const { getSteamQuote } = await freshModule();
  stubFetch([
    ["/listings/730/", () => json({}, 429)],
    ["/market/search/render/", () => json({ results: [{ hash_name: NAME, sell_listings: 88 }] })],
    ["/priceoverview/", () => json({ success: true, lowest_price: "12,34€", volume: "40" })],
  ]);

  const started = Date.now();
  const quote = await getSteamQuote(NAME, { withCount: true });
  const elapsed = Date.now() - started;

  assert.equal(quote.listingCount, 88);
  assert.equal(quote.priceEur, 12.34);
  // Each endpoint has its own limiter, so the listings cooldown (5s by
  // default) must not be served by the calls meant to rescue it.
  assert.ok(
    elapsed < 1500,
    `fallback took ${elapsed}ms — it is sitting out a cooldown it did not earn`,
  );
});

test("a deep cooldown never hangs the response: it fails fast and serves stale", async () => {
  const { getSteamQuote } = await freshModule();
  stubFetch([["/render/", renderOk]]);
  await getSteamQuote(NAME, { withCount: true });

  // Drive every endpoint into a cooldown.
  stubFetch([["steamcommunity.com", () => json({}, 429)]]);
  await getSteamQuote("Other A", { withCount: true }).catch(() => {});
  await getSteamQuote("Other B", { withCount: true }).catch(() => {});

  const started = Date.now();
  const quote = await getSteamQuote(NAME, { withCount: true, force: true });
  const elapsed = Date.now() - started;

  assert.ok(
    elapsed < 4000,
    `response took ${elapsed}ms; a queued request must never hold the handler`,
  );
  assert.equal(quote.listingCount, 1229, "serves the last good value rather than n/a");
  assert.equal(quote.stale, true);
});

test("stale-while-revalidate: a soft-stale entry answers instantly and refreshes behind", async () => {
  const { getSteamQuote } = await freshModule();
  let hits = 0;
  globalThis.fetch = async () => {
    hits += 1;
    return renderOk();
  };

  await getSteamQuote(NAME, { withCount: true });
  assert.equal(hits, 1);

  // Age the entry past the soft TTL but well inside the hard one.
  const entry = globalThis.__cs2hub_steam_cache__.get(NAME);
  entry.fetchedAt = Date.now() - 11 * 60 * 1000;

  const started = Date.now();
  const quote = await getSteamQuote(NAME, { withCount: true });
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 50, `stale read took ${elapsed}ms; it must not wait on the network`);
  assert.equal(quote.stale, true);
  assert.equal(quote.listingCount, 1229);

  await new Promise((r) => setTimeout(r, 600));
  assert.equal(hits, 2, "a background refresh should have run");
});

test("Doppler-style names round-trip through URL encoding intact", async () => {
  const { getSteamQuote } = await freshModule();
  const tricky = "★ Karambit | Doppler (Factory New)";
  const calls = stubFetch([["/render/", renderOk]]);

  await getSteamQuote(tricky, { withCount: true });

  const url = calls[0];
  assert.ok(url.includes(encodeURIComponent(tricky)), "name must be percent-encoded in the path");
  assert.ok(!url.includes("★"), "raw non-ASCII in a URL path is how these lookups silently 404");
});

/* -------------------------------------------------------------------------
 * Which endpoint a PRICE-ONLY lookup opens with.
 *
 * This is the difference between Steam prices loading and not loading at
 * all on a shared cloud IP: `render` answers price and count together but
 * has the tightest per-IP budget, so opening with it meant a portfolio
 * refresh — which wants nothing but prices — spent its first request on the
 * endpoint most likely to 429.
 * ---------------------------------------------------------------------- */

const overviewOk = () =>
  json({ success: true, lowest_price: "12,34€", median_price: "13,00€", volume: "1,234" });

test("a price-only lookup goes straight to priceoverview, not to render", async () => {
  const { getSteamQuote } = await freshModule();
  const calls = stubFetch([
    ["/priceoverview/", overviewOk],
    ["/render/", () => json({}, 429)],
  ]);

  const quote = await getSteamQuote(NAME, { withCount: false });

  assert.equal(quote.priceEur, 12.34, "reports Steam's LOWEST listing price");
  assert.equal(quote.status, "ok");
  assert.equal(calls.length, 1, "exactly one Steam call");
  assert.ok(calls[0].includes("/priceoverview/"), `opened with ${calls[0]}`);
  assert.ok(
    !calls.some((c) => c.includes("/listings/730/")),
    "the tightly-limited listings endpoint must not be touched",
  );
});

test("price-only falls back to render when priceoverview has nothing", async () => {
  const { getSteamQuote } = await freshModule();
  const calls = stubFetch([
    ["/priceoverview/", () => json({ success: false })],
    ["/render/", renderOk],
  ]);

  const quote = await getSteamQuote(NAME, { withCount: false });

  assert.equal(quote.priceEur, 38.44, "recovers via render rather than reporting n/a");
  assert.ok(calls[0].includes("/priceoverview/"), "cheap endpoint still goes first");
  assert.ok(
    calls.some((c) => c.includes("/listings/730/")),
    "render is the fallback, not the opening move",
  );
});

test("a price-only lookup still reports volume when asked", async () => {
  const { getSteamQuote } = await freshModule();
  stubFetch([["/priceoverview/", overviewOk]]);

  const quote = await getSteamQuote(NAME, { withCount: false, withVolume: true });

  assert.equal(quote.priceEur, 12.34);
  assert.equal(quote.volume24h, 1234, "24h volume comes from the same response");
});

test("asking for a count still uses the one-request render path", async () => {
  const { getSteamQuote } = await freshModule();
  const calls = stubFetch([["/render/", renderOk]]);

  const quote = await getSteamQuote(NAME, { withCount: true });

  assert.equal(quote.listingCount, 1229);
  assert.equal(calls.length, 1, "count + price still cost exactly one call");
});

test("a cached price is served without touching Steam at all", async () => {
  const { getSteamQuote } = await freshModule();
  const calls = stubFetch([["/priceoverview/", overviewOk]]);

  await getSteamQuote(NAME, { withCount: false });
  const second = await getSteamQuote(NAME, { withCount: false });

  assert.equal(second.priceEur, 12.34);
  assert.equal(second.cached, true);
  assert.equal(calls.length, 1, "one Steam request for two lookups");
});

test("consecutive Steam calls are paced, not fired back-to-back", async () => {
  const { getSteamQuote } = await freshModule();
  const stamps = [];
  globalThis.fetch = async () => {
    stamps.push(Date.now());
    return json({ success: true, lowest_price: "9,99€" });
  };

  // Three different skins at once, the way a portfolio refresh asks.
  await Promise.all(
    [
      "AK-47 | Redline (Field-Tested)",
      "AWP | Asiimov (Well-Worn)",
      "M4A4 | Howl (Factory New)",
    ].map((name) => getSteamQuote(name, { withCount: false })),
  );

  assert.equal(stamps.length, 3);
  // Two at a time are allowed through, so the pacing shows up as the spread
  // between the first and the last rather than as a gap on every pair.
  assert.ok(
    stamps[stamps.length - 1] - stamps[0] >= 250,
    `three lookups must not leave together (spread was ${stamps[stamps.length - 1] - stamps[0]}ms)`,
  );
});
