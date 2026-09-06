# MCP server

The Scheduler hosts the remote MCP endpoint and keeps connected social credentials on the server. The canonical [MCP guide](https://docs.simplepost.social/mcp) covers client installation, OAuth, tools, drafts, scheduling, media, and interactive previews.

## Client setup

Connect social accounts in the [web app](https://app.simplepost.social/accounts), then follow [ChatGPT](https://docs.simplepost.social/mcp#chatgpt), [Claude](https://docs.simplepost.social/mcp#claude), or [other client setup](https://docs.simplepost.social/mcp#client-setup). Hosted MCP is included in every paid plan and the active trial; no API key is needed for OAuth.

For Claude Code:

```bash
claude mcp add --transport http simplepost https://app.simplepost.social/mcp
```

Run `/mcp` and complete browser authorization. The remote server cannot read local filesystem paths. [Media upload requirements](https://docs.simplepost.social/mcp#media).

## Self-hosting and development

Run the [Scheduler app](../scheduler-app/README.md). Use your deployment's `/mcp` endpoint instead of the hosted origin. Locally it is `http://localhost:3000/mcp`; clients must be able to reach that origin and complete OAuth. The stateless REST server does not host MCP.

Tool registrations live in [`scheduler/lib/mcp/server.ts`](../../scheduler/lib/mcp/server.ts); implementations live in [`scheduler/lib/mcp/tools`](../../scheduler/lib/mcp/tools/). Widgets use MCP Apps with text/structured fallbacks. Build widgets with `yarn workspace @simple-post/scheduler build:mcp-widgets` from the repository root, or use the Scheduler's `dev`/`build` commands which include this step.

## Contract checks

Run `yarn docs:export` from the repository root with a sibling docs checkout, then the docs workspace checks. They verify tool coverage and help links. Update the canonical tool guide with any registration or schema change. Read [release checks](https://docs.simplepost.social/release-policy#documentation-release-checklist).
