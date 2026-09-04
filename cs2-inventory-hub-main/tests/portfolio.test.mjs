/**
 * Portfolio arithmetic.
 *
 * These exist because of a specific confusion this dashboard produced: a
 * value chart reading €1452 next to a market total reading €680 with
 * €625 of realised profit. Nothing was miscomputed — two different
 * quantities were both being called "value". The tests below pin down which
 * number means what, so the labels and the maths cannot drift apart again.
 *
 * Run: node --experimental-strip-types --import ./tests/register.mjs \
 *        --test tests/portfolio.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  countMissingPrices,
  getMarketPrice,
  removeHolding,
  revertSale,
  soldHoldings,
  updateSalePrice,
  countOpenPositions,
  countOwnedUnits,
  getEffectivePrice,
  getPositionValue,
  getTotalPaid,
  isOpenPosition,
  sumHoldingsValue,
  sumPortfolioValue,
  sumRealizedPnL,
  sumSaleProceeds,
  sumTotalPaid,
} from "../src/lib/portfolioMath.ts";

const TAX = 15;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: expected ~${b}, got ${a}`);

const skin = (over) => ({
  id: "x",
  name: "AK-47 | Redline",
  category: "Rifles",
  buyPrice: 10,
  quantity: 1,
  marketPrices: {},
  ...over,
});

/** The reported reading, rebuilt from scratch. */
const held = Array.from({ length: 10 }, (_, i) =>
  skin({ id: `h${i}`, buyPrice: 50, marketPrices: { csfloat: 69.4 } }),
);
const sold = [
  skin({
    id: "s1",
    buyPrice: 100,
    marketPrices: { csfloat: 300 },
    sold: { pricePerUnit: 500, date: "2026-08-01" },
  }),
  skin({
    id: "s2",
    buyPrice: 47,
    marketPrices: { csfloat: 200 },
    sold: { pricePerUnit: 272, date: "2026-08-02" },
  }),
];
const portfolio = [...held, ...sold];

test("holdings value counts only what is still owned", () => {
  near(sumHoldingsValue(portfolio, "csfloat", TAX), 680.12, "holdings");
  // The sold items carry CSFloat prices too; they must not be added.
  assert.equal(sumHoldingsValue(portfolio, "csfloat", TAX), sumHoldingsValue(held, "csfloat", TAX));
});

test("portfolio value is holdings plus banked cash, and nothing else", () => {
  const holdings = sumHoldingsValue(portfolio, "csfloat", TAX);
  const cash = sumSaleProceeds(portfolio);
  near(cash, 772, "cash");
  near(sumPortfolioValue(portfolio, "csfloat", TAX), holdings + cash, "total");
  // This is the €1452 that looked like a bug next to the €680 market row.
  near(sumPortfolioValue(portfolio, "csfloat", TAX), 1452.12, "total");
});

test("banked cash is the same on every market — only holdings move", () => {
  const cash = sumSaleProceeds(portfolio);
  for (const market of ["steam", "skinport", "csfloat"]) {
    near(
      sumPortfolioValue(portfolio, market, TAX) - sumHoldingsValue(portfolio, market, TAX),
      cash,
      `cash on ${market}`,
    );
  }
});

test("profit is the total minus everything ever spent — no double counting", () => {
  const net = sumPortfolioValue(portfolio, "csfloat", TAX) - sumTotalPaid(portfolio);
  const unrealised = sumHoldingsValue(portfolio, "csfloat", TAX) - sumTotalPaid(held);
  // Realised and unrealised must add up to the headline number exactly; if
  // sale proceeds were counted twice (or the cost of sold items dropped),
  // this is the assertion that breaks.
  near(net, unrealised + sumRealizedPnL(portfolio), "net = unrealised + realised");
  near(sumRealizedPnL(portfolio), 625, "realised");
});

test("selling does not destroy value — it moves it", () => {
  const before = sumPortfolioValue(held, "csfloat", TAX);
  const [first, ...rest] = held;
  const price = getEffectivePrice(first, "csfloat", TAX);
  const after = sumPortfolioValue(
    [{ ...first, sold: { pricePerUnit: price, date: "2026-09-01" } }, ...rest],
    "csfloat",
    TAX,
  );
  near(after, before, "total is unchanged by selling at the market price");
  // ...but the inventory itself really is smaller, which is exactly why the
  // two figures need different labels.
  assert.ok(
    sumHoldingsValue(
      [{ ...first, sold: { pricePerUnit: price, date: "x" } }, ...rest],
      "csfloat",
      TAX,
    ) < before,
  );
});

test("quantity multiplies the price, once", () => {
  const two = skin({ quantity: 2, buyPrice: 10, marketPrices: { skinport: 100 } });
  near(getTotalPaid(two), 20, "paid");
  // Skinport takes 8%: 100 * 0.92 = 92 per unit, 184 for two.
  near(getEffectivePrice(two, "skinport", TAX), 92, "unit net");
  near(getPositionValue(two, "skinport", TAX), 184, "position");
  near(sumHoldingsValue([two], "skinport", TAX), 184, "sum");
});

test("a missing price is not a zero price", () => {
  const untracked = skin({ marketPrices: {} });
  assert.equal(getEffectivePrice(untracked, "steam", TAX), undefined);
  assert.equal(getPositionValue(untracked, "steam", TAX), undefined);
  // It contributes nothing to the total rather than dragging it down.
  assert.equal(sumHoldingsValue([untracked], "steam", TAX), 0);
});

