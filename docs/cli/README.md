# CLI development and releases

For users, start with the [CLI guide](https://docs.simplepost.social/cli). It covers installation, secret storage, hosted account sharing, local OAuth, media uploads, and command flags. The [package README](../../cli/README.md) provides a short overview.

Hosted CLI access requires Advanced, Pro, or an active trial. Local CLI publishing uses your own credentials. Both accept local files and public URLs; app-account files upload through Scheduler. CLI posting submits immediately and does not create SimplePost drafts or calendar schedules.

## Develop from source

From the repository root, using Node.js 20+ and Yarn 4.9.2:

```bash
yarn install --immutable
yarn workspace @simple-post/cli build
node cli/bin/run.js --help
yarn workspace @simple-post/cli check
yarn workspace @simple-post/cli test
```

The build includes the workspace SDK. This can differ from the version installed by npm users; see [release scope](https://docs.simplepost.social/release-policy#published-packages-and-hosted-features).

## Releasing To npm

Publishing is automated by [`.github/workflows/release.yml`](../../.github/workflows/release.yml) and driven by git tags. Authentication uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) — no token secret. Each package must be configured on npmjs.com with this repository and the `release.yml` workflow as its trusted publisher.

1. Bump `version` in `cli/package.json` (and `sdk/package.json` if the SDK changed).
2. Commit, then tag and push:

   ```bash
   git tag "sdk-v$(node -p 'require("./sdk/package.json").version')" # SDK release
   git push origin "sdk-v$(node -p 'require("./sdk/package.json").version')"
   # After that SDK version is published, tag the CLI version if releasing the CLI.
   git tag "cli-v$(node -p 'require("./cli/package.json").version')"
   git push origin "cli-v$(node -p 'require("./cli/package.json").version')"
   ```

3. CI verifies the tag matches the package version, runs checks and tests, and publishes.

The npm dist-tag is derived from the version: stable versions publish as `latest`, prerelease versions publish under their prerelease identifier (`cli-v1.1.0-beta.1` → `@simple-post/cli@1.1.0-beta.1` with dist-tag `beta`, installable via `npm i -g @simple-post/cli@beta`).

The CLI depends on `@simple-post/sdk` from the public npm registry, so the SDK version tested by the workspace must already be published and must satisfy the CLI dependency range before a CLI release is tagged.

After publishing, update the docs' pinned npm reference and run its SDK/example checks. A version field on main is not proof that the current implementation has shipped.
