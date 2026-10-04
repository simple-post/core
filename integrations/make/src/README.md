SimplePost
==========

[SimplePost](https://simplepost.social) publishes and schedules posts to X, LinkedIn, Instagram, Facebook, Threads, Bluesky, TikTok, YouTube, Pinterest, Telegram, and DEV/Forem from one place.

## Connect SimplePost to Make

1. In SimplePost, open [API keys](https://app.simplepost.social/api-keys) and create a key. API keys need a SimplePost plan with API access.
2. In Make, add a SimplePost module and click **Create a connection**.
3. Paste the key into **API key** and save. Make checks the key by listing your connected accounts.

Self-hosted Scheduler users can enter their Scheduler address under **Show advanced settings** > **SimplePost URL**.

## Modules

### Triggers

- **Watch published posts**: triggers when a post is published.
- **Watch failed posts**: triggers when a post fails to publish to one or more accounts.

Both triggers register a SimplePost webhook automatically and remove it when you delete the Make webhook. SimplePost allows up to 10 webhooks per user.

### Posts

- **Search posts**: lists scheduled, draft, published, or failed posts.
- **Get a post**: returns a post with its publishing status and per-account results.
- **Create a post**: publishes now, schedules, or saves a draft. Supports media, threads, reposts, per-account content, and platform settings.
- **Validate a post**: checks content against each account's platform rules without creating anything.
- **Delete a post**: deletes a post from SimplePost. Published posts stay on the social networks.

### Other

- **Upload a media file**: uploads an image or video from a previous module and returns a media item you can map into **Create a post**.
- **List accounts**: lists your connected social accounts and their IDs.
- **Make an API call**: calls any SimplePost API endpoint with your connection.

## Learn more

- [SimplePost API](https://docs.simplepost.social/api)
- [API reference](https://docs.simplepost.social/api-reference)
- [Support](https://simplepost.social/contact)
