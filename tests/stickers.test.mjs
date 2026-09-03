/**
 * Sticker finishes, grouping and capsules.
 *
 * Fixtures are shaped exactly like upstream's stickers.json, and the
 * quoted counts come from a scan of the real 11,134-sticker dataset.
 *
 * Run: node --experimental-strip-types --import ./tests/register.mjs \
 *        --test tests/stickers.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";

import { normalizeStickers, stickerGroupId } from "../src/lib/catalog/normalize.ts";
import { STICKER_VARIANTS } from "../src/lib/catalog/types.ts";
import { capsuleNamesTheEvent } from "../src/lib/catalog/provenance.ts";

const CAPSULE = {
  id: "crate-296",
  name: "ESL One Katowice 2015 Legends (Holo/Foil)",
  image: "https://img/katowice-legends.png",
};

/** The NaVi Katowice 2015 family, verbatim in shape from upstream. */
const NAVI = [
  {
    id: "sticker-a",
    name: "Sticker | Natus Vincere | Katowice 2015",
    image: "https://img/navi-paper.png",
    effect: "Other",
    market_hash_name: "Sticker | Natus Vincere | Katowice 2015",
    crates: [],
    rarity: { name: "High Grade", color: "#4b69ff" },
  },
  {
    id: "sticker-b",
    name: "Sticker | Natus Vincere (Holo) | Katowice 2015",
    image: "https://img/navi-holo.png",
    effect: "Holo",
    market_hash_name: "Sticker | Natus Vincere (Holo) | Katowice 2015",
    crates: [CAPSULE],
    rarity: { name: "Remarkable", color: "#8847ff" },
  },
  {
    id: "sticker-c",
    name: "Sticker | Natus Vincere (Foil) | Katowice 2015",
    image: "https://img/navi-foil.png",
    effect: "Foil",
    market_hash_name: "Sticker | Natus Vincere (Foil) | Katowice 2015",
    crates: [CAPSULE],
    rarity: { name: "Exotic", color: "#d32ce6" },
  },
  {
    id: "sticker-d",
    name: "Sticker | Natus Vincere (Gold) | Katowice 2015",
    image: "https://img/navi-gold.png",
    effect: "Gold",
    market_hash_name: null,
    crates: [],
    rarity: { name: "Extraordinary", color: "#eb4b4b" },
  },
];

/** A qualifier family: Champion stickers are their own item. */
const RAIN_CHAMPION = [
  {
    id: "s-rain-1",
    name: "Sticker | rain (Champion) | Antwerp 2022",
    image: "https://img/rain-paper.png",
    effect: "Other",
    crates: [],
  },
  {
    id: "s-rain-2",
    name: "Sticker | rain (Holo, Champion) | Antwerp 2022",
    image: "https://img/rain-holo.png",
    effect: "Holo",
    crates: [],
  },
  {
    id: "s-rain-3",
    name: "Sticker | rain (Gold, Champion) | Antwerp 2022",
    image: "https://img/rain-gold.png",
    effect: "Gold",
    crates: [],
  },
  // Same player, same event, but NOT a Champion sticker — must not join
  // the group above, it is a different and far cheaper item.
  {
    id: "s-rain-4",
    name: "Sticker | rain | Antwerp 2022",
    image: "https://img/rain-plain.png",
    effect: "Other",
    crates: [],
  },
];

const group = (items, id) => items.filter((i) => i.variantGroupId === id);

test("upstream's 'Other' effect becomes Paper, never shown as 'Other'", () => {
  const items = normalizeStickers(NAVI);
  const paper = items.find((i) => i.id === "sticker-a");
  assert.equal(paper.variant, "Paper");
  assert.ok(!items.some((i) => i.variant === "Other"));
});

test("every finish maps to its own label", () => {
  const items = normalizeStickers(NAVI);
  assert.deepEqual(
    items.map((i) => i.variant),
    ["Paper", "Holo", "Foil", "Gold"],
  );
});

