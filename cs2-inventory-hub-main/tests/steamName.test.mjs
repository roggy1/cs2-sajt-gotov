/**
 * Name normalization and the search ladder.
 *
 * The fixtures are REAL names taken from the ByMykel catalog, not invented
 * ones — the point of this module is that Valve's actual spelling survives
 * intact while lookalikes get folded onto it, and only real data proves
 * the first half of that.
 *
 * Run: node --experimental-strip-types --import ./tests/register.mjs \
 *        --test tests/steamName.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeMarketHashName,
  steamNameKey,
  searchQueryPlan,
  searchParams,
  stripWearSuffix,
  wearSuffixOf,
} from "../src/lib/steamName.ts";

test("real catalog names survive normalization byte for byte", () => {
  // Every one of these occurs verbatim in the catalog. If normalization
  // "cleans" any of them, the item stops resolving on every market.
  const untouched = [
    "AK-47 | Redline (Field-Tested)",
    "★ Karambit | Doppler",
    "StatTrak™ AK-47 | Redline (Field-Tested)",
    "★ Sport Gloves | Pandora's Box (Field-Tested)",
    "AUG | Lil' Pig",
    "AWP | Man-o'-war (Minimal Wear)",
    "P250 | Black & Tan",
    "AUG | Flame Jörmungandr",
    "Negev | Mjölnir",
    "MAC-10 | Saibā Oni",
    "Desert Eagle | Sunset Storm 壱",
    "M4A4 | 龍王 (Dragon King) (Factory New)",
    "Sawed-Off | Kiss♥Love",
    "Music Kit | Chipzel, ~Yellow Magic~",
    "Charm | Piñatita",
    "Souvenir AWP | Dragon Lore (Well-Worn)",
  ];

  for (const name of untouched) {
    assert.equal(normalizeMarketHashName(name), name, `mangled: ${name}`);
  }
});

test("normalization is idempotent", () => {
  for (const name of ["★ StatTrak™ Karambit | Doppler (Factory New)", "AUG | Lil' Pig"]) {
    const once = normalizeMarketHashName(name);
    assert.equal(normalizeMarketHashName(once), once);
  }
});

test("lookalikes fold onto the character Valve actually uses", () => {
  const cases = [
    // Curly quotes: every editor and chat client produces these.
    ["Pandora’s Box", "Pandora's Box"],
    ["Lil‘ Pig", "Lil' Pig"],
    ["Man-o´-war", "Man-o'-war"],
    // Dashes.
    ["AK-47 | Redline (Field–Tested)", "AK-47 | Redline (Field-Tested)"],
    ["Sawed—Off | Kiss♥Love", "Sawed-Off | Kiss♥Love"],
    // Tilde variants -> ASCII, which is what the music kit uses.
    ["Music Kit | Chipzel, ～Yellow Magic～", "Music Kit | Chipzel, ~Yellow Magic~"],
    ["Music Kit | Chipzel, ∼Yellow Magic∼", "Music Kit | Chipzel, ~Yellow Magic~"],
    // Invisible junk that survives a copy-paste.
    ["AK-47 | Redline", "AK-47 | Redline"],
    ["﻿AK-47 | Redline", "AK-47 | Redline"],
    ["AK-47 |​ Redline", "AK-47 | Redline"],
    ["  AK-47   |   Redline  ", "AK-47 | Redline"],
    // Star lookalikes.
    ["☆ Karambit | Doppler", "★ Karambit | Doppler"],
    // Fullwidth separator.
    ["AK-47 ｜ Redline", "AK-47 | Redline"],
  ];

  for (const [input, expected] of cases) {
    assert.equal(normalizeMarketHashName(input), expected, `input: ${JSON.stringify(input)}`);
  }
});

test("mojibake from a mis-decoded inventory import is repaired", () => {
  // UTF-8 bytes read as cp1252 — what a proxy that guesses the encoding
  // wrong produces. Built by re-encoding rather than typed by hand.
  const garble = (s) => Buffer.from(s, "utf8").toString("latin1");

  assert.equal(
    normalizeMarketHashName(`${garble("StatTrak™")} AK-47 | Redline`),
    "StatTrak™ AK-47 | Redline",
  );
  assert.equal(
    normalizeMarketHashName(`${garble("★")} Karambit | Doppler`),
    "★ Karambit | Doppler",
  );
  assert.equal(
    normalizeMarketHashName(garble("AUG | Flame Jörmungandr")),
    "AUG | Flame Jörmungandr",
  );

  // The other decoding, cp1252, is the one browsers and PHP produce. Its
  // 0x80-0x9F block maps to printable characters instead of controls, so
  // the garbled text looks different and needs its own coverage.
  const cp1252 = (s) => {
    const HIGH =
      "\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f" +
      "\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178";
    return [...Buffer.from(s, "utf8")]
      .map((b) => (b >= 0x80 && b <= 0x9f ? HIGH[b - 0x80] : String.fromCharCode(b)))
      .join("");
  };

  assert.equal(cp1252("StatTrak™"), "StatTrakâ\u201e¢", "fixture must be cp1252-garbled");
  assert.equal(
    normalizeMarketHashName(`${cp1252("StatTrak™")} AK-47 | Redline`),
    "StatTrak™ AK-47 | Redline",
  );
  assert.equal(normalizeMarketHashName(cp1252("★ Karambit | Doppler")), "★ Karambit | Doppler");
  assert.equal(normalizeMarketHashName(cp1252("Sawed-Off | Kiss♥Love")), "Sawed-Off | Kiss♥Love");
});

test("NFD decomposed input composes to the form Steam stores", () => {
  const decomposed = "AUG | Flame Jörmungandr".normalize("NFD");
  assert.notEqual(decomposed, "AUG | Flame Jörmungandr", "fixture must actually be decomposed");
  assert.equal(normalizeMarketHashName(decomposed), "AUG | Flame Jörmungandr");
});

test("★ and StatTrak™ are put back into Valve's order", () => {
  const canonical = "★ StatTrak™ Karambit | Doppler (Factory New)";
  for (const wrong of [
    "StatTrak™ ★ Karambit | Doppler (Factory New)",
    "★StatTrak™ Karambit | Doppler (Factory New)",
    "★  StatTrak™  Karambit | Doppler (Factory New)",
  ]) {
    assert.equal(normalizeMarketHashName(wrong), canonical, `input: ${wrong}`);
  }
  // A missing space after the star is a common hand-typed shape.
  assert.equal(normalizeMarketHashName("★Karambit | Doppler"), "★ Karambit | Doppler");
});

test("StatTrak and Souvenir never coexist", () => {
  // Mutually exclusive in CS2; StatTrak wins because Souvenir is the one a
  // manual toggle adds by mistake.
  assert.equal(
    normalizeMarketHashName("StatTrak™ Souvenir AK-47 | Redline"),
    "StatTrak™ AK-47 | Redline",
  );
});

test("steamNameKey matches across harmless spelling differences", () => {
  assert.equal(
    steamNameKey("★ Sport Gloves | Pandora’s Box (Field-Tested)"),
    steamNameKey("★ Sport Gloves | Pandora's Box (Field-Tested)"),
  );
  // ★ and ™ carry no matching information...
  assert.equal(steamNameKey("★ Karambit | Doppler"), steamNameKey("Karambit | Doppler"));
  // ...but the actual item identity still has to differ.
  assert.notEqual(
    steamNameKey("AK-47 | Redline (Field-Tested)"),
    steamNameKey("AK-47 | Redline (Minimal Wear)"),
  );
  assert.notEqual(
    steamNameKey("StatTrak™ AK-47 | Redline (Field-Tested)"),
    steamNameKey("Souvenir AK-47 | Redline (Field-Tested)"),
  );
});

test("wear suffix helpers", () => {
  assert.equal(wearSuffixOf("AK-47 | Redline (Field-Tested)"), "Field-Tested");
  assert.equal(stripWearSuffix("AK-47 | Redline (Field-Tested)"), "AK-47 | Redline");
  // "(Dragon King)" is part of the name, not a wear.
  assert.equal(wearSuffixOf("M4A4 | 龍王 (Dragon King)"), undefined);
  assert.equal(stripWearSuffix("M4A4 | 龍王 (Dragon King)"), "M4A4 | 龍王 (Dragon King)");
  assert.equal(
    stripWearSuffix("M4A4 | 龍王 (Dragon King) (Factory New)"),
    "M4A4 | 龍王 (Dragon King)",
  );
});

test("search ladder goes from exact name down to item type", () => {
  const plan = searchQueryPlan("★ Sport Gloves | Pandora's Box (Field-Tested)");

  assert.equal(plan[0].query, "★ Sport Gloves | Pandora's Box (Field-Tested)");
  assert.equal(plan[0].exterior, undefined, "the exact query needs no facet");

  // The tier that actually rescued this item live: type only, wear facet.
  const rescue = plan.find((t) => t.query === "Sport Gloves");
  assert.ok(rescue, "ladder must reach the bare item type");
  assert.equal(rescue.exterior, "tag_WearCategory2", "Field-Tested facet");

  // Every tier is non-empty and no tier repeats.
  const seen = new Set();
  for (const t of plan) {
    assert.ok(t.query.length > 0);
    const key = `${t.query}|${t.exterior ?? ""}|${t.quality ?? ""}`;
    assert.ok(!seen.has(key), `duplicate tier: ${key}`);
    seen.add(key);
  }
});

test("quality facet uses tag_unusual for ★ items, never tag_normal", () => {
  // Verified live: "Sport Gloves" + tag_normal returns zero rows, the same
  // query + tag_unusual returns fifteen. Getting this wrong looks exactly
  // like an item with no listings.
  const glove = searchQueryPlan("★ Sport Gloves | Pandora's Box (Field-Tested)");
  const gloveQualities = glove.map((t) => t.quality).filter(Boolean);
  assert.ok(gloveQualities.includes("tag_unusual"));
  assert.ok(!gloveQualities.includes("tag_normal"));

  const stKnife = searchQueryPlan("★ StatTrak™ Karambit | Doppler (Factory New)");
  assert.ok(stKnife.map((t) => t.quality).includes("tag_unusual_strange"));

  const stRifle = searchQueryPlan("StatTrak™ AK-47 | Redline (Field-Tested)");
  assert.ok(stRifle.map((t) => t.quality).includes("tag_strange"));

  const souvenir = searchQueryPlan("Souvenir AWP | Dragon Lore (Well-Worn)");
  assert.ok(souvenir.map((t) => t.quality).includes("tag_tournament"));
});

test("a risky quality facet never precedes the same query without it", () => {
  // A wrong quality tag empties the result set silently, so the unfaceted
  // form of a query must always get its chance first.
  const plan = searchQueryPlan("★ Sport Gloves | Pandora's Box (Field-Tested)");
  const withQuality = plan.findIndex((t) => t.quality);
  const sameWithout = plan.findIndex(
    (t, i) => i !== withQuality && t.query === plan[withQuality]?.query && !t.quality,
  );
  assert.ok(sameWithout >= 0 && sameWithout < withQuality);
});

test("searchParams emits the array-style facet keys Steam expects", () => {
  const plan = searchQueryPlan("★ Sport Gloves | Pandora's Box (Field-Tested)");
  const tier = plan.find((t) => t.quality);
  const qs = searchParams(tier, 20, 10);

  assert.equal(qs.get("appid"), "730");
  assert.equal(qs.get("norender"), "1");
  assert.equal(qs.get("start"), "20");
  assert.equal(qs.get("count"), "10");
  assert.equal(qs.get("category_730_Exterior[]"), "tag_WearCategory2");
  assert.equal(qs.get("category_730_Quality[]"), "tag_unusual");
});

test("empty and junk input never throws", () => {
  assert.equal(normalizeMarketHashName(""), "");
  assert.equal(normalizeMarketHashName("   "), "");
  assert.equal(steamNameKey(""), "");
  assert.deepEqual(searchQueryPlan(""), []);
  assert.equal(normalizeMarketHashName("★"), "★");
});
