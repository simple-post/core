# Mastodon

SimplePost can publish to any Mastodon-compatible instance. The instance URL is part of the account credentials; it is never assumed to be `mastodon.social`.

## Content support

- Text statuses up to the standard Mastodon limit of 500 characters
- Up to four images or videos, including image descriptions
- Public, quiet-public (`unlisted`), followers-only, and mentioned-users-only visibility
- Content warnings, sensitive-media flags, and language codes
- Replies and native thread chains
- Boosts through the repost API

Some instances customize text and media limits. SimplePost validates against Mastodon's standard limits for portable multi-instance behavior; the destination instance remains authoritative.

## SDK

```typescript
await post({
  content: {
    text: "Hello fediverse",
    media: [{ type: "image", path: "./photo.jpg", caption: "Accessible image description" }],
  },
  platforms: ["mastodon"],
  options: {
    mastodon: {
      visibility: "unlisted",
      spoilerText: "Launch update",
      credentials: {
        instanceUrl: "https://mastodon.social",
        accessToken: "...",
      },
    },
  },
});
```

Credentials can also come from:

```bash
MASTODON_INSTANCE_URL=https://mastodon.social
MASTODON_ACCESS_TOKEN=...
```

## Create an access token

On your Mastodon instance, open **Preferences → Development → New application**. Grant these scopes:

- `read:accounts`
- `write:statuses`
- `write:media`

Copy the resulting user access token. Tokens are instance-specific and should be treated as secrets.

## CLI

```bash
simplepost account add mastodon --alias main \
  --instance-url https://mastodon.social \
  --access-token "$MASTODON_ACCESS_TOKEN"

simplepost post --account mastodon:main \
  --text "Hello fediverse" \
  --mastodon-visibility public
```

Interactive account setup prompts for the same instance URL and token.

## Scheduler

Choose Mastodon on the Accounts page, then provide the instance URL and user access token. Per-account composer options control visibility, content warnings, language, and sensitive media. The Scheduler stores the instance URL with the encrypted connected-account credentials.

## API behavior

The self-hosted HTTP server uses the normal account configuration and API posting model. Mastodon credentials require `instanceUrl` and `accessToken`. The hosted Scheduler API and MCP tools accept per-account Mastodon options through `accountOptions`.

See the official Mastodon documentation for [status publishing](https://docs.joinmastodon.org/methods/statuses/), [media uploads](https://docs.joinmastodon.org/methods/media/), and [application registration](https://docs.joinmastodon.org/methods/apps/).
