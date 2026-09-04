/**
 * Catalog normalization: collection artwork and the full container list.
 *
 * Runs against a small set of fixtures shaped exactly like upstream's
 * skins.json / collections.json. The numbers quoted in the comments come
 * from a scan of the real 2,126-skin dataset.
 *
 * Run: node --experimental-strip-types --import ./tests/register.mjs \
 *        --test tests/catalog.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSkins } from "../src/lib/catalog/normalize.ts";

const COLLECTION_IMAGES = new Map([
  ["The Gods and Monsters Collection", "https://img/gods-and-monsters.png"],
  ["The Boreal Collection", "https://img/boreal.png"],
  ["The Chroma Collection", "https://img/chroma.png"],
]);

/** "★ Karambit | Doppler" — the canonical multi-case gold item. */
const KARAMBIT = {
  id: "skin-karambit-doppler",
  name: "★ Karambit | Doppler",
  image: "https://img/karambit.png",
  category: { name: "Knife" },
  rarity: { name: "Extraordinary", color: "#eb4b4b" },
  collections: [{ name: "The Chroma Collection" }],
  paint_index: "418",
  phase: "Phase 2",
  crates: [
    { id: "crate-1", name: "Chroma Case", image: "https://img/chroma-case.png" },
    { id: "crate-2", name: "Chroma 2 Case", image: "https://img/chroma-2.png" },
    { id: "crate-3", name: "Chroma 3 Case", image: "https://img/chroma-3.png" },
  ],
};

/** A souvenir-capable skin that appears in several tournament packages. */
const PANTHERA = {
  id: "skin-ak-panthera",
  name: "AK-47 | Panthera onca",
  image: "https://img/panthera.png",
  category: { name: "Rifle" },
  rarity: { name: "Classified" },
  collections: [{ name: "The Gods and Monsters Collection" }],
  souvenir: true,
  crates: [
    { id: "c-set", name: "The Gods and Monsters Collection Package", image: "https://img/set.png" },
    { id: "c-sv1", name: "Stockholm 2021 Ancient Souvenir Package", image: "https://img/sv1.png" },
    { id: "c-sv2", name: "Antwerp 2022 Ancient Souvenir Package", image: "https://img/sv2.png" },
  ],
};

const SIMPLE = {
  id: "skin-boreal",
  name: "AWP | Boreal Forest",
  image: "https://img/boreal-forest.png",
  category: { name: "Sniper Rifle" },
  collections: [{ name: "The Boreal Collection" }],
  stattrak: true,
  crates: [],
};

test("collection artwork comes from the index, for every collection", () => {
  const items = normalizeSkins([KARAMBIT, PANTHERA, SIMPLE], COLLECTION_IMAGES);

  const gods = items.find((i) => i.collection === "The Gods and Monsters Collection");
  const boreal = items.find((i) => i.collection === "The Boreal Collection");

  // The two collections named in the request, and nothing hand-mapped:
  // every collection upstream ships resolves the same way.
  assert.equal(gods.collectionImage, "https://img/gods-and-monsters.png");
  assert.equal(boreal.collectionImage, "https://img/boreal.png");
});

test("an unknown collection degrades to no icon, never to a wrong one", () => {
  const items = normalizeSkins(
    [{ ...SIMPLE, collections: [{ name: "The Brand New Collection" }] }],
    COLLECTION_IMAGES,
  );
  assert.equal(items[0].collection, "The Brand New Collection");
  assert.equal(items[0].collectionImage, undefined);
});

test("a gold item keeps EVERY case it drops from", () => {
  const items = normalizeSkins([KARAMBIT], COLLECTION_IMAGES);
  const knife = items[0];

  // The bug this replaces: crates[0] only, so two of the three Chroma
  // cases silently vanished for 818 of 2,126 skins.
  assert.deepEqual(
    knife.crates.map((c) => c.name),
    ["Chroma Case", "Chroma 2 Case", "Chroma 3 Case"],
  );
  assert.equal(knife.crates.length, 3);
  assert.deepEqual(
    knife.crates.map((c) => c.image),
    ["https://img/chroma-case.png", "https://img/chroma-2.png", "https://img/chroma-3.png"],
  );
});

