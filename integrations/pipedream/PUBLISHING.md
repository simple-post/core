# Publishing SimplePost to Pipedream

Pipedream publishes registry components from its public monorepo, [PipedreamHQ/pipedream](https://github.com/PipedreamHQ/pipedream). There is no self-serve marketplace upload. Publishing has three stages: Pipedream creates the app, Pipedream merges our components PR, and Pipedream's CI publishes the components.

## 1. Request the app integration

Pipedream reviews a components PR for a new app only after the app exists ([PR template](https://github.com/PipedreamHQ/pipedream/blob/master/.github/pull_request_template.md), [contributing docs](https://pipedream.com/docs/components/contributing)).

1. Open the [App / Integration Request issue](https://github.com/PipedreamHQ/pipedream/issues/new?template=app---service-integration.md).
2. Fill in the template:
   - **Name**: `SimplePost`
   - **Developer docs**: `https://docs.simplepost.social/api-reference` and `https://app.simplepost.social/api/openapi.json`
   - **Auth**: API key, sent as `Authorization: Bearer <api_key>`. Ask for these custom fields:
     - `api_key`: secret, required. Label "API Key". Help text: "Create one in SimplePost under API Keys. Starts with `sp_api_`."
     - `base_url`: optional. Label "Base URL". Default `https://app.simplepost.social`. Help text: "Change only for a self-hosted SimplePost Scheduler."
   - **Test request** (to validate a connection): `GET {{custom_fields.base_url}}/api/v1/accounts` with header `Authorization: Bearer {{custom_fields.api_key}}`. It returns `200 {"accounts": [...]}` for a valid key.
   - **Slug**: ask for `simplepost`. The code uses `app: "simplepost"` and keys prefixed `simplepost-`.
   - **App icon**: attach the SimplePost logo (square PNG or SVG).
   - **Actions/triggers**: list the seven components in [README.md](README.md) and link this directory.
3. Wait for Pipedream to integrate the app. They then add `components/simplepost/` (`package.json` and `simplepost.app.mjs`) to the monorepo, and `https://pipedream.com/apps/simplepost` goes live. Pipedream does not publish a turnaround time.
4. Check the app that Pipedream created:
   - The slug is `simplepost`. If it is different, rename the folder, the `app:` value, and the `simplepost-` key prefixes to match before step 3.
   - The `$auth` field names are `api_key` and `base_url`. If they are different, update `_baseUrl()` and `_makeRequest()` in `simplepost.app.mjs`.

## 2. Test privately with the Pipedream CLI

This needs the app to exist, because the components connect through an app account.

1. Install the CLI ([install docs](https://pipedream.com/docs/cli/install)) and run `pd login`.
2. In Pipedream, connect a SimplePost account under **Accounts** with a test API key.
3. From a checkout where the files sit at `components/simplepost/` (for example, your fork after step 3.4), publish each action with a throwaway version ([CLI reference](https://pipedream.com/docs/components/contributing/cli/reference)):

   ```bash
   pd publish components/simplepost/actions/list-accounts/list-accounts.mjs --dev
   pd publish components/simplepost/actions/validate-post/validate-post.mjs --dev
   pd publish components/simplepost/actions/create-post/create-post.mjs --dev
   pd publish components/simplepost/actions/upload-media/upload-media.mjs --dev
   pd publish components/simplepost/actions/get-post/get-post.mjs --dev
   ```

4. In a new workflow, add a step, open **My Actions**, pick each action, and run it ([actions quickstart](https://pipedream.com/docs/components/contributing/actions-quickstart)). Check:
   - **List Accounts** returns your accounts.
   - **Validate Post** reports a too-long X post as invalid.
   - **Create Post** with **Posting Mode** `draft` creates a draft that shows in SimplePost.
   - **Create Post** with **Posting Mode** `schedule` and a time a few minutes out publishes on time.
   - **Upload Media** with a URL, then **Create Post** with that step's `media` output in **Media (JSON)**.
5. Deploy each source and fire a real event:

   ```bash
   pd deploy components/simplepost/sources/post-published-instant/post-published-instant.mjs
   pd deploy components/simplepost/sources/post-failed-instant/post-failed-instant.mjs
   ```

   SimplePost has no webhooks page, so check registrations through the API: `curl -H "Authorization: Bearer $SP_API_KEY" https://app.simplepost.social/api/v1/webhooks` should list one endpoint per source with a `*.m.pipedream.net` URL. Publish a post (and make one fail, for example an Instagram post with no media) and check the events in Pipedream. Delete the sources and run the `curl` again: the endpoints should be gone.

To test against Connect instead of workflows, use `pd publish <file> --connect-environment development` ([CLI reference](https://pipedream.com/docs/components/contributing/cli/reference)).

## 3. Open the components PR

1. Fork [PipedreamHQ/pipedream](https://github.com/PipedreamHQ/pipedream) and clone your fork.
2. Use the pnpm version pinned in the monorepo's `package.json` (currently `pnpm@10.28.2`), then install: `corepack enable && pnpm install`.
3. Create a branch: `git checkout -b simplepost-components`.
4. Copy the components over the scaffold Pipedream created. This keeps your `components/simplepost/` files and replaces theirs:

   ```bash
   rsync -a --delete <simplepost-core>/integrations/pipedream/components/simplepost/ components/simplepost/
   ```

   Then diff `package.json` against Pipedream's scaffold. Keep their `name`, `homepage`, and `author`. Make the version one minor above the scaffold's (for example `0.0.1` to `0.1.0`), as the PR checklist requires. Keep our `dependencies`.
5. Update the lockfile so CI's `pnpm install --frozen-lockfile` passes: `pnpm install -r`, then commit `pnpm-lock.yaml`.
6. Run the checks CI runs ([pull-request-checks.yaml](https://github.com/PipedreamHQ/pipedream/blob/master/.github/workflows/pull-request-checks.yaml)):

   ```bash
   npx eslint components/simplepost
   node scripts/findBadKeys.js $(find components/simplepost -name '*.mjs')
   node --experimental-loader ./scripts/version-strip-loader.mjs scripts/checkComponentAppProp.js $(find components/simplepost -name '*.mjs')
   node scripts/findDuplicateKeys.js
   ```

7. The Markdown spellcheck uses `.wordlist.txt`. Add the words it does not know (case-insensitive): `Bluesky`, `Forem`, `Idempotency`, `Pinterest`, `SimplePost`, `TikTok`.
8. Commit, push, and open a PR against `master` at https://github.com/PipedreamHQ/pipedream/compare. Title it `New Components - simplepost`, a common form for new-app PRs. Fill in the template:
   - **Summary**: list the five actions and two sources, and link the app request issue.
   - **Versioning**: check both boxes (new components are at `0.0.1`, `package.json` is bumped).
   - **New app**: check "already integrated" and link the app issue.
   - **CodeRabbit**: reply to every CodeRabbit comment. Do not mark them resolved yourself.

## 4. Review and release

- Pipedream reviews against their [component guidelines](https://pipedream.com/docs/components/contributing/guidelines) (annotations, prop descriptions with examples, `$summary`, versioning). Expect a QA pass on the actions and requested changes. Pipedream publishes no SLA, so follow up in the [#contribute Slack channel](https://pipedream-users.slack.com/archives/C01E5KCTR16) or on the issue if it stalls.
- After Pipedream merges to `master`, their publish workflow releases the components, and they appear on `https://pipedream.com/apps/simplepost`.
- The README's **Overview**, **Example Use Cases**, and **Getting Started** sections show on the app's marketplace page ([guidelines](https://pipedream.com/docs/components/contributing/guidelines)).
- Registry actions also become tools for Pipedream Connect and the Pipedream MCP server automatically ([MCP docs](https://pipedream.com/docs/connect/mcp)). The `annotations` tell agents that **Create Post** and **Upload Media** write data and the other actions only read.

## How users use it

1. In a Pipedream workflow, add a step and search for **SimplePost**, or start with the **New Post Published (Instant)** or **New Post Failed (Instant)** trigger.
2. Connect a SimplePost account by pasting an API key from SimplePost (**API Keys**). The SimplePost plan must include API access.
3. Choose accounts from the **Account IDs** dropdown and fill in the action's props.

## Updating later

Make changes here first, then repeat stage 3 with a version bump on every changed component and on `package.json` ([versioning rules](https://pipedream.com/docs/components/contributing/guidelines)). If you change `simplepost.app.mjs` or a `common/` file, bump every component that imports it.
