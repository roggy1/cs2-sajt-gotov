/**
 * The CSFloat price route, run against a stubbed global fetch.
 *
 * What is being pinned down here is the QUESTION the route asks CSFloat.
 * It used to ask "is there a listing whose float is within ±0.001 of this
 * user's own copy?", which for a normal holding is almost always no — and
 * the app reported that as "No matching CSFloat listing found for this
 * float" even when the skin had dozens of listings. A portfolio wants the
 * market price of the skin, so the route now asks for the cheapest Buy Now
 * listing of that exact market_hash_name and nothing more.
 *
 * Run: node --experimental-strip-types --import ./tests/register.mjs \
 *        --test tests/csfloat.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";

const MOD = "../src/routes/api/csfloat-price.ts";
const NAME = "AK-47 | Redline (Field-Tested)";

/** Records every outbound URL (and its headers) and answers with `listings`. */
function stubFetch(listings, status = 200) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers ?? {} });
    return new Response(JSON.stringify(listings), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return calls;
}

/**
 * A fresh module instance AND a cleared cache.
 *
 * The cache, the in-flight map and the throttle are pinned to globalThis on
 * purpose (a warm serverless instance and Vite's HMR must not end up with
 * two of each), which makes them true process singletons — so a test has to
 * clear them explicitly rather than relying on a new module instance.
 */
async function handler() {
  delete globalThis.__cs2hub_csfloat_cache__;
  delete globalThis.__cs2hub_csfloat_inflight__;
  delete globalThis.__cs2hub_csfloat_throttle__;
  const mod = await import(`${MOD}?v=${Math.random()}`);
  const route = mod.Route;
  return route.options?.server?.handlers?.GET ?? route.server?.handlers?.GET;
}

const get = async (query) => {
  const GET = await handler();
  const res = await GET({ request: new Request(`http://test/api/csfloat-price?${query}`) });
  return { status: res.status, body: await res.json() };
};

const listing = (id, price, floatValue, extra = {}) => ({
  id,
  price,
  item: { float_value: floatValue, ...extra },
});

test("returns the LOWEST listing, whatever the user's float is", async () => {
  stubFetch([listing("a", 5000, 0.22), listing("b", 1234, 0.31), listing("c", 2000, 0.16)]);

  const { status, body } = await get(`name=${encodeURIComponent(NAME)}&float=0.9876`);

  assert.equal(status, 200);
  assert.equal(body.priceCents, 1234, "cheapest Buy Now listing, in cents");
});

test("never asks CSFloat to filter by float", async () => {
  const calls = stubFetch([listing("a", 999, 0.4)]);

  await get(`name=${encodeURIComponent(NAME)}&float=0.1234`);

  assert.equal(calls.length, 1, "one upstream call, not a float query plus a fallback");
  assert.ok(!calls[0].url.includes("min_float"), "no min_float in the query");
  assert.ok(!calls[0].url.includes("max_float"), "no max_float in the query");
  assert.ok(calls[0].url.includes("type=buy_now"), "auctions are not prices");
  assert.ok(calls[0].url.includes("sort_by=lowest_price"));
});

test("an item with no listings is 'no price', not an error", async () => {
  stubFetch([]);

  const { status, body } = await get(`name=${encodeURIComponent(NAME)}`);

  assert.equal(status, 200);
  assert.equal(body.priceCents, null);
});

test("a zero or negative price is never accepted as a price", async () => {
  stubFetch([listing("a", 0, 0.2), listing("b", -5, 0.2), listing("c", 750, 0.2)]);

  const { body } = await get(`name=${encodeURIComponent(NAME)}`);

  assert.equal(body.priceCents, 750, "a 0 would wipe the holding's value from every total");
});

test("Doppler phases are still verified — float is not, phase is", async () => {
  // The cheapest listing is a different phase; taking it would report a
  // Phase 1 price for a Ruby, which is wrong rather than approximate.
  stubFetch([
    listing("cheap", 1000, 0.02, { phase: "Phase 1" }),
    listing("ruby", 90000, 0.03, { phase: "Ruby" }),
  ]);

  const { body } = await get(
    `name=${encodeURIComponent("★ Karambit | Doppler (Factory New)")}&phase=Ruby`,
  );

  assert.equal(body.priceCents, 90000, "prices the phase the user actually owns");
});

test("a refusal from CSFloat is a 200 with a status, never a 502", async () => {
  stubFetch({ error: "forbidden" }, 403);

  const { status, body } = await get(`name=${encodeURIComponent(NAME)}`);

  assert.equal(status, 200, "a 5xx would read as the whole deployment being broken");
  assert.equal(body.priceCents, null);
  assert.equal(body.status, "unauthorized");
  assert.equal(body.upstreamStatus, 403);
});