test("Embroidered and Lenticular are real finishes, not dropped", () => {
  // 198 and 25 stickers respectively in the live data. Falling back to
  // "Paper" for these would label a real item as something it is not.
  const items = normalizeStickers([
    { id: "e", name: "Patch | Foo (Embroidered)", image: "i", effect: "Embroidered", crates: [] },
    { id: "l", name: "Sticker | Bar (Lenticular)", image: "i", effect: "Lenticular", crates: [] },
  ]);
  assert.deepEqual(
    items.map((i) => i.variant),
    ["Embroidered", "Lenticular"],
  );
});

test("stickers NEVER carry a wear list", () => {
  // The whole point: a sticker has a finish, not an exterior.
  for (const item of normalizeStickers(NAVI)) {
    assert.equal(item.wears, undefined);
    assert.equal(item.minFloat, undefined);
    assert.equal(item.maxFloat, undefined);
  }
});

test("finishes of one sticker share a group id", () => {
  const items = normalizeStickers(NAVI);
  const ids = new Set(items.map((i) => i.variantGroupId));
  assert.equal(ids.size, 1);
  assert.equal([...ids][0], "Sticker | Natus Vincere | Katowice 2015");
});

test("a qualifier keeps Champion stickers out of the ordinary group", () => {
  const items = normalizeStickers(RAIN_CHAMPION);

  const champions = group(items, "Sticker | rain (Champion) | Antwerp 2022");
  const ordinary = group(items, "Sticker | rain | Antwerp 2022");

  assert.equal(champions.length, 3, "Paper, Holo and Gold Champion");
  assert.equal(ordinary.length, 1);
  // Merging these would offer a €5 sticker as a finish of a €500 one.
  assert.notEqual(champions[0].variantGroupId, ordinary[0].variantGroupId);
});

test("stickerGroupId strips only the finish token", () => {
  assert.equal(
    stickerGroupId("Sticker | Natus Vincere (Holo) | Katowice 2015"),
    "Sticker | Natus Vincere | Katowice 2015",
  );
  assert.equal(
    stickerGroupId("Sticker | rain (Holo, Champion) | Antwerp 2022"),
    "Sticker | rain (Champion) | Antwerp 2022",
  );
  assert.equal(
    stickerGroupId("Sticker | s1mple (Gold, Ranked) | Stockholm 2021"),
    "Sticker | s1mple (Ranked) | Stockholm 2021",
  );
  // A parenthetical that is not a finish is left completely alone.
  assert.equal(stickerGroupId("Sticker | Lucky 13"), "Sticker | Lucky 13");
  assert.equal(
    stickerGroupId("Sticker | Team (Champion) | Rio 2022"),
    "Sticker | Team (Champion) | Rio 2022",
  );
});

test("each finish keeps its OWN artwork", () => {
  // This is what makes the picture change on click: the finishes are
  // different catalog entries pointing at different images.
  const items = normalizeStickers(NAVI);
  const images = items.map((i) => i.image);
  assert.equal(new Set(images).size, images.length, "no two finishes share an image");
  assert.equal(items.find((i) => i.variant === "Holo").image, "https://img/navi-holo.png");
  assert.equal(items.find((i) => i.variant === "Gold").image, "https://img/navi-gold.png");
});

test("each finish keeps its OWN capsule", () => {
  // 659 of 3,664 real groups have finishes from different capsules, so the
  // capsule has to travel with the finish rather than with the group.
  const items = normalizeStickers(NAVI);
  assert.equal(items.find((i) => i.variant === "Holo").crateName, CAPSULE.name);
  assert.equal(items.find((i) => i.variant === "Foil").crateImage, CAPSULE.image);
  // Paper and Gold genuinely come from no capsule — the card shows nothing
  // rather than an empty frame.
  assert.deepEqual(items.find((i) => i.variant === "Paper").crates, []);
  assert.deepEqual(items.find((i) => i.variant === "Gold").crates, []);
});

test("a sticker in several capsules keeps all of them", () => {
  const second = {
    id: "c2",
    name: "ESL One Katowice 2015 Challengers (Holo/Foil)",
    image: "https://img/ch.png",
  };
  const items = normalizeStickers([{ ...NAVI[1], crates: [CAPSULE, second] }]);
  assert.deepEqual(
    items[0].crates.map((c) => c.name),
    [CAPSULE.name, second.name],
  );
});

