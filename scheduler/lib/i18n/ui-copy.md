# Remaining authored interface copy

The complete original keyed catalogs remain in `messages/`. New authored-copy overlays live separately in `copy/`; their English phrases are stable keys. Requests merge the selected actual overlay with the original catalog, and widget builds produce the same merged locale module. Missing target files are not fabricated; English source fallback remains visible in this draft until every target is translated and registered in `copy-resources.ts`.

Run `node scripts/extract-ui-copy.mjs` after changing `copy("literal")` calls or `UiCopy source` sentences. It extracts literal authored text and records plural families from `copy-plurals.json`; `--references=/absolute/path.json` writes locations for review. Complete sentences use named values and explicit count plurals. Safe React slots permit links/emphasis to move without translated HTML or attributes. Empty slots retain their original children, so user content is not interpreted as translation syntax.

`node scripts/check-ui-copy.mjs` deliberately fails until all 14 targets exist, cover every phrase/required plural category, retain variables and component slots, and are registered for runtime loading. CI includes this full-surface gate alongside the original main-catalog and artwork checks.

The source audit now covers authenticated composer/account/billing flows, static legal/help pages, administration, onboarding, calendar and list presentation, client fallback errors and browser WebMCP schemas. MCP widgets carry each host connection's locale in tool-call metadata and translate their authored prompts without translating selected post content. Draft persistence, canonical option IDs, authorization and publishing constraints remain unchanged.

The pull request remains a draft: all 14 overlay targets must be authored and registered, server/MCP/auth/email source coverage must close, and full locale/RTL acceptance must pass before readiness. The source extractor and target gate are independent; a successful build does not establish translation completeness.
