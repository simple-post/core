# Discord Platform-Specific Options

SimplePost publishes to Discord channels through incoming webhooks. Create a webhook in the target channel's **Integrations** settings and keep its URL secret.

## Content Support

- **Text**: Up to 2,000 characters
- **Media**: Up to 10 image or video attachments
- **Requirements**: Text or at least one media attachment
- **Mentions**: Disabled by default to prevent scheduled content from unexpectedly notifying users or roles

## Authentication

Set the webhook URL in the environment when using the SDK or HTTP server:

```bash
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/WEBHOOK_ID/WEBHOOK_TOKEN
```

The CLI and Scheduler app also accept the webhook URL directly when connecting a Discord account. The webhook grants permission to publish to its channel, so handle it like an API token.

## Platform-Specific Options

```typescript
await post({
  content: { text: "Deployment complete" },
  platforms: ["discord"],
  options: {
    discord: {
      username: "Release Bot",
      avatarUrl: "https://example.com/avatar.png",
      threadId: "123456789012345678",
      suppressEmbeds: true,
      suppressNotifications: true,
      allowMentions: false,
    },
  },
});
```

- `username` and `avatarUrl` override the webhook identity for this message.
- `threadId` posts into a thread or forum channel thread available to the webhook.
- `suppressEmbeds` hides automatic link previews.
- `suppressNotifications` sends the message without push notifications.
- `allowMentions` enables Discord's normal mention parsing. It defaults to `false` for safety.

## Media Example

```typescript
await post({
  content: {
    text: "New screenshots",
    media: [
      { type: "image", path: "./screenshot.png" },
      { type: "image", url: "https://cdn.example.com/screenshot-2.png" },
    ],
  },
  platforms: ["discord"],
});
```
