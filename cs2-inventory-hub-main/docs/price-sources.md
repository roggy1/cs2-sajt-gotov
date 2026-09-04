# Price sources — what is wired up, and what each one costs

Checked September 2026. Everything below is either live in the app today or
has a concrete, stated blocker. "Free" here means: no card, no paid plan, and
usable from this app's own server proxy.

## Where prices come from (v14)

The dump is downloaded **by the browser**, not by the server.

Two walls, one after the other. Steam and CSFloat rate-limit per IP, and a
Vercel egress address is shared with every tenant on the edge — so per-item
lookups came back 429 or hung on `(pending)`. Moving to a bulk dump fixed the
rate limit and hit the next one: a serverless function is killed at 10
seconds, and a ~15MB download does not reliably finish inside that.

The browser has neither limit — no execution ceiling, its own IP, and it only
has to do this once per session rather than once per invocation.

- `src/lib/priceDumpStore.tsx` — a provider that downloads the dump once,
  keeps it in memory for **30 minutes**, and persists it in **IndexedDB**
  (not localStorage: that caps at ~5MB and is synchronous, so a 15MB dump
  would throw `QuotaExceededError`). A returning user sees prices from the
  persisted copy before any network call is made.
- CORS: the direct fetch is tried first, then `api.allorigins.win` and
  `corsproxy.io` as read-only fallbacks. They only ever GET a public JSON
  file — no credentials, nothing about the user in the URL.
- `src/lib/priceDumpParse.ts` — the parser, shared by the browser store and
  the server module so the two can never disagree about what counts as a
  price.

**Nothing in the app makes a per-item price request any more.** Not the table,
not the add form, not the Steam import, not the wishlist, not the Inspect
page. `useCsfloatPrice`, `useSteamPrice`, `useSkinportPrice` and
`prefetchSteamPrices` are **deleted**, not merely unused — the surest way to
guarantee a component cannot reintroduce a per-item fetch is for it not to
exist. `useLivePriceFetcher` is the single entry point and reads the dump
synchronously; Market.CSGO is the one market still behind a route, because it
is not in the dump, has never been IP-blocked, and answers the whole catalogue
in one cached server-side request.

A price cell shows a figure or "No listings"; there is no per-row loading
state left, because there is nothing to wait for. The one honest spinner is on
the single dump download, shared by the whole page.

**The add form no longer requires a market price.** It used to, back when the
form fetched one per skin — the field was filled in for you, so demanding it
was invisible. Reading from the dump means a skin the dump does not cover
leaves the field empty, which turned "we have no price for this yet" into
"Please enter the current market price" and blocked a perfectly valid holding.
What the user knows is what they PAID; the current price is ours to find.

The server module and `/api/prices` are kept for the routes that still answer
per item (and for anything running without a browser), but they are no longer
on the path the inventory table takes.

## The bulk price dump (the default source since v12)

Steam and CSFloat both rate-limit **per IP**. On a laptop that budget belongs
to one person; on Vercel the egress address is shared with every other tenant
on the edge, so the budget is gone before this app asks for anything — the
symptom was 429 on the very first call, and requests left hanging on
`(pending)` until they timed out. No amount of caching fixes that, because
nothing ever succeeded once.

A per-item API is the wrong shape for a shared address, so the model is
inverted. `src/lib/server/priceDump.server.ts` downloads **one** pre-built
dump of the whole CS2 catalogue with every market's price in it, holds it in
memory for 20 minutes, and answers every lookup as a Map read. A forty-holding
portfolio costs one HTTP request per TTL instead of forty per refresh, and
there is no per-item budget left to exhaust.

| Variable               | Default                                                    | What it does                                                                |
| ---------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| `PRICE_DUMP_URL`       | `https://prices.csgotrader.app/latest/prices.json`         | The dump. `off` disables it and restores per-item calls.                    |
| `PRICE_DUMP_RATES_URL` | `https://prices.csgotrader.app/latest/exchange_rates.json` | FX file used to convert the dump into EUR.                                  |
| `PRICE_DUMP_RATE`      | _(auto, from the FX file)_                                 | Fixed multiplier instead of the FX file. Use `1` for a dump already in EUR. |
| `PRICE_DUMP_TTL_MS`    | `1200000` (20 min)                                         | How long a dump is served before refreshing behind the answer.              |
| `STEAM_LIVE`           | off                                                        | `1` re-enables per-item Steam calls (worth it only on an IP of your own).   |
| `CSFLOAT_LIVE`         | off                                                        | `1` re-enables per-item CSFloat calls.                                      |

**Currency is the thing to get right.** The default dump publishes USD and
every value is multiplied on the way in, so the app keeps working in EUR. If
the FX file cannot be read, a fallback rate is used and a warning is logged
once — a portfolio priced a few percent off is better than a portfolio with no
prices, but it is not something to leave running unnoticed.

