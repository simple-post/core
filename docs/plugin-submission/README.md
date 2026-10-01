# SimplePost 3.0.0 submission preparation

This prepares the existing SimplePost draft in Creafex Lab's OpenAI organization. It does not submit or publish the plugin. Public version `3.0.0` matches the existing portal draft; the source plugin version is separate and remains unchanged.

## Prepared artifacts

Run from `core/`:

```sh
node scripts/prepare-plugin-submission.mjs
```

Outputs under `dist/plugin-submission/`:

- `simplepost-3.0.0-review-draft.zip`: portable public upload copy with production MCP endpoint, two skills, onboarding reference, existing branding, listing, release notes, worldwide targeting, and five positive/three negative review cases.
- `PACKAGE-STATUS.md`: archive checksum, inventory, and outstanding preparation items.

The single ZIP contains both skills, `plugin.json`, `mcp.json`, and the icon. Listing, onboarding, five positive/three negative review cases, commerce declaration, release notes, and country targeting live under `extensions.com.openai` in the packaged manifest. Do not upload skills separately in the current ZIP-based flow. The builder validates the actual archive. For old tooling only, `--legacy-exports` additionally emits the form importer and separate skill ZIPs; those files are not needed for the new flow.

The public upload excludes private app bindings, credentials, development URLs, compatibility manifests, dependencies, and backend source. Reviewer credentials stay only in the portal's secure Testing field. The original source and saved portal MCP binding are preserved.

## ZIP-based submission flow

Follow the [current OpenAI submission guide](https://developers.openai.com/plugins/deploy/submission). Finish the replacement recording first, add its verified URL to `listing.json`, and rebuild. When upload is authorized, open the existing SimplePost plugin draft and use its package update/upload action; do not create a duplicate plugin. Choose the existing verified publisher identity. Upload `simplepost-3.0.0-review-draft.zip`, inspect **Metadata & Skills**, and resolve all scan findings by editing source and rebuilding the complete ZIP. Imported review cases are read-only: update them in source, not the portal.

In **MCPs**, preserve the production endpoint and existing connection. Verify domain ownership, OAuth, and discovered tools; reconnect only if needed, and rescan deployed changes. Run the review cases against the saved version. Reviewer access goes only in secure portal fields. Reupload replaces the bundle and resets attestations; inspect the saved state again. The developer completes legal attestations. **Submit for review** and **Publish** after approval are separate authorized actions. Neither has been performed by this preparation.

Local validation does not verify portal identity, domain ownership, authentication, skill/tool scans, live behavior, or approval.

## Discovery preparation

See [discovery.md](discovery.md) for the proposed positioning, 33-case routing evaluation, evidence template, and publication/first-user checklist. The listing and starter prompts in this branch are proposed updates; they have not been uploaded to the saved portal draft. The generated ZIP remains a review draft with the outstanding items below.

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
- Replacement recording: the current 3.0.0 portal draft contains https://youtu.be/9XTzNhhaRSY (observed 2026-09-30). Playback verification was blocked by a YouTube CAPTCHA. Preserve this saved value; verify actual playback and coverage before adding `demo_recording_url` to the ZIP. Omitting it preserves the saved portal value.
- Commerce: the developer confirmed that direct subscriptions through the plugin are not allowed. The ZIP declares `commerce: false` and explains that hosted access requires an existing trial or paid plan, with no plugin checkout. Confirm imported values when the ZIP is uploaded; this declaration is not a legal attestation.
- Deployment and scan: the saved public draft points to `https://app.simplepost.social/mcp`. After dev passes, deploy this version to production, apply its migration, enable `PLUGIN_EXTENSIONS` for the review account, then scan and verify all expected extension tools/entrypoints. Do not change the public listing's endpoint to dev.
- Skills: both skills and the onboarding reference are included in the single ZIP. Verify their scans under **Metadata & Skills** after upload.
- Reviewer access: preserve secure credentials, add exact login/tenant/sign-in instructions in the secure field, and verify access plus sample-account readiness. No credentials belong in this document or any public archive.
- Developer attestations: the developer must review and complete the portal's legal/policy confirmations themselves. Leave them unchecked during preparation.
- Privacy: the published policy covers preferences, draft content, AI requests, storage, sharing, and account deletion. The implementation now expires editor copies after seven inactive days; consider stating that specific editor-copy retention behavior in the published policy. No legal page was edited by this task.

Listing website, support, privacy, and terms pages were inspected as public pages. The source logo is a square 1254 × 1254 PNG under 5 MiB. Existing portal identity, countries, prompts, screenshots, icons, and MCP URL are preserved unless a specific update is requested. Import success does not mean the MCP scan, live tests, reviewer access, or submission is complete.

ZIP preparation recheck: public website, contact form, privacy policy, and terms were inspected on 2026-09-30. The privacy page identifies Creafex Lab Vladimir Haltakov and covers assistant/MCP data and hosted service practices; the terms cover assistant integrations and subscription access. The existing SP icon was visually inspected and its PNG dimensions/size are validated from the archive. These checks do not constitute legal approval.

## Current portal snapshot (2026-09-30)

Read-only inspection of the existing plugin confirmed:

- Package identity: `app-69f882652190819192ab1c88f1218795`; published version 2.0.0, existing legacy draft 3.0.0. The public upload manifest and its containing folder now preserve that package identity. The repository's development plugin remains named `simplepost`.
- Published metadata/skills: no issues; no skills packaged in 2.0.0. The 3.0.0 legacy draft still has the prior listing copy. No portal content was updated.
- Production MCP: `https://app.simplepost.social/mcp`, authorized, domain verified, MCP key displayed as “Not specified.” Preserve the existing associated app/connection when updating via ZIP and verify association after upload.
- The visible scan lists 12 legacy tools, not the 23 expected with extensions. Verify feature access for the connected reviewer account and scan after deploying the candidate before testing extension cases.
- Server instructions, list_accounts, create_post, inspect_posts, update_scheduled_post, and discard_scheduled_post show “Earlier version live.” The issues list names server instructions and four tools (list_accounts, inspect_posts, update_scheduled_post, discard_scheduled_post). Opened instruction/account findings only state further review is required; no actionable defect was supplied. A new ZIP does not resolve held server updates by itself.
- The saved commerce checkbox is unchecked, consistent with the developer's answer. Demo URL is recorded above but playback remains unverified.

Use the existing plugin's **Upload plugin to make changes**/**Upload new version** action for the new ZIP workflow, rather than importing JSON into the legacy 3.0.0 form. Verify the destination and preserved MCP association after upload; do not create another public plugin.
