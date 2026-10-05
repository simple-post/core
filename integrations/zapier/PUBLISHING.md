# Publishing SimplePost on Zapier

These are the release steps for the public SimplePost integration in the Zapier App Directory. Each requirement links to the Zapier page it comes from. Zapier's checks are listed in the [integration checks reference](https://docs.zapier.com/platform/publish/integration-checks-reference), and its policy is in the [publishing requirements](https://docs.zapier.com/integrations/publish/integration-publishing-requirements).

## 0. Prerequisites (one time)

1. **Zapier developer account with a SimplePost domain admin.** The admin team must include someone whose email is on the homepage domain, `@simplepost.social`. Zapier blocks publishing otherwise ([M005](https://docs.zapier.com/platform/publish/integration-checks-reference#m005), [team requirements](https://docs.zapier.com/integrations/publish/integration-publishing-requirements)). Sign in at <https://developer.zapier.com> and accept the Developer Terms of Service ([U001](https://docs.zapier.com/platform/publish/integration-checks-reference#u001)).
2. **Production API and HTTPS.** The integration calls `https://app.simplepost.social/api/v1/*` and nothing else ([publishing requirements](https://docs.zapier.com/integrations/publish/integration-publishing-requirements)).
3. **Public API docs.** Link <https://docs.simplepost.social/api>. Also publish a short Zapier help page, for example `https://docs.simplepost.social/zapier`, covering how to get an API key, the plan requirement, the 30-second publish-now limit, and the 10-webhook limit.
4. **Reviewer test account.** Zapier needs a non-expiring account for `integration-testing@zapier.com` with every paid feature turned on ([publishing requirements](https://docs.zapier.com/integrations/publish/integration-publishing-requirements)). SimplePost signs in with magic links or Google, so no password reset is needed.
   - Create a complimentary invite in the production database: a `ComplimentaryAccessInvite` row with `planKey = 'pro'`, `accessDurationDays = 3650`, and `expiresAt = null`.
   - In the submission notes, give the reviewer the link `https://app.simplepost.social/invite/<code>`. They sign in as `integration-testing@zapier.com` through the magic link, and the invite gives that account Pro with API access.
   - Ask them to connect a social account that is easy to test, such as a Telegram channel or a Bluesky account, or connect one yourself after they sign in.
5. **Logo.** Use `integrations/zapier/assets/simplepost-512.png`. Zapier requires a square PNG of at least 256×256 in RGBA mode ([M004](https://docs.zapier.com/platform/publish/integration-checks-reference#m004)).

## 1. Build and validate locally

```bash
cd integrations/zapier
npm ci
npm test
npm run check     # zapier-platform validate: expect 0 errors and 0 publishing tasks
npm run build
```

The only expected warning is D026, which flags the self-hosted **SimplePost URL** field for human review. `normalizeBaseUrl` validates that field: it must be HTTPS and must not contain credentials, a query, or a fragment ([D026](https://docs.zapier.com/platform/publish/integration-checks-reference#d026)). Integrations run on Node.js 22 ([CLI docs](https://docs.zapier.com/platform/reference/cli-docs)).

## 2. Register and push a private version

```bash
npx zapier-platform login
npx zapier-platform register "SimplePost" \
  --desc "SimplePost is a social media scheduler that publishes and schedules posts to X, Instagram, LinkedIn, TikTok, YouTube, and more." \
  --url "https://simplepost.social" \
  --audience global \
  --role employee \
  --category social-marketing
npx zapier-platform push
```

- `register` writes `.zapierapprc`. Commit it so later pushes reuse the same integration.
- The description must start with "SimplePost is a", must not mention Zapier, and must be 40 to 140 characters ([M002](https://docs.zapier.com/platform/publish/integration-checks-reference#m002)). The homepage must be the marketing site, not the app login ([M006](https://docs.zapier.com/platform/publish/integration-checks-reference#m006), [publishing requirements](https://docs.zapier.com/integrations/publish/integration-publishing-requirements)).
- In the Platform UI at <https://developer.zapier.com>, under **Integration Home → Settings**, upload the logo and confirm the category ([M001](https://docs.zapier.com/platform/publish/integration-checks-reference#m001)).

## 3. Test with live Zaps

Zapier requires all of the following before it accepts a submission:

- **At least one connected account** created through the integration's auth ([A001](https://docs.zapier.com/platform/publish/integration-checks-reference#a001)).
- **One live Zap for every visible trigger, action, and search.** Each must be turned on with at least one successful run ([S002](https://docs.zapier.com/platform/publish/integration-checks-reference#s002), [T001](https://docs.zapier.com/platform/publish/integration-checks-reference#t001)). Build these five:
  1. New Published Post → any action, such as Slack or Email by Zapier.
  2. New Failed Post → any action. Trigger a failure, for example by posting oversized text to X, or by scheduling to an account and then revoking its token.
  3. Schedule or webhook trigger → SimplePost **Create Post** (publish now and schedule).
  4. Any trigger → SimplePost **Validate Post**.
  5. Any trigger → SimplePost **Find Account**.
- **At least 3 users with live Zaps** ([S001](https://docs.zapier.com/platform/publish/integration-checks-reference#s001)). Invite customers or teammates who do not share a Zapier account:

  ```bash
  npx zapier-platform users:add someone@example.com 1.0.0
  npx zapier-platform users:links   # shareable invite link
  ```

Check that dates in Zap history use ISO 8601 with a timezone ([T003](https://docs.zapier.com/platform/publish/integration-checks-reference#t003)). Check that the trigger fields used in the editor also appear in the live hook payloads ([T004/T006](https://docs.zapier.com/platform/publish/integration-checks-reference#t006)). The integration's unit tests cover both. Use `npx zapier-platform logs` to inspect failures.

## 4. Submit for review

1. Run `npx zapier-platform validate` again and confirm there are 0 publishing tasks.
2. At <https://developer.zapier.com>, open SimplePost → **Integration Home** → **Publish**. Complete the form and click **Submit for Review** ([publish a public integration](https://docs.zapier.com/platform/publish/public-integration)). Have these ready:
   - Description and category from step 2, plus the logo.
   - Homepage `https://simplepost.social`, API docs `https://docs.simplepost.social/api`, and the Zapier help page.
   - The reviewer test account details and invite link from step 0, plus a support email.
3. The version moves to **Pending** and stays **Private**. Zapier says a developer contacts you within 1 week with any outstanding requirements ([publish a public integration](https://docs.zapier.com/platform/publish/public-integration)). Fix the requested items, `push` a new version (bump `version` in `package.json`), and reply in the review thread.

## 5. After approval

1. Zapier marks the integration **Beta** and lists it in the [App Directory](https://zapier.com/apps) with a Beta tag for **90 days**. You can leave beta early by embedding a Zapier embed tool on simplepost.social: one detected signup ends beta the next business day ([publish a public integration](https://docs.zapier.com/platform/publish/public-integration)).
2. Promote the reviewed version if Zapier has not already:

   ```bash
   npx zapier-platform promote 1.0.0
   ```

3. After 90 days the Beta tag is removed, and the integration is enrolled automatically in the [Partner Program](https://zapier.com/developer-platform/partner-program), which provides marketing and support benefits ([publish a public integration](https://docs.zapier.com/platform/publish/public-integration)). Fill in the partner profile, add Zap templates for common workflows (RSS → Create Post, Google Sheets row → Create Post, New Failed Post → Slack), and link the integration from the SimplePost **Integrations** page.

## Releasing updates

```bash
# bump "version" in package.json, then
npm test && npm run check
npx zapier-platform push
npx zapier-platform promote <new-version>
npx zapier-platform migrate <old-version> <new-version>
```

Keep input field keys, sample keys, and trigger keys stable. Removing or renaming any of them breaks existing Zaps and raises the [C002, C003, and C004](https://docs.zapier.com/platform/publish/integration-checks-reference) checks. Keep `zapier-platform-core` on the latest release ([D027](https://docs.zapier.com/platform/publish/integration-checks-reference#d027)).
