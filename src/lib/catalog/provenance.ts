/**
 * Where an item came from, as a user reads it.
 *
 * Pure string logic, kept out of the component so it can be tested without
 * a bundler — the display rules here decide what gets shown and what gets
 * hidden, which is exactly the sort of thing that should not only be
 * verifiable by looking at the screen.
 */

/** Words that appear in almost every capsule name and identify nothing. */
const FILLER = new Set(["capsule", "sticker", "autograph", "package", "collection"]);

/**
 * Significant tokens in a name: words of four letters or more, plus years.
 *
 * Four is the cutoff that keeps city and organiser names ("Cologne",
 * "Katowice", "Stockholm", "Legends") while dropping the noise that would
 * otherwise create false matches ("ESL", "PGL", "EMS", "One").
 */
function significantTokens(text: string): Set<string> {
  const matches = text.toLowerCase().match(/[a-z]{4,}|20\d\d/g) ?? [];
  return new Set(matches.filter((token) => !FILLER.has(token)));
}

/**
 * True when a capsule's name already tells the user which event this is.
 *
 * "Stockholm 2021 Champions Autograph Capsule" shown above an event line
 * reading "2021 PGL Stockholm" is the same fact printed twice, one under
 * the other. It is not a rare case: of the 9,252 stickers carrying both a
 * capsule and an event, the great majority have a capsule whose name
 * states the event outright.
 *
 * Two shared significant tokens is the test — in practice a city and a
 * year, which is precisely what makes the second line redundant. One token
 * is not enough: "ESL One Cologne 2014 Legends" and "2015 ESL One
 * Katowice" share nothing but the organiser, and suppressing there would
 * hide real provenance rather than a duplicate.
 */
export function capsuleNamesTheEvent(capsuleName: string, tournament: string): boolean {
  const capsule = significantTokens(capsuleName);
  let shared = 0;
  for (const token of significantTokens(tournament)) {
    if (capsule.has(token)) shared += 1;
  }
  return shared >= 2;
}
