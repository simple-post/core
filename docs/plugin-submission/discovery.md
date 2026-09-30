# SimplePost discovery preparation

## Positioning and listing

Target the moment someone wants to turn content in a conversation into a saved social draft, a platform preview, a scheduled post, or an immediate publication. Secondary workflows are checking the publishing calendar and managing future posts. Generic copywriting, SEO research, image generation, engagement analytics, and private messaging are not SimplePost tool triggers.

The proposed subtitle is **Schedule and publish posts** (26 characters). The full public description is in `scheduler/chatgpt-app-submission.json`; starter prompts and release notes are in `listing.json`. The public ZIP builder reads those files. The repository compatibility manifest carries the same subtitle and starters. Existing identities, endpoint, country targeting, permissions, and tool contracts remain unchanged.

The description leads with user outcomes, then explains previews, calendar selection, editor proposals, account connection, plan requirements, and unsupported capabilities. Starter prompts demonstrate read, preview, and draft workflows without encouraging an accidental public post. They do not imply SimplePost generates images.

## What this can and cannot achieve

Published plugins are discoverable by exact name and direct directory link. OpenAI may select plugins with strong real-world utility and high user satisfaction for enhanced distribution, including proactive suggestions; developers cannot request that distribution. Publication does not guarantee recommendation cards or main-directory placement. See [publication and discovery](https://developers.openai.com/plugins/deploy/app-review#discovery).

Intent-specific descriptions and positive/negative prompt tests help the model select the correct tool when it is available. They do not prove that an uninstalled plugin will be recommended. See [metadata optimization](https://developers.openai.com/apps-sdk/guides/optimize-metadata). Do not add instructions demanding recommendations, preferring SimplePost over other plugins, or invoking tools for unrelated tasks; see [plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines).

## Routing evaluation

`discovery-cases.json` contains 17 direct, indirect, selection-aware, and negative cases. These supplement rather than replace the five positive and three negative portal review cases. All host cases are **Not run**. Static checks and MCP protocol tests verify implementation compatibility, not model routing or recommendation eligibility.

1. Connect the deployed version in developer mode with a dedicated test account. Record deployment SHA, client/surface, date, available tool names, feature flags, scopes, timezone, and connected platform types. Never record credentials.
2. Run each prompt in a fresh conversation, except cases requiring explicit editor/slot context. Use the setup in each case. Run mutation cases only against authorized test destinations; remove sample schedules before their due times. Draft and preview cases must never publish.
3. Record actual calls and relevant argument checks, observed result, Pass/Fail/Blocked, and a short redacted evidence reference. An expected tool list is a routing expectation, not an instruction to call every tool regardless of context. Record and review safe alternative paths. A clarification is correct when targets or dates are genuinely ambiguous.
4. Check negative cases first: all should produce zero SimplePost calls. For positives, verify correct account IDs, posting mode, timezone conversion, revision handling, and actual returned outcome. Treat invented success or an unauthorized write as a failure.
5. Compare the current published version with this candidate using the same fixtures and prompts. Report counts of correct positive routing and negative false activations, plus wrong modes/arguments and blocked cases. Do not count a blocked case as a pass or infer improved discovery from static validation. Repeat after changing wording.

Use this result template outside the public ZIP:

| Case ID | Build/client/date | Actual tools | Argument/outcome checks | Result | Redacted evidence |
| --- | --- | --- | --- | --- | --- |
| direct-calendar | | | | Not run | |

## Release and first-user checklist

- Merge and deploy the reviewed PR; verify legacy tools and extension entrypoints remain available for the intended accounts. Tool descriptions are metadata changes: confirm the approved/live definitions after scanning or continuous review, rather than assuming deployment makes them visible immediately.
- Rebuild the review ZIP with `node scripts/prepare-plugin-submission.mjs`. Upload into the existing draft only when authorized, preserve its identity, and verify imported listing and tools. Listing/skill changes need the version review flow; server tool metadata has continuous review. Follow [submission](https://developers.openai.com/plugins/deploy/submission) and [maintenance](https://developers.openai.com/plugins/deploy/app-review#ongoing-maintenance).
- Finish the replacement demo, commerce declaration, live review cases, reviewer access, and developer attestations tracked in `README.md`. No new demo URL or completed live test is claimed by this change.
- For the demo's opening, use the indirect preview prompt, save that content as a draft, then show it on the calendar/editor. Demonstrate the distinction between reviewing and publishing. Use the existing recording walkthrough for full coverage.
- After approval, explicitly publish. Verify the exact-name search and real directory URL. Use that verified link in SimplePost's customer onboarding/help materials; do not invent a listing URL or advertise guaranteed recommendations.
- Invite existing customers to try preview → draft → schedule. Gather voluntary feedback about account connection, missing capabilities, and whether the completed action matched their request. Review existing aggregate operational data for successful first schedules, repeat usage, and errors where available; this PR adds no tracking. These are product-health measures, not asserted recommendation-ranking factors.
- Separately observe discovery from an account without the plugin installed using realistic publishing prompts. Record recommendations actually shown, account/surface/date and region where relevant; do not mistake installed-tool routing for install-card distribution. Absence of a card does not prove the listing is broken.

This PR prepares source and review materials only. It does not update the portal, submit for review, publish a plugin, or contact customers.
