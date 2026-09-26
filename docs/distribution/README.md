# ChatGPT and Claude listing refresh

This is a review package for the existing listings. Merging this PR does not submit either listing, publish social content, or change marketplace configuration.

## Ready-to-use assets

- ChatGPT name, subtitle and description: [`scheduler/chatgpt-app-submission.json`](../../scheduler/chatgpt-app-submission.json), `app_info`. Tool annotations and submission tests are unchanged.
- Claude listing copy: [`claude-listing.json`](./claude-listing.json). This is editorial input, not an asserted Claude submission API schema.
- Four starter prompts: [`starter-prompts.ts`](../../scheduler/lib/distribution/starter-prompts.ts). The same prompts appear in the app's assistant selector, with clipboard controls and a manual-copy fallback.
- Interactive concept demo: [`demo.html`](./demo.html). Open locally; it runs entirely offline. Its examples are explicitly illustrative, with no network requests or real account data. Use it to review narrative and captions, not as a screenshot of the live app.
- Actual product recording script: [`recording-script.md`](./recording-script.md). Includes two complete paths and the expected tool evidence. Capture the real interfaces in a dedicated demo account before uploading marketplace screenshots or a video.

The copy starts with a job the user can finish: prepare a first draft, adapt an idea for two accounts, prepare Instagram media, or fill a calendar. It makes the separate social-account connection explicit. Claims about engagement analytics, automatically choosing the best time, and editing already-published posts are excluded because the connector cannot do those things.

## Apply and measure

1. Review the descriptions and run the recording script with a dedicated demo account. Confirm current assistant plan/workspace availability and listing field limits in the publishing UI; this package does not assume them.
2. Use the existing [ChatGPT listing](https://chatgpt.com/plugins/plugin_asdk_app_69f882652190819192ab1c88f1218795) and [Claude listing](https://claude.ai/directory/simplepost). Replace the approved copy and screenshots through their normal update process after owner approval.
3. The app emits `Assistant Starter Copied` only after a successful clipboard write, with a fixed prompt ID and no prompt text or account identity. Configure that Plausible goal when deploying. A copy event measures intent, not use or conversion.
4. Compare connection → first successful publishing → paid conversion for new signups in equivalent time windows after release. Report sample sizes. Do not attribute all direct traffic to a marketplace, or treat MCP, CLI and API credentials as proof of ChatGPT/Claude origin. Use verified OAuth client provenance where available; otherwise keep origin unknown.

## Sources checked September 26, 2026

- [SimplePost MCP guide](https://docs.simplepost.social/mcp): OAuth setup, drafts, previews, schedules, media and limitations.
- [Account prerequisites](https://docs.simplepost.social/accounts): eligible account types and hosted platform availability.
- [OpenAI submission guide](https://developers.openai.com/plugins/deploy/submission): public listing details and review assets.
- [Claude connector setup](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities): directory connection and authorization.

Product behavior is also checked against `scheduler/lib/mcp/server.ts` and its existing contract tests. The listing update retains all tool permissions and safety annotations.
