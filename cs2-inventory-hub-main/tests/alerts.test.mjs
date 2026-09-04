/**
 * Price-alert rules.
 *
 * The part worth testing here is not the storage but the DECISION: whether
 * a given price counts as reaching the user's target, and which way it had
 * to move to get there. That rule is what turns a refresh into a
 * notification, and getting it wrong is either silence when the price hit
 * the number, or an alert on every single refresh.
 *
 * Run: node --experimental-strip-types --import ./tests/register.mjs \
 *        --test tests/alerts.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  directionFor,
  isAlertMet,
  migrateAlerts,
  migrateNotifications,
  subjectFromSkin,
  subjectFromWish,
} from "../src/lib/alertModel.ts";

const alert = (over) => ({
  id: "a1",
  name: "AK-47 | Redline",
  source: "portfolio",
  targetPrice: 30,
  direction: "above",
  createdAt: 0,
  armed: true,
  ...over,
});

test("a target above today's price waits for a RISE", () => {
  assert.equal(directionFor(40, 30), "above");
});

test("a target below today's price waits for a DROP", () => {
  assert.equal(directionFor(20, 30), "below");
});

test("with no reference price the direction is undecided", () => {
  assert.equal(directionFor(20, undefined), "either");
  // NaN is not a price. Treating it as one would pick a direction at random.
  assert.equal(directionFor(20, Number.NaN), "either");
});

test("an equal target is undecided rather than guessed", () => {
  assert.equal(directionFor(30, 30), "either");
});

test("a rise alert fires at the target and above it, never below", () => {
  const a = alert({ direction: "above" });
  assert.equal(isAlertMet(a, 29.99), false);
  assert.equal(isAlertMet(a, 30), true);
  assert.equal(isAlertMet(a, 41), true);
});

test("a drop alert fires at the target and below it, never above", () => {
  const a = alert({ direction: "below", targetPrice: 20 });
  assert.equal(isAlertMet(a, 20.01), false);
  assert.equal(isAlertMet(a, 20), true);
  assert.equal(isAlertMet(a, 5), true);
});

test("an undecided alert fires only on an exact hit", () => {
  const a = alert({ direction: "either" });
  assert.equal(isAlertMet(a, 30), true);
  assert.equal(isAlertMet(a, 31), false);
  assert.equal(isAlertMet(a, 29), false);
});

test("holdings and wishlist entries become the same kind of subject", () => {
  const fromSkin = subjectFromSkin({
    id: "s1",
    name: "AK-47 | Redline",
    category: "Rifles",
    wear: "Field-Tested",
    buyPrice: 10,
    marketPrices: {},
    stattrak: true,
  });
  assert.equal(fromSkin.source, "portfolio");
  assert.equal(fromSkin.wear, "Field-Tested");
  assert.equal(fromSkin.stattrak, true);

  const fromWish = subjectFromWish({
    id: "w1",
    name: "AWP | Asiimov",
    targetPrice: 50,
    marketPrice: 70,
    wear: "Battle-Scarred",
    catalogId: "skin-awp-asiimov",
  });
  assert.equal(fromWish.source, "wishlist");
  assert.equal(fromWish.wear, "Battle-Scarred");
  // Carried through so the notification can link to the exact Inspect page.
  assert.equal(fromWish.catalogId, "skin-awp-asiimov");
});

test("a Doppler phase survives into the alert's name", () => {
  const subject = subjectFromSkin({
    id: "s2",
    name: "★ Karambit | Doppler",
    category: "Knives",
    wear: "Factory New",
    buyPrice: 0,
    marketPrices: {},
    phase: "Ruby",
  });
  assert.equal(subject.name, "★ Karambit | Doppler (Ruby)");
});

test("alerts written by the pre-wishlist build keep working", () => {
  const migrated = migrateAlerts([
    { skinId: "s1", name: "AK-47 | Redline", targetPrice: 30, direction: "above", armed: true },
  ]);
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].id, "s1");
  // Nothing but the portfolio existed back then.
  assert.equal(migrated[0].source, "portfolio");
});

test("migration drops records it cannot make sense of", () => {
  const migrated = migrateAlerts([
    null,
    "nonsense",
    { name: "no id, no target" },
    { skinId: "s1", targetPrice: "30" },
  ]);
  assert.deepEqual(migrated, []);
  assert.deepEqual(migrateAlerts(undefined), []);
});

test("old notifications gain a stable id of their own", () => {
  const migrated = migrateNotifications([
    { id: "n1", skinId: "s1", name: "AK-47 | Redline", price: 41, targetPrice: 30 },
  ]);
  assert.equal(migrated.length, 1);
  // The notification id and the ITEM id are different things now: one is
  // what gets marked read, the other is what the alert watches.
  assert.equal(migrated[0].notificationId, "n1");
  assert.equal(migrated[0].id, "s1");
  assert.equal(migrated[0].source, "portfolio");
});
