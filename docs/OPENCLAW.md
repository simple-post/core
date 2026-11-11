# OpenClaw and ClawHub

SimplePost is published to ClawHub from `integrations/openclaw` as a compatible bundle plugin. Keeping the package inside `core` makes `skills/simplepost` the source of truth; `scripts/sync-openclaw-bundle.mjs` refreshes and verifies the packaged copy.

The current ClawHub package publisher requires `openclaw.plugin.json` for bundle releases, so the package includes a minimal no-config manifest for registry validation and catalog identity. It is intentionally not a native OpenClaw code plugin: `package.json` does not declare `openclaw.extensions` and the package contains no executable extension entrypoint. Always publish it with `--family bundle-plugin`.

## Keep the packaged skill in sync

```bash
node scripts/sync-openclaw-bundle.mjs
node scripts/sync-openclaw-bundle.mjs --check
```

Commit the synchronized files whenever the canonical skill changes.

## Local verification

```bash
openclaw plugins install ./integrations/openclaw
openclaw plugins inspect simplepost
```

Confirm the installation resolves as a bundle package with the SimplePost skill and MCP server. Complete OAuth when the server first connects, then test account listing, preview, drafting, scheduling, publishing, and inspection. If a direct local-path install selects the native marker instead, test through the ClawHub dry-run or staged bundle artifact and report the mismatch to OpenClaw before publishing.

## Validate and publish

Use the latest ClawHub CLI from the repository root:

```bash
npx --yes clawhub@0.25.1 package validate ./integrations/openclaw
npx --yes clawhub@0.25.1 package publish ./integrations/openclaw --family bundle-plugin --dry-run
npx --yes clawhub@0.25.1 login
npx --yes clawhub@0.25.1 package publish ./integrations/openclaw --family bundle-plugin --wait
```

The catalog icon is `integrations/openclaw/assets/icon.png`, a 512 × 512 PNG under the 512 KiB limit. The unscoped package name is `simplepost`. Before the first real publish, check that the name is available. If publishing under an organization scope, claim or create the ClawHub publisher first and change the package name to the matching scope only after that owner exists.

New releases remain out of public install surfaces until ClawHub's automated security checks and verification complete. Inspect the published package and its file list before announcing it.

For the 1.0.1 review-hardening release, the skill explains write authorization, public media URLs (including drafts and media preflight), TikTok audience selection, and developer-only credential setup. Its default prompt requests a preview without writes. Do not claim the audit findings are cleared until the registry has audited this exact release; local validation and publication dry-run do not establish that.
