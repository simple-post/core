# Slack

SimplePost posts messages and files to Slack conversations using a Slack app and the Web API.

## App setup

Create an app at [Slack API Apps](https://api.slack.com/apps), add a redirect URL, and grant these bot scopes:

- `chat:write`
- `chat:write.public`
- `files:write`
- `channels:read`
- `groups:read`

The CLI uses Slack's OAuth v2 installation flow. Configure `SIMPLE_POST_SLACK_CLIENT_ID` and `SIMPLE_POST_SLACK_CLIENT_SECRET`, then run `simplepost account add slack`. The scheduler uses `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`.

For direct SDK credentials, set:

```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_TEAM_ID=T0123456789
SLACK_CHANNEL_ID=C0123456789
```

If Slack token rotation is enabled, also set `SLACK_REFRESH_TOKEN`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, and `SLACK_EXPIRES_AT` (Unix seconds). Connected CLI and scheduler accounts retain these values automatically.

## Posting

```ts
await post({
  content: { text: "Release complete :rocket:" },
  platforms: ["slack"],
  options: {
    slack: {
      channelId: "C0123456789",
      mrkdwn: true,
      unfurlLinks: false,
    },
  },
});
```

Set `threadTs` to reply in a thread and `replyBroadcast` to broadcast a text reply. Images and videos are uploaded with Slack's current external upload flow (`files.getUploadURLExternal` and `files.completeUploadExternal`); the deprecated `files.upload` method is not used.
