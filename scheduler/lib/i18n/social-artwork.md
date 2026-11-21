# Localized scheduler social artwork

All 15 locales have reviewed browser-rendered 1200×630 JPEGs, two translated artwork messages and two translated scheduler metadata messages. The old PNG remains for legacy links. The new artwork omits the outdated purchase claim from that PNG.

Run `node scripts/prepare-social-artwork.mjs --output=/absolute/preview/path` from `scheduler`, serve the previews locally and capture each page in a real browser. Review Arabic shaping/RTL, CJK/Indic glyphs, balanced wrapping and Korean word boundaries. Save reviewed captures in `public/social/<locale>/card.jpg`; register component + renderer + logo, catalog and image SHA-256 hashes in `social-assets.json`. The build's `check-social-artwork.mjs` requires all 15 actual catalogs and distinct images with correct dimensions and matching hashes.

`schedulerMetadata(locale, appUrl)` is pure and request-scoped. The app keeps its existing noindex/nofollow policy. Twitter inherits final page Open Graph values, including overrides. User-authored post text, names, images and publishing behavior are untouched.
