## What does this PR do?

Adds SimplePost's vendor-hosted remote MCP server to the Nous-reviewed catalog. The entry is URL-only: Hermes connects to `https://app.simplepost.social/mcp` and completes OAuth using discovery, Dynamic Client Registration, and PKCE. It installs no package and starts no local process.

## Related Issue

No issue yet. Duplicate search completed before submission.

## Type of Change

- [x] ✨ New MCP catalog entry
- [x] 📝 Documentation supplied through manifest metadata

## Changes Made

- Adds `optional-mcps/simplepost/manifest.yaml`.
- Declares HTTP transport and OAuth authentication.
- Adds SimplePost keyword and hostname suggestions.
- Provides first-connection login and restart instructions.

## How to Test

1. Run `scripts/run_tests.sh tests/hermes_cli/test_mcp_catalog.py -q`.
2. Run `hermes mcp install simplepost` from the changed checkout.
3. Complete `hermes mcp login simplepost` in the browser.
4. Run `hermes mcp test simplepost` and confirm tool discovery.
5. Call `list_accounts` and a non-writing `preview_post` or `validate_post` operation.
6. Restart Hermes and confirm the connection refreshes without exposing credentials.

## Security and operations

- The endpoint is HTTPS and returns `401` with OAuth protected-resource metadata when unauthenticated.
- Authorization-server metadata advertises authorization, token, revocation, registration, user-info, and JWKS endpoints.
- OAuth uses authorization code with S256 PKCE and supports public dynamically registered clients.
- The resource advertises `openid`, `email`, `accounts:read`, `posts:read`, `posts:validate`, and `posts:write` scopes.
- The catalog entry executes no local command, bootstrap step, or downloaded package.
- Tokens are managed by Hermes and are not embedded in the manifest.

## Submission checklist

- [ ] Search open and merged issues and PRs for `SimplePost`, `simplepost`, and the endpoint.
- [ ] Rebase on the latest `NousResearch/hermes-agent` `main`.
- [ ] Recheck `https://app.simplepost.social/mcp` and both OAuth metadata documents.
- [ ] Confirm `https://docs.simplepost.social/mcp` is current and publicly accessible.
- [ ] Run the MCP catalog parser tests.
- [ ] Complete OAuth, tool discovery, a read, and a non-publishing validation or preview in current Hermes.
- [ ] Record the tested Hermes version and operating system.
- [ ] Confirm no account data, access token, authorization code, cookie, or private post content appears in commits or logs.
- [ ] Request Nous maintainer security review.
- [ ] Wait for a Nous maintainer to apply `mcp-catalog-reviewed` and rerun the gated CI job.
- [ ] Respond to review feedback and mirror material manifest changes back to `simple-post/core`.
