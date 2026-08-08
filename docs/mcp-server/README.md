# MCP Server

Use the MCP server when an AI assistant should validate, publish, or schedule posts for a user through SimplePost.

The MCP server is hosted by the Scheduler app and uses the Scheduler app's connected accounts. Users connect their social accounts once in the web app, then authorize the AI client with OAuth.

The connector uses the shared MCP Apps protocol for interactive schedules and realistic platform previews in both ChatGPT and Claude. Every UI tool also returns model-readable text plus structured JSON data for clients that do not render embedded UI.

Post-related tool responses include the exact root post text, plus thread segments when present, so the conversation history shows what was previewed, posted, scheduled, edited, or discarded.

## When To Use It

Choose MCP when:

- The user wants to tell an AI assistant what to post.
- The assistant should discover available social accounts.
- The assistant should validate content before publishing.
- The assistant should schedule a post without handling raw social platform credentials.

Use the [CLI](../cli/README.md) for shell-driven agents and the [HTTP API server](../http-server/README.md) for backend-to-backend calls.

## Endpoint

For a deployed Scheduler app:

```text
https://your-scheduler-domain.example/mcp
```

Locally, with `NEXT_PUBLIC_APP_URL=http://localhost:3000`:

```text
http://localhost:3000/mcp
```

The public documentation page is available at:

```text
https://your-scheduler-domain.example/mcp-docs
```

## Authentication

The MCP server uses OAuth through the Scheduler app. The AI client receives a bearer token only after the user approves access.

Access tokens are stored only as SHA-256 hashes, expire after 90 days, can be revoked through the OAuth revocation endpoint, and are rejected immediately after revocation. The authorization server metadata advertises the revocation endpoint to compatible clients.

Supported scopes:

| Scope            | Allows                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `accounts:read`  | Listing connected social accounts                                                        |
| `posts:read`     | Inspecting scheduled, posted, and failed posts                                           |
| `posts:validate` | Validating and previewing drafts                                                         |
| `posts:write`    | Uploading media, creating posts, editing scheduled posts, and discarding scheduled posts |

The MCP server does not expose raw social platform credentials to the AI client.

## Available Tools

| Tool                     | Purpose                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `list_accounts`          | Lists connected Scheduler accounts and returns the `accountId` values required by other tools  |
| `upload_media`           | Uploads a ChatGPT file parameter to SimplePost storage and returns a public URL                |
| `validate_post`          | Checks text and media against platform rules without creating anything                         |
| `preview_post`           | Resolves accounts, media count, schedule time, and validation without writing anything         |
| `show_post_preview`      | Renders a saved or unsaved post using the platform preview library and an interactive switcher |
| `create_post`            | Publishes immediately or schedules for later                                                   |
| `inspect_posts`          | Lists scheduled, posted, or failed posts, or inspects a single post by ID                      |
| `show_schedule`          | Renders an interactive day, week, or month calendar with slots and post activity               |
| `get_schedule`           | Returns a day, week, or month schedule as text and structured data without rendering UI        |
| `update_scheduled_post`  | Edits a future scheduled post after validating the resulting content                           |
| `discard_scheduled_post` | Deletes a future scheduled post and its stored media                                           |

## Recommended Agent Workflow

1. Call `list_accounts`.
2. Ask the user to connect accounts in the Scheduler app if none are available.
3. Draft the post and choose target account IDs from `list_accounts`.
4. If media is needed, use a public URL or call `upload_media` when the client has raw file bytes.
5. Call `validate_post` for an explicit validation request, or `preview_post` for posting-detail preflight.
6. Ask for confirmation when content, accounts, media, or timing are not explicit.
7. Call `create_post` with `postingMode: "now"` or `postingMode: "schedule"`.
8. After saving or changing a draft or scheduled post, call `show_post_preview` with its returned `postId`.
9. Inspect the returned summary and per-account results.
10. Use `show_schedule` for visual day, week, or month schedule requests, and `inspect_posts` for searches or compact lists.
11. Use `update_scheduled_post` or `discard_scheduled_post` only for drafts or future scheduled posts after identifying the exact `postId`.

