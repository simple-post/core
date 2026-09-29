# SimplePost 3.0.0 submission preparation

This prepares the existing SimplePost draft in Creafex Lab's OpenAI organization. It does not submit or publish the plugin. Public version `3.0.0` matches the existing portal draft; the source plugin version is separate and remains unchanged.

## Prepared artifacts

Run from `core/`:

```sh
node scripts/prepare-plugin-submission.mjs
```

Outputs under `dist/plugin-submission/`:

- `simplepost-3.0.0-review-draft.zip`: portable public upload copy with production MCP endpoint, two skills, onboarding reference, existing branding, listing, release notes, worldwide targeting, and five positive/three negative review cases.
- `chatgpt-app-submission.json`: the portal's form importer, with listing text, all 23 tool annotations and justifications, and the same review cases. The canonical input is `scheduler/chatgpt-app-submission.json`.
- `setup-skill-3.0.0.zip` and `simplepost-skill-3.0.0.zip`: individual skill uploads for the existing draft's Skills section.
- `PACKAGE-STATUS.md`: archive checksum, inventory, and outstanding preparation items.

The public upload excludes private app bindings, credentials, development URLs, compatibility manifests, dependencies, and backend source. Reviewer credentials stay only in the portal's secure Testing field. The original source and saved portal MCP binding are preserved.

## Recording walkthrough

Record actual interactions in the intended ChatGPT host using the new dev connection, a dedicated test account, and sample content. This is a script, not a completed recording. Start your screen recorder before the walkthrough; browser control and screenshots alone do not record a video. Keep passwords, tokens, and unrelated chats out of the recording. Aim for four to six minutes with readable pauses.

1. Show SimplePost's sidebar workspace. Briefly show the no-destination connection screen with a fresh test user, then continue with a ready test account. Explain that assistant authorization and connecting a social destination are separate steps. Confirm at least one destination, timezone `Europe/Berlin`, and the calendar view.
2. Open a new editor. Enter `SimplePost review draft: a small product update.` Select two dedicated test destinations, show both live previews, and edit only one platform's variant. Show autosave, close/reopen, and recover the same working copy. Save as draft; show its draft status without publishing.
3. Focus the editor and ask: `Shorten this draft to one sentence. Show me a suggestion before changing it.` Show the separate AI proposal and unchanged current text. Apply it manually and verify the other variant remains intact.
4. Select a future calendar slot and click its chat action. Show the selected time and timezone in chat context, then clear the selection. Demonstrate that selecting a slot does not schedule anything.
5. On one explicitly chosen test destination, open schedule review for tomorrow at 14:00 Berlin time. Show content, destination, local time, and zone. If you confirm a test schedule, verify the saved timestamp, then return it to draft before its due time. Show a second view changing a saved draft and the editor's conflict message instead of an overwrite.
6. Ask for the standalone preview and standalone week calendar to demonstrate legacy compatibility. Finish with `Show the impressions and follower growth for my last ten LinkedIn posts.` Show the unsupported-analytics explanation without fabricated metrics.

Play back the recording to verify readability, actual results, and absence of secrets. Host it at a reviewer-accessible URL, verify playback without a private login, then add the new URL to `listing.json` as `demo_recording_url`, replace the old URL in the portal, and rebuild the ZIP. The existing legacy demo URL is deliberately omitted from the new public ZIP until the replacement is verified.

## Review case execution status

All five positive and three negative portal cases are **Not run** against the saved version. Local unit, database integration, and fixture-host browser tests support the implementation but do not replace these live host tests. Case 2 requires two dedicated supported destinations for variant isolation; case 4 requires a ready X test account and a deliberate sample schedule. Confirm the reviewer account has this setup and remains accessible without emailed codes, MFA, or a private network.

The drafted positive cases cover sidebar/calendar discovery, persistent draft/preview/recovery, selection and proposals, timezone/schedule review, and legacy interfaces. Negative cases cover engagement analytics, editing already-published social content, and direct messaging. Each case identifies actual tool calls, arguments, and observable results. Correct the setup or expectations if the designated reviewer account differs; do not replace failures with invented success.

## Remaining preparation

- Portal draft updated: listing, five positive/three negative cases, and release notes were imported/saved and checked after a reload. Both skills were uploaded. The setup skill passed; the main workflow skill was scanning at handoff. The portal requires an MCP scan, so the annotation justifications may need reimporting after that scan. No review was submitted and all legal confirmations remain unchecked.
- Replacement recording: the developer will record during dev testing. No new recording URL is available yet.
- Commerce: confirm whether plugin flows direct users to subscribe. The portal currently has the purchase-routing box unchecked; preserve it until the developer answers. Hosted trial/paid-plan requirements are disclosed in the listing. Do not attest that subscription access is a physical-goods sale or invent an exemption.
- Deployment and scan: the saved public draft points to `https://app.simplepost.social/mcp`. After dev passes, deploy this version to production, apply its migration, enable `PLUGIN_EXTENSIONS` for the review account, then scan and verify all expected extension tools/entrypoints. Do not change the public listing's endpoint to dev.
- Skills: verify both skill uploads and scan results. If the portal does not expose the onboarding reference, preserve it in the portable ZIP and report the portal mapping as unverified.
- Reviewer access: preserve secure credentials, add exact login/tenant/sign-in instructions in the secure field, and verify access plus sample-account readiness. No credentials belong in this document or any public archive.
- Developer attestations: the developer must review and complete the portal's legal/policy confirmations themselves. Leave them unchecked during preparation.
- Privacy: the published policy covers preferences, draft content, AI requests, storage, sharing, and account deletion. The implementation now expires editor copies after seven inactive days; consider stating that specific editor-copy retention behavior in the published policy. No legal page was edited by this task.

Listing website, support, privacy, and terms pages were inspected as public pages. The source logo is a square 1254 × 1254 PNG under 5 MiB. Existing portal identity, countries, prompts, screenshots, icons, and MCP URL are preserved unless a specific update is requested. Import success does not mean the MCP scan, live tests, reviewer access, or submission is complete.