test("upstream's market_hash_name is carried through when present", () => {
  const items = normalizeStickers(NAVI);
  assert.equal(
    items.find((i) => i.variant === "Holo").marketHashName,
    "Sticker | Natus Vincere (Holo) | Katowice 2015",
  );
  // 699 real stickers have none; those fall back to the display name.
  assert.equal(items.find((i) => i.variant === "Gold").marketHashName, undefined);
});

test("upstream duplicates collapse to one button per finish", () => {
  // "Sticker | Mirage (Gold)" ships twice with different ids and no market
  // name. Two identical buttons in the selector would be nonsense.
  const dupe = [
    {
      id: "sticker-1692",
      name: "Sticker | Mirage (Gold)",
      image: "i1",
      effect: "Gold",
      crates: [],
    },
    {
      id: "sticker-7889",
      name: "Sticker | Mirage (Gold)",
      image: "i2",
      effect: "Gold",
      crates: [],
    },
  ];
  const items = normalizeStickers(dupe);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "sticker-1692", "first wins, deterministically");
});

test("malformed rows are skipped, not turned into broken cards", () => {
  const items = normalizeStickers([
    { id: "x", name: "Sticker | No Image", effect: "Holo", crates: [] },
    { id: "y", image: "https://img/no-name.png", effect: "Holo", crates: [] },
    { id: "z", name: "Sticker | Fine", image: "https://img/fine.png", effect: null, crates: null },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].variant, "Paper", "a missing effect is a plain sticker");
  assert.deepEqual(items[0].crates, []);
});

test("STICKER_VARIANTS covers every finish the normalizer can emit", () => {
  const emitted = new Set(
    normalizeStickers([
      ...NAVI,
      { id: "g", name: "Sticker | G (Glitter)", image: "i", effect: "Glitter", crates: [] },
      { id: "e", name: "Sticker | E (Embroidered)", image: "i", effect: "Embroidered", crates: [] },
      { id: "l", name: "Sticker | L (Lenticular)", image: "i", effect: "Lenticular", crates: [] },
    ]).map((i) => i.variant),
  );
  for (const v of emitted) {
    assert.ok(STICKER_VARIANTS.includes(v), `${v} missing from the display order`);
  }
});

test("display order runs cheapest finish first", () => {
  assert.deepEqual(STICKER_VARIANTS.slice(0, 5), ["Paper", "Glitter", "Holo", "Foil", "Gold"]);
});

// --- Valve rarity tiers -----------------------------------------------

test("each finish keeps its OWN Valve tier, never a tier we invent", () => {
  // Measured across the real catalog, the scheme is NOT fixed per finish —
  // Valve changes it per tournament:
  //   2014-2016  Foil Exotic     · Gold Exotic
  //   2017-2019  Foil Remarkable · Gold Extraordinary
  //   2020-2021  Foil Exotic     · Gold Extraordinary
  //   2022-2024  Holo Exotic     · Glitter Remarkable
  //   2025-2026  Foil Remarkable · Holo Exotic
  // So a hardcoded "Foil = Exotic" would be wrong for most of the catalog.
  const items = normalizeStickers(NAVI);
  assert.equal(items.find((i) => i.variant === "Paper").rarityName, "High Grade");
  assert.equal(items.find((i) => i.variant === "Holo").rarityName, "Remarkable");
  assert.equal(items.find((i) => i.variant === "Foil").rarityName, "Exotic");
  assert.equal(items.find((i) => i.variant === "Gold").rarityName, "Extraordinary");
});