test("the API key is sent when configured, and a User-Agent always is", async () => {
  process.env.CSFLOAT_API_KEY = "test-key-123";
  const calls = stubFetch([listing("a", 500, 0.2)]);

  await get(`name=${encodeURIComponent(NAME)}`);

  const headers = calls[0].headers;
  assert.equal(headers.Authorization, "test-key-123", "raw key, no Bearer prefix");
  assert.ok(String(headers["User-Agent"]).length > 0, "a bare runtime UA is what bot filters drop");
  delete process.env.CSFLOAT_API_KEY;
});

test("a missing key does not stop the lookup", async () => {
  delete process.env.CSFLOAT_API_KEY;
  const calls = stubFetch([listing("a", 4200, 0.2)]);

  const { status, body } = await get(`name=${encodeURIComponent(NAME)}`);

  assert.equal(status, 200);
  assert.equal(body.priceCents, 4200);
  assert.equal(calls[0].headers.Authorization, undefined, "no empty Authorization header");
});

/* -------------------------------------------------------------------------
 * Staying inside CSFloat's rate budget
 *
 * A shared cloud IP gets 429 long before a laptop does, so the route has to
 * (1) remember prices, (2) pace the calls it does make, and (3) treat a
 * refusal as "show what we know", not as an error.
 * ---------------------------------------------------------------------- */

/** Calls the SAME module instance repeatedly — the cache must survive. */
async function session() {
  const GET = await handler();
  return (query) =>
    GET({ request: new Request(`http://test/api/csfloat-price?${query}`) }).then((r) => r.json());
}

test("a second lookup of the same skin costs no upstream call at all", async () => {
  const calls = stubFetch([listing("a", 2500, 0.2)]);
  const get = await session();

  const first = await get(`name=${encodeURIComponent(NAME)}`);
  const second = await get(`name=${encodeURIComponent(NAME)}`);

  assert.equal(first.priceCents, 2500);
  assert.equal(second.priceCents, 2500);
  assert.equal(second.cached, true, "served from memory");
  assert.equal(calls.length, 1, "one CSFloat request for two lookups");
});

test("two copies of one skin share a single lookup, whatever their floats", async () => {
  const calls = stubFetch([listing("a", 3000, 0.2)]);
  const get = await session();

  await get(`name=${encodeURIComponent(NAME)}&float=0.1600`);
  await get(`name=${encodeURIComponent(NAME)}&float=0.3100`);

  assert.equal(calls.length, 1, "float must not split the cache into two entries");
});