**Field names are read tolerantly.** Public dumps spell their fields
differently and change them over time, so each market is described as a list
of candidate paths (`steam.last_24h` → `last_7d` → …, `csgofloat.price`,
`skinport.starting_at` before `suggested_price`) and the first usable number
wins. A schema change upstream costs one line rather than a dead column. A
missing, zero, negative or unparseable value is always "no price" — never 0,
which in a portfolio reads as "this skin is worthless".

`GET /api/prices?names=a|b|c` serves this to the client for every market at
once; the inventory table warms itself with a single call, which is why
switching price source no longer makes any network requests at all.

## Wired up and free today

| Source                 | Endpoint                                            | Key?         | Shape                                  | Where it's used                   |
| ---------------------- | --------------------------------------------------- | ------------ | -------------------------------------- | --------------------------------- |
| Steam Community Market | `priceoverview` / listings render                   | no           | one item per call, tight per-IP budget | portfolio + Inspect               |
| Skinport prices        | `api.skinport.com/v1/items?app_id=730&currency=EUR` | **no**       | whole catalogue in one response        | portfolio + Inspect               |
| Market.CSGO            | `market.csgo.com/api/v2/prices/EUR.json`            | **no**       | whole catalogue in one response        | Inspect only (`scope: "inspect"`) |
| CSFloat                | `csfloat.com/api/v1/listings`                       | **optional** | one item per call                      | portfolio + Inspect               |
| Skinport sales history | `api.skinport.com/v1/sales/history`                 | **no**       | one item per call, 8 req / 5 min       | Inspect only                      |

Two of these changed in this round:

**CSFloat no longer needs a key to read prices.** CSFloat documents `GET
/api/v1/listings` as a public endpoint; only _listing an item for sale_
requires authentication. The proxy used to return HTTP 500 whenever
`CSFLOAT_API_KEY` was unset, so a deployment without a key simply had no
CSFloat prices at all. The key is now sent when it exists and omitted when it
doesn't. Keep setting it in production anyway — an authenticated caller gets a
higher rate ceiling — but the market works out of the box without one.

**Skinport sales history is new.** A second free, key-less Skinport endpoint,
answering a question no price adapter can: not "what is it listed at" but
"what did copies actually sell for, and how many" — min/max/avg/median and
volume over 24h / 7d / 30d / 90d, already in EUR.

Its budget is what shapes the integration: **8 requests per 5 minutes for the
whole deployment**, so it can never price a portfolio (that budget covers eight
holdings). It is an Inspect-page panel only — one item, on demand — behind a
30-minute server cache, a shared in-flight promise per item, and a call-counter
that serves a stale answer (or says "busy") instead of burning someone else's
slot. Brotli (`Accept-Encoding: br`) is mandatory on this endpoint.

### Why Skinport can be a bulk feed and CSFloat cannot

The Market.CSGO pattern — download the whole catalogue occasionally, answer
every lookup from memory — needs a source that publishes every item in one
response. Skinport and Market.CSGO both do. CSFloat does not: its API is a
paginated listings search (50 rows per page, cursor paging), so there is no
dump to cache. Per-item calls remain the only option there, which is exactly
how the existing adapter already works.

## Not free / not connectable yet

**Pricempire** — no free tier. The API plan is $119.90/month (10,000 calls) and
Enterprise $239.90/month (100,000 calls, plus history and inventory
endpoints). To connect it we would need: a paid subscription, an API key in
`PRICEMPIRE_API_KEY`, and a server proxy in the shape of the existing ones. The
code side is roughly a day; the blocker is purely the subscription.

**Skintick** — has a genuinely free tier, but it is key-gated and small: sign-up
for an API key, then **100 requests per day**, latest prices plus 7 days of
history, across 16 markets (Buff163, Bitskins, Waxpeer, DMarket, SkinBaron,
Lis-Skins and others) via `api.skintick.io/v1/items/{name}` with a bearer
token. To connect it we would need: (1) a free account and API key, (2)
`SKINTICK_API_KEY` on the server, (3) a proxy route with aggressive caching.

100 calls/day is the whole story: it is not enough to price a portfolio, or
even to sit on the Inspect page unthrottled — one visitor clicking through
twenty items would spend a fifth of the day's budget. It would be worth having
as a _research_ row (Buff163 is the real prize, since nothing else free
publishes it), cached for hours per item, and it should stay `scope: "inspect"`
in the market registry. The paid Developer tier ($47/month, 5,000/day) is what
would make it a portfolio-wide source.

## What to add next, if the budget is zero

Priority order, all still free:

1. **Surface the data already downloaded.** The Skinport catalogue response
   carries `quantity` and `suggested_price`; Market.CSGO carries 24h volume.
   Both are already in memory on the server and cost nothing extra to show.
2. **Skinport history on the wear table**, reusing the same cached response —
   it returns every requested name in one call (`market_hash_name` is
   comma-delimited), so five wears cost one request, not five.
3. Anything beyond that means a key. Skintick's free tier is the cheapest
   credible next step; Pricempire is not free at any tier.
