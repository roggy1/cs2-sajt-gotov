/**
 * Market registry scoping.
 *
 * The portfolio and the Inspect page deliberately see DIFFERENT market
 * lists. A market listed for the portfolio gets a stored price on every
 * holding, a column in the inventory table and a slot in the comparison
 * panel; a research-only market appears on the Inspect page alone and
 * costs an existing portfolio nothing.
 *
 * That boundary is invisible on screen until it is already broken — a new
 * adapter silently appears in someone's inventory table — so it is pinned
 * here instead.
 *
 * Run: node --experimental-strip-types --import ./tests/register.mjs \
 *        --test tests/markets.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  MARKETS,
  INSPECT_MARKETS,
  MARKET_ADAPTERS,
  getMarket,
} from "../src/lib/markets/registry.ts";

test("every adapter declares a scope", () => {
  for (const m of MARKET_ADAPTERS) {
    assert.ok(
      m.scope === "all" || m.scope === "inspect",
      `${m.id} has no valid scope (got ${JSON.stringify(m.scope)})`,
    );
  }
});

test("the portfolio sees only markets scoped to it", () => {
  for (const m of MARKETS) {
    assert.equal(m.scope, "all", `${m.id} leaked into the portfolio market list`);
  }
});

test("the portfolio list is exactly the three original markets", () => {
  // Adding a fourth is a deliberate decision — it changes what is stored
  // on every holding a user owns — so it should break this test first.
  assert.deepEqual(MARKETS.map((m) => m.id).sort(), ["csfloat", "skinport", "steam"]);
});

test("Market.CSGO is available on Inspect but not in the portfolio", () => {
  assert.ok(
    INSPECT_MARKETS.some((m) => m.id === "marketcsgo"),
    "marketcsgo should be comparable on the Inspect page",
  );
  assert.ok(
    !MARKETS.some((m) => m.id === "marketcsgo"),
    "marketcsgo must NOT appear in the portfolio",
  );
});

test("the Inspect list is a superset of the portfolio list", () => {
  const inspect = new Set(INSPECT_MARKETS.map((m) => m.id));
  for (const m of MARKETS) {
    assert.ok(inspect.has(m.id), `${m.id} is in the portfolio but not on Inspect`);
  }
});

test("both lists contain only enabled adapters", () => {
  for (const m of [...MARKETS, ...INSPECT_MARKETS]) {
    assert.equal(m.enabled, true, `${m.id} is disabled but still listed`);
  }
});

test("getMarket resolves inspect-only markets too", () => {
  // Fee maths and logo lookups go through getMarket regardless of scope,
  // so an inspect-only market must still resolve or its quotes render bare.
  const m = getMarket("marketcsgo");
  assert.ok(m, "getMarket('marketcsgo') returned nothing");
  assert.equal(m.label, "Market.CSGO");
});

test("a market reporting 24h volume does not also claim a listing count", () => {
  // Market.CSGO publishes units SOLD in 24h, not live offers. Reporting
  // that as a listing count would state a number the market never gave.
  const m = getMarket("marketcsgo");
  assert.equal(m.capabilities.volume24h, true);
  assert.equal(m.capabilities.listingCount, false);
});

test("every market's fee rate is a sane fraction with a checked date", () => {
  for (const m of INSPECT_MARKETS) {
    assert.ok(
      m.fees.sellerFee >= 0 && m.fees.sellerFee < 0.5,
      `${m.id} has an implausible seller fee: ${m.fees.sellerFee}`,
    );
    assert.match(m.fees.verifiedAt, /^\d{4}-\d{2}-\d{2}$/, `${m.id} has no ISO verifiedAt date`);
  }
});

test("only one market carries the user-adjustable fee flag", () => {
  // The app has a single fee input and it holds STEAM's rate. A second
  // adjustable market would silently be repriced at Steam's number.
  const adjustable = MARKET_ADAPTERS.filter((m) => m.fees.userAdjustable).map((m) => m.id);
  assert.deepEqual(adjustable, ["steam"]);
});
