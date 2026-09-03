# Price sources — what is wired up, and what each one costs

Checked September 2026. Everything below is either live in the app today or
has a concrete, stated blocker. "Free" here means: no card, no paid plan, and
usable from this app's own server proxy.

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
