# Publishing the SimplePost n8n node

`n8n-nodes-simplepost` is published to npm from GitHub Actions with a provenance statement, then submitted to n8n for verification. Verified nodes can be installed from the nodes panel on n8n Cloud and self-hosted n8n. Since May 1, 2026, n8n only verifies packages published from GitHub Actions with provenance ([n8n: submit community nodes](https://docs.n8n.io/connect/create-nodes/deploy-your-node/submit-community-nodes/)).

Two workflows support this:

- `.github/workflows/check-n8n.yml` lints, builds, tests, and packs the node on pull requests that touch it.
- `.github/workflows/publish-n8n.yml` publishes when an `n8n-vX.Y.Z` tag is pushed. It checks that the tag matches `package.json`, runs the tests, then runs `npm run release`. In GitHub Actions, `n8n-node release` lints, builds, and runs `npm publish` with provenance enabled.

Don't run `npm run release` locally. Outside CI it starts `release-it`, which would bump, tag, and push the whole monorepo with a plain version tag.

## Accounts

- An npm account with two-factor authentication that will own `n8n-nodes-simplepost`. n8n checks that the npm author or maintainer matches the repository, so use the SimplePost maintainer account and keep `author` in `package.json` accurate ([verification guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines/)).
- Admin access to `simple-post/core` on GitHub, to add a temporary secret and push tags.
- An n8n Creator Portal account at [creators.n8n.io](https://creators.n8n.io/nodes).

## Pre-release checks

```bash
cd integrations/n8n
npm ci
npm run lint          # n8n community node rules, strict (Cloud) mode
npm test              # build + node:test suite
npm pack --dry-run    # only dist/, README.md, LICENSE, package.json
npm view n8n-nodes-simplepost   # 404 before the first release
```

Then run `npm run dev`, open http://localhost:5678, and test against a SimplePost test workspace:

1. Create the **SimplePost API** credential; the connection test must pass.
2. Post > Create: publish now, schedule, and draft, with a media URL and a thread.
3. Run the same Create twice with one idempotency key. The second run must return `replayed: true`.
4. Media > Upload from a binary image, then use its `url` in Post > Create.
5. Post > Get, Get Many, and Delete; Account > Get Many.
6. SimplePost Trigger on a public URL (n8n Cloud, a public server, or a tunnel with `WEBHOOK_URL`): activate, publish a post, confirm the execution, deactivate, and confirm the webhook is removed from SimplePost.

## First release (one time)

npm only offers trusted publishing on a package that already exists ([npm trusted publishers](https://docs.npmjs.com/trusted-publishers)). The first version is published by the same workflow with a short-lived token, so it still carries provenance.

1. On npmjs.com, go to **Access Tokens > Generate New Token > Granular Access Token**. Give it **Read and write** package access to all packages (the package doesn't exist yet), a 7-day expiry, and, if your account requires 2FA for writes, **Bypass two-factor authentication**.
2. In GitHub, go to **simple-post/core > Settings > Secrets and variables > Actions** and add a repository secret named `NPM_TOKEN`.
3. Make sure `integrations/n8n/package.json` has `"version": "0.1.0"` on `main`, then tag the merge commit:

   ```bash
   git switch main && git pull
   git tag n8n-v0.1.0
   git push origin n8n-v0.1.0
   ```

4. Watch **Actions > Publish n8n node**. It must finish with `Signed provenance statement` and `+ n8n-nodes-simplepost@0.1.0`.
5. On npmjs.com, open **n8n-nodes-simplepost > Settings > Trusted Publisher**, choose **GitHub Actions**, and enter:
   - Organization or user: `simple-post`
   - Repository: `core`
   - Workflow filename: `publish-n8n.yml`
   - Environment: leave blank
6. On the same page, set **Publishing access** to **Require two-factor authentication and disallow tokens**.
7. Delete the `NPM_TOKEN` GitHub secret and revoke the npm token.

## Later releases

1. On a branch: `cd integrations/n8n && npm version patch --no-git-tag-version` (or `minor` / `major`), add a line to the root `CHANGELOG.md`, and open a PR.
2. Merge after **Check n8n node** passes.
3. Tag the merge commit and push the tag:

   ```bash
   git switch main && git pull
   git tag "n8n-v$(node -p "require('./integrations/n8n/package.json').version")"
   git push origin --tags
   ```

4. The workflow publishes through OIDC; no secret is needed. npm versions are immutable, so if a publish fails after npm accepted the version, bump again rather than moving the tag.

Use semantic versioning. Removing a field, changing a default, or changing output shape is a breaking change. Breaking node changes should also add a new node version (`version: [1, 2]`) rather than changing version 1 behavior.

## Verify the published package

```bash
npm view n8n-nodes-simplepost version dist.attestations
npx @n8n/scan-community-package n8n-nodes-simplepost
```

The npm page must show the **Provenance** badge linking to the workflow run. The scanner is the check n8n runs during verification ([verification guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines/)).

Install it in a clean self-hosted n8n through **Settings > Community Nodes > Install** with `n8n-nodes-simplepost`, then repeat the smoke test.

## Submit for verification

1. Sign in or sign up at [creators.n8n.io](https://creators.n8n.io/nodes).
2. Submit the npm package `n8n-nodes-simplepost`. Give the public repository (`https://github.com/simple-post/core/tree/main/integrations/n8n`), the README as documentation, support at `https://github.com/simple-post/core/issues`, and a short demo video of the credential, a publish, and the trigger if the form asks for one.
3. An automated review runs first (package scan, lint, provenance), followed by a manual review of code, security, credential handling, and UX.
4. Fix any feedback in a new version (see Later releases) and update the submission.

n8n doesn't publish a review timeline. Community reports range from days to several weeks, and the automated stage sometimes stalls. If it's stuck, ask in the n8n community forum or Discord `#community-nodes` ([forum thread](https://community.n8n.io/t/creator-portal-automated-review-stuck-in-progress-for-hours/275867)). n8n may reject nodes that compete with its paid features.

Requirements the reviewers check, and how this package meets them:

| Requirement                                                              | Status                  |
| ------------------------------------------------------------------------ | ----------------------- |
| Name `n8n-nodes-*`, `n8n-community-node-package` keyword, `n8n` manifest | Yes                     |
| Built with `@n8n/node-cli`, `strict: true`, unmodified ESLint config     | Yes                     |
| No runtime dependencies; only `n8n-workflow` (peer) and `node:crypto`    | Yes                     |
| No environment variable or file system access                            | Yes                     |
| MIT license, public repository, README with usage and auth               | Yes                     |
| One service per package; trigger for the same service allowed            | Yes                     |
| English-only UI copy, password-type API key, credential test             | Yes                     |
| Published from GitHub Actions with provenance                            | After the first release |

## After verification

- Set `NEXT_PUBLIC_N8N_NODE_URL` for the production Scheduler (the n8n integration page, or `https://www.npmjs.com/package/n8n-nodes-simplepost`) and redeploy. The API Keys page shows the n8n card only when it's set.
- Install from the nodes panel on n8n Cloud and on a clean self-hosted instance to confirm.
- Announce the verified version.
