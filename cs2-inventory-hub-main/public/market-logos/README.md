# Market logos

Official brand logos shown next to each marketplace's price in the UI.
They are loaded by filename at runtime (see src/components/MarketLogo.tsx),
so replacing one is just a matter of dropping in a new file — no code
changes, no rebuild of any component.

Installed:

    steam.png       64x64, transparent
    skinport.png    64x64, transparent
    csfloat.png     64x64, transparent
    marketcsgo.png  64x64, official Market.CSGO mark

These files live at the site ROOT once served: `public/` is not part of
the URL, so `public/market-logos/steam.png` is fetched as
`/market-logos/steam.png`.

Each market names its own file — extension included — in
`src/lib/markets/registry.ts` (`logo: "steam.png"`). Exactly that one file
is requested, so nothing 404s. If a file is missing entirely, the UI falls
back to a muted initial rather than a fake logo; nothing breaks.

## Replacing / upgrading

SVG is preferable if you can get it (stays sharp at any size). Drop
`steam.svg` in this folder and change that market's `logo` field in
`src/lib/markets/registry.ts` from `"steam.png"` to `"steam.svg"` — one
word, no component changes.

Sources: Steam is also available in the Simple Icons collection
(simpleicons.org, CC0). Skinport, CSFloat and Market.CSGO logos come from
their own sites.

These are third-party trademarks, used here only to identify each
marketplace. Follow each brand's usage guidelines.
