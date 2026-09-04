/**
 * Corrections to upstream catalog data.
 *
 * Two independent things live here: the sticker rarity fix (scoped to
 * TOURNAMENT golds, verified against Steam's own asset_description) and
 * the per-skin float overrides. Both override a source of truth, so both
 * need tests that pin down exactly how far the override reaches — an
 * over-broad correction is as wrong as no correction.
 *
 * Run: node --experimental-strip-types --import ./tests/register.mjs \
 *        --test tests/corrections.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  correctStickerRarity,
  floatOverrideFor,
  paintKitKey,
  FLOAT_OVERRIDE_NAMES,
} from "../src/lib/catalog/corrections.ts";
import { availableWearsFor, floatBoundsFor, WEARS } from "../src/lib/wear.ts";
import { normalizeStickers } from "../src/lib/catalog/normalize.ts";

// --- sticker rarity --------------------------------------------------

test("a TOURNAMENT gold is Extraordinary red", () => {
  // Verified against Steam's own asset_description: every Gold sticker in
  // the "Berlin 2019" query comes back as "Extraordinary Sticker" with
  // name_color eb4b4b — 144 of them — while the dump tags 641 tournament
  // golds as Exotic.
  const fixed = correctStickerRarity("Gold", { name: "Exotic", color: "#d32ce6" }, true);
  assert.equal(fixed.name, "Extraordinary");
  assert.equal(fixed.color, "#eb4b4b");
});

test("a NON-tournament gold keeps its own tier", () => {
  // Also verified against Steam: "Sticker | Hello AK-47 (Gold)" is really
  // "Remarkable Sticker", name_color 8847ff. A blanket "gold is always
  // Extraordinary" would mislabel it and the twelve others like it.
  assert.equal(correctStickerRarity("Gold", { name: "Remarkable" }, false).name, "Remarkable");
  assert.equal(correctStickerRarity("Gold", { name: "Exotic" }, false).name, "Exotic");
});

test("non-gold finishes are never touched", () => {
  for (const variant of ["Paper", "Glitter", "Holo", "Foil"]) {
    for (const isTournament of [true, false]) {
      assert.equal(
        correctStickerRarity(variant, { name: "Exotic" }, isTournament).name,
        "Exotic",
        `${variant} tournament=${isTournament}`,
      );
    }
  }
});

test("tier colour is Valve's canonical one, not whatever hex arrived", () => {
  const odd = correctStickerRarity("Holo", { name: "Exotic", color: "#ff00ff" }, true);
  assert.equal(odd.color, "#d32ce6");
});

test("a missing tier stays missing rather than being guessed", () => {
  assert.equal(correctStickerRarity("Holo", {}, true), undefined);
  assert.equal(correctStickerRarity("Gold", {}, true).name, "Extraordinary");
});

test("the correction reaches the normalizer for the reported stickers", () => {
  const items = normalizeStickers([
    {
      id: "furia",
      name: "Sticker | FURIA (Gold) | Berlin 2019",
      image: "https://img/furia-gold.png",
      effect: "Gold",
      // Exactly as upstream ships it: no market name, no capsule, Exotic.
      market_hash_name: null,
      crates: [],
      rarity: { name: "Exotic", color: "#d32ce6" },
      tournament: { name: "2019 StarLadder Berlin" },
    },
    {
      id: "navi",
      name: "Sticker | Natus Vincere (Gold) | Cologne 2015",
      image: "https://img/navi-gold.png",
      effect: "Gold",
      market_hash_name: null,
      crates: [],
      rarity: { name: "Exotic", color: "#d32ce6" },
      tournament: { name: "2015 ESL One Cologne" },
    },
    {
      id: "hello",
      name: "Sticker | Hello AK-47 (Gold)",
      image: "https://img/hello.png",
      effect: "Gold",
      market_hash_name: "Sticker | Hello AK-47 (Gold)",
      crates: [{ id: "c", name: "Hello Capsule", image: "i" }],
      rarity: { name: "Remarkable", color: "#8847ff" },
      tournament: null,
    },
  ]);

  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(byId.furia.rarityName, "Extraordinary");
  assert.equal(byId.furia.rarityColor, "#eb4b4b");
  assert.equal(byId.navi.rarityName, "Extraordinary");
  assert.equal(byId.hello.rarityName, "Remarkable");
});

test("a missing market name does NOT decide the tier", () => {
  // The previous rule keyed on release status, which put FURIA and NaVi on
  // the right side by luck and would have mislabelled any tournament gold
  // that happened to carry a market name.
  const withName = normalizeStickers([
    {
      id: "x",
      name: "Sticker | Team (Gold) | Some Major",
      image: "i",
      effect: "Gold",
      market_hash_name: "Sticker | Team (Gold) | Some Major",
      crates: [{ id: "c", name: "Some Capsule", image: "i" }],
      rarity: { name: "Exotic" },
      tournament: { name: "Some Major" },
    },
  ]);
  assert.equal(withName[0].rarityName, "Extraordinary");
});

test("the event is carried through as provenance", () => {
  const items = normalizeStickers([
    {
      id: "p",
      name: "Sticker | FURIA | Berlin 2019",
      image: "i",
      effect: "Other",
      market_hash_name: "Sticker | FURIA | Berlin 2019",
      // No capsule: the paper finish was never sold in one.
      crates: [],
      rarity: { name: "High Grade" },
      tournament: { name: "2019 StarLadder Berlin" },
    },
  ]);
  assert.equal(items[0].tournament, "2019 StarLadder Berlin");
  assert.deepEqual(items[0].crates, []);
});

// --- float overrides -------------------------------------------------

const CHATTERBOX = {
  name: "Galil AR | Chatterbox",
  kind: "skin",
  category: "Rifles",
  minFloat: 0.35,
  maxFloat: 0.85,
  wears: ["Field-Tested", "Well-Worn", "Battle-Scarred"],
};

test("Chatterbox keeps Field-Tested — upstream's own data stands", () => {
  // A hand-written 0.40 override used to sit in FLOAT_OVERRIDES and quietly
  // deleted Field-Tested from the item page, the float bar AND the
  // portfolio dropdown. Upstream declares the exterior and its float window
  // agrees; nothing here may contradict that without a source.
  assert.deepEqual(floatBoundsFor(CHATTERBOX), { min: 0.35, max: 0.85 });
  assert.deepEqual(availableWearsFor(CHATTERBOX), ["Field-Tested", "Well-Worn", "Battle-Scarred"]);
});

test("every StatTrak/Souvenir variant keeps the same exteriors", () => {
  for (const prefix of ["StatTrak™ ", "Souvenir ", ""]) {
    assert.deepEqual(
      availableWearsFor({ ...CHATTERBOX, name: `${prefix}Galil AR | Chatterbox` }),
      ["Field-Tested", "Well-Worn", "Battle-Scarred"],
      prefix,
    );
  }
});

test("a declared wears list is authoritative over the float window", () => {
  // The float bounds must never subtract from a list Valve published.
  // Measured across the catalog the two always agree, so any disagreement
  // means one of OUR numbers is wrong — and silently dropping a real
  // exterior is the more damaging way to be wrong.
  const item = {
    name: "Some | Skin",
    kind: "skin",
    category: "Rifles",
    minFloat: 0.45,
    maxFloat: 1,
    wears: ["Field-Tested", "Well-Worn", "Battle-Scarred"],
  };
  assert.deepEqual(availableWearsFor(item), ["Field-Tested", "Well-Worn", "Battle-Scarred"]);
});

test("the float window still derives the list when none is declared", () => {
  const item = { name: "X | Y", kind: "skin", category: "Rifles", minFloat: 0.38, maxFloat: 1 };
  assert.deepEqual(availableWearsFor(item), ["Well-Worn", "Battle-Scarred"]);
});

test("an unbounded skin still offers all five", () => {
  assert.deepEqual(availableWearsFor({ name: "X | Y", kind: "skin", category: "Rifles" }), [
    ...WEARS,
  ]);
});

test("the override table is empty, and any future entry must be reachable", () => {
  // Empty on purpose — see FLOAT_OVERRIDES. The reachability check stays so
  // an entry added later cannot sit in the table doing nothing.
  assert.deepEqual(FLOAT_OVERRIDE_NAMES, []);
  for (const name of FLOAT_OVERRIDE_NAMES) {
    assert.equal(paintKitKey(name), name, `unreachable override key: ${name}`);
    assert.ok(floatOverrideFor(name), name);
  }
});

test("paintKitKey strips every decoration a display name can carry", () => {
  assert.equal(paintKitKey("★ StatTrak™ Karambit | Doppler (Phase 2)"), "Karambit | Doppler");
  assert.equal(paintKitKey("Souvenir AWP | Dragon Lore (Well-Worn)"), "AWP | Dragon Lore");
  assert.equal(paintKitKey("Galil AR | Chatterbox"), "Galil AR | Chatterbox");
  // A parenthetical that is part of the name survives.
  assert.equal(paintKitKey("M4A4 | 龍王 (Dragon King)"), "M4A4 | 龍王 (Dragon King)");
});

test("skins with no override use their published bounds unchanged", () => {
  const ak = {
    name: "AK-47 | Redline",
    kind: "skin",
    category: "Rifles",
    minFloat: 0.1,
    maxFloat: 0.7,
  };
  assert.equal(floatOverrideFor(ak.name), undefined);
  assert.deepEqual(floatBoundsFor(ak), { min: 0.1, max: 0.7 });
});

// --- event artwork ---------------------------------------------------

test("a finish with no capsule borrows the event icon from its sibling", () => {
  // 885 of the 1,148 capsule-less stickers can be given a real icon this
  // way. NaVi's paper and gold Cologne 2015 were never sold in a capsule;
  // their Foil sibling was.
  const items = normalizeStickers([
    {
      id: "foil",
      name: "Sticker | Natus Vincere (Foil) | Cologne 2015",
      image: "i",
      effect: "Foil",
      crates: [
        { id: "c", name: "ESL One Cologne 2015 Legends (Foil)", image: "https://img/cap.png" },
      ],
      tournament: { name: "2015 ESL One Cologne" },
    },
    {
      id: "paper",
      name: "Sticker | Natus Vincere | Cologne 2015",
      image: "i",
      effect: "Other",
      crates: [],
      tournament: { name: "2015 ESL One Cologne" },
    },
  ]);

  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(byId.paper.tournamentImage, "https://img/cap.png");
  // The one that HAS a capsule shows the real thing, not a borrowed image.
  assert.equal(byId.foil.tournamentImage, undefined);
  assert.equal(byId.foil.crateImage, "https://img/cap.png");
});

test("no sibling capsule means no borrowed icon, not a wrong one", () => {
  const items = normalizeStickers([
    {
      id: "lonely",
      name: "Sticker | Nobody (Gold) | Nowhere 2020",
      image: "i",
      effect: "Gold",
      crates: [],
      tournament: { name: "2020 Nowhere" },
    },
  ]);
  assert.equal(items[0].tournamentImage, undefined);
  assert.equal(items[0].tournament, "2020 Nowhere");
});
