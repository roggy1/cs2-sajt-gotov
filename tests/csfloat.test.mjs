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

/** A fresh module instance, so the route's in-memory cache starts empty. */
async function handler() {
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
