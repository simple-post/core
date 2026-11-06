# Remaining authored interface copy

The complete original keyed catalogs remain in `messages/`. New authored-copy overlays live separately in `copy/`; their English phrases are stable keys. Requests merge the selected actual overlay with the original catalog, and widget builds produce the same merged locale module. Missing target files are not fabricated; English source fallback remains visible in this draft until every target is translated and registered in `copy-resources.ts`.

Run `node scripts/extract-ui-copy.mjs` after changing `copy("literal")` calls or `UiCopy source` sentences. It extracts literal authored text and records plural families from `copy-plurals.json`; `--references=/absolute/path.json` writes locations for review. Complete sentences use named values and explicit count plurals. Safe React slots permit links/emphasis to move without translated HTML or attributes. Empty slots retain their original children, so user content is not interpreted as translation syntax.

`node scripts/check-ui-copy.mjs` deliberately fails until all 14 targets exist, cover every phrase/required plural category, retain variables and component slots, and are registered for runtime loading. CI includes this full-surface gate alongside the original main-catalog and artwork checks.

Current first source batch covers billing-page copy and both publishing-option editors, including limits, upload feedback and TikTok privacy display labels. Machine option values, control handlers, IDs and publishing constraints remain unchanged. Remaining app screens, plan metadata, static legal/help pages, administration and residual MCP human messages still require source review and translation before the PR is ready.
