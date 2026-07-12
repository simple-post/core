# Reddit

SimplePost publishes text, link, and single-image posts to Reddit through Reddit's OAuth Data API.

> Reddit requires explicit approval before an app may use the Data API. Commercial use also requires Reddit's written approval. Apply for access and use credentials belonging to the approved app.

## Content support

- Text/self posts
- Link posts through `options.reddit.url`
- One image, supplied by URL or uploaded through SimplePost's configured media storage
- Titles up to 300 characters
- Optional flair, NSFW, spoiler, and reply-notification settings
- Video and gallery posts are not currently supported

## SDK

```typescript
await post({
  content: { text: "What do you think?" },
  platforms: ["reddit"],
  options: {
    reddit: {
      subreddit: "simplepost",
      title: "Posting to Reddit with SimplePost",
      flairId: "optional-flair-template-id",
    },
  },
});
```

Set credentials through `options.reddit.credentials` or environment variables:

```bash
REDDIT_ACCESS_TOKEN=
REDDIT_REFRESH_TOKEN=
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
REDDIT_EXPIRES_AT=
REDDIT_SUBREDDIT=
REDDIT_TITLE=
REDDIT_USER_AGENT="web:your-app:1.0 (by /u/yourname)"
```

The refresh token, client ID, and client secret allow the SDK to refresh Reddit's short-lived access token.

## CLI

Create an approved Reddit OAuth app with this redirect URI:

```text
http://127.0.0.1:5000/oauth/callback
```

Then connect and post:

```bash
export SIMPLE_POST_REDDIT_CLIENT_ID="..."
export SIMPLE_POST_REDDIT_CLIENT_SECRET="..."

simplepost account add reddit --alias main
simplepost post --account reddit:main \
  --text "Hello Reddit" \
  --reddit-subreddit simplepost \
  --reddit-title "Hello from SimplePost"
```

## Scheduler

Configure `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET`, register
`https://YOUR_HOST/api/connect/callback/reddit` as the OAuth redirect URI, and connect Reddit from the Accounts page. The composer exposes subreddit, title, link, flair, NSFW, and spoiler options.

## API access policy

Review Reddit's current [Data API access guidance](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data) and [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/16471395473812-Moderation-Bots-Tooling) before deploying.
