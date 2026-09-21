## What does this PR do?

Adds SimplePost as an official optional social-media skill. The skill guides Hermes through safe preview, draft, scheduling, publishing, inspection, editing, and discard workflows using SimplePost's hosted OAuth MCP server.

The portable SimplePost skill remains canonical in `simple-post/core`. This Hermes adapter follows the repository's required frontmatter, section order, native-tool language, and verification conventions.

## Related Issue

No issue yet. Duplicate search completed before submission.

## Type of Change

- [x] 🎯 New skill (optional)
- [x] ✅ Tests
- [x] 📝 Documentation update generated from the skill catalog

## Changes Made

- Adds `optional-skills/social-media/simplepost/SKILL.md`.
- Adds an MCP workflow reference covering media, idempotency, result handling, TikTok options, and recovery.
- Adds offline contract tests for account resolution, exact-content preservation, uncertain-write safety, and partial-failure reporting.
- Regenerates only the SimplePost optional-skill documentation, catalog row, and sidebar entry.

## How to Test

1. Run `scripts/run_tests.sh tests/skills/test_simplepost_skill.py -q`.
2. Run `scripts/run_tests.sh tests/skills/test_authoring_standards.py -q`.
3. Run `python website/scripts/generate-skill-docs.py` and confirm a clean second run.
4. Install the skill with `hermes skills install official/social-media/simplepost`.
5. Connect the hosted MCP, complete OAuth, and run `hermes mcp test simplepost`.
6. Verify `list_accounts`, a non-writing preview or validation, and a draft create/inspect/discard flow.

## Submission checklist

- [ ] Search open and merged issues and PRs for `SimplePost` and the MCP endpoint.
- [ ] Rebase on the latest `NousResearch/hermes-agent` `main`.
- [ ] Confirm the description remains at most 60 characters and ends with a period.
- [ ] Confirm author attribution is `Vladimir Haltakov (haltakov), Hermes Agent`.
- [ ] Run the skill-specific and authoring-standard tests.
- [ ] Regenerate docs and remove unrelated generator drift.
- [ ] Test end-to-end with the current Hermes release and record the OS/version.
- [ ] Confirm no real post is published during review unless its exact content and target are explicitly approved.
- [ ] Confirm no token, cookie, account identifier, or private post content appears in commits or logs.
- [ ] Respond to maintainer feedback and update the adapter in `simple-post/core` if upstream review changes its behavior.

## New-skill checks

- [x] Optional rather than bundled: this is a specific hosted-service integration.
- [x] Uses only Hermes tools and the declared SimplePost MCP dependency.
- [x] Supports Linux, macOS, and Windows without platform-specific scripts.
- [x] Includes prerequisites, procedure, pitfalls, and verification.
- [x] Tests use the standard library and pytest without live network calls.
