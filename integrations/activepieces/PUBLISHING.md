# Publishing the SimplePost Activepieces piece

Checked against the Activepieces repository and docs on 2026-10-04 (upstream `main` at `1cc3a0d`, release 0.92.0).

## How distribution works now

- **Pieces are bundles.** A piece is built inside the Activepieces monorepo, and `@activepieces/pieces-framework` and `pieces-common` are bundled into it. Those libraries are no longer published to npm; the last npm release is `pieces-framework@0.32.0` from August 2026, while the monorepo is on `0.40.0`. A standalone package built against npm will drift. Always build from an Activepieces checkout. ([Bundling Pieces](https://www.activepieces.com/docs/build-pieces/misc/bundling-pieces))
- **There are three ways to publish** ([Sharing Pieces](https://www.activepieces.com/docs/build-pieces/sharing-pieces/overview)):
  1. **Contribute upstream.** The piece ships as `@activepieces/piece-simplepost` to every Cloud and self-hosted user through the hourly registry sync ([Piece syncing](https://www.activepieces.com/docs/install/architecture/piece-syncing)).
  2. **Publish to npm as a community package.** Each platform admin installs it by package name.
  3. **Upload a private `.tgz`, or push it with `publish-piece-to-api`, to one platform.**
- **Unsolicited upstream PRs are closed automatically.** At the moment, PRs from authors who aren't org members, collaborators, or past contributors are closed by a bot. The exception is a PR that Activepieces has agreed to over Slack, which gets the `keep-open` label. Path 1 needs Activepieces on board before you open the PR. ([CONTRIBUTING.md](https://github.com/activepieces/activepieces/blob/main/CONTRIBUTING.md#pull-requests), [close-external-prs.yml](https://github.com/activepieces/activepieces/blob/main/.github/workflows/close-external-prs.yml))
- **Installing a non-official piece:**
  - On **Activepieces Cloud**, it needs the **Ultimate** plan ("Private pieces"). ([Pricing](https://www.activepieces.com/pricing), [Manage pieces](https://www.activepieces.com/docs/admin-guide/guides/manage-pieces))
  - On **self-hosted Community Edition**, the platform admin can install pieces from npm or from a `.tgz` through `POST /v1/pieces`. This is registered by the CE `communityPiecesModule` ([app.ts](https://github.com/activepieces/activepieces/blob/main/packages/server/api/src/app/app.ts)).
  - Only path 1 reaches every Activepieces user.
- **Servers must be on 0.82.0 or newer** to list newly published pieces, so the piece declares `minimumSupportedRelease: '0.82.0'` ([Piece syncing → Server compatibility](https://www.activepieces.com/docs/install/architecture/piece-syncing)).

## Prerequisites (all paths)

1. Node.js 22.15+ or 24, which `npm start` / `tools/setup-dev.js` enforces, and npm 9+ ([Development setup](https://www.activepieces.com/docs/build-pieces/building-pieces/development-setup)). Bun is installed by the setup script, or you can run `npm i -g bun`. The repo pins `bun@1.4.0`.
2. A SimplePost API key from a plan with API access, for testing.
3. Fork https://github.com/activepieces/activepieces, then clone the fork shallowly ([Fork Repository](https://www.activepieces.com/docs/build-pieces/building-pieces/setup-fork)):
   ```bash
   git clone --depth=1 https://github.com/<you>/activepieces.git
   cd activepieces
   ```
4. Copy the piece in. Run this from the SimplePost repo root:
   ```bash
   node integrations/activepieces/scripts/sync-to-activepieces.mjs ../activepieces
   ```
   The script writes `packages/pieces/community/simplepost` and adds the `@activepieces/piece-simplepost` path to `tsconfig.base.json` in alphabetical order. That entry is required, or the build fails ([piece-builder skill, Step 5](https://github.com/activepieces/activepieces/blob/main/.agents/skills/piece-builder/SKILL.md)). The files match what `npm run create-piece` scaffolds: `package.json` with `workspace:*` deps, `tsconfig.json`, `tsconfig.lib.json`, and `.eslintrc.json` with the import-boundary rule ([create-piece.ts](https://github.com/activepieces/activepieces/blob/main/packages/cli/src/lib/commands/create-piece.ts), [Migrate to bundles](https://www.activepieces.com/docs/build-pieces/misc/migrate-pieces-to-bundles)).
5. Install, then build, lint, and test:
   ```bash
   bun install
   npx turbo run build lint test --filter=@activepieces/piece-simplepost
   ```
   Lint must pass as well as the build, because CI blocks on lint errors ([piece-builder skill](https://github.com/activepieces/activepieces/blob/main/.agents/skills/piece-builder/SKILL.md)). The tests use Vitest and `createMockActionContext` ([Testing Pieces](https://www.activepieces.com/docs/build-pieces/misc/testing-pieces)).
6. Build the publishable bundle:
   ```bash
   npm run build-piece simplepost
   # → packages/pieces/community/simplepost/dist/activepieces-piece-simplepost-<version>.tgz
   ```
   ([Build Custom Pieces](https://www.activepieces.com/docs/build-pieces/misc/build-piece)). If the CLI stops with `TS2339 … deno.ts`, prefix the command with `TS_NODE_TRANSPILE_ONLY=true`. On 2026-10-04 that upstream CLI type error showed up for existing pieces such as `buffer` too, so it isn't caused by this piece.
7. Test end to end in a local instance:
   ```bash
   AP_DEV_PIECES=simplepost npm start   # http://localhost:4200, dev@ap.com / 12345678
   ```
   ([Development setup → Pieces Development](https://www.activepieces.com/docs/build-pieces/building-pieces/development-setup)). Create a connection, run each action, and publish a flow with each trigger. Webhook triggers only fire on a published flow and need a public URL. Expose `localhost:4200` with a tunnel and set `AP_FRONTEND_URL` ([Webhook Trigger → Testing](https://www.activepieces.com/docs/build-pieces/piece-reference/triggers/webhook-trigger)). SimplePost refuses webhook URLs on localhost or private networks.
8. If strings changed, regenerate the i18n source file and copy it back into `integrations/activepieces/piece/src/i18n/`:
   ```bash
   npm run cli pieces generate-translation-file simplepost
   ```
   ([Piece i18n](https://www.activepieces.com/docs/build-pieces/piece-reference/i18n))

## Path 1: list SimplePost in the official catalog (recommended)

1. **Get a go-ahead from Activepieces first.** Contact them through Slack (as a customer) or through the partnership or sales contact on https://www.activepieces.com. Ask them to accept a SimplePost piece and to add `keep-open` to the PR. Without that label the PR is closed on open ([CONTRIBUTING.md](https://github.com/activepieces/activepieces/blob/main/CONTRIBUTING.md#pull-requests)).
2. **Send the logo.** Every official piece loads its logo from `https://cdn.activepieces.com/pieces/<name>.png`, and none of the current community pieces uses another host. Attach `scheduler/public/android-chrome-512x512.png` (512×512 PNG) to the PR and ask the maintainers to upload it as `simplepost.png`. Until they do, the logo shows as broken in dev.
3. **Check `authors`.** `authors: ['haltakov']` must list the GitHub username(s) of whoever maintains the piece.
4. **Prepare the branch** in your fork after the prerequisites, with green build, lint, and test:
   ```bash
   git checkout -b feat/simplepost-piece
   git add packages/pieces/community/simplepost tsconfig.base.json
   git add -p bun.lock
   git commit -m "feat(simplepost): add SimplePost piece"
   git push -u origin feat/simplepost-piece
   ```
   `bun install` adds the new workspace to `bun.lock`. Commit only the `simplepost` hunks: on 2026-10-04 upstream's lockfile also had unrelated version drift (`google-gemini`, `youtube`), so leave those hunks out with `git add -p bun.lock`. Each workspace keeps its dependencies in its own manifest ([AGENTS.md](https://github.com/activepieces/activepieces/blob/main/AGENTS.md)).
5. **Open the PR** against `activepieces/activepieces:main`:
   - Use a conventional-commit title, because CI checks it with `amannn/action-semantic-pull-request`. For example: `feat(simplepost): add SimplePost piece` ([validate-pr-title.yml](https://github.com/activepieces/activepieces/blob/main/.github/workflows/validate-pr-title.yml)).
   - Fill in the template ([pull_request_template.md](https://github.com/activepieces/activepieces/blob/main/.github/pull_request_template.md)):
     - **Description:** what the piece does.
     - **How was this tested:** the commands above, plus the manual run in a local instance.
     - **Breaking change:** "no", since it's a new piece.
     - **Security impact:** you must tick one box. The piece stores an API key, sends outbound HTTP, and verifies webhook HMAC signatures, so tick "yes — security-sensitive". As the mitigation, say that the key is only sent to the configured SimplePost base URL and that webhook payloads are rejected unless the `X-SimplePost-Signature` HMAC matches. CI fails if either section is left untouched.
   - Labels: `🌟 feature` and `🧩 area/third-party-pieces`. If you can't add labels, maintainers will ([AGENTS.md → Pull Requests](https://github.com/activepieces/activepieces/blob/main/AGENTS.md)).
6. **Review.** Greptile posts an automated first review. Resolve its comments before asking for a human review. Reviews favour PRs under about 400 changed lines with green CI ([CONTRIBUTING.md → Code review](https://github.com/activepieces/activepieces/blob/main/CONTRIBUTING.md#code-review)). This piece is about 1,150 lines of source, or about 1,700 with tests and i18n. If they ask, split it into actions first and triggers second. No review turnaround time is published.
7. **Release.** After merge, a GitHub Action builds and publishes `@activepieces/piece-simplepost` to npm, and the piece is available "within a few minutes" ([Contribute](https://www.activepieces.com/docs/build-pieces/sharing-pieces/contribute), [release-pieces.yml](https://github.com/activepieces/activepieces/blob/main/.github/workflows/release-pieces.yml)). Cloud and every self-hosted server on 0.82.0 or later pick it up through the hourly registry sync, with no server upgrade needed ([Piece syncing](https://www.activepieces.com/docs/install/architecture/piece-syncing)).
8. **Later changes.** Edit `integrations/activepieces/piece` here, bump `version` in `piece/package.json`, sync, and open another upstream PR. Bump the patch version for new actions, triggers, optional props, or fixes. Bump the major version when you remove or rename anything or add a required prop. Never rename an action or trigger `name`, because flows store it ([Piece versioning](https://www.activepieces.com/docs/build-pieces/piece-reference/piece-versioning), [piece-builder skill](https://github.com/activepieces/activepieces/blob/main/.agents/skills/piece-builder/SKILL.md)).

## Path 2: community npm package (available today, self-hosted and Ultimate)

1. Sync under our own scope and logo:
   ```bash
   node integrations/activepieces/scripts/sync-to-activepieces.mjs ../activepieces \
     --package-name @simple-post/piece-simplepost \
     --logo-url https://app.simplepost.social/android-chrome-512x512.png
   cd ../activepieces && bun install
   npx turbo run build lint test --filter=@simple-post/piece-simplepost
   ```
   The docs say to rename the package to your own scope and bump the version for each release ([Community (Public NPM)](https://www.activepieces.com/docs/build-pieces/sharing-pieces/community)).
2. Log in with `npm login`, using an account that can publish to the `@simple-post` scope.
3. Publish:
   ```bash
   npm run publish-piece simplepost
   ```
   This builds with turbo, bundles, and refuses to publish if any `workspace:*` or `@activepieces/*` dependency is left in the manifest ([publish-npm-package.ts](https://github.com/activepieces/activepieces/blob/main/tools/scripts/utils/publish-npm-package.ts)).
4. Users install it as a platform admin: **Platform Admin → Catalogue → Pieces → Install Piece**. Choose npm, enter `@simple-post/piece-simplepost` and the exact version ([Manage pieces](https://www.activepieces.com/docs/admin-guide/guides/manage-pieces)). Installed pieces are never auto-updated by the sync job, so admins install each new version themselves ([Piece syncing](https://www.activepieces.com/docs/install/architecture/piece-syncing)).

## Path 3: private piece for one platform

Use this for a design partner or customer who runs their own Activepieces: self-hosted, or Cloud Ultimate.

1. Sync with `--type custom` and the logo override. Package name and version must not collide with what is already installed.
2. Then either:
   - Build with `npm run build-piece simplepost`, and upload `packages/pieces/custom/simplepost/dist/*.tgz` under **Platform Admin → Catalogue → Pieces → Install Piece → Upload File** ([Private](https://www.activepieces.com/docs/build-pieces/sharing-pieces/private)), or
   - Run `npm run publish-piece-to-api`. Enter the folder name `simplepost`, the API URL (e.g. `https://cloud.activepieces.com/api` or `https://<instance>/api`), and a platform API key from Platform Admin settings ([Publish Custom Pieces](https://www.activepieces.com/docs/build-pieces/misc/publish-piece)). For CI, use `AP_API_KEY=… bun run sync-pieces -- --apiUrl https://<instance>/api` ([Custom Pieces CI/CD](https://www.activepieces.com/docs/build-pieces/misc/pieces-ci-cd)).

## Release checklist

- [ ] `version` bumped in `integrations/activepieces/piece/package.json`
- [ ] i18n regenerated if any user-facing strings changed
- [ ] `npx turbo run build lint test --filter=<package>` green in an up-to-date Activepieces checkout
- [ ] `npm run build-piece simplepost` produces a `.tgz` whose `dist/package.json` has no `@activepieces/*` dependencies
- [ ] Manual run against production SimplePost:
  - [ ] connection validates
  - [ ] Create Post works in all three modes
  - [ ] Upload Media → Create Post with the returned URL
  - [ ] Post Published and Post Failed fire on a published flow
  - [ ] disabling the flow removes the webhook from SimplePost
