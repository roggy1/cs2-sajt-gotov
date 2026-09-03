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

`.svg` takes priority if present, `.png` is the fallback. If a file is
missing entirely, the UI just shows the market name as plain text —
nothing breaks.

## Replacing / upgrading

SVG is preferable if you can get it (stays sharp at any size). Name it
`steam.svg` / `skinport.svg` / `csfloat.svg` / `marketcsgo.svg` and it
will be used automatically in place of the PNG.

Sources: Steam is also available in the Simple Icons collection
(simpleicons.org, CC0). Skinport, CSFloat and Market.CSGO logos come from
their own sites.

These are third-party trademarks, used here only to identify each
marketplace. Follow each brand's usage guidelines.