test("crateName and crateImage stay the head of the same list", () => {
  // The compact single-thumbnail call sites read these; if they could
  // disagree with crates[0] the UI would contradict itself.
  for (const item of normalizeSkins([KARAMBIT, PANTHERA, SIMPLE], COLLECTION_IMAGES)) {
    if (!item.crates?.length) {
      assert.equal(item.crateName, undefined);
      continue;
    }
    assert.equal(item.crateName, item.crates[0].name);
    assert.equal(item.crateImage, item.crates[0].image);
  }
});

test("cases come before souvenir packages on the normal entry", () => {
  const items = normalizeSkins([PANTHERA], COLLECTION_IMAGES);
  const normal = items.find((i) => !i.isSouvenir && !i.isStattrak);

  assert.equal(normal.crates[0].name, "The Gods and Monsters Collection Package");
  assert.equal(normal.crates[0].souvenir, false);
  assert.deepEqual(
    normal.crates.slice(1).map((c) => c.souvenir),
    [true, true],
  );
});

test("the Souvenir entry leads with a package it can actually drop from", () => {
  const items = normalizeSkins([PANTHERA], COLLECTION_IMAGES);
  const souvenir = items.find((i) => i.isSouvenir);

  assert.ok(souvenir, "a skin in a Souvenir Package gets its own entry");
  assert.equal(souvenir.name, "Souvenir AK-47 | Panthera onca");
  // A Souvenir AK does not come out of a collection package — pointing a
  // collector at one would be actively misleading.
  assert.equal(souvenir.crates[0].souvenir, true);
  assert.equal(souvenir.crateName, "Stockholm 2021 Ancient Souvenir Package");
  // Same set, different order: nothing is dropped.
  assert.equal(souvenir.crates.length, 3);
});

test("souvenir packages are flagged, not guessed at by the UI", () => {
  const items = normalizeSkins([PANTHERA], COLLECTION_IMAGES);
  const crates = items[0].crates;
  assert.deepEqual(
    crates.map((c) => [c.name.includes("Souvenir Package"), c.souvenir]),
    crates.map((c) => [c.souvenir, c.souvenir]),
  );
});

test("duplicate container entries are collapsed", () => {
  const dupes = {
    ...KARAMBIT,
    crates: [
      ...KARAMBIT.crates,
      { id: "crate-1b", name: "Chroma Case", image: "https://img/x.png" },
    ],
  };
  const items = normalizeSkins([dupes], COLLECTION_IMAGES);
  assert.equal(items[0].crates.length, 3, "same container listed twice is still one container");
});

test("StatTrak marker goes AFTER the star, as Steam spells it", () => {
  // Verified against the live market: Steam indexes
  // "★ StatTrak™ M9 Bayonet | Tiger Tooth (Minimal Wear)". Prefixing
  // blindly produced "StatTrak™ ★ ..." for all 576 StatTrak knife and
  // glove entries — names Steam has never heard of, on the most valuable
  // items in the game.
  const knife = { ...KARAMBIT, stattrak: true };
  const items = normalizeSkins([knife], COLLECTION_IMAGES);
  const st = items.find((i) => i.isStattrak);

  assert.ok(st.name.startsWith("★ StatTrak™ "), `got: ${st.name}`);
  assert.ok(!st.name.startsWith("StatTrak™ ★"));
  assert.equal(st.name, "★ StatTrak™ Karambit | Doppler (Phase 2)");
});

test("a starless skin keeps the plain StatTrak prefix", () => {
  const items = normalizeSkins([SIMPLE], COLLECTION_IMAGES);
  const st = items.find((i) => i.isStattrak);
  assert.equal(st.name, "StatTrak™ AWP | Boreal Forest");
  assert.equal(st.collectionImage, "https://img/boreal.png");
  assert.deepEqual(st.crates, []);
});

test("missing or malformed crate data never throws", () => {
  const items = normalizeSkins(
    [
      { ...SIMPLE, id: "a", crates: null },
      { ...SIMPLE, id: "b", crates: undefined },
      { ...SIMPLE, id: "c", crates: [{ name: "" }, { name: "   " }, {}] },
      { ...SIMPLE, id: "d", collections: null },
    ],
    COLLECTION_IMAGES,
  );
  for (const item of items) {
    assert.ok(Array.isArray(item.crates));
    assert.equal(item.crates.length, 0);
  }
});

test("normalizeSkins works with no collection index at all", () => {
  // The index is optional so a catalog fetch that loses collections.json
  // degrades to "no icons" instead of throwing and taking the app with it.
  const items = normalizeSkins([KARAMBIT]);
  assert.equal(items[0].collectionImage, undefined);
  assert.equal(items[0].crates.length, 3);
});
