---
name: simplepost
description: Use when an AI agent needs to validate, publish, schedule, inspect, or manage social posts through SimplePost using MCP, CLI, HTTP API, Scheduler app, or TypeScript SDK.
license: MIT
---

# SimplePost

SimplePost provides one posting model across the TypeScript SDK, HTTP API server, Scheduler app, CLI, and MCP server. Use this skill to choose the right interface and avoid common agent mistakes around accounts, media, credentials, validation, scheduling, and partial failures.

## Choose The Interface

- Use **MCP** when the AI client can call tools and the user has accounts connected in SimplePost. Read [references/mcp.md](references/mcp.md).
- Use **CLI** when the agent can run shell commands on a machine where SimplePost CLI accounts are configured. Read [references/cli.md](references/cli.md).
- Use **HTTP API** when calling SimplePost from another backend, service, or language. Read [references/http-server.md](references/http-server.md).
- Use **TypeScript SDK** when editing a TypeScript app or agent that can call `@simple-post/sdk` directly. Read [references/sdk.md](references/sdk.md).
- Use **Scheduler app** when the user needs account connection, OAuth, browser upload, human preview, scheduling UI, or hosted MCP. Read [references/scheduler.md](references/scheduler.md).

If multiple options are available, prefer MCP for AI-user posting, SDK for in-process TypeScript integrations, HTTP for service-to-service integrations, and CLI for local terminal automation.

## Non-Negotiables

- Never invent account IDs, account aliases, board IDs, chat IDs, or scheduler URLs. List accounts when the interface supports it, otherwise ask or point the user to setup.
- Do not expose, print, or ask the model to remember raw social credentials. Use the Scheduler account store, CLI secret store, environment variables, or server accounts file.
- Media sent through MCP or HTTP must be a public URL or an uploaded SimplePost media URL. Local file paths are only appropriate for SDK and local CLI account posting.
- Do not validate or preview by default. `create_post` and HTTP post creation validate before publishing. Validate only when the user asks for validation-only feedback; preview when the user asks for a preview or essential details are missing.
- For scheduling, resolve relative times to an absolute future ISO 8601 datetime with timezone offset or `Z`. Ask for timezone if it is unknown.
- A successful API or tool call can still contain per-platform failures. Always inspect `summary.overallSuccess`, per-account results, and `threadResults` for threads.
- When reporting a preview, scheduled post, draft, edit, discard, or publish result, include the exact root post text and any thread segments in the visible answer.
- Reddit posts require per-account `subreddit` and `title` options. Never guess the target community; use the user's explicit choice.

## Shared Posting Model

SDK and CLI JSON payloads use:

```json
{
  "content": {
    "text": "Launch day",
    "media": [{ "type": "image", "url": "https://cdn.example.com/image.jpg" }]
  },
  "platforms": ["x", "instagram", "linkedin"],
  "options": {
    "common": { "logLevel": "info" },
    "x": { "replyToId": "1234567890" }
  }
}
```

HTTP and MCP use Scheduler-style account targets:

```json
{
  "message": "Launch day",
  "accountIds": ["account_123"],
  "postingMode": "now",
  "media": [{ "type": "image", "url": "https://cdn.example.com/image.jpg" }]
}
```

## Threads

Use the root `message` or `content.text` for the first post and `thread` for follow-up segments where supported. Native thread/reply-chain platforms are `x`, `bluesky`, `threads`, and `telegram`. Other platforms receive the root post only and may surface validation warnings.
