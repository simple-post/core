# SimplePost for n8n

Publish immediately, schedule for later, or save drafts across all social accounts connected to [SimplePost](https://simplepost.social) from an n8n workflow.

The node uses the same Scheduler API and API keys as other SimplePost integrations. It supports:

- Connected-account selection loaded from SimplePost
- Publish now, schedule, and draft modes
- Images and videos from public URLs
- Threads
- Per-account content overrides
- Platform-specific account options
- Automatic repost settings
- Quote posts
- Idempotency keys for safe workflow retries
- Multiple n8n input items with correct item linking

## Installation

Once the package is published, install `n8n-nodes-simplepost` from **Settings > Community Nodes** in self-hosted n8n. After n8n verifies the package, n8n Cloud users can find **SimplePost** directly in the node picker.

For local development from this monorepo:

```bash
cd integrations/n8n
yarn dev
```

## Credentials

1. Connect the social accounts you want to use in SimplePost.
2. Open **API Keys** in the SimplePost app.
3. Create a key and copy it immediately; the complete key is only shown once.
4. In n8n, create a **SimplePost API** credential.
5. Paste the key. Keep the default `https://app.simplepost.social` base URL, or enter the URL of your self-hosted Scheduler app.
6. Save the credential. n8n tests it by listing your connected accounts.

## Create a post

Add the **SimplePost** node, choose one or more connected accounts, enter the message, and select a posting mode:

- **Publish Now** sends the post immediately.
- **Schedule** requires a date and time; the node converts it to UTC before sending, so offset and zone-less values work.
- **Save as Draft** keeps the post in SimplePost for later review.

Media URLs must be publicly reachable. `ID`, `Filename`, and `Size in Bytes` can be supplied when known; the node generates an ID, derives a filename, and uses size `0` when they are omitted.

## Advanced API fields

The node keeps complex API maps as JSON so they remain expression-friendly in n8n.

Account options are keyed by connected account ID:

```json
{
  "account_id": {
    "privacyStatus": "public",
    "title": "Video title",
    "tags": ["automation", "n8n"]
  }
}
```

Account overrides can change content per account:

```json
{
  "account_id": {
    "message": "A LinkedIn-specific version of the post"
  }
}
```

Thread JSON is an array of additional segments after the root message:

```json
[
  { "message": "Part two" },
  { "message": "Part three" }
]
```

Use an n8n execution ID or another stable workflow identifier as the idempotency key when a workflow may retry. Reusing the same key returns the original post instead of publishing a duplicate.

## Development

From the `core` repository root:

```bash
yarn install
yarn workspace n8n-nodes-simplepost check
yarn workspace n8n-nodes-simplepost test
```

See [PUBLISHING.md](PUBLISHING.md) for the npm and n8n Creator Portal release process.

## License

MIT
