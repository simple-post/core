# Kiro Power installation and submission

SimplePost uses the Agent Plugins v1 package format supported by Kiro Powers. The repository root contains the required `plugin.json`, optional `mcp.json`, and canonical skill under `skills/simplepost`.

## Install and verify

Install `https://github.com/simple-post/core` as a Power from Kiro, then:

1. Ask Kiro to publish or schedule through SimplePost and confirm the Power activates from the task wording.
2. Complete the browser OAuth flow for the `simplepost` MCP server.
3. Call `list_accounts` and confirm Kiro uses returned account IDs rather than inventing targets.
4. Preview exact copy without creating a post.
5. Save and inspect a draft.
6. Schedule a post with an explicit timezone and inspect the resulting schedule.
7. Publish a test post and verify per-account and thread results are reported.
8. Start an unrelated task and confirm SimplePost does not activate unnecessarily.

The hosted MCP endpoint is production infrastructure. Do not describe it as beta or preview in the application.

## Suggested submission copy

- **Use case:** Social publishing automation
- **Repository:** `https://github.com/simple-post/core`
- **Problem space:** SimplePost gives Kiro a reliable, account-aware workflow for drafting, previewing, publishing, scheduling, and managing social posts across connected platforms. The Power combines portable operational guidance with a production Streamable HTTP MCP server and OAuth, including safe account resolution, idempotent writes, timezone-aware scheduling, and per-target result reporting.
- **Privacy:** `https://app.simplepost.social/privacy`
- **Support:** `support@simplepost.social`

Submit the repository through [kiro.dev/powers/submit](https://kiro.dev/powers/submit/).
