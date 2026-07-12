# SimplePost for Activepieces

Native Activepieces piece for the SimplePost Scheduler API.

## Included actions

- **Create Post** — publish now, schedule, or save a draft with media, threads, account options, overrides, quote posts, repost settings, and idempotency keys.
- **Validate Post** — check content and platform settings before creating a post.

## Credentials

Create a SimplePost API key in the Scheduler app and use it as the Activepieces piece connection. Each action accepts the hosted SimplePost URL by default and can point to a self-hosted Scheduler app.

## Development

```bash
npm install
npm run check
```

The package follows the Activepieces piece framework and is ready to be published as a community npm piece or contributed upstream. See the [Activepieces community publishing guide](https://www.activepieces.com/docs/build-pieces/sharing-pieces/community) for the current publication process.