## Tool Naming Contract

- `list_*` enumerates a collection, while `get_*` retrieves a data-only view.
- `validate_*` checks rules without writing.
- `preview_*` computes a non-writing text and structured-data preflight.
- `show_*` renders MCP Apps UI and also returns a useful text fallback.
- `create_*`, `update_*`, `discard_*`, and `upload_*` change stored or external state.

The data/UI pairs are `get_schedule` / `show_schedule` and `preview_post` / `show_post_preview`. Existing tool names remain stable for backward compatibility; `inspect_posts` is the established read/search tool for post records.

### `show_schedule`

```json
{
  "view": "week",
  "date": "2030-05-01",
  "timeZone": "Europe/Berlin"
}
```

The rendered calendar includes recurring posting slots plus scheduled, pending, published, failed, and past posts. The user can navigate between periods or switch between day, week, and month inside the widget.

### `show_post_preview`

Render a saved draft or scheduled post:

```json
{
  "postId": "post_123"
}
```

For content that has not been saved, provide `message` and `accountIds`, with optional root `media` and `thread`. The widget uses `@simple-post/preview-react` and lets the user switch among all selected preview-capable platforms.

## Tool Inputs

### `validate_post` and `preview_post`

```json
{
  "message": "Launch day",
  "accountIds": ["account_123", "account_456"],
  "media": [
    {
      "type": "image",
      "url": "https://cdn.example.com/image.jpg"
    }
  ],
  "postingMode": "schedule",
  "scheduledFor": "2030-05-01T14:30:00Z"
}
```

### `create_post`

```json
{
  "message": "Launch day",
  "accountIds": ["account_123"],
  "postingMode": "now"
}
```

For scheduled posts, `scheduledFor` must be a future ISO 8601 datetime with a timezone offset or `Z`.

### `inspect_posts`

List posts by status:

```json
{
  "status": "scheduled",
  "page": 1,
  "limit": 10
}
```

Inspect one post before editing or discarding it:

```json
{
  "postId": "post_123"
}
```

`status` can be `scheduled`, `posted`, `failed`, or `all`. For `all`, `limit` is applied per status.

### `update_scheduled_post`

```json
{
  "postId": "post_123",
  "message": "Updated launch day copy",
  "scheduledFor": "2030-05-01T16:30:00Z"
}
```

The update is partial. Omitted fields keep their current values. Pass `media: null` or `media: []` to clear root media, and `thread: null` or `thread: []` to clear follow-up thread segments. The tool validates the resulting scheduled post before saving.

### `discard_scheduled_post`

```json
{
  "postId": "post_123"
}
```

Discarding deletes the future scheduled SimplePost record and best-effort deletes its stored media. It does not undo posts that were already published.

## Client Setup

### ChatGPT

The SimplePost directory app is coming soon. Until it is listed, use ChatGPT on the web and add it manually. Open
**Settings → Apps**, enable **Developer mode** under **Advanced settings**, then click **Create** and use the Scheduler
app MCP URL as the MCP server endpoint. The ChatGPT plan or workspace must allow custom MCP apps with write actions.
Scan the tools, create the app, and complete SimplePost OAuth when prompted:

```text
https://your-scheduler-domain.example/mcp
```

### Claude Code

```bash
claude mcp add simplepost https://your-scheduler-domain.example/mcp
```

### Claude Desktop, Cursor, Windsurf, and other clients

The Claude directory listing is coming soon. Until it is listed, open **Settings → Connectors**, click **Add custom
connector**, name it SimplePost, and add a remote MCP server using the same `/mcp` URL. Other clients can use the same
URL. The client should start the OAuth flow automatically when it first needs authorization.

## What MCP Cannot Do

- It cannot connect, disconnect, or re-authenticate social accounts.
- It cannot expose social platform access tokens.
- It cannot edit or discard already published, failed, pending, or due-for-dispatch posts.
- It cannot read analytics or previous social media posts.

Manage social account connections in the Scheduler app.
