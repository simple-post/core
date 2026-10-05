# SimplePost for n8n

Publish, schedule, or save social media posts as drafts from n8n with [SimplePost](https://simplepost.social). The node posts to every social account connected to your SimplePost workspace, including X, LinkedIn, Instagram, Facebook, Threads, TikTok, YouTube, Pinterest, Bluesky, Telegram, and DEV/Forem.

The package contains two nodes:

| Node                   | Resource    | Operations                                                              |
| ---------------------- | ----------- | ----------------------------------------------------------------------- |
| **SimplePost**         | Post        | Create (publish now, schedule, or save as draft), Get, Get Many, Delete |
|                        | Account     | Get Many                                                                |
|                        | Media       | Upload (from n8n binary data)                                           |
| **SimplePost Trigger** | Post events | Post Published, Post Failed                                             |

The SimplePost node can also be used as a tool by n8n AI agents.

## Installation

**n8n Cloud and self-hosted, after verification:** open the nodes panel, search for **SimplePost**, and select **Install** under **More from the community**. Only instance owners and admins can install community nodes.

**Self-hosted, from npm:** go to **Settings > Community Nodes > Install**, enter `n8n-nodes-simplepost`, and confirm. See the [n8n community node installation guide](https://docs.n8n.io/integrations/community-nodes/installation-and-management/gui-installation/).

## Credentials

1. Connect the social accounts you want to use in the SimplePost app.
2. Open **API Keys** in SimplePost and create a key. API access is included in plans with the API feature. Copy the key immediately; it's only shown once.
3. In n8n, create a **SimplePost API** credential and paste the key.
4. Keep the default **Base URL** (`https://app.simplepost.social`), or enter the URL of your self-hosted Scheduler app.
5. Save. n8n tests the credential by listing your connected accounts.

## Create a post

Add the **SimplePost** node, choose **Post > Create**, pick one or more connected accounts, enter the message, and choose a posting mode:

- **Publish Now** publishes immediately. If any account rejects the post, the node fails the item with the reason. With **Continue On Fail**, the output contains the error and the full SimplePost response.
- **Schedule** publishes at a future date and time. Offset and zone-less dates are converted to UTC.
- **Save as Draft** keeps the post in SimplePost for review.

### Media

Add media items with public image or video URLs. SimplePost imports external files into its own storage and validates them against each platform before publishing.

To post a file produced earlier in the workflow (for example, an AI-generated image or a file from Google Drive), use **Media > Upload** first. It uploads the binary field and returns `url`, `type`, and `filename`, which you can map into the Create operation's media fields with expressions such as `{{ $json.url }}`.

### Additional fields

| Field                    | Purpose                                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Account Options (JSON)   | Platform settings keyed by account ID, such as YouTube `title` and `privacyStatus`, Pinterest `boardId`, or TikTok `privacyLevel` |
| Account Overrides (JSON) | A different `message`, `media`, or `thread` for specific accounts                                                                 |
| Thread (JSON)            | Up to 24 additional segments after the main message                                                                               |
| Image Fit                | Crop or blur-pad images a platform would reject. Requires image fitting on your SimplePost account                                |
| Repost / Repost Delay    | Repost automatically after publishing                                                                                             |
| Quote Post ID            | Quote a published SimplePost post                                                                                                 |
| Idempotency Key          | Retrying with the same key returns the original post instead of publishing again                                                  |

JSON fields accept typed JSON or an expression that returns an object or array. Account option example:

```json
{
	"ACCOUNT_ID": {
		"title": "Launch video",
		"privacyStatus": "public",
		"tags": ["automation", "n8n"]
	}
}
```

Account override example:

```json
{
	"ACCOUNT_ID": { "message": "A LinkedIn-specific version of the post" }
}
```

Thread example:

```json
[{ "message": "Part two" }, { "message": "Part three" }]
```

Use `{{ $execution.id }}` or another stable value as the idempotency key when a workflow may be retried.

## Trigger

The **SimplePost Trigger** starts a workflow when a post is published or fails, whether it was published from n8n, the SimplePost app, the API, or a schedule. When you activate the workflow, n8n registers a SimplePost webhook and removes it when you deactivate the workflow.

Each delivery is verified with its `X-SimplePost-Signature` HMAC and timestamp; unsigned, forged, or stale requests are rejected. The output contains `event`, `createdAt`, and `post` (ID, status, message, publish time, error message, and per-account results).

SimplePost only delivers webhooks to public URLs and allows up to 10 webhooks per account. To test a local n8n instance, expose it through a tunnel and set `WEBHOOK_URL`.

## Example workflows

- **RSS to social:** RSS Feed Trigger → SimplePost (Post > Create, Schedule) with the item title and link.
- **AI image post:** OpenAI (generate image) → SimplePost (Media > Upload) → SimplePost (Post > Create, Publish Now) with `{{ $json.url }}` as the media URL.
- **Failure alerts:** SimplePost Trigger (Post Failed) → Slack message with `{{ $json.post.errorMessage }}`.

## Compatibility

Tested with n8n 2.x. The node uses the SimplePost Scheduler API (`/api/v1`) and requires a SimplePost API key; self-hosted Scheduler apps must run a version that includes the posts, upload presign, and webhooks endpoints.

## Development

This package is standalone and uses npm, separate from the monorepo's Yarn workspaces.

```bash
cd integrations/n8n
npm ci
npm run lint
npm test        # builds, then runs the node:test suite
npm run dev     # starts n8n with the node loaded at http://localhost:5678
```

See [PUBLISHING.md](PUBLISHING.md) for the release and n8n verification process.

## Resources

- [SimplePost API documentation](https://docs.simplepost.social/api-reference)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](LICENSE)
