# Cursor installation and verification

## Install for local testing

Clone this repository and install it as a local Agent Plugin through Cursor's **Customize** view. The repository root is the plugin root: it contains `plugin.json`, `mcp.json`, and `skills/`.

When Cursor first connects to the `simplepost` MCP server, complete the browser-based SimplePost OAuth flow. Connect social accounts at [app.simplepost.social](https://app.simplepost.social) before testing publishing workflows.

## Smoke test

1. Ask Cursor to list the SimplePost accounts. Confirm it calls `list_accounts` and uses returned account IDs.
2. Ask for a preview using exact supplied copy. Confirm no post is created.
3. Save a draft and inspect it.
4. Schedule a post for an explicit ISO 8601 time with a timezone.
5. Publish a test post, then inspect the result for per-account or per-thread failures.
6. If a write times out, confirm the retry uses the same idempotency key.

Cursor should continue to expose the skill if MCP authentication is incomplete, while reporting the connection failure.

## Marketplace submission

Submit `https://github.com/simple-post/core` at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish). The canonical skill and shared Agent Plugin manifests are maintained together in this repository.
