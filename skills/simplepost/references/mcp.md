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

## TikTok privacy

TikTok posts through MCP default to public (`PUBLIC_TO_EVERYONE`) when privacy is omitted. The default is applied server-side only to TikTok targets and is preserved when saving drafts, scheduling, and publishing. A generic posting request does not need a privacy question or a creator-info preflight.

Override the audience through `accountOptions`, keyed by the connected account ID:

```json
{
  "accountOptions": {
    "TIKTOK_ACCOUNT_ID": { "privacyLevel": "SELF_ONLY" }
  }
}
```

Supported values are `PUBLIC_TO_EVERYONE` (everyone), `MUTUAL_FOLLOW_FRIENDS` (mutual friends), `FOLLOWER_OF_CREATOR` (followers), and `SELF_ONLY` (only me). Explicit privacy and legacy `visibility` choices take precedence over the default. Existing choices are preserved when editing without replacement settings. Creation and inspection results include `accountOptions`.

TikTok enforces the creator's available audiences at publishing time. If public or another requested audience is unavailable, surface the error and call `get_tiktok_creator_info` to inspect supported choices and posting restrictions. Ask for an alternative; never silently fall back to a different audience.

`postingMode: "draft"` saves a SimplePost draft without publishing. The separate TikTok inbox option, `accountOptions[accountId].publishMode: "draft"`, bypasses the direct-post privacy default. Comments, Duet and Stitch remain off unless explicitly enabled and allowed.

## TikTok photo carousels, music and inbox upload

TikTok supports 1–35 JPEG/WebP photos in the root `media` array, in order. Do not mix images and videos. Use `upload_media` to host attachments on SimplePost's media storage (its domain/prefix must be verified with TikTok); photos need public HTTPS URLs without redirects. Maximum 20 MB per image and 1080p.

Use the same account-scoped options in `create_post`, `preview_post`, `validate_post` and `update_scheduled_post`:

- `autoAddMusic: true`: TikTok selects recommended music for a photo Direct Post.
- `publishMode: "draft"`: upload to TikTok inbox to add music, edit and publish manually. Omit `autoAddMusic` or set false. This does not directly publish.
- `photoCoverIndex`: zero-based cover image index (default 0).
- `title`: up to 90 characters for photos; `description`: up to 4000, defaults to `message`.

For inbox upload **now**, set top-level `postingMode: "now"` and `accountOptions[accountId].publishMode: "draft"`. Top-level `postingMode: "draft"` only saves a SimplePost draft and performs no TikTok upload. `postingMode: "schedule"` schedules the selected TikTok operation. Return the result message to the user: inbox uploads require opening the TikTok notification to finish publishing. A specific song cannot be selected through the photo API.