test("the same finish can hold different tiers in different tournaments", () => {
  // Valve's scheme moves per era, so this must stay true for stickers that
  // actually shipped. Both fixtures are RELEASED (market name + capsule),
  // which is what makes their upstream tier trustworthy — an unreleased
  // gold gets corrected instead, see corrections.test.mjs.
  const capsule = [{ id: "c", name: "Some Capsule", image: "https://img/c.png" }];
  const holo2017 = {
    id: "s-2017",
    name: "Sticker | Team (Holo) | Krakow 2017",
    image: "https://img/a.png",
    effect: "Holo",
    market_hash_name: "Sticker | Team (Holo) | Krakow 2017",
    crates: capsule,
    rarity: { name: "Remarkable", color: "#8847ff" },
  };
  const holo2022 = {
    id: "s-2022",
    name: "Sticker | Team (Holo) | Antwerp 2022",
    image: "https://img/b.png",
    effect: "Holo",
    market_hash_name: "Sticker | Team (Holo) | Antwerp 2022",
    crates: capsule,
    rarity: { name: "Exotic", color: "#d32ce6" },
  };

  const [a, b] = normalizeStickers([holo2017, holo2022]);
  assert.equal(a.variant, "Holo");
  assert.equal(b.variant, "Holo");
  assert.equal(a.rarityName, "Remarkable", "2017 Holo is Remarkable");
  assert.equal(b.rarityName, "Exotic", "2022 Holo is Exotic");
  // The colour travels with the tier, so the two rows are visibly different.
  assert.notEqual(a.rarityColor, b.rarityColor);
});

test("a tournament gold is corrected away from its placeholder tier", () => {
  // The NaVi Cologne 2015 / FURIA Berlin 2019 case: the dump tags these
  // Exotic, Steam serves them as "Extraordinary Sticker" eb4b4b.
  const items = normalizeStickers([
    {
      id: "sticker-631",
      name: "Sticker | Natus Vincere (Gold) | Cologne 2015",
      image: "https://cdn/navi_gold.png",
      effect: "Gold",
      market_hash_name: null,
      crates: [],
      rarity: { name: "Exotic", color: "#d32ce6" },
      tournament: { name: "2015 ESL One Cologne" },
    },
  ]);
  assert.equal(items[0].rarityName, "Extraordinary");
  assert.equal(items[0].rarityColor, "#eb4b4b");
});

test("tier colour is carried through for the row tint", () => {
  const items = normalizeStickers(NAVI);
  assert.equal(items.find((i) => i.variant === "Foil").rarityColor, "#d32ce6");
  assert.equal(items.find((i) => i.variant === "Gold").rarityColor, "#eb4b4b");
});

test("a missing tier degrades to nothing, never to a guess", () => {
  const items = normalizeStickers([
    { id: "n", name: "Sticker | No Rarity (Holo)", image: "i", effect: "Holo", crates: [] },
  ]);
  assert.equal(items[0].rarityName, undefined);
  assert.equal(items[0].rarityColor, undefined);
  assert.equal(items[0].variant, "Holo", "the finish is still known");
});

// --- event line de-duplication ---------------------------------------

test("the event line is dropped when the capsule name already says it", () => {
  // The reported case: "Stockholm 2021 Champions Autograph Capsule" with
  // "2021 PGL Stockholm" printed again underneath. Of the 9,252 stickers
  // that carry both, most have a capsule whose name already states the
  // event, so this is the common case rather than an edge one.
  assert.equal(
    capsuleNamesTheEvent("Stockholm 2021 Champions Autograph Capsule", "2021 PGL Stockholm"),
    true,
  );
  assert.equal(
    capsuleNamesTheEvent("ESL One Cologne 2015 Legends (Foil)", "2015 ESL One Cologne"),
    true,
  );
  assert.equal(capsuleNamesTheEvent("EMS Katowice 2014 Legends", "2014 EMS One Katowice"), true);

  // A different event must NOT be suppressed — that would hide real
  // provenance rather than a duplicate.
  assert.equal(
    capsuleNamesTheEvent("ESL One Cologne 2014 Legends", "2015 ESL One Katowice"),
    false,
  );
  assert.equal(capsuleNamesTheEvent("Community Sticker Capsule 1", "2021 PGL Stockholm"), false);

  // "Capsule"/"Sticker"/"Autograph" are filler and must not count toward
  // the two shared tokens on their own.
  assert.equal(capsuleNamesTheEvent("Autograph Capsule", "Sticker Capsule"), false);
});
