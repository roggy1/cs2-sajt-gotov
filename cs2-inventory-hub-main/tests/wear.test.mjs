/**
 * Exterior rules.
 *
 * This is the logic that decides whether an item has a wear at all — the
 * rule that quietly gave every sticker five wear conditions. It lives in
 * its own React-free module so it can be tested directly.
 *
 * Run: node --experimental-strip-types --import ./tests/register.mjs \
 *        --test tests/wear.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  WEARS,
  availableWearsFor,
  isWearless,
  requiresWear,
  slugifyWear,
  wearRange,
} from "../src/lib/wear.ts";

const STICKER = {
  kind: "sticker",
  category: "Sticker",
  // Exactly the shape upstream gives: no wears array, no float bounds.
  wears: undefined,
  minFloat: undefined,
  maxFloat: undefined,
};

test("a sticker has NO wear rows", () => {
  // The regression: with no wears array and no float bounds, the overlap
  // test defaulted to 0..1 and matched all five buckets, so the card
  // offered "Factory New" through "Battle-Scarred" for a sticker.
  assert.deepEqual(availableWearsFor(STICKER), []);
  assert.equal(requiresWear(STICKER), false);
  assert.equal(isWearless(STICKER), true);
});

test("every wearless kind is covered, not just stickers", () => {
  for (const kind of ["sticker", "agent", "case", "musicKit", "patch", "graffiti", "keychain"]) {
    const item = { kind, category: "Sticker", wears: undefined };
    assert.equal(isWearless(item), true, kind);
    assert.deepEqual(availableWearsFor(item), [], kind);
  }
});

test("category is a fallback when the kind is missing", () => {
  // Holdings saved before `kind` existed only carry a category.
  for (const category of [
    "Sticker",
    "Agent",
    "Case",
    "Music Kit",
    "Patch",
    "Graffiti",
    "Keychain",
  ]) {
    assert.equal(isWearless({ category }), true, category);
  }
  assert.equal(isWearless({ category: "Rifle" }), false);
  assert.equal(isWearless({}), false, "unknown shapes stay treated as skins");
});

test("skins still get their wears", () => {
  const skin = { kind: "skin", category: "Rifle", minFloat: 0, maxFloat: 1 };
  assert.deepEqual(availableWearsFor(skin), [...WEARS]);
  assert.equal(requiresWear(skin), true);
  assert.equal(isWearless(skin), false);
});

test("a skin's declared wear list wins over the float range", () => {
  const skin = {
    kind: "skin",
    category: "Rifle",
    wears: ["Field-Tested", "Battle-Scarred"],
    minFloat: 0,
    maxFloat: 1,
  };
  assert.deepEqual(availableWearsFor(skin), ["Field-Tested", "Battle-Scarred"]);
});

test("float bounds exclude exteriors a skin cannot reach", () => {
  const restricted = { kind: "skin", category: "Rifle", minFloat: 0.18, maxFloat: 1 };
  const wears = availableWearsFor(restricted);
  assert.ok(!wears.includes("Factory New"));
  assert.ok(!wears.includes("Minimal Wear"));
  assert.ok(wears.includes("Field-Tested"));
});

test("a touching endpoint is not an overlap", () => {
  // Buckets are half-open: a skin capped at exactly 0.07 is Factory New
  // only, never Minimal Wear.
  const wears = availableWearsFor({ kind: "skin", category: "Rifle", minFloat: 0, maxFloat: 0.07 });
  assert.deepEqual(wears, ["Factory New"]);
});

test("wear ranges are contiguous and cover 0..1", () => {
  let previousMax = 0;
  for (const w of WEARS) {
    const { min, max } = wearRange(w);
    assert.equal(min, previousMax, `${w} must start where the previous bucket ended`);
    assert.ok(max > min);
    previousMax = max;
  }
  assert.equal(previousMax, 1);
});

test("slugifyWear produces URL-safe values", () => {
  assert.equal(slugifyWear("Factory New"), "factory-new");
  assert.equal(slugifyWear("Battle-Scarred"), "battle-scarred");
});
