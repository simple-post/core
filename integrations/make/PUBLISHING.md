# Publishing the SimplePost Make app

Make apps are not published from a package registry. The app lives in a Make organization, you deploy its code with the Make Apps Editor VS Code extension, and Make reviews it before listing it for all users. This guide goes from an empty Make account to an approved app.

Sources: [Make custom apps documentation](https://developers.make.com/custom-apps-documentation). Each step links to the page it follows.

## 0. Before you start

- [ ] A Make account in the organization that will own the app. Use a SimplePost company account, not a personal one: ownership cannot be transferred easily once the app is public, and Make sends review and maintenance email to the owner.
- [ ] Note your Make zone (`eu1`, `eu2`, `us1`, `us2`). It's in the Make URL, for example `https://eu1.make.com`.
- [ ] A SimplePost account on a plan with API access, with at least two connected social accounts for testing (for example LinkedIn and Bluesky), and an API key from [API keys](https://app.simplepost.social/api-keys). Make's reviewers also need a working account (step 7).
- [ ] VS Code with the [Make Apps Editor](https://marketplace.visualstudio.com/items?itemName=Integromat.apps-sdk) extension (`Integromat.apps-sdk`).
- [ ] `cd integrations/make && npm install && npm test && npm run validate` passes.

## 1. Create a Make API key for the extension

[Generate your API key](https://developers.make.com/custom-apps-documentation/get-started/make-apps-editor/apps-sdk/generation-of-your-api-key)

1. In Make, open your profile → **API access** → **+ Add token**.
2. Select the scopes `sdk-apps:read` and `sdk-apps:write`.
3. Save and copy the token. Make shows it only once.

## 2. Connect VS Code to Make

[Configure VS Code](https://developers.make.com/custom-apps-documentation/get-started/make-apps-editor/apps-sdk/configuration-of-vs-code)

1. Click the Make icon in the VS Code sidebar → **Add environment** (or run `Make Apps: Add SDK Environment`).
2. API URL: `<zone>.make.com/api`, for example `eu1.make.com/api`.
3. Label: `Make <zone>`. Paste the API key from step 1.

## 3. Create the app in Make

[Initial setup in Make](https://developers.make.com/custom-apps-documentation/create-your-first-app/create-your-app) · [App logo](https://developers.make.com/custom-apps-documentation/create-your-first-app/app-logo) · [App naming](https://developers.make.com/custom-apps-documentation/best-practices/naming-conventions/apps)

In Make, go to **Custom Apps** → **+ Create app**:

| Field       | Value |
| ----------- | ----- |
| Name        | `simplepost`. This is the app ID and must match `^[a-z][0-9a-z-]+[0-9a-z]$`. If it's taken, use something like `simplepost-social` and use that ID in step 4. |
| Label       | `SimplePost` |
| Description | `Publish and schedule posts to X, LinkedIn, Instagram, Facebook, Threads, Bluesky, TikTok, YouTube, Pinterest, Telegram, and DEV.` |
| Theme       | `#10120d` |
| Language    | English |
| Audience    | Global |
| Logo        | `integrations/make/assets/make-icon.png` |

About the logo: Make shows white and transparent pixels in the theme colour and black pixels in white ([App logo](https://developers.make.com/custom-apps-documentation/create-your-first-app/app-logo)). The icon is a black SimplePost "SP" mark on a transparent 512×512 PNG (2.5 kB; the limits are 512–2048 px square, PNG, 500 kB at most). With theme `#10120d`, modules show a white SP on SimplePost's near-black. The brand lime `#c6f432` doesn't work as the theme because the white glyph would be unreadable on it. Logo changes can take up to an hour to show.

For a safer workflow, also create a second, empty app named `simplepost-testing` with label `SimplePost Testing` and deploy to it first. See [Manage testing and production app versions](https://developers.make.com/custom-apps-documentation/get-started/make-apps-editor/apps-sdk/manage-testing-and-production-app-versions).

## 4. Point the project at your app

[Create a new app origin](https://developers.make.com/custom-apps-documentation/get-started/make-apps-editor/apps-sdk/local-development-for-apps/create-a-new-app-origin)

1. Open the repository in VS Code. The project file is `integrations/make/src/makecomapp.json`.
2. In `origins[0]`, set:
   - `baseUrl`: `https://<zone>.make.com/api`
   - `appId`: the Name from step 3
   - `appVersion`: `1`
3. If you created a testing app, add a second origin with the same fields and `"label": "SimplePost testing"`.
4. Create `integrations/make/.secrets/apikey` containing only the Make API key from step 1. `.secrets/` is git-ignored. Never commit it.

## 5. Deploy

[Deploy changes to Make](https://developers.make.com/custom-apps-documentation/get-started/make-apps-editor/apps-sdk/local-development-for-apps/deploy-changes-from-local-app-to-make-app)

1. Right-click `src/makecomapp.json` → **Deploy to Make (beta)** and pick the origin (testing first).
2. The app is empty, so the extension asks how to pair each local component. Choose to **create** each new remote component: 1 connection, 2 webhooks, 1 RPC, 10 modules. The extension records the pairings in `origins[].idMapping`.
3. Commit the updated `makecomapp.json` so the pairings are versioned. It contains no secrets.
4. In Make, check that the app now has Base, Readme, one connection, two webhooks, one RPC, and ten modules in three groups (Triggers, Posts, Other).

To bring later edits made in the Make UI back into git, right-click `makecomapp.json` → **Pull changes from Make**. To see differences first, right-click a file → **Compare with Make**.

## 6. Test in scenarios

[Prerequisites › Testing your custom app](https://developers.make.com/custom-apps-documentation/app-review/prerequisites#testing-your-custom-app) · [Debugging pagination](https://developers.make.com/custom-apps-documentation/debug-your-app/debugging-of-pagination-in-list-search-modules)

Reviewers need fresh execution logs for every module, and the logs must not contain personal or sensitive data. Use a test SimplePost account and test social accounts.

1. **Connection**: create a SimplePost connection with a valid key and confirm it saves. Then try an invalid key and confirm you get `[401] …`.
2. **Scenario A, main flow** (one route, no errors): **List accounts** (limit 1) → **Upload a media file** (fed by an **HTTP › Get a file** module with a public test image) → **Validate a post** → **Create a post** (Posting mode: Schedule, 1 hour ahead, media mapped from Upload) → **Get a post** → **Delete a post**.
3. **Scenario B, publish now**: **Create a post** with Posting mode **Publish now** to a test account. Before running it, turn on scenarios C and D.
4. **Scenario C**: **Watch published posts**. Creating the webhook must register it in SimplePost (`GET /api/v1/webhooks` with your key shows the Make URL). Running scenario B must trigger it.
5. **Scenario D**: **Watch failed posts**. Trigger it by publishing an invalid post, for example to Instagram with no media, from scenario B or the SimplePost app.
6. **Scenario E, search** (search modules at the end of a route): **Search posts** with Status **Published** and Limit `150`. You need more than 100 matching posts so the log shows a second page request. Then **Make an API call** with `GET` `/api/v1/accounts`.
7. **Scenario F, error**: **Create a post** with Posting mode **Schedule** and a time in the past. The log should show `[400] …`.
8. Delete scenarios C and D's webhooks in Make and confirm `GET /api/v1/webhooks` no longer lists them (detach works).
9. Run every scenario right before requesting review, and again after each fix. Make deletes old execution logs and reviewers can't see them.

## 7. Publish and request review

[Request app review](https://developers.make.com/custom-apps-documentation/app-review/request-app-review) · [App visibility](https://developers.make.com/custom-apps-documentation/create-your-first-app/app-visibility)

Publishing can't be undone. A published app can't be made private again, and its components can't be deleted. Do steps 1 and 2 only on the production app, and only after testing passes.

1. Remove any test-only modules or connections from the production app.
2. In the app, click **Publish**. The app becomes **public, invite-only**: Make generates an invite link that any Make user can use to install it, whatever their zone. This is enough for early customers.
3. In the **Modules** tab, switch every module to **visible**.
4. Open the new **Review** tab and fill in:
   - API documentation: `https://docs.simplepost.social/api` (reference: `https://docs.simplepost.social/api-reference`)
   - Links to scenarios A–F from step 6
5. Click **Request review**. The app status changes to **pending approval**, and Make emails "App review: SimplePost".
6. Fill in the form linked in that email:
   - Developer relationship: SimplePost is the vendor of the API.
   - Partnership contact and support contact: SimplePost team addresses.
   - Category: Marketing › Social media.
   - Company logo: `scheduler/public/simplepost-logo.png`
   - Service URL: `https://simplepost.social`
   - Confirm trademark ownership and compliance with the terms of the integrated APIs.
7. Reviewers need a working login. Send credentials for a dedicated SimplePost review account on a plan with API access and with test social accounts connected, privately in the email thread. Don't put them in the review form, a scenario, or a log.

## 8. Review stages and timeline

[Review status](https://developers.make.com/custom-apps-documentation/app-review/review-status)

1. **Automatic review (beta)** sends a PDF of issues to the email thread. Fix them, rerun the scenarios, and click **Update review**.
2. **Manual review**: a Make QA engineer checks best practices and usability and replies in the same thread.
3. **Approval**: the app is scheduled into Make's planned release. Make emails you on approval and again on release.

Track progress in **App flow** and in the **Review** tab's status log. Make doesn't publish a review SLA. Plan for several weeks, and longer if there are review rounds ([community report](https://community.make.com/t/custom-app-review-pending-after-all-requested-changes-were-submitted-case-2099406-2082001/114915)).

Alternative while waiting: the [Community Apps program](https://developers.make.com/custom-apps-documentation/community-apps/how-does-it-work) lists invite-only apps on make.com/integrations after a business-only review that usually takes 2–3 business days. Submit through [the submission form](https://f.make.com/submit-your-app) with the invite link from step 7.2 and a landing page. The program requires a Make partnership; see its [terms](https://developers.make.com/custom-apps-documentation/community-apps/terms-and-conditions).

## 9. After approval

[Approved app](https://developers.make.com/custom-apps-documentation/app-review/approved-app) · [Terms of approved app maintenance](https://developers.make.com/custom-apps-documentation/app-maintenance/terms-of-approved-app-maintenance) · [Approval of changes](https://developers.make.com/custom-apps-documentation/app-maintenance/updating-your-app/approved-apps/approval-of-changes-in-approved-app)

- Make gives you a **development version**, tagged "custom app" in the scenario editor. Deploys go there. Changes to the public version need Make's approval, and so do logo and theme changes.
- Obligations: fix issues Make validates from user reports, answer the API checkup Make sends every six months, and watch the [App Improvement Ideas](https://www.make.com/en/app-improvement-ideas/) board. Make can take over an unmaintained app.
- Keep the Scheduler API backwards compatible for these modules: the request fields in `test/definition.test.mjs`, `/api/v1/webhooks`, and the `{ event, createdAt, post }` webhook payload. A breaking API change needs a new app version. See [Managing breaking changes](https://developers.make.com/custom-apps-documentation/app-maintenance/updating-your-app/approved-apps/managing-breaking-changes).

## Review checklist status

From [Prerequisites › Custom app code](https://developers.make.com/custom-apps-documentation/app-review/prerequisites#custom-app-code):

| Requirement | Where |
| --- | --- |
| Base and connection sanitize the API key | `log.sanitize: request.headers.authorization` in base and connection |
| Base and connection have error handling | `[statusCode] error` plus the first platform validation issue |
| Base and connection use a production API endpoint | `https://app.simplepost.social` (connection `baseUrl` default) |
| Connection validates credentials | `GET /api/v1/accounts`, which fails with 401 or 403 for an invalid key or a plan without API access |
| Module labels and descriptions follow conventions | Enforced in `test/definition.test.mjs` |
| Universal module | **Make an API call**, relative path only |
| Interfaces match the output | Post, account, validation, and webhook interfaces with nested specs and samples |
| Dates parsed | Interface `date` types for ISO 8601 UTC fields; `Scheduled for` is a `date` input |
| Search modules have `limit` | **Search posts** and **List accounts**: optional, default 10, last field |
| Pagination | **Search posts** pages at 100 per page until `pagination.hasNextPage` is false. `/api/v1/accounts` isn't paginated. The RPC is capped at 500 |

## Known gaps to raise with reviewers if asked

- **No connection metadata.** The API has no "who am I" endpoint for API keys, so connections can't show the account email. Adding `GET /api/v1/me` to the Scheduler would allow it.
- **Self-hosted base URL.** The connection's advanced **SimplePost URL** lets self-hosted Scheduler users connect. It's non-editable after creation and HTTPS-only, following [Editable connection](https://developers.make.com/custom-apps-documentation/best-practices/connections/editable-connection). If reviewers object, remove the parameter and hardcode `https://app.simplepost.social` in base and connection.
- **Webhook signatures aren't verified** in Make. Make's webhook IML has no access to the raw request body, which the HMAC needs. The Make webhook URL itself is an unguessable secret, and the trigger only accepts its own event type.
- **Media items need ID, file name, and size.** The Scheduler's media schema requires these. **Upload a media file** outputs them ready to map. For external URLs, enter any ID and size `0`; SimplePost measures the file when it imports it.
