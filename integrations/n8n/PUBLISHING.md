# Publishing the SimplePost node to n8n

This package is intended to be published as `n8n-nodes-simplepost` on npm and then submitted to n8n for verification. Verified community nodes appear in the node picker on n8n Cloud and self-hosted n8n.

## 1. Accounts and ownership

You need:

- An npm account with permission to publish `n8n-nodes-simplepost`
- Access to the `simple-post/core` GitHub repository settings
- An account in the [n8n Creator Portal](https://creators.n8n.io/)

If the npm package name has never been used, the first trusted-publishing release may need an initial package ownership setup. Follow npm's current trusted publishing flow; do not put a long-lived npm token in the repository unless npm requires a token for the first publication.

## 2. Pre-release checks

From the `core` repository root, run:

```bash
yarn install --immutable
yarn workspace n8n-nodes-simplepost check
yarn workspace n8n-nodes-simplepost test
cd integrations/n8n && npm pack --dry-run
```

Check that the tarball contains only the compiled `dist` files, README, and license. Test the node locally with `yarn workspace n8n-nodes-simplepost dev`, create a real credential, load accounts, and exercise publish-now, scheduled, draft, media, and retry/idempotency workflows against a test SimplePost account.

Before every release, update `integrations/n8n/package.json` and document user-visible changes. n8n requires community-node packages to have names beginning with `n8n-nodes-` (or a scoped equivalent), the `n8n-community-node-package` keyword, node and credential entries in the `n8n` manifest field, and suitable public documentation.

## 3. Configure npm trusted publishing

This repository includes `.github/workflows/publish-n8n.yml`. It publishes through GitHub Actions with npm provenance, which n8n requires for marketplace verification as of May 1, 2026.

On npmjs.com:

1. Open the settings for `n8n-nodes-simplepost`.
2. Under **Publish access > Trusted Publishers**, add **GitHub Actions**.
3. Set repository owner to `simple-post`.
4. Set repository name to `core`.
5. Set workflow filename to `publish-n8n.yml`.
6. Leave the environment blank unless the workflow is later changed to use a GitHub Environment.

The workflow uses OIDC, so no `NPM_TOKEN` repository secret is needed.

## 4. Publish a release

1. Change the version in `integrations/n8n/package.json`, for example from `0.1.0` to `0.1.1`.
2. Run the checks above and commit the version change.
3. Push the commit to `main`.
4. Tag the exact commit using the package version:

   ```bash
   git tag n8n-v0.1.1
   git push origin n8n-v0.1.1
   ```

5. Watch the **Publish n8n node** GitHub Actions workflow.
6. Verify provenance on npm and install the released package into a clean self-hosted n8n instance.

Do not reuse or move a release tag. If publication fails after npm accepted the version, bump to a new version because npm versions are immutable.

## 5. Submit to the official n8n marketplace

Publishing to npm makes this a community node, but it does not make it a verified node in n8n's official discovery UI.

1. Read the current [community node verification guidelines](https://docs.n8n.io/integrations/creating-nodes/build/reference/verification-guidelines/) and [submission instructions](https://docs.n8n.io/integrations/creating-nodes/deploy/submit-community-nodes/).
2. Sign in to the [n8n Creator Portal](https://creators.n8n.io/).
3. Create a submission for the npm package `n8n-nodes-simplepost`.
4. Provide the public GitHub repository, npm package, support/issue URL, documentation URL, and requested author/company details.
5. Confirm that the node integrates one service, uses no runtime dependencies, does not access environment variables or the filesystem, uses English UI copy, and passes `n8n-node lint`.
6. Submit the exact npm version published by the provenance-enabled GitHub workflow.
7. Respond to review feedback with a new npm version and update the Creator Portal submission when requested.

n8n reserves the right to reject submissions and may update its requirements, so re-check the linked official documentation for each submission.

## 6. After verification

After the listing is live:

- Confirm installation from both n8n Cloud and a clean self-hosted instance.
- Replace any temporary npm links in product copy with the final n8n integration/marketplace URL. The scheduler supports `NEXT_PUBLIC_N8N_NODE_URL` for this without another code change.
- Announce the verified version, not an unpublished or prerelease version.
- Keep the credential test and account loader compatible with `/api/v1/accounts`.
- Use semantic versioning. Treat removed fields, changed defaults, or changed output structures as breaking changes.

## Release checklist

- [ ] Version updated and changes documented
- [ ] Lint, build, tests, and `npm pack --dry-run` pass
- [ ] Real test account succeeds for now/schedule/draft and idempotent retry
- [ ] `n8n-vX.Y.Z` tag points to the reviewed commit
- [ ] GitHub Actions publication succeeds with provenance
- [ ] Clean n8n install succeeds
- [ ] Creator Portal submission created or updated
- [ ] Product links updated to the live n8n listing
