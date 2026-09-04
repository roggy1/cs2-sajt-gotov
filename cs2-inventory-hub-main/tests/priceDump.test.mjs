/**
 * The shared price dump, run against a stubbed global fetch.
 *
 * What matters here is not "does it parse JSON" but the two properties the
 * pricing model now rests on:
 *
 *   1. ONE download answers the whole portfolio, on every market. That is
 *      the entire point — per-item calls are what got the app rate-limited
 *      on a shared Vercel IP in the first place.
 *   2. A zero is never a price. A 0 that survives into a holding reads as
 *      "this skin is worthless" and quietly drags the portfolio total down.
 *
 * Run: node --experimental-strip-types --import ./tests/register.mjs \
 *        --test tests/priceDump.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";

const MOD = "../src/lib/server/priceDump.server.ts";
const NAME = "AK-47 | Redline (Field-Tested)";

/** Answers the FX file and the dump, and records every URL asked for. */
function stubFetch(dump, { rates = { EUR: 0.5 } } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const href = String(url);
    calls.push(href);
    const body = href.includes("exchange_rates") ? rates : dump;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return calls;
}

/**
 * A fresh module instance AND a cleared cache. The dump is pinned to
 * globalThis on purpose (a warm serverless instance and Vite's HMR must not
 * end up with two copies), which makes it a true process singleton — so a
 * test has to clear it explicitly.
 */
async function load() {
  delete globalThis.__cs2hub_price_dump__;
  delete process.env.PRICE_DUMP_URL;
  process.env.PRICE_DUMP_RATE = "1";
  return import(`${MOD}?v=${Math.random()}`);
}

test("one download answers every market for every item", async () => {
  const calls = stubFetch({
    [NAME]: {
      steam: { last_24h: 12.5, volume: 320 },
      csgofloat: { price: 11, quantity: 7 },
      skinport: { starting_at: 10.5, suggested_price: 13, quantity: 42 },
    },
    "AWP | Asiimov (Field-Tested)": { steam: { last_24h: 60 } },
  });
  const { dumpQuote, dumpRow } = await load();

  const steam = await dumpQuote(NAME, "steam");
  const csfloat = await dumpQuote(NAME, "csfloat");
  const skinport = await dumpQuote(NAME, "skinport");
  const other = await dumpRow("AWP | Asiimov (Field-Tested)");

  assert.equal(calls.length, 1, "four lookups across two items must cost ONE request");
  assert.equal(steam.priceEur, 12.5);
  assert.equal(csfloat.priceEur, 11);
  assert.equal(csfloat.listingCount, 7);
  assert.equal(skinport.priceEur, 10.5, "starting_at is what a buyer pays, not suggested_price");
  assert.equal(skinport.listingCount, 42);
  assert.equal(other.steam.priceEur, 60);
});

test("a zero, a negative or a missing price is never a price", async () => {
  stubFetch({
    [NAME]: {
      steam: { last_24h: 0 },
      csgofloat: { price: -1 },
      skinport: { starting_at: "not a number" },
    },
    // A second, healthy item so the dump itself parses — a dump where
    // NOTHING parses is a broken dump, and is covered by its own test
    // below.
    "AWP | Asiimov (Field-Tested)": { steam: { last_24h: 60 } },
  });
  const { dumpQuote } = await load();

  for (const market of ["steam", "csfloat", "skinport"]) {
    assert.equal(await dumpQuote(NAME, market), null, `${market} must report no price, not 0`);
  }
});

test("a market missing from the entry is absent, not zero", async () => {
  stubFetch({ [NAME]: { steam: { last_24h: 9 } } });
  const { dumpRow } = await load();

  const row = await dumpRow(NAME);
  assert.equal(row.steam.priceEur, 9);
  assert.equal(row.csfloat, undefined);
  assert.equal(row.skinport, undefined);
});

test("an unknown item is a real answer, not a failure", async () => {
  stubFetch({ [NAME]: { steam: { last_24h: 9 } } });
  const { dumpQuote } = await load();

  // null = "the dump loaded and has nothing for this"; undefined would mean
  // "we could not read a dump at all", and the routes treat those
  // differently on purpose.
  assert.equal(await dumpQuote("Nonexistent | Skin (Factory New)", "steam"), null);
});

test("prices are converted into EUR on the way in", async () => {
  stubFetch({ [NAME]: { steam: { last_24h: 10 } } }, { rates: { EUR: 0.5 } });
  delete globalThis.__cs2hub_price_dump__;
  delete process.env.PRICE_DUMP_URL;
  delete process.env.PRICE_DUMP_RATE; // let the FX file decide
  const { dumpQuote } = await import(`${MOD}?v=${Math.random()}`);

  const steam = await dumpQuote(NAME, "steam");
  assert.equal(steam.priceEur, 5, "a USD dump must not be shown as EUR unconverted");
});

test("a catalogue with no prices fails loudly instead of zeroing the portfolio", async () => {
  // CSGO-API's skins.json shape: real items, no price field anywhere.
  stubFetch({ [NAME]: { id: "skin-7", rarity: "Classified" } });
  const { dumpQuote } = await load();

  assert.equal(
    await dumpQuote(NAME, "steam"),
    undefined,
    "0 usable rows must read as 'no dump', so callers can fall back",
  );
});

test("the dump can be switched off entirely", async () => {
  const calls = stubFetch({ [NAME]: { steam: { last_24h: 9 } } });
  delete globalThis.__cs2hub_price_dump__;
  process.env.PRICE_DUMP_URL = "off";
  const { dumpQuote } = await import(`${MOD}?v=${Math.random()}`);

  assert.equal(await dumpQuote(NAME, "steam"), undefined);
  assert.equal(calls.length, 0, "nothing is downloaded when the dump is off");
  delete process.env.PRICE_DUMP_URL;
});