test("consecutive upstream calls are spaced out", async () => {
  const stamps = [];
  globalThis.fetch = async () => {
    stamps.push(Date.now());
    return new Response(JSON.stringify([listing("a", 100, 0.2)]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const get = await session();

  // Three DIFFERENT skins, requested at once, as a portfolio refresh does.
  await Promise.all([
    get(`name=${encodeURIComponent("AK-47 | Redline (Field-Tested)")}`),
    get(`name=${encodeURIComponent("AWP | Asiimov (Well-Worn)")}`),
    get(`name=${encodeURIComponent("M4A4 | Howl (Factory New)")}`),
  ]);

  assert.equal(stamps.length, 3);
  const gaps = stamps.slice(1).map((t, i) => t - stamps[i]);
  for (const gap of gaps) {
    // 300ms configured; allow for timer slack on a busy machine.
    assert.ok(gap >= 250, `calls must not be fired back-to-back (gap was ${gap}ms)`);
  }
});

test("a 429 returns the last known price instead of an error", async () => {
  let mode = "ok";
  globalThis.fetch = async () =>
    mode === "ok"
      ? new Response(JSON.stringify([listing("a", 4444, 0.2)]), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      : new Response(JSON.stringify({ error: "rate limited" }), { status: 429 });

  const get = await session();
  const first = await get(`name=${encodeURIComponent(NAME)}&withCount=1`);
  assert.equal(first.priceCents, 4444);

  // CSFloat starts refusing, and the cached entry is deliberately aged past
  // every TTL so the route is forced to go upstream.
  mode = "429";
  for (const entry of globalThis.__cs2hub_csfloat_cache__.values()) {
    entry.fetchedAt = Date.now() - 24 * 60 * 60 * 1000;
  }

  const second = await get(`name=${encodeURIComponent(NAME)}&withCount=1`);

  assert.equal(second.priceCents, 4444, "the price the user had must survive a 429");
  assert.equal(second.stale, true, "and it is honestly marked as stale");
  assert.equal(second.status, "ok", "a rate limit is our plumbing, not their portfolio");
});

test("a 429 with nothing cached says so rather than inventing a price", async () => {
  stubFetch({ error: "rate limited" }, 429);
  const get = await session();

  const body = await get(`name=${encodeURIComponent(NAME)}`);

  assert.equal(body.priceCents, null);
  assert.equal(body.status, "rate_limited");
  assert.equal(body.upstreamStatus, 429);
});

test("a long queue answers from cache rather than holding the request open", async () => {
  let served = 0;
  globalThis.fetch = async () => {
    served++;
    return new Response(JSON.stringify([listing("a", 1500, 0.2)]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const get = await session();

  // Prime a price for one skin, then flood the throttle with other skins so
  // its queue is long, and ask for the primed one again.
  await get(`name=${encodeURIComponent(NAME)}`);
  for (const entry of globalThis.__cs2hub_csfloat_cache__.values()) {
    entry.fetchedAt = Date.now() - 24 * 60 * 60 * 1000; // force a refresh
  }
  const flood = Array.from({ length: 30 }, (_, i) =>
    get(`name=${encodeURIComponent(`Filler ${i} (Field-Tested)`)}`),
  );
  // Let the flood actually reach the throttle's queue before measuring.
  await new Promise((resolve) => setTimeout(resolve, 50));

  const started = Date.now();
  const body = await get(`name=${encodeURIComponent(NAME)}`);
  const waited = Date.now() - started;

  assert.equal(body.priceCents, 1500, "the known price is served immediately");
  assert.equal(body.stale, true);
  assert.ok(waited < 1000, `must not wait behind the whole queue (waited ${waited}ms)`);
  await Promise.all(flood);
  assert.ok(served > 1, "the queued lookups still ran");
});

/* -------------------------------------------------------------------------
 * Listing count
 *
 * Counting used to mean walking up to eight pages, which turned one item
 * page (five wears) into forty upstream calls and was the single biggest
 * source of 429s. The count now has to come out of the response the price
 * already came from.
 * ---------------------------------------------------------------------- */

test("the listing count costs no extra requests", async () => {
  const calls = stubFetch({
    data: [listing("a", 1000, 0.2), listing("b", 1500, 0.3)],
    total: 137,
  });

  const { body } = await get(`name=${encodeURIComponent(NAME)}&withCount=1`);

  assert.equal(calls.length, 1, "the count must ride along on the price request");
  assert.equal(body.listingCount, 137, "reported total, not the page size");
  assert.equal(body.priceCents, 1000);
});

test("a short page is counted exactly, without a total", async () => {
  stubFetch([listing("a", 1000, 0.2), listing("b", 1500, 0.3)]);

  const { body } = await get(`name=${encodeURIComponent(NAME)}&withCount=1`);

  assert.equal(body.listingCount, 2, "fewer rows than the page limit proves there is no page 2");
});

test("a full page with no total reports no count at all", async () => {
  // 50 rows is the query limit: there may well be a page 2, so any number
  // we could give is a floor, and a floor shown as a count is wrong.
  const full = Array.from({ length: 50 }, (_, i) => listing(`l${i}`, 1000 + i, 0.2));
  stubFetch({ data: full });

  const { body } = await get(`name=${encodeURIComponent(NAME)}&withCount=1`);

  assert.equal(body.listingCount, undefined, "no count is better than a wrong one");
  assert.equal(body.priceCents, 1000, "the price is still answered");
});

test("no count is asked for, none is reported", async () => {
  stubFetch({ data: [listing("a", 1000, 0.2)], total: 9 });

  const { body } = await get(`name=${encodeURIComponent(NAME)}`);

  assert.equal(body.listingCount, undefined);
});

/* -------------------------------------------------------------------------
 * Never Pending
 *
 * The client paces CSFloat through a single queue, so a request that never
 * settles does not fail one cell — it stalls every item behind it. The
 * route therefore has to answer within a bounded time no matter what the
 * upstream does.
 * ---------------------------------------------------------------------- */

test("the upstream call carries a 4s abort signal", async () => {
  let seenSignal;
  globalThis.fetch = async (url, init) => {
    seenSignal = init?.signal;
    return new Response(JSON.stringify([listing("a", 1000, 0.2)]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  await get(`name=${encodeURIComponent(NAME)}`);

  assert.ok(seenSignal, "fetch must be given an abort signal");
  assert.equal(seenSignal.aborted, false, "a fast answer is not aborted");
});

test("an upstream that never answers still produces a response", async () => {
  // Nothing ever resolves — the shape of a hung CSFloat, minus the wait.
  globalThis.fetch = () => new Promise(() => {});

  process.env.CSFLOAT_DEADLINE_MS = "120";
  process.env.CSFLOAT_TIMEOUT_MS = "100";
  try {
    const { status, body } = await get(`name=${encodeURIComponent(NAME)}`);

    assert.equal(status, 200, "a hung upstream is still an HTTP 200 answer");
    assert.equal(body.priceCents, null, "no price is known, and that is said plainly");
    assert.equal(
      body.listingCount,
      undefined,
      "'0 listings' would be a claim about the market we never verified",
    );
  } finally {
    delete process.env.CSFLOAT_DEADLINE_MS;
    delete process.env.CSFLOAT_TIMEOUT_MS;
  }
});
