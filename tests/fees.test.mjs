/**
 * Fee maths, and specifically WHO the user's fee override applies to.
 *
 * The app has one fee input holding Steam's rate, and every market row is
 * priced with that same options object passed down. The override therefore
 * has to name the market it belongs to — otherwise any market flagged
 * `userAdjustable` picks it up and shows a rate that is not its own, with
 * nothing on screen to explain the number.
 *
 * Run: node --experimental-strip-types --import ./tests/register.mjs \
 *        --test tests/fees.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";

import { netProceeds, feeBreakdown, resolveRate } from "../src/lib/fees.ts";
import { getMarket } from "../src/lib/markets/registry.ts";

const STEAM_OVERRIDE = { sellerFeePercent: 15, sellerFeeMarket: "steam" };

test("Steam's fee is inclusive — divided out, not subtracted", () => {
  // 15% inclusive on 34.02 is 29.58, NOT 34.02 * 0.85 (28.92).
  const net = netProceeds(34.02, "steam", STEAM_OVERRIDE);
  assert.ok(Math.abs(net - 29.58) < 0.01, `expected ~29.58, got ${net}`);
});

test("an exclusive market subtracts its cut off the top", () => {
  // Skinport: 8% of 32.29 -> 29.71.
  const net = netProceeds(32.29, "skinport");
  assert.ok(Math.abs(net - 29.71) < 0.01, `expected ~29.71, got ${net}`);
});

test("Steam's override does NOT bleed into another market", () => {
  // The regression this test exists for: Market.CSGO rendered at -15%,
  // Steam's rate, because it was merely flagged adjustable.
  const { appliedRate } = feeBreakdown(29.59, "marketcsgo", STEAM_OVERRIDE);
  const own = getMarket("marketcsgo").fees.sellerFee;
  assert.equal(appliedRate, own, "marketcsgo must use its own fee, not Steam's");
  assert.notEqual(appliedRate, 0.15);
});

test("the override still applies to the market it names", () => {
  const { appliedRate } = feeBreakdown(100, "steam", {
    sellerFeePercent: 12,
    sellerFeeMarket: "steam",
  });
  assert.equal(appliedRate, 0.12);
});

test("an untagged override is ignored rather than applied blindly", () => {
  const { appliedRate } = feeBreakdown(100, "steam", { sellerFeePercent: 12 });
  assert.equal(appliedRate, getMarket("steam").fees.sellerFee);
});

test("volume tiers beat the base rate at the threshold", () => {
  const fees = getMarket("skinport").fees;
  assert.equal(resolveRate(fees, 999, undefined, "skinport"), 0.08);
  assert.equal(resolveRate(fees, 1000, undefined, "skinport"), 0.06);
});

test("net is never greater than gross for any market", () => {
  for (const id of ["steam", "skinport", "csfloat", "marketcsgo"]) {
    for (const gross of [0.03, 12.5, 999, 5000]) {
      const net = netProceeds(gross, id, STEAM_OVERRIDE);
      assert.ok(net <= gross + 1e-9, `${id} @ ${gross}: net ${net} > gross ${gross}`);
      assert.ok(net > 0, `${id} @ ${gross}: net collapsed to ${net}`);
    }
  }
});

test("an unknown market returns the price untouched instead of guessing", () => {
  assert.equal(netProceeds(42, "not-a-market"), 42);
});