test("counters describe the inventory, not the archive", () => {
  assert.equal(countOpenPositions(portfolio), 10);
  assert.equal(countOwnedUnits(portfolio), 10);
  assert.equal(countOwnedUnits([skin({ quantity: 3 })]), 3);
  // Sold holdings have no Steam price here, but they are not gaps to fill.
  assert.equal(countMissingPrices(portfolio, "steam"), 10);
  assert.equal(countMissingPrices(sold, "steam"), 0);
  assert.equal(
    sold.every((s) => !isOpenPosition(s)),
    true,
  );
});

test("Steam's fee is divided out of the holdings total, not subtracted", () => {
  const one = skin({ marketPrices: { steam: 115 } });
  // 115 inclusive of 15% is 100 net — 115 * 0.85 (97.75) would be wrong.
  near(sumHoldingsValue([one], "steam", 15), 100, "steam net");
});

/* ---- editing a sale after the fact ------------------------------------ */

const withSale = [
  skin({ id: "keep", buyPrice: 10, marketPrices: { steam: 20 } }),
  skin({
    id: "typo",
    buyPrice: 100,
    quantity: 2,
    sold: { pricePerUnit: 5000, date: "2026-08-10" },
  }),
  skin({ id: "older", buyPrice: 10, sold: { pricePerUnit: 30, date: "2026-01-02" } }),
];

test("sold holdings are listed newest sale first", () => {
  assert.deepEqual(
    soldHoldings(withSale).map((s) => s.id),
    ["typo", "older"],
  );
  // An owned holding is not history and never appears here.
  assert.equal(
    soldHoldings(withSale).some((s) => s.id === "keep"),
    false,
  );
});

test("correcting a sale price moves the realised result immediately", () => {
  near(sumRealizedPnL(withSale), (5000 - 100) * 2 + 20, "before");
  const fixed = updateSalePrice(withSale, "typo", 500);
  near(sumRealizedPnL(fixed), (500 - 100) * 2 + 20, "after");
  // Quantity still multiplies the corrected figure, once.
  near(sumSaleProceeds(fixed), 500 * 2 + 30, "proceeds");
});

test("correcting a price keeps the sale date — it is the same sale", () => {
  const fixed = updateSalePrice(withSale, "typo", 500);
  assert.equal(fixed.find((s) => s.id === "typo").sold.date, "2026-08-10");
});

test("a nonsense price is refused rather than stored", () => {
  for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(updateSalePrice(withSale, "typo", bad), withSale);
  }
});

test("reverting a sale returns the item to the inventory, intact", () => {
  const reverted = revertSale(withSale, "typo");
  const back = reverted.find((s) => s.id === "typo");
  assert.equal(back.sold, undefined);
  assert.equal(isOpenPosition(back), true);
  // Cost basis and quantity survive, so it can simply be sold again.
  assert.equal(back.buyPrice, 100);
  assert.equal(back.quantity, 2);
  assert.equal(countOpenPositions(reverted), 2);
  // Its proceeds leave the realised figures with it.
  near(sumRealizedPnL(reverted), 20, "realised after revert");
  near(sumSaleProceeds(reverted), 30, "cash after revert");
});

test("deleting a record removes the money spent on it too", () => {
  const investedBefore = sumTotalPaid(withSale);
  const pruned = removeHolding(withSale, "typo");
  assert.equal(
    pruned.some((s) => s.id === "typo"),
    false,
  );
  near(sumTotalPaid(pruned), investedBefore - 200, "invested drops by the cost basis");
  near(sumRealizedPnL(pruned), 20, "realised drops with it");
});

test("editing one record leaves every other one alone", () => {
  const edited = updateSalePrice(withSale, "typo", 500);
  assert.deepEqual(
    edited.filter((s) => s.id !== "typo"),
    withSale.filter((s) => s.id !== "typo"),
  );
  // An id that is not there changes nothing at all.
  assert.deepEqual(updateSalePrice(withSale, "ghost", 1), withSale);
  assert.deepEqual(revertSale(withSale, "ghost"), withSale);
});

/* -------------------------------------------------------------------------
 * Zero is not a price
 *
 * A freshly added holding whose lookup had not landed yet rendered a
 * confident "0.00" — which reads as "this skin is worthless" rather than
 * "we have no answer" — and, worse, counted as priced, so nothing ever
 * went back to ask.
 * ---------------------------------------------------------------------- */

test("a stored 0 is not a price", () => {
  const item = { ...skin({}), marketPrices: { steam: 0 } };

  assert.equal(getMarketPrice(item, "steam"), undefined, "0.00 must read as no price");
  assert.equal(getEffectivePrice(item, "steam", 15), undefined);
  assert.equal(countMissingPrices([item], "steam"), 1, "and it must count as still missing");
  assert.equal(sumHoldingsValue([item], "steam", 15), 0);
});

test("NaN and negatives are rejected the same way", () => {
  for (const bad of [Number.NaN, -3, Number.POSITIVE_INFINITY]) {
    const item = { ...skin({}), marketPrices: { steam: bad } };
    assert.equal(getMarketPrice(item, "steam"), undefined, `${bad} is not a price`);
  }
});

test("a real price still comes through untouched", () => {
  const item = { ...skin({}), marketPrices: { steam: 12.5 } };
  assert.equal(getMarketPrice(item, "steam"), 12.5);
});
