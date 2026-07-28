# SimplePost MCP

Use MCP when an AI assistant should publish, schedule, draft, validate, inspect, edit, or discard posts through accounts connected in SimplePost.

## Setup

The Scheduler app exposes MCP at:

```text
https://YOUR-SCHEDULER-DOMAIN/mcp
```

Claude Code:

```bash
claude mcp add --transport http simplepost https://YOUR-SCHEDULER-DOMAIN/mcp
```

Cursor-style MCP config:

```json
{
  "mcpServers": {
    "simplepost": {
      "type": "http",
      "url": "https://YOUR-SCHEDULER-DOMAIN/mcp"
    }
  }
}
```

Clients with OAuth support should open the Scheduler authorization flow. If the client cannot complete remote MCP OAuth, use the CLI or HTTP API instead.

## Tool Workflow

1. Call `list_accounts` first. Use returned `accountId` values; never invent them.
2. If media is needed and the user provided a public URL, pass it directly in `media`.
3. If the client exposes an attached/generated file as a tool file parameter, call `upload_media` and use the returned URL.
4. If the post details are explicit, call `create_post` directly with `postingMode: "now"`, `"schedule"`, or `"draft"`.
5. Use `preview_post` for a text and structured-data preflight. Use `show_post_preview` when the user asks to see the rendered post; it provides MCP Apps UI plus a text fallback.
6. Use `validate_post` only when the user asks to validate, check, test, or troubleshoot a draft without creating anything.
7. Use `inspect_posts` to list or inspect drafts, scheduled posts, posted posts, or failed posts.
8. Use `update_scheduled_post` only for drafts or future scheduled posts.
9. Use `discard_scheduled_post` only for drafts or future scheduled posts. It cannot undo already published social posts.
10. After creating or updating a draft or scheduled post, call `show_post_preview` with the returned post ID.
11. Use `get_schedule` for a text or structured-data schedule and `show_schedule` for MCP Apps calendar UI. Use `inspect_posts` for post searches or exact post lookup.

## Naming contract

- `list_*`: enumerate collections.
- `get_*`: retrieve text and structured data without UI.
- `validate_*`: check without writing.
- `preview_*`: compute a non-writing preflight without UI.
- `show_*`: render MCP Apps UI with a text fallback.
- `create_*`, `update_*`, `discard_*`, `upload_*`: mutate stored or external state.

The same remote MCP endpoint and shared MCP Apps metadata work in ChatGPT and Claude. Clients without MCP Apps support still receive the text and structured result.

## Scheduling

For scheduled posts, pass a future ISO 8601 datetime with timezone:

```json
{
  "postingMode": "schedule",
  "scheduledFor": "2026-05-12T09:00:00+02:00"
}
```

Never pass date-only strings or naive local times. Resolve "tomorrow at 9" using the user's timezone before calling the tool.

## Media

MCP media items are:

```json
{ "type": "image", "url": "https://cdn.example.com/image.jpg" }
```

Videos may include `thumbnailUrl`. Some platforms require media: Instagram needs at least one image or video, and YouTube needs a video.

## Result Handling

For immediate publishing, inspect:

- `summary.overallSuccess`
- `postingResults[].success`
- `postingResults[].message` and `error`
- `postingResults[].threadResults` for threads

Always show the exact content that was previewed, created, scheduled, drafted, edited, or discarded.
